package cz.intentsmith.companion;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** Frozen native portion of the reviewed M7 session and route vocabulary. */
final class M7RemoteProtocol {
    static final String ADAPTER_MANIFEST_DIGEST =
        "sha256:abe99330702ea02ccdf7b644f4114df1b910a6e83cf3229a294a90e74c0822f4";
    static final int MAX_BODY_BYTES = 1_048_576;
    static final Set<String> POST_PATHS;
    static final Set<String> SIGNED_SCHEMAS;

    static {
        Set<String> paths = new HashSet<>();
        paths.add("/remote/v1/pairing/claim");
        paths.add("/remote/v1/session/challenge");
        paths.add("/remote/v1/session/open");
        paths.add("/remote/v1/session/refresh");
        paths.add("/remote/v1/session/revoke");
        paths.add("/remote/v1/invoke");
        POST_PATHS = Collections.unmodifiableSet(paths);

        Set<String> schemas = new HashSet<>();
        schemas.add("RemoteInvocationEnvelope@1");
        schemas.add("RemoteSessionChallengeRequest@1");
        schemas.add("RemoteSessionOpenRequest@1");
        schemas.add("RemoteSessionRefreshRequest@1");
        schemas.add("RemoteSessionRevokeRequest@1");
        SIGNED_SCHEMAS = Collections.unmodifiableSet(schemas);
    }

    private M7RemoteProtocol() {}
}
