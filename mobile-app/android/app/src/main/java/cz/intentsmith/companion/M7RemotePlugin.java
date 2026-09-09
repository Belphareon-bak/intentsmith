package cz.intentsmith.companion;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/** Native M7 device proof and pinned HTTPS boundary. No fetch fallback exists. */
@CapacitorPlugin(name = "IntentSmithRemote")
public class M7RemotePlugin extends Plugin {
    private final Object serial = new Object();

    @PluginMethod
    public void describe(PluginCall call) {
        call.resolve(new JSObject()
            .put("available", M7PinnedHttpsClient.configured(
                BuildConfig.M7_REMOTE_ORIGIN,
                BuildConfig.M7_REMOTE_SPKI_PIN
            ))
            .put("origin", BuildConfig.M7_REMOTE_ORIGIN)
            .put("serverIdentityPin", BuildConfig.M7_REMOTE_SPKI_PIN)
            .put("adapterManifestDigest", M7RemoteProtocol.ADAPTER_MANIFEST_DIGEST)
            .put("clientBuild", BuildConfig.M7_CLIENT_BUILD)
            .put("minimumApi", M7PinnedHttpsClient.MINIMUM_REMOTE_API)
            .put("nativeHttps", true)
            .put("tlsVersion", "TLSv1.3")
            .put("proxy", "forbidden")
            .put("redirect", "forbidden"));
    }

    @PluginMethod
    public void identity(PluginCall call) {
        execute(() -> {
            synchronized (serial) {
                M7DeviceIdentity identity = null;
                try {
                    requireUnlocked();
                    identity = M7DeviceIdentity.getOrCreate(getContext());
                    call.resolve(new JSObject()
                        .put("deviceKeyId", identity.keyId)
                        .put("devicePublicKey", identity.publicKey));
                } catch (Exception error) {
                    reject(call, error);
                } finally {
                    if (identity != null) identity.destroy();
                }
            }
        });
    }

    @PluginMethod
    public void sign(PluginCall call) {
        execute(() -> {
            synchronized (serial) {
                M7DeviceIdentity identity = null;
                try {
                    requireUnlocked();
                    String schemaId = call.getString("schemaId");
                    JSObject request = call.getObject("request");
                    if (request == null || !request.has("deviceSignature")
                        || !"".equals(request.optString("deviceSignature", null))) {
                        throw new IllegalArgumentException("m7_device_proof_request_invalid");
                    }
                    identity = M7DeviceIdentity.getOrCreate(getContext());
                    String signature = identity.sign(schemaId, request);
                    call.resolve(new JSObject()
                        .put("deviceKeyId", identity.keyId)
                        .put("deviceSignature", signature));
                } catch (Exception error) {
                    reject(call, error);
                } finally {
                    if (identity != null) identity.destroy();
                }
            }
        });
    }

    @PluginMethod
    public void post(PluginCall call) {
        execute(() -> {
            synchronized (serial) {
                try {
                    requireUnlocked();
                    String path = call.getString("path");
                    JSObject body = call.getObject("body");
                    if (body == null) throw new IllegalArgumentException("m7_remote_body_required");
                    M7PinnedHttpsClient.Response response = client().post(path, body);
                    resolveResponse(call, response);
                } catch (Exception error) {
                    reject(call, error);
                }
            }
        });
    }

    @PluginMethod
    public void health(PluginCall call) {
        execute(() -> {
            synchronized (serial) {
                try {
                    requireUnlocked();
                    resolveResponse(call, client().health(call.getString("requestId")));
                } catch (Exception error) {
                    reject(call, error);
                }
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        execute(() -> {
            synchronized (serial) {
                boolean identity = M7DeviceIdentity.clear(getContext());
                if (!identity) {
                    call.reject("m7_remote_clear_failed", "M7_REMOTE_STORAGE_FAILURE");
                    return;
                }
                call.resolve(new JSObject().put("cleared", true));
            }
        });
    }

    private M7PinnedHttpsClient client() throws Exception {
        return new M7PinnedHttpsClient(BuildConfig.M7_REMOTE_ORIGIN, BuildConfig.M7_REMOTE_SPKI_PIN);
    }

    private static void resolveResponse(PluginCall call, M7PinnedHttpsClient.Response response)
        throws Exception {
        call.resolve(new JSObject()
            .put("status", response.status)
            .put("body", new JSObject(response.body.toString())));
    }

    private static void requireUnlocked() {
        if (VaultPlugin.LockState.isLocked()) throw new IllegalStateException("m7_remote_locked");
    }

    private static void reject(PluginCall call, Exception error) {
        String message = error.getMessage() == null ? "m7_remote_failed" : error.getMessage();
        String code = message.startsWith("m7_")
            ? message.toUpperCase()
            : "M7_REMOTE_FAILURE";
        call.reject(message, code);
    }
}
