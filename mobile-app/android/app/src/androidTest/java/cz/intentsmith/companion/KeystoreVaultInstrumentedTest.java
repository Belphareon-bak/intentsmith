package cz.intentsmith.companion;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.LinkedHashMap;
import java.util.Map;

/** Device-side proof for behavior a source inspection cannot establish. */
@RunWith(AndroidJUnit4.class)
public class KeystoreVaultInstrumentedTest {

    private static final String CURRENT_STORE = "intentsmith.vault.direct.v1";
    private static final String LEGACY_STORE = "intentsmith.vault";

    private Context context;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        KeystoreVault.destroy(context);
    }

    @After
    public void tearDown() throws Exception {
        KeystoreVault.destroy(context);
    }

    @Test
    public void roundTripLeavesNoCleartextInPreferences() throws Exception {
        KeystoreVault vault = KeystoreVault.open(context);
        Map<String, String> credential = credential("token-secret-123");
        vault.putCredential(credential);

        assertEquals("token-secret-123", vault.getString(LockPolicy.K_TOKEN, null));
        assertEquals("device-1", vault.getString(LockPolicy.K_DEVICE, null));

        SharedPreferences raw = context.getSharedPreferences(CURRENT_STORE, Context.MODE_PRIVATE);
        String stored = raw.getAll().toString();
        assertFalse(stored.contains("token-secret-123"));
        assertFalse(stored.contains("device-1"));
        assertTrue(stored.contains("v1."));
    }

    @Test
    public void appStateRoundTripIsEncryptedAndRejectsCredentialKeys() throws Exception {
        String snapshot = "{\"is.cache.thread.demo\":{\"secret\":\"message-secret-456\"},"
            + "\"is.drafts\":{\"op-1\":{\"message\":\"draft-secret-789\"}}}";

        assertTrue(LockPolicy.saveAppState(context, snapshot));
        assertEquals(snapshot, LockPolicy.readAppState(context));
        assertFalse(LockPolicy.appStateInputValid("{\"is.auth.token\":\"must-not-pass\"}"));
        assertFalse(LockPolicy.appStateInputValid("{\"foreign.key\":true}"));

        SharedPreferences raw = context.getSharedPreferences(CURRENT_STORE, Context.MODE_PRIVATE);
        String stored = raw.getAll().toString();
        assertFalse(stored.contains("message-secret-456"));
        assertFalse(stored.contains("draft-secret-789"));
        assertTrue(stored.contains("v1."));

        assertFalse(LockPolicy.clearAll(context, snapshot));
        assertEquals(snapshot, LockPolicy.readAppState(context));
        String preferences = "{\"is.prefs\":{\"hideBarOnHome\":false}}";
        assertTrue(LockPolicy.clearAll(context, preferences));
        assertEquals(preferences, LockPolicy.readAppState(context));
    }

    @Test
    public void authenticatedCorruptionFailsClosedInsteadOfLookingUnpaired() throws Exception {
        KeystoreVault vault = KeystoreVault.open(context);
        vault.putCredential(credential("token-before-corruption"));

        SharedPreferences raw = context.getSharedPreferences(CURRENT_STORE, Context.MODE_PRIVATE);
        assertTrue(raw.edit().putString(LockPolicy.K_TOKEN, "v1.invalid.invalid").commit());

        try {
            KeystoreVault.open(context);
            fail("corrupt authenticated data was accepted");
        } catch (Exception expected) {
            assertFalse(expected.getClass().getSimpleName().isEmpty());
        }
    }

    @Test
    public void legacyPrototypeIsNarrowlyResetAndRepairClearsAfterPairing() throws Exception {
        SharedPreferences legacy = context.getSharedPreferences(LEGACY_STORE, Context.MODE_PRIVATE);
        assertTrue(legacy.edit().putString("opaque-old-name", "opaque-old-value").commit());

        KeystoreVault vault = KeystoreVault.open(context);
        assertTrue(vault.repairRequired());
        assertTrue(legacy.getAll().isEmpty());

        vault.putCredential(credential("replacement-token"));
        assertFalse(vault.repairRequired());
        assertEquals("replacement-token", vault.getString(LockPolicy.K_TOKEN, null));
    }

    private static Map<String, String> credential(String token) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put(LockPolicy.K_TOKEN, token);
        values.put(LockPolicy.K_DEVICE, "device-1");
        values.put(LockPolicy.K_SCOPES, "[\"read:chat\"]");
        return values;
    }
}
