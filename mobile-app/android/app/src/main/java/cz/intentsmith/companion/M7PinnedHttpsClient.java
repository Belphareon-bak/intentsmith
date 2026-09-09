package cz.intentsmith.companion;

import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URI;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Arrays;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/** TLS-1.3-only, no-proxy, no-redirect client bound to one bundled SPKI. */
final class M7PinnedHttpsClient {
    static final int MINIMUM_REMOTE_API = 29;
    private final String origin;
    private final String pin;
    private final SSLSocketFactory socketFactory;

    M7PinnedHttpsClient(String origin, String pin) throws Exception {
        requireConfiguration(origin, pin);
        if (Build.VERSION.SDK_INT < MINIMUM_REMOTE_API) {
            throw new IllegalStateException("m7_tls13_platform_unavailable");
        }
        this.origin = origin;
        this.pin = pin;
        byte[] expectedPin = hexBytes(pin.substring("sha256:".length()));
        X509TrustManager trustManager = new PinnedTrustManager(expectedPin);
        SSLContext context = SSLContext.getInstance("TLSv1.3");
        context.init(null, new TrustManager[] { trustManager }, null);
        this.socketFactory = new Tls13SocketFactory(context.getSocketFactory());
        Arrays.fill(expectedPin, (byte) 0);
    }

    static boolean configured(String origin, String pin) {
        try {
            requireConfiguration(origin, pin);
            return Build.VERSION.SDK_INT >= MINIMUM_REMOTE_API;
        } catch (Exception ignored) {
            return false;
        }
    }

    Response post(String path, JSONObject body) throws Exception {
        if (!M7RemoteProtocol.POST_PATHS.contains(path)) {
            throw new IllegalArgumentException("m7_remote_path_denied");
        }
        byte[] bytes = M7CanonicalJson.bytes(body);
        if (bytes.length < 2 || bytes.length > M7RemoteProtocol.MAX_BODY_BYTES) {
            throw new IllegalArgumentException("m7_remote_body_size_invalid");
        }
        try {
            return exchange(path, "POST", bytes, null);
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    Response health(String requestId) throws Exception {
        if (requestId == null || !requestId.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")) {
            throw new IllegalArgumentException("m7_health_request_id_invalid");
        }
        return exchange("/remote/v1/health", "GET", null, requestId);
    }

    private Response exchange(String path, String method, byte[] body, String healthRequestId)
        throws Exception {
        URL target = new URL(origin + path);
        HttpsURLConnection connection = (HttpsURLConnection) target.openConnection(Proxy.NO_PROXY);
        connection.setSSLSocketFactory(socketFactory);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(35_000);
        connection.setUseCaches(false);
        connection.setRequestMethod(method);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("Cache-Control", "no-store");
        connection.setRequestProperty("Connection", "close");
        if (body != null) {
            connection.setDoOutput(true);
            connection.setFixedLengthStreamingMode(body.length);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            }
        } else {
            connection.setRequestProperty("X-IntentSmith-Request-Id", healthRequestId);
        }

        int status = connection.getResponseCode();
        if (status >= 300 && status < 400) {
            connection.disconnect();
            throw new IllegalStateException("m7_remote_redirect_denied");
        }
        if (!"application/json; charset=utf-8".equalsIgnoreCase(connection.getContentType())) {
            connection.disconnect();
            throw new IllegalStateException("m7_remote_content_type_invalid");
        }
        if (connection.getContentEncoding() != null) {
            connection.disconnect();
            throw new IllegalStateException("m7_remote_content_encoding_denied");
        }
        String transferEncoding = connection.getHeaderField("Transfer-Encoding");
        long declaredLength = connection.getContentLengthLong();
        if (transferEncoding != null || declaredLength < 2
            || declaredLength > M7RemoteProtocol.MAX_BODY_BYTES) {
            connection.disconnect();
            throw new IllegalStateException("m7_remote_content_length_invalid");
        }
        String cacheControl = connection.getHeaderField("Cache-Control");
        if (cacheControl == null || !cacheControl.toLowerCase().contains("no-store")) {
            connection.disconnect();
            throw new IllegalStateException("m7_remote_cache_policy_invalid");
        }
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        byte[] responseBytes = readBounded(stream);
        connection.disconnect();
        if (declaredLength != responseBytes.length) {
            Arrays.fill(responseBytes, (byte) 0);
            throw new IllegalStateException("m7_remote_content_length_mismatch");
        }
        String text = decodeUtf8(responseBytes);
        JSONObject value = new JSONObject(text);
        if (!M7CanonicalJson.encode(value).equals(text)) {
            Arrays.fill(responseBytes, (byte) 0);
            throw new IllegalStateException("m7_remote_response_not_canonical");
        }
        Arrays.fill(responseBytes, (byte) 0);
        return new Response(status, value);
    }

    private static byte[] readBounded(InputStream input) throws Exception {
        if (input == null) throw new IllegalStateException("m7_remote_response_missing");
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int total = 0;
            int read;
            while ((read = stream.read(chunk)) != -1) {
                total += read;
                if (total > M7RemoteProtocol.MAX_BODY_BYTES) {
                    throw new IllegalStateException("m7_remote_response_too_large");
                }
                output.write(chunk, 0, read);
            }
            Arrays.fill(chunk, (byte) 0);
            return output.toByteArray();
        }
    }

