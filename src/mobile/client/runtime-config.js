// Browser/PWA default: the client and /m1 API share an origin. Android release
// preparation replaces the copied asset, never this source file.
Object.defineProperty(globalThis, 'INTENTSMITH_RUNTIME_CONFIG', {
  value: Object.freeze({ gatewayOrigin: '' }),
  configurable: false,
  enumerable: false,
  writable: false,
});
