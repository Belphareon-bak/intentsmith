package cz.intentsmith.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class M7CanonicalJsonTest {
    @Test
    public void canonicalJsonMatchesTheNodeWireOrderAndNfc() throws Exception {
        JSONObject value = new JSONObject();
        value.put("z", new JSONArray().put(true).put(JSONObject.NULL).put(-12));
        value.put("e\u0301", "A\u030A");
        value.put("a", 7);
        assertEquals(
            "{\"a\":7,\"z\":[true,null,-12],\"é\":\"Å\"}",
            M7CanonicalJson.encode(value)
        );
    }

    @Test
    public void unsafeNumbersAndNormalizedKeyCollisionsFailClosed() throws Exception {
        assertThrows(
            IllegalArgumentException.class,
            () -> M7CanonicalJson.encode(new JSONObject().put("n", 9_007_199_254_740_992d))
        );
        JSONObject collision = new JSONObject().put("é", 1).put("e\u0301", 2);
        assertThrows(IllegalArgumentException.class, () -> M7CanonicalJson.encode(collision));
    }

    @Test
    public void deviceProofMatchesIndependentNodeEd25519Vector() throws Exception {
        byte[] seed = new byte[32];
        for (int index = 0; index < seed.length; index += 1) seed[index] = (byte) index;
        JSONObject request = new JSONObject();
        request.put("clientNonce", "abcdefghijklmnopqrstuv");
        request.put("contract", "RemoteSessionChallengeRequest");
        request.put("deviceId", "device:test");
        request.put("deviceSignature", "");
        request.put("pairingRevision", "pairing:test");
        request.put("purpose", "OPEN");
        request.put("requestId", "request:test");
        request.put("sentAt", "2026-09-08T00:00:00.000Z");
        request.put("sessionId", JSONObject.NULL);
        request.put("sessionRevision", JSONObject.NULL);
        request.put("version", 1);
        M7DeviceIdentity identity = M7DeviceIdentity.fromSeed(seed);
        try {
            assertEquals(
                "mmNysBhK07ANALL-z4169zYPiB5QfzDriIje4ivU5jBsGgyOSJUuSt9I2SQFJ3EHIFJrlUhm4JRaFi2ProNgDg",
                identity.sign("RemoteSessionChallengeRequest@1", request)
            );
        } finally {
            identity.destroy();
        }
    }
}
