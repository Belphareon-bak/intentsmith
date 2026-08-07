# `@c3/chat-panel` source contract

The committed `lib/` directory is the current authoritative C3 Studio runtime.
The package entry point and Theia frontend entry both load
`lib/browser/chat-panel-module.js` directly.

The former TypeScript/Tailwind prototype was materially older than the running
product and could not rebuild this runtime. It is preserved only for historical
reference under
[`docs/archive/c3-studio/c3-chat-panel-ts-prototype/`](../../../docs/archive/c3-studio/c3-chat-panel-ts-prototype/README.md).
Nothing in the active Studio build imports or compiles that archive.

Package-level `build` validates the committed runtime without rewriting it.
Package-level `clean` is deliberately non-destructive, and package-level
TypeScript `watch` is rejected. Use the product-level `c3-ide` build for the
actual Electron bundle.

The current UI is a functional transport/runtime baseline, not the final
IntentSmith visual or UX contract. Runtime tests may pin observable behavior,
security boundaries and lifecycle, but not today's layout or styling.
