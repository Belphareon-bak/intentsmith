package cz.intentsmith.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import androidx.biometric.BiometricManager;

import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

import org.json.JSONObject;

/**
 * The store and the lock, in one place because they are one decision.
 *
 * `MD-11` says the device token is **S3** and belongs in `ST-SECURE`,
 * "výhradně".  A PWA has no such place: `localStorage` is readable by anything
 * that can reach the profile directory, it goes out in backups, and it cannot
 * be sealed while the app is in the background.  That — not a missing screen —
 * is why `MR-22` and `MR-23` were `PARTIAL` "pod úložištním limitem PWA".
 *
 * Two callers need this and they run at different times: {@link VaultPlugin}
 * answers the WebView, {@link MainActivity} answers the lifecycle before any
 * WebView exists.  Putting the rules in a third place keeps them from drifting
 * — a lock the activity enforces and the plugin does not is not a lock.
 *
 * ── Properties ─────────────────────────────────────────────────────────────
 *
 *   * **Encrypted at rest under a Keystore key.**  The master key never enters
 *     the app's address space, so the ciphertext is useless off the device.
 *
 *   * **The PIN is never stored.**  PBKDF2-HMAC-SHA256, per-install random
 *     salt, constant-time comparison.  A four-digit secret is weak against an
 *     offline attack by construction; the iteration count is what makes each
 *     guess cost real time, and the attempt counter lives here rather than in
 *     the WebView so that reloading the page does not reset it.
 *
 *   * **Ten wrong PINs wipe the credential, not the app.**  Somebody who does
 *     not know the PIN is not the owner; the honest cost of being wrong is
 *     re-pairing from the desktop, which is the recovery `MD-11` already
 *     describes for a lost device.
 *
 * This is a **lock**, not a second factor: it buys time between "phone lost
 * while unlocked" and "device revoked on the desktop" (`P-9`).  See
 * `docs/mobile/FINAL-PROTOTYPE.md`.
 */
final class LockPolicy {

    static final String K_TOKEN = "auth.token";
    static final String K_DEVICE = "auth.device";
    static final String K_SCOPES = "auth.scopes";

    // Contains only the salted PIN verifier and attempt count. Credentials and
    // domain data live as AES-GCM ciphertext in KeystoreStorage.
    private static final String PREFS_FILE = "intentsmith.lock_policy.v2";
    private static final String K_PIN_HASH = "lock.pin.hash";
    private static final String K_PIN_SALT = "lock.pin.salt";
    private static final String K_FAILURES = "lock.failures";

    /** Enough that a guess costs time on a phone; not so much that a real unlock drags. */
    private static final int PBKDF2_ITERATIONS = 120_000;
    static final int MAX_FAILURES = 10;

    private static SharedPreferences prefs;
    private static String openError;
    private static boolean attempted;

    private LockPolicy() {}

    enum Outcome { OK, WRONG, WIPED, UNAVAILABLE }

    static final class Result {
        final Outcome outcome;
        final int remaining;

        Result(Outcome outcome, int remaining) {
            this.outcome = outcome;
            this.remaining = remaining;
        }
    }

    /**
     * Open once, remember the failure.  A vault that failed to open must say so
     * rather than look empty: "no credential" sends the app to pairing, which
     * would be a lie told to somebody whose credential is right there, sealed
     * behind a broken Keystore.
     */
    static synchronized SharedPreferences prefs(Context context) {
        if (!attempted) {
            attempted = true;
            try {
                prefs = context.getApplicationContext()
                    .getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
            } catch (Exception e) {
                prefs = null;
                openError = e.getClass().getSimpleName() + ": " + e.getMessage();
            }
        }
        return prefs;
    }

    static String openError() {
        return openError != null ? openError : KeystoreStorage.openError();
    }

    static boolean available(Context context) {
        boolean result = prefs(context) != null && KeystoreStorage.available(context);
        if (result) openError = null;
        return result;
    }

