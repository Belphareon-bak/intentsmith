package cz.intentsmith.companion;

import android.content.Context;
import android.util.Base64;

import androidx.biometric.BiometricManager;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Credential, app-state and lock policy shared by the Capacitor plugin and
 * activity.
 *
 * MD-11 classifies the device token as S3/ST-SECURE.  Every stored value,
 * including the app snapshot, PIN verifier and failure counter, therefore
 * passes through {@link KeystoreVault}.  The PIN remains a fallback for
 * devices without a system credential; it is a lock, not a second
 * authentication factor.
 */
final class LockPolicy {

    static final String K_TOKEN = "auth.token";
    static final String K_DEVICE = "auth.device";
    static final String K_SCOPES = "auth.scopes";
    static final String K_APP_STATE = "app.state";

    // Below the practical WebView storage ceiling, but explicit so compromised
    // page code cannot turn one bridge call into an unbounded vault record.
    static final int MAX_APP_STATE_BYTES = 8 * 1024 * 1024;

    private static final String K_PIN_HASH = "lock.pin.hash";
    private static final String K_PIN_SALT = "lock.pin.salt";
    private static final String K_FAILURES = "lock.failures";

    /** Enough that a guess costs time on a phone without making a real unlock drag. */
    private static final int PBKDF2_ITERATIONS = 120_000;
    static final int MAX_FAILURES = 10;

    private static KeystoreVault vault;
    private static String openError;
    private static boolean attempted;

    private LockPolicy() {}

    enum Outcome { OK, WRONG, WIPED, UNAVAILABLE }
    enum LockKind { SYSTEM, PIN, NONE }

    static final class Result {
        final Outcome outcome;
        final int remaining;

        Result(Outcome outcome, int remaining) {
            this.outcome = outcome;
            this.remaining = remaining;
        }
    }

    /** A failed vault stays failed until explicit recovery; it never looks empty. */
    private static synchronized KeystoreVault vault(Context context) {
        if (!attempted) {
            attempted = true;
            try {
                vault = KeystoreVault.open(context);
                openError = null;
            } catch (Exception error) {
                markUnavailable(error);
            }
        }
        return vault;
    }

    private static synchronized void markUnavailable(Throwable error) {
        vault = null;
        attempted = true;
        String message = error.getMessage();
        openError = error.getClass().getSimpleName()
            + (message == null || message.isEmpty() ? "" : ": " + message);
    }

    static String openError() { return openError; }

    static boolean available(Context context) { return vault(context) != null; }

