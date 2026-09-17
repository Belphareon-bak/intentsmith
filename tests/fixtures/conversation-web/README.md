# Loopback HTTPS test identity

The suite generates a fresh ephemeral self-signed identity for the reserved
hostname `web.fixture.test` with the declared `/usr/bin/openssl` toolchain.
Its private temporary directory is removed immediately after reading the pair,
including on failure. No certificate or private key is stored in the current
Git tree. The former pair remains published in Git history and is permanently
retired: never restore, trust, or reuse it, including in tests. Both blobs are
listed in `docs/convergence/PRIVACY-INCIDENT.json`; the disposition and pending
signature scope are recorded in `docs/review/2026-09-17-M5-TLS-HISTORY-REMEDIATION.md`.
Never
install the certificate in a trust store or use this identity outside tests.

The registered conversation-web HTTP suite serves this identity only on an
ephemeral `127.0.0.1` port. Its explicitly injected request seam maps the
transport's validated fixture DNS answer to that loopback socket. Positive and
interrupted-response cases trust this certificate only through that individual
test request; the untrusted-certificate case supplies no such trust. Production
URL, public-address and TLS validation remain unchanged.

This proves actual Node HTTPS/TLS/response-stream behavior on controlled local
sockets. It is not public DNS, Internet reachability or a production HTTPS
endpoint test.
