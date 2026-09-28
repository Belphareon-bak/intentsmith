package cz.intentsmith.companion;

import org.json.JSONObject;

import java.util.Locale;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The vault as the WebView sees it — `MR-22`, `MD-11`.
 *
 * Every rule lives in {@link LockPolicy}; this class is the doorway and holds
 * one rule of its own, the important one:
 *
 * > **A locked app does not hand out the credential.**
 *
 * That is what separates a lock from a curtain.  `MainActivity` puts an overlay
 * over the WebView, but the WebView behind it is still running and still able
 * to issue requests; if the token were readable, an attacker with an unlocked
 * phone (`A2`) would only need to reach the page, not the person.  So the seal
 * is here, on the read, and the overlay is the visible half of it.
 *
 * The web client's contract is in `src/mobile/client/app.js` (`nativeVault`):
 * it hydrates the credential once at boot and keeps the synchronous `store`
 * API it always had, so nothing else in 4 000 lines had to become async to gain
 * a Keystore.
 */
@CapacitorPlugin(name = "IntentSmithVault")
public class VaultPlugin extends Plugin {

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", LockPolicy.available(getContext()));
        result.put("error", LockPolicy.openError());
        result.put("hasPin", LockPolicy.pinIsSet(getContext()));
        // Which lock is actually in force, so the settings screen states the
        // truth rather than offering a PIN on a phone that uses its own.
        result.put("lockKind", LockPolicy.lockKind(getContext()).name().toLowerCase(Locale.ROOT));
        result.put("hasCredential", LockPolicy.hasCredential(getContext()));
        result.put("locked", LockState.isLocked());
        result.put("failures", LockPolicy.failures(getContext()));
        result.put("maxFailures", LockPolicy.MAX_FAILURES);
        call.resolve(result);
    }

    @PluginMethod
    public void save(PluginCall call) {
        if (LockState.isLocked() && LockPolicy.hasCredential(getContext())) {
            call.reject("locked");
            return;
        }
        if (LockPolicy.lockKind(getContext()) == LockPolicy.LockKind.NONE) {
            call.reject("device_lock_required");
            return;
        }
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("token_required");
            return;
        }
        boolean saved = LockPolicy.saveCredential(
            getContext(), token, call.getString("deviceId", ""), call.getString("scopes", "[]"));
        if (!saved) {
            call.reject("vault_unavailable", LockPolicy.openError());
            return;
        }
        // Pairing is an unlock: the person who just scanned the code is the
        // person the lock exists for.
        LockState.unlock();
        call.resolve(new JSObject().put("saved", true));
    }

    /**
     * Named `read` rather than `load` because `load()` is the plugin's own
     * lifecycle hook, and shadowing it would break plugin start-up.
     */
    @PluginMethod
    public void read(PluginCall call) {
        if (!LockPolicy.available(getContext())) {
            call.reject("vault_unavailable", LockPolicy.openError());
            return;
        }
        if (LockState.isLocked()) {
            // Named, not empty.  "Locked" and "not paired" lead to different
            // screens, and answering one with the other would show the pairing
            // screen to somebody who is merely locked out.
            call.reject("locked");
            return;
        }
        String raw = KeystoreStorage.get(getContext(), KeystoreStorage.ENTRY_CREDENTIAL);
        if (raw == null) {
            if (KeystoreStorage.openError() != null
                || LockPolicy.hasCredential(getContext())) {
                call.reject("credential_read_failed", KeystoreStorage.openError());
                return;
            }
            call.resolve(new JSObject()
                .put("token", null).put("deviceId", null).put("scopes", "[]"));
            return;
        }
        try {
            JSONObject payload = new JSONObject(raw);
            String token = payload.optString(LockPolicy.K_TOKEN, "");
            if (token.isEmpty()) {
                call.reject("credential_invalid");
                return;
            }
            call.resolve(new JSObject()
                .put("token", token)
                .put("deviceId", payload.optString(LockPolicy.K_DEVICE, ""))
                .put("scopes", payload.optString(LockPolicy.K_SCOPES, "[]")));
        } catch (Exception error) {
            call.reject("credential_invalid", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        if (!LockPolicy.clearAll(getContext())) {
            call.reject("vault_clear_failed", LockPolicy.openError());
            return;
        }
        LockState.unlock();
        call.resolve(new JSObject().put("cleared", true));
    }

    /**
     * S1/S2 client state (scopes, cache, operation journal and drafts) shares
     * the Keystore at-rest boundary but not the credential entry.  Returning
     * one authenticated JSON object keeps the WebView storage API synchronous
     * after a single boot hydration.
     */
    @PluginMethod
    public void readDomain(PluginCall call) {
        if (LockState.isLocked()) {
            call.reject("locked");
            return;
        }
        String data = KeystoreStorage.get(getContext(), KeystoreStorage.ENTRY_DOMAIN);
        if (data == null) {
            if (KeystoreStorage.openError() != null) {
                call.reject("domain_read_failed", KeystoreStorage.openError());
                return;
            }
            data = "{}";
        }
        call.resolve(new JSObject().put("data", data));
    }

    @PluginMethod
    public void writeDomain(PluginCall call) {
        if (LockState.isLocked()) {
            call.reject("locked");
            return;
        }
        String data = call.getString("data");
        try {
            if (data == null || data.length() > 4 * 1024 * 1024
                || new JSONObject(data).length() > 10000) {
                call.reject("domain_invalid");
                return;
            }
        } catch (Exception error) {
            call.reject("domain_invalid", error);
            return;
        }
        if (!KeystoreStorage.put(getContext(), KeystoreStorage.ENTRY_DOMAIN, data)) {
            call.reject("domain_write_failed", KeystoreStorage.openError());
            return;
        }
        call.resolve(new JSObject().put("stored", true));
    }

    @PluginMethod
    public void clearDomain(PluginCall call) {
        if (!KeystoreStorage.remove(getContext(), KeystoreStorage.ENTRY_DOMAIN)) {
            call.reject("domain_clear_failed", KeystoreStorage.openError());
            return;
        }
        call.resolve(new JSObject().put("cleared", true));
    }

    @PluginMethod
    public void consumePairingCode(PluginCall call) {
        // Do not consume a new identity while the current one is still locked.
        // MainActivity retains it until the post-unlock reload asks again.
        if (LockState.isLocked()) {
            call.reject("locked");
            return;
        }
        String code = MainActivity.consumePairingCode();
        JSObject result = new JSObject();
        if (code != null) result.put("code", code);
        call.resolve(result);
    }

    @PluginMethod
    public void setPin(PluginCall call) {
        if (!LockPolicy.setPin(getContext(), call.getString("pin"))) {
            call.reject(LockPolicy.available(getContext()) ? "pin_too_short" : "vault_unavailable");
            return;
        }
        LockState.unlock();
        call.resolve(new JSObject().put("set", true));
    }

    @PluginMethod
    public void clearPin(PluginCall call) {
        if (!LockPolicy.clearPin(getContext(), call.getString("pin"))) {
            call.reject("pin_wrong");
            return;
        }
        call.resolve(new JSObject().put("cleared", true));
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        LockPolicy.Result result = LockPolicy.verify(getContext(), call.getString("pin"));
        JSObject response = new JSObject();
        switch (result.outcome) {
            case OK:
                LockState.unlock();
                response.put("unlocked", true);
                break;
            case WIPED:
                response.put("unlocked", false);
                response.put("wiped", true);
                response.put("remaining", 0);
                break;
            case UNAVAILABLE:
                call.reject("vault_unavailable", LockPolicy.openError());
                return;
            default:
                response.put("unlocked", false);
                response.put("wiped", false);
                response.put("remaining", result.remaining);
        }
        call.resolve(response);
    }

    @PluginMethod
    public void lock(PluginCall call) {
        LockState.lock();
        call.resolve(new JSObject().put("locked", true));
    }

    /**
     * Whether the app is locked is **process** state, not stored state: the
     * activity sets it from the lifecycle (`MR-23`) and this plugin reads it.
     * Keeping it out of the WebView is what makes it survive a page reload —
     * a lock a reload clears is not a lock.
     */
    static final class LockState {
        private static volatile boolean locked = false;

        static boolean isLocked() { return locked; }
        static void lock() { locked = true; }
        static void unlock() { locked = false; }

        private LockState() {}
    }
}