    static boolean repairRequired(Context context) {
        KeystoreVault store = vault(context);
        if (store == null) return false;
        try {
            return store.repairRequired();
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    static final int SYSTEM_AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    static boolean systemLockAvailable(Context context) {
        try {
            return BiometricManager.from(context.getApplicationContext())
                .canAuthenticate(SYSTEM_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception error) {
            return false;
        }
    }

    static LockKind lockKind(Context context) {
        if (systemLockAvailable(context)) return LockKind.SYSTEM;
        if (pinIsSet(context)) return LockKind.PIN;
        return LockKind.NONE;
    }

    static boolean lockEngaged(Context context) {
        return hasCredential(context) && lockKind(context) != LockKind.NONE;
    }

    static boolean pinIsSet(Context context) {
        KeystoreVault store = vault(context);
        if (store == null) return false;
        try {
            boolean hasHash = store.contains(K_PIN_HASH);
            boolean hasSalt = store.contains(K_PIN_SALT);
            if (hasHash != hasSalt) {
                throw new GeneralSecurityException("incomplete PIN verifier");
            }
            return hasHash;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    static boolean hasCredential(Context context) {
        KeystoreVault store = vault(context);
        return store != null && store.contains(K_TOKEN);
    }

    static int failures(Context context) {
        KeystoreVault store = vault(context);
        if (store == null) return 0;
        try {
            return store.getInt(K_FAILURES, 0);
        } catch (Exception error) {
            markUnavailable(error);
            return 0;
        }
    }

    // ── Credential ─────────────────────────────────────────────────────────

    static boolean saveCredential(Context context, String token, String deviceId, String scopes) {
        KeystoreVault store = vault(context);
        if (store == null) return false;
        Map<String, String> values = new LinkedHashMap<>();
        values.put(K_TOKEN, token);
        values.put(K_DEVICE, deviceId == null ? "" : deviceId);
        values.put(K_SCOPES, scopes == null ? "[]" : scopes);
        try {
            store.putCredential(values);
            return true;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    static String get(Context context, String key, String fallback) {
        KeystoreVault store = vault(context);
        if (store == null) return fallback;
        try {
            return store.getString(key, fallback);
        } catch (Exception error) {
            markUnavailable(error);
            return fallback;
        }
    }

    // ── Encrypted ST-DB snapshot ──────────────────────────────────────────

    static boolean hasAppState(Context context) {
        KeystoreVault store = vault(context);
        return store != null && store.contains(K_APP_STATE);
    }

    static boolean appStateInputValid(String json) {
        if (json == null
                || json.getBytes(StandardCharsets.UTF_8).length > MAX_APP_STATE_BYTES) return false;
        try {
            JSONObject object = new JSONObject(json);
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                // The app-state record owns only the browser client's `is.*`
                // namespace. S3 credential fields have their own records and
                // may never be smuggled into this lower-classification blob.
                if (!key.startsWith("is.")
                        || "is.auth.token".equals(key)
                        || "is.auth.device".equals(key)) return false;
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    /** Logout may carry only cosmetic preferences across key rotation. */
    static boolean preferencesStateInputValid(String json) {
        if (!appStateInputValid(json)) return false;
        try {
            JSONObject object = new JSONObject(json);
            Iterator<String> keys = object.keys();
            while (keys.hasNext()) {
                if (!"is.prefs".equals(keys.next())) return false;
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

    static String readAppState(Context context) {
        return get(context, K_APP_STATE, "{}");
    }

    static boolean saveAppState(Context context, String json) {
        if (!appStateInputValid(json)) return false;
        KeystoreVault store = vault(context);
        if (store == null) return false;
        try {
            store.putStrings(Collections.singletonMap(K_APP_STATE, json), Collections.emptySet());
            return true;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    /** E-LOGOUT is also the recovery path for a corrupt or invalidated key. */
    static synchronized boolean clearAll(Context context) {
        return clearAll(context, null);
    }

    /**
     * Destroy the old key and optionally seed a caller-validated preferences-
     * only app state under a new key. A crash between the two loses preferences
     * but can never leave credential or cached content behind.
     */
    static synchronized boolean clearAll(Context context, String preservedAppState) {
        if (preservedAppState != null && !preferencesStateInputValid(preservedAppState)) return false;
        try {
            KeystoreVault.destroy(context);
            vault = null;
            attempted = false;
            openError = null;
            if (preservedAppState != null) {
                KeystoreVault replacement = vault(context);
                if (replacement == null) return false;
                replacement.putStrings(
                    Collections.singletonMap(K_APP_STATE, preservedAppState),
                    Collections.emptySet());
            }
            return true;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    // ── PIN ────────────────────────────────────────────────────────────────

    static boolean setPin(Context context, String pin) {
        KeystoreVault store = vault(context);
        if (store == null || pin == null || pin.length() < 4) return false;
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        Map<String, String> values = new LinkedHashMap<>();
        try {
            values.put(K_PIN_SALT, Base64.encodeToString(salt, Base64.NO_WRAP));
            values.put(K_PIN_HASH, Base64.encodeToString(derive(pin, salt), Base64.NO_WRAP));
            values.put(K_FAILURES, "0");
            store.putStrings(values, Collections.emptySet());
            return true;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    static boolean clearPin(Context context, String pin) {
        Result result = verify(context, pin);
        if (result.outcome != Outcome.OK) return false;
        KeystoreVault store = vault(context);
        if (store == null) return false;
        try {
            store.putStrings(
                Collections.singletonMap(K_FAILURES, "0"),
                names(K_PIN_HASH, K_PIN_SALT));
            return true;
        } catch (Exception error) {
            markUnavailable(error);
            return false;
        }
    }

    /** Verify and persist the attempt before returning it to the caller. */
    static synchronized Result verify(Context context, String pin) {
        KeystoreVault store = vault(context);
        if (store == null) return new Result(Outcome.UNAVAILABLE, 0);
        try {
            if (!store.contains(K_PIN_HASH)) return new Result(Outcome.OK, MAX_FAILURES);

            if (matches(store, pin)) {
                store.putStrings(
                    Collections.singletonMap(K_FAILURES, "0"),
                    Collections.emptySet());
                return new Result(Outcome.OK, MAX_FAILURES);
            }

            int count = store.getInt(K_FAILURES, 0) + 1;
            if (count >= MAX_FAILURES) {
                // The final failed attempt and credential removal are one
                // commit.  A process death must not leave attempt 10 recorded
                // while the credential it was meant to revoke survives.
                store.putStrings(
                    Collections.singletonMap(K_FAILURES, Integer.toString(count)),
                    names(K_TOKEN, K_DEVICE, K_SCOPES, K_APP_STATE));
                return new Result(Outcome.WIPED, 0);
            }
            store.putStrings(
                Collections.singletonMap(K_FAILURES, Integer.toString(count)),
                Collections.emptySet());
            return new Result(Outcome.WRONG, MAX_FAILURES - count);
        } catch (Exception error) {
            markUnavailable(error);
            return new Result(Outcome.UNAVAILABLE, 0);
        }
    }

    private static boolean matches(KeystoreVault store, String pin) throws Exception {
        if (pin == null) return false;
        byte[] salt = Base64.decode(store.getString(K_PIN_SALT, ""), Base64.NO_WRAP);
        byte[] expected = Base64.decode(store.getString(K_PIN_HASH, ""), Base64.NO_WRAP);
        return MessageDigest.isEqual(derive(pin, salt), expected);
    }

    private static byte[] derive(String pin, byte[] salt) throws GeneralSecurityException {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, PBKDF2_ITERATIONS, 256);
        try {
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return factory.generateSecret(spec).getEncoded();
        } finally {
            spec.clearPassword();
        }
    }

    /** Java 8-compatible collection factory for the Android 7 runtime floor. */
    private static Set<String> names(String... values) {
        return new HashSet<>(Arrays.asList(values));
    }
}