    private static String decodeUtf8(byte[] bytes) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes)).toString();
    }

    private static void requireConfiguration(String origin, String pin) throws Exception {
        URI parsed = new URI(origin == null ? "" : origin);
        if (!"https".equals(parsed.getScheme()) || parsed.getRawUserInfo() != null
            || parsed.getPort() != 7443 || parsed.getHost() == null
            || parsed.getHost().isBlank() || !"".equals(parsed.getRawPath())
            || parsed.getRawQuery() != null || parsed.getRawFragment() != null
            || pin == null || !pin.matches("sha256:[0-9a-f]{64}")) {
            throw new IllegalArgumentException("m7_remote_configuration_invalid");
        }
    }

    private static byte[] hexBytes(String value) {
        byte[] bytes = new byte[value.length() / 2];
        for (int index = 0; index < value.length(); index += 2) {
            int high = Character.digit(value.charAt(index), 16);
            int low = Character.digit(value.charAt(index + 1), 16);
            if (high < 0 || low < 0) throw new IllegalArgumentException("m7_spki_pin_invalid");
            bytes[index / 2] = (byte) ((high << 4) | low);
        }
        return bytes;
    }

    private static final class PinnedTrustManager implements X509TrustManager {
        private final byte[] expectedPin;

        PinnedTrustManager(byte[] expectedPin) {
            this.expectedPin = Arrays.copyOf(expectedPin, expectedPin.length);
        }

        @Override public void checkClientTrusted(X509Certificate[] chain, String authType)
            throws CertificateException {
            throw new CertificateException("m7_client_certificate_not_supported");
        }

        @Override public void checkServerTrusted(X509Certificate[] chain, String authType)
            throws CertificateException {
            try {
                if (chain == null || chain.length < 1 || authType == null || authType.isBlank()) {
                    throw new CertificateException("m7_server_certificate_missing");
                }
                chain[0].checkValidity();
                byte[] observed = MessageDigest.getInstance("SHA-256")
                    .digest(chain[0].getPublicKey().getEncoded());
                boolean matches = MessageDigest.isEqual(expectedPin, observed);
                Arrays.fill(observed, (byte) 0);
                if (!matches) throw new CertificateException("m7_server_spki_mismatch");
            } catch (CertificateException error) {
                throw error;
            } catch (Exception error) {
                throw new CertificateException("m7_server_certificate_invalid", error);
            }
        }

        @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }

    private static final class Tls13SocketFactory extends SSLSocketFactory {
        private final SSLSocketFactory delegate;

        Tls13SocketFactory(SSLSocketFactory delegate) { this.delegate = delegate; }
        private java.net.Socket lock(java.net.Socket socket) {
            if (!(socket instanceof SSLSocket)) throw new IllegalStateException("m7_tls_socket_invalid");
            ((SSLSocket) socket).setEnabledProtocols(new String[] { "TLSv1.3" });
            return socket;
        }
        @Override public String[] getDefaultCipherSuites() { return delegate.getDefaultCipherSuites(); }
        @Override public String[] getSupportedCipherSuites() { return delegate.getSupportedCipherSuites(); }
        @Override public java.net.Socket createSocket(java.net.Socket socket, String host, int port, boolean close)
            throws java.io.IOException { return lock(delegate.createSocket(socket, host, port, close)); }
        @Override public java.net.Socket createSocket(String host, int port)
            throws java.io.IOException { return lock(delegate.createSocket(host, port)); }
        @Override public java.net.Socket createSocket(String host, int port, java.net.InetAddress local, int localPort)
            throws java.io.IOException { return lock(delegate.createSocket(host, port, local, localPort)); }
        @Override public java.net.Socket createSocket(java.net.InetAddress host, int port)
            throws java.io.IOException { return lock(delegate.createSocket(host, port)); }
        @Override public java.net.Socket createSocket(java.net.InetAddress host, int port, java.net.InetAddress local, int localPort)
            throws java.io.IOException { return lock(delegate.createSocket(host, port, local, localPort)); }
    }

    static final class Response {
        final int status;
        final JSONObject body;
        Response(int status, JSONObject body) { this.status = status; this.body = body; }
    }
}
