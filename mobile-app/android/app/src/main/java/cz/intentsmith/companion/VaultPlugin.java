package cz.intentsmith.companion;

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
        result.put("hasCredential", LockPolicy.hasCredential(getContext()));
        result.put("locked", LockState.isLocked());
        result.put("failures", LockPolicy.failures(getContext()));
        result.put("maxFailures", LockPolicy.MAX_FAILURES);
        call.resolve(result);
    }

    @PluginMethod
    public void save(PluginCall call) {
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
        JSObject result = new JSObject();
        result.put("token", LockPolicy.get(getContext(), LockPolicy.K_TOKEN, null));
        result.put("deviceId", LockPolicy.get(getContext(), LockPolicy.K_DEVICE, null));
        result.put("scopes", LockPolicy.get(getContext(), LockPolicy.K_SCOPES, "[]"));
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        LockPolicy.clearAll(getContext());
        LockState.unlock();
        call.resolve(new JSObject().put("cleared", true));
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