    /**
     * Which lock this device can actually offer.
     *
     * `SYSTEM` means the phone has a screen lock (biometric or device
     * credential) and `BiometricPrompt` can use it.  `PIN` is retained only
     * as a legacy fallback for already-enrolled pilot devices. New pairing
     * requires the system lock. `NONE` means there is no valid unlock path,
     * so a stored credential remains sealed rather than disabling the lock.
     */
    enum LockKind { SYSTEM, PIN, NONE }

    static final int SYSTEM_AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    static boolean systemLockAvailable(Context context) {
        try {
            return BiometricManager.from(context.getApplicationContext())
                .canAuthenticate(SYSTEM_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
        } catch (Exception e) {
            // A device that cannot answer the question is treated as not having
            // it: falling back is visible, assuming success would not be.
            return false;
        }
    }

    /**
     * The lock in force, in one place, so the activity, the plugin and the
     * settings screen cannot each decide differently.  The system lock wins
     * whenever it exists — an app PIN on a phone that already asks for a
     * fingerprint is a second secret protecting the same thing.
     */
    static LockKind lockKind(Context context) {
        if (systemLockAvailable(context)) return LockKind.SYSTEM;
        if (pinIsSet(context)) return LockKind.PIN;
        return LockKind.NONE;
    }

    /**
     * Is there something that must be locked?
     *
     * The credential check is not a nicety. Without it a fresh install on a phone
     * with a screen lock opens straight into a system prompt — before pairing,
     * with nothing stored, guarding nothing.  The user's first experience of the
     * app is then an authentication challenge for an empty box, which teaches
     * exactly the wrong reflex: that the prompt is noise to be dismissed.
     *
     * Found by running it, not by reading it.
     */
    static boolean lockEngaged(Context context) {
        // A credential never disables the lock merely because the device lock
        // was removed. NONE means "no valid unlock path", not "leave secrets
        // visible"; MainActivity blocks until a system lock is restored.
        return hasCredential(context);
    }

    static boolean pinIsSet(Context context) {
        SharedPreferences store = prefs(context);
        return store != null && store.contains(K_PIN_HASH);
    }

    static boolean hasCredential(Context context) {
        return prefs(context) != null
            && KeystoreStorage.contains(context, KeystoreStorage.ENTRY_CREDENTIAL);
    }

    static int failures(Context context) {
        SharedPreferences store = prefs(context);
        return store == null ? 0 : store.getInt(K_FAILURES, 0);
    }

    // ── Credential ─────────────────────────────────────────────────────────

    static boolean saveCredential(Context context, String token, String deviceId, String scopes) {
        if (!available(context)) return false;
        try {
            JSONObject payload = new JSONObject();
            payload.put(K_TOKEN, token);
            payload.put(K_DEVICE, deviceId == null ? "" : deviceId);
            payload.put(K_SCOPES, scopes == null ? "[]" : scopes);
            return KeystoreStorage.put(
                context, KeystoreStorage.ENTRY_CREDENTIAL, payload.toString());
        } catch (Exception error) {
            openError = error.getClass().getSimpleName() + ": " + error.getMessage();
            return false;
        }
    }

    /** `E-LOGOUT`: the credential goes unconditionally, and the PIN with it — a lock over nothing is a prompt for nothing. */
    static boolean clearAll(Context context) {
        SharedPreferences store = prefs(context);
        boolean lockCleared = store == null || store.edit().clear().commit();
        return lockCleared && KeystoreStorage.clearAll(context);
    }

    private static boolean wipeCredential(Context context) {
        boolean credentialRemoved =
            KeystoreStorage.remove(context, KeystoreStorage.ENTRY_CREDENTIAL);
        boolean domainRemoved =
            KeystoreStorage.remove(context, KeystoreStorage.ENTRY_DOMAIN);
        return credentialRemoved && domainRemoved;
    }

    // ── PIN ────────────────────────────────────────────────────────────────

    static boolean setPin(Context context, String pin) {
        SharedPreferences store = prefs(context);
        if (store == null || pin == null || pin.length() < 4) return false;
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        byte[] derived = derive(pin, salt);
        boolean committed = store.edit()
            .putString(K_PIN_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
            .putString(K_PIN_HASH, Base64.encodeToString(derived, Base64.NO_WRAP))
            .putInt(K_FAILURES, 0)
            .commit();
        java.util.Arrays.fill(salt, (byte) 0);
        java.util.Arrays.fill(derived, (byte) 0);
        if (!committed) openError = "pin_storage_commit_failed";
        return committed;
    }

    static boolean clearPin(Context context, String pin) {
        if (verify(context, pin).outcome != Outcome.OK) return false;
        SharedPreferences store = prefs(context);
        boolean committed = store.edit()
            .remove(K_PIN_HASH).remove(K_PIN_SALT).putInt(K_FAILURES, 0).commit();
        if (!committed) openError = "pin_storage_commit_failed";
        return committed;
    }

    /**
     * Verify, count, and wipe at the limit.  The counter is incremented before
     * anything is returned, so a caller that crashes on the answer has still
     * paid for the attempt.
     */
    static synchronized Result verify(Context context, String pin) {
        SharedPreferences store = prefs(context);
        if (store == null) return new Result(Outcome.UNAVAILABLE, 0);
        if (!store.contains(K_PIN_HASH)) {
            openError = "device_lock_required";
            return new Result(Outcome.UNAVAILABLE, 0);
        }

        openError = null;
        boolean pinMatches = matches(store, pin);
        if (openError != null) {
            return new Result(Outcome.UNAVAILABLE, 0);
        }
        if (pinMatches) {
            if (!store.edit().putInt(K_FAILURES, 0).commit()) {
                openError = "pin_storage_commit_failed";
                return new Result(Outcome.UNAVAILABLE, 0);
            }
            return new Result(Outcome.OK, MAX_FAILURES);
        }

        int failures = store.getInt(K_FAILURES, 0) + 1;
        if (!store.edit().putInt(K_FAILURES, failures).commit()) {
            openError = "pin_storage_commit_failed";
            return new Result(Outcome.UNAVAILABLE, 0);
        }
        if (failures >= MAX_FAILURES) {
            if (!wipeCredential(context)) {
                openError = KeystoreStorage.openError();
                return new Result(Outcome.UNAVAILABLE, 0);
            }
            return new Result(Outcome.WIPED, 0);
        }
        return new Result(Outcome.WRONG, MAX_FAILURES - failures);
    }

    private static boolean matches(SharedPreferences store, String pin) {
        if (pin == null) return false;
        byte[] salt = null;
        byte[] expected = null;
        byte[] actual = null;
        try {
            salt = Base64.decode(store.getString(K_PIN_SALT, ""), Base64.NO_WRAP);
            expected = Base64.decode(store.getString(K_PIN_HASH, ""), Base64.NO_WRAP);
            actual = derive(pin, salt);
            // Constant time: on a four-digit secret a timing difference is a
            // real shortcut, not a theoretical one.
            return MessageDigest.isEqual(actual, expected);
        } catch (Exception error) {
            openError = "pin_verifier_invalid";
            return false;
        } finally {
            if (salt != null) java.util.Arrays.fill(salt, (byte) 0);
            if (expected != null) java.util.Arrays.fill(expected, (byte) 0);
            if (actual != null) java.util.Arrays.fill(actual, (byte) 0);
        }
    }

    private static byte[] derive(String pin, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, PBKDF2_ITERATIONS, 256);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] derived = factory.generateSecret(spec).getEncoded();
            spec.clearPassword();
            return derived;
        } catch (Exception e) {
            // Cannot derive → cannot match.  Random fails closed; a constant
            // would make every PIN equal to every other.
            byte[] impossible = new byte[32];
            new SecureRandom().nextBytes(impossible);
            return impossible;
        }
    }
}
