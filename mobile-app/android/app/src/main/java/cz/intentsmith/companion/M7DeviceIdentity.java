package cz.intentsmith.companion;

import android.content.Context;

import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;

/** Ed25519 device identity wrapped at rest by the AndroidKeyStore AES key. */
final class M7DeviceIdentity {
    private static final int IDENTITY_VERSION = 1;
    private final byte[] seed;
    final String publicKey;
    final String keyId;

    private M7DeviceIdentity(byte[] seed, String publicKey, String keyId) {
        this.seed = seed;
        this.publicKey = publicKey;
        this.keyId = keyId;
    }

    static synchronized M7DeviceIdentity getOrCreate(Context context) throws Exception {
        String stored = KeystoreStorage.get(context, KeystoreStorage.ENTRY_M7_DEVICE_IDENTITY);
        if (stored != null) return parse(stored);
        if (KeystoreStorage.openError() != null
            || KeystoreStorage.contains(context, KeystoreStorage.ENTRY_M7_DEVICE_IDENTITY)) {
            throw new IllegalStateException("m7_device_identity_unreadable");
        }
        byte[] seed = new byte[32];
        new SecureRandom().nextBytes(seed);
        M7DeviceIdentity identity = fromSeed(seed);
        JSONObject record = new JSONObject();
        record.put("version", IDENTITY_VERSION);
        record.put("privateSeed", encode(seed));
        record.put("publicKey", identity.publicKey);
        record.put("keyId", identity.keyId);
        if (!KeystoreStorage.put(
            context,
            KeystoreStorage.ENTRY_M7_DEVICE_IDENTITY,
            M7CanonicalJson.encode(record)
        )) {
            identity.destroy();
            throw new IllegalStateException("m7_device_identity_write_failed");
        }
        Arrays.fill(seed, (byte) 0);
        return identity;
    }

    private static M7DeviceIdentity parse(String raw) throws Exception {
        JSONObject record = new JSONObject(raw);
        if (record.length() != 4 || record.getInt("version") != IDENTITY_VERSION) {
            throw new IllegalStateException("m7_device_identity_invalid");
        }
        byte[] seed = decode(record.getString("privateSeed"), 32);
        M7DeviceIdentity identity = fromSeed(seed);
        Arrays.fill(seed, (byte) 0);
        if (!identity.publicKey.equals(record.getString("publicKey"))
            || !identity.keyId.equals(record.getString("keyId"))) {
            identity.destroy();
            throw new IllegalStateException("m7_device_identity_binding_invalid");
        }
        return identity;
    }

    static M7DeviceIdentity fromSeed(byte[] seed) throws Exception {
        byte[] owned = Arrays.copyOf(seed, seed.length);
        Ed25519PrivateKeyParameters privateKey = new Ed25519PrivateKeyParameters(owned, 0);
        Ed25519PublicKeyParameters publicKey = privateKey.generatePublicKey();
        byte[] rawPublic = publicKey.getEncoded();
        String encodedPublic = encode(rawPublic);
        String keyId = "device-key:" + hex(MessageDigest.getInstance("SHA-256").digest(rawPublic));
        Arrays.fill(rawPublic, (byte) 0);
        return new M7DeviceIdentity(owned, encodedPublic, keyId);
    }

    synchronized String sign(String schemaId, JSONObject request) throws Exception {
        if (!M7RemoteProtocol.SIGNED_SCHEMAS.contains(schemaId)) {
            throw new IllegalArgumentException("m7_device_proof_schema_invalid");
        }
        JSONObject unsigned = new JSONObject(request.toString());
        unsigned.remove("deviceSignature");
        byte[] canonical = M7CanonicalJson.bytes(unsigned);
        byte[] prefix = ("IntentSmith/M7/" + schemaId + "/Ed25519DeviceProof/v1\n")
            .getBytes(StandardCharsets.UTF_8);
        byte[] proof = new byte[prefix.length + canonical.length];
        System.arraycopy(prefix, 0, proof, 0, prefix.length);
        System.arraycopy(canonical, 0, proof, prefix.length, canonical.length);
        Ed25519Signer signer = new Ed25519Signer();
        signer.init(true, new Ed25519PrivateKeyParameters(seed, 0));
        signer.update(proof, 0, proof.length);
        byte[] signature = signer.generateSignature();
        String result = encode(signature);
        Arrays.fill(canonical, (byte) 0);
        Arrays.fill(proof, (byte) 0);
        Arrays.fill(signature, (byte) 0);
        return result;
    }

    void destroy() { Arrays.fill(seed, (byte) 0); }

    static boolean clear(Context context) {
        return KeystoreStorage.remove(context, KeystoreStorage.ENTRY_M7_DEVICE_IDENTITY);
    }

    private static String encode(byte[] value) {
        return M7Base64Url.encode(value);
    }

    private static byte[] decode(String value, int length) {
        byte[] decoded = M7Base64Url.decode(value);
        if (decoded.length != length || !encode(decoded).equals(value)) {
            Arrays.fill(decoded, (byte) 0);
            throw new IllegalArgumentException("m7_device_identity_base64_invalid");
        }
        return decoded;
    }

    private static String hex(byte[] value) {
        StringBuilder output = new StringBuilder(value.length * 2);
        for (byte item : value) output.append(String.format("%02x", item & 0xff));
        return output.toString();
    }
}
