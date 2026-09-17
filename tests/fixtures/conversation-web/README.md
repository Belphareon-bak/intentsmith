# Loopback HTTPS test identity

The suite generates a fresh ephemeral self-signed identity for the reserved
hostname `web.fixture.test` with the declared `/usr/bin/openssl` toolchain.
Its private temporary directory is removed immediately after reading the pair,
including on failure. No certificate or private key is stored in Git. Never
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
