package cz.intentsmith.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small, auditable encrypted record store backed directly by AndroidKeyStore.
 *
 * AndroidX Security Crypto deprecated its encrypted-preferences wrapper.  The
 * platform primitive underneath it is stable: a non-exportable AES key in the
 * AndroidKeyStore and an authenticated cipher.  This class deliberately keeps
 * the format narrow instead of replacing one opaque wrapper with another.
 *
 * SharedPreferences contains only versioned AES-GCM envelopes.  Record names
 * are authenticated as AAD, so moving one valid ciphertext under another key
 * does not change its meaning.  All values for one logical operation are
 * encrypted before a single synchronous commit; a process death therefore
 * leaves either the old group or the new group, never half a credential.
 */
final class KeystoreVault {

    private static final String STORE = "intentsmith.vault.direct.v1";
    private static final String LEGACY_STORE = "intentsmith.vault";
    private static final String KEY_ALIAS = "intentsmith.mobile.vault.aes.v1";
    private static final String LEGACY_KEY_ALIAS = "_androidx_security_master_key_";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final String FORMAT_KEY = "meta.format";
    private static final String REPAIR_KEY = "meta.repair_required";
    private static final int FORMAT_VERSION = 1;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int BASE64_FLAGS = Base64.NO_WRAP | Base64.NO_PADDING | Base64.URL_SAFE;

    private final Context context;
    private final SharedPreferences preferences;
    private final SecretKey key;

    private KeystoreVault(Context context, SharedPreferences preferences, SecretKey key) {
        this.context = context;
        this.preferences = preferences;
        this.key = key;
    }

    static KeystoreVault open(Context suppliedContext) throws Exception {
        Context context = suppliedContext.getApplicationContext();
        SharedPreferences preferences = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
        migrateLegacyStore(context, preferences);
        ensureFormat(preferences);

        KeystoreVault vault = new KeystoreVault(context, preferences, getOrCreateKey());
        vault.validateAll();
        return vault;
    }

    /**
     * The prototype used AndroidX EncryptedSharedPreferences.  Its key and
     * value names are themselves encrypted, so retaining no deprecated code
     * means there is no trustworthy direct decoder.  No production build was
     * released with that format: erase only that private store, leave a repair
     * marker, and require a fresh one-time pairing.
     */
    private static void migrateLegacyStore(Context context, SharedPreferences current)
            throws Exception {
        SharedPreferences legacy = context.getSharedPreferences(LEGACY_STORE, Context.MODE_PRIVATE);
        if (legacy.getAll().isEmpty()) return;

        if (!current.edit()
                .putInt(FORMAT_KEY, FORMAT_VERSION)
                .putBoolean(REPAIR_KEY, true)
                .commit()) {
            throw new GeneralSecurityException("cannot record legacy vault reset");
        }
        if (!legacy.edit().clear().commit()) {
            throw new GeneralSecurityException("cannot clear legacy vault");
        }
        context.deleteSharedPreferences(LEGACY_STORE);
        deleteKey(LEGACY_KEY_ALIAS);
    }

