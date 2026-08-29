package cz.intentsmith.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Small, auditable encrypted store backed directly by AndroidKeyStore.
 *
 * SharedPreferences contains only an AES-GCM IV and ciphertext.  The AES key
 * is generated non-exportably in AndroidKeyStore; the entry name and schema
 * are authenticated as AAD, so ciphertext cannot be renamed into another
 * security domain.  This replaces the deprecated AndroidX security-crypto
 * wrapper while retaining the same fail-closed storage boundary.
 */
final class KeystoreStorage {
    static final String ENTRY_CREDENTIAL = "credential";
    static final String ENTRY_DOMAIN = "domain";

    private static final String PREFS_FILE = "intentsmith.keystore.v2";
    private static final String KEY_ALIAS = "intentsmith_mobile_vault_v2";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int SCHEMA_VERSION = 2;
    private static final int MAX_PLAINTEXT_BYTES = 4 * 1024 * 1024;

    private static String openError;

    private KeystoreStorage() {}

    static synchronized boolean available(Context context) {
        try {
            getOrCreateKey();
            openError = null;
            return true;
        } catch (Exception error) {
            openError = describe(error);
            return false;
        }
    }

    static synchronized String openError() { return openError; }

    static boolean contains(Context context, String entry) {
        SharedPreferences prefs = preferences(context);
        // Any fragment means there is protected state to account for. Treating
        // a half-written entry as "absent" would send a paired device to the
        // pairing screen instead of surfacing storage corruption.
        return prefs.contains(schemaKey(entry))
            || prefs.contains(cipherKey(entry))
            || prefs.contains(ivKey(entry));
    }

    static synchronized boolean put(Context context, String entry, String value) {
        byte[] plaintext = null;
        byte[] ciphertext = null;
        byte[] iv = null;
        try {
            plaintext = value.getBytes(StandardCharsets.UTF_8);
            if (plaintext.length > MAX_PLAINTEXT_BYTES) {
                throw new GeneralSecurityException("plaintext_too_large");
            }
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            cipher.updateAAD(aad(entry));
            ciphertext = cipher.doFinal(plaintext);
            iv = cipher.getIV();
            boolean committed = preferences(context).edit()
                .putInt(schemaKey(entry), SCHEMA_VERSION)
                .putString(cipherKey(entry), Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .putString(ivKey(entry), Base64.encodeToString(iv, Base64.NO_WRAP))
                .commit();
            if (!committed) throw new GeneralSecurityException("storage_commit_failed");
            openError = null;
            return true;
        } catch (Exception error) {
            openError = describe(error);
            return false;
        } finally {
            wipe(plaintext);
            wipe(ciphertext);
            wipe(iv);
        }
    }

    /** Null means absent; a partial or undecryptable entry is an error. */
    static synchronized String get(Context context, String entry) {
        SharedPreferences prefs = preferences(context);
        String encodedCiphertext = prefs.getString(cipherKey(entry), null);
        String encodedIv = prefs.getString(ivKey(entry), null);
        if (encodedCiphertext == null && encodedIv == null
            && !prefs.contains(schemaKey(entry))) {
            openError = null;
            return null;
        }
        if (encodedCiphertext == null || encodedIv == null
            || prefs.getInt(schemaKey(entry), 0) != SCHEMA_VERSION) {
            openError = "stored_entry_incomplete";
            return null;
        }

        byte[] ciphertext = null;
        byte[] iv = null;
        byte[] plaintext = null;
        try {
            ciphertext = Base64.decode(encodedCiphertext, Base64.NO_WRAP);
            iv = Base64.decode(encodedIv, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, getExistingKey(), new GCMParameterSpec(128, iv));
            cipher.updateAAD(aad(entry));
            plaintext = cipher.doFinal(ciphertext);
            openError = null;
            return new String(plaintext, StandardCharsets.UTF_8);
        } catch (Exception error) {
            openError = describe(error);
            return null;
        } finally {
            wipe(ciphertext);
            wipe(iv);
            wipe(plaintext);
        }
    }

    static synchronized boolean remove(Context context, String entry) {
        boolean committed = preferences(context).edit()
            .remove(schemaKey(entry)).remove(cipherKey(entry)).remove(ivKey(entry)).commit();
        openError = committed ? null : "storage_commit_failed";
        return committed;
    }

    static synchronized boolean clearAll(Context context) {
        boolean committed = preferences(context).edit().clear().commit();
        try {
            KeyStore keyStore = keyStore();
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception error) {
            openError = describe(error);
            return false;
        }
        if (!committed) {
            openError = "storage_commit_failed";
            return false;
        }
        openError = null;
        return true;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE);
    }

    private static SecretKey getOrCreateKey() throws GeneralSecurityException {
        KeyStore keyStore = keyStore();
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
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

    private static SecretKey getExistingKey() throws GeneralSecurityException {
        KeyStore keyStore = keyStore();
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw new GeneralSecurityException("keystore_key_missing");
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private static KeyStore keyStore() throws GeneralSecurityException {
        try {
            KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
            keyStore.load(null);
            return keyStore;
        } catch (java.io.IOException error) {
            throw new GeneralSecurityException("keystore_load_failed", error);
        }
    }

    private static byte[] aad(String entry) {
        return ("IntentSmith|" + SCHEMA_VERSION + "|" + entry).getBytes(StandardCharsets.UTF_8);
    }

    private static String schemaKey(String entry) { return entry + ".schema"; }
    private static String cipherKey(String entry) { return entry + ".ciphertext"; }
    private static String ivKey(String entry) { return entry + ".iv"; }
    private static String describe(Exception error) {
        return error.getClass().getSimpleName() + ": " + String.valueOf(error.getMessage());
    }
    private static void wipe(byte[] value) { if (value != null) Arrays.fill(value, (byte) 0); }
}