    private static void ensureFormat(SharedPreferences preferences) throws GeneralSecurityException {
        if (preferences.contains(FORMAT_KEY)) {
            int version;
            try {
                version = preferences.getInt(FORMAT_KEY, -1);
            } catch (ClassCastException error) {
                throw new GeneralSecurityException("invalid vault format marker", error);
            }
            if (version != FORMAT_VERSION) {
                throw new GeneralSecurityException("unsupported vault format " + version);
            }
            return;
        }
        if (!preferences.edit().putInt(FORMAT_KEY, FORMAT_VERSION).commit()) {
            throw new GeneralSecurityException("cannot initialise vault format");
        }
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
            if (!(existing instanceof SecretKey)) {
                throw new GeneralSecurityException("vault alias is not a secret key");
            }
            return (SecretKey) existing;
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private static void deleteKey(String alias) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias);
    }

    private byte[] aad(String recordName) {
        return (context.getPackageName() + "\u0000" + recordName).getBytes(StandardCharsets.UTF_8);
    }

    private String encrypt(String recordName, String cleartext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(CIPHER);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        if (iv == null || iv.length != IV_BYTES) {
            throw new GeneralSecurityException("provider returned an invalid GCM IV");
        }
        cipher.updateAAD(aad(recordName));
        byte[] ciphertext = cipher.doFinal(cleartext.getBytes(StandardCharsets.UTF_8));
        return "v1."
            + Base64.encodeToString(iv, BASE64_FLAGS)
            + "."
            + Base64.encodeToString(ciphertext, BASE64_FLAGS);
    }

    private String decrypt(String recordName, String envelope) throws GeneralSecurityException {
        String[] parts = envelope == null ? new String[0] : envelope.split("\\.", -1);
        if (parts.length != 3 || !"v1".equals(parts[0])) {
            throw new GeneralSecurityException("invalid envelope for " + recordName);
        }
        try {
            byte[] iv = Base64.decode(parts[1], BASE64_FLAGS);
            byte[] ciphertext = Base64.decode(parts[2], BASE64_FLAGS);
            if (iv.length != IV_BYTES || ciphertext.length < TAG_BITS / 8) {
                throw new GeneralSecurityException("invalid GCM payload for " + recordName);
            }
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad(recordName));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new GeneralSecurityException("invalid base64 for " + recordName, error);
        }
    }

    /** Authentication is checked eagerly; corrupted data never looks empty. */
    private void validateAll() throws GeneralSecurityException {
        for (Map.Entry<String, ?> entry : preferences.getAll().entrySet()) {
            String name = entry.getKey();
            if (FORMAT_KEY.equals(name) || REPAIR_KEY.equals(name)) continue;
            if (!(entry.getValue() instanceof String)) {
                throw new GeneralSecurityException("invalid value type for " + name);
            }
            decrypt(name, (String) entry.getValue());
        }
    }

    synchronized boolean contains(String name) {
        return preferences.contains(name);
    }

    synchronized String getString(String name, String fallback) throws GeneralSecurityException {
        if (!preferences.contains(name)) return fallback;
        try {
            return decrypt(name, preferences.getString(name, null));
        } catch (ClassCastException error) {
            throw new GeneralSecurityException("invalid value type for " + name, error);
        }
    }

    synchronized int getInt(String name, int fallback) throws GeneralSecurityException {
        String value = getString(name, null);
        if (value == null) return fallback;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException error) {
            throw new GeneralSecurityException("invalid integer for " + name, error);
        }
    }

    synchronized boolean repairRequired() throws GeneralSecurityException {
        try {
            return preferences.getBoolean(REPAIR_KEY, false);
        } catch (ClassCastException error) {
            throw new GeneralSecurityException("invalid repair marker", error);
        }
    }

    synchronized void putStrings(Map<String, String> values, Set<String> removals)
            throws GeneralSecurityException {
        Map<String, String> envelopes = new HashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getValue() == null) {
                throw new GeneralSecurityException("null vault value for " + entry.getKey());
            }
            envelopes.put(entry.getKey(), encrypt(entry.getKey(), entry.getValue()));
        }

        SharedPreferences.Editor editor = preferences.edit();
        for (Map.Entry<String, String> entry : envelopes.entrySet()) {
            editor.putString(entry.getKey(), entry.getValue());
        }
        for (String name : removals) editor.remove(name);
        if (!editor.commit()) throw new GeneralSecurityException("vault commit failed");
    }

    synchronized void putCredential(Map<String, String> values) throws GeneralSecurityException {
        Map<String, String> envelopes = new HashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            envelopes.put(entry.getKey(), encrypt(entry.getKey(), entry.getValue()));
        }
        SharedPreferences.Editor editor = preferences.edit();
        for (Map.Entry<String, String> entry : envelopes.entrySet()) {
            editor.putString(entry.getKey(), entry.getValue());
        }
        editor.remove(REPAIR_KEY);
        if (!editor.commit()) throw new GeneralSecurityException("credential commit failed");
    }

    /** Recovery/logout path: works even when an existing envelope cannot decrypt. */
    static void destroy(Context suppliedContext) throws Exception {
        Context context = suppliedContext.getApplicationContext();
        SharedPreferences current = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
        SharedPreferences legacy = context.getSharedPreferences(LEGACY_STORE, Context.MODE_PRIVATE);
        if (!current.edit().clear().commit() || !legacy.edit().clear().commit()) {
            throw new GeneralSecurityException("vault clear failed");
        }
        context.deleteSharedPreferences(STORE);
        context.deleteSharedPreferences(LEGACY_STORE);
        deleteKey(KEY_ALIAS);
        deleteKey(LEGACY_KEY_ALIAS);
    }
}
