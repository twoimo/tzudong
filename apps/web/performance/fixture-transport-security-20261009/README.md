# Fixture gateway transport correction

Three authored visual fixtures used concatenated request-derived URLs. CodeQL reported request-forgery alerts on commit `99b1256297db3619c10b3d4e7fa3b108b4bdef5f`. Independent URL analysis found their destination already fixed to loopback, while malformed request targets, forwarded authentication/proxy headers and missing Host/Origin constraints were concrete gaps.

The transport now uses an HTTP options object with literal `127.0.0.1` and three allowed development ports. Incoming origin-form paths, Host and optional Origin are checked before any preview work. HMR permits only GET/websocket on `/_next/webpack-hmr`. Authentication, cookies and proxy headers are stripped; redirects are returned without following them, and upstream cookies are discarded.

`verify-transport.mjs` starts all three real Bun fixtures with independent Node HTTP sentinels. 67 checks passed with zero requests to the external-destination trap. Valid UI/static paths, encoded paths, synthetic API data, redirect behavior, HMR, hostile targets and forwarding boundaries were checked. Five files passed Node24 ESLint. These checks do not prove rendered UI or hosted behavior. Required CI remains separate.

`original-bindings.json` preserves the exact old gateways and both historical artifact maps in `originals/*.txt`. Old screenshots and browser receipts bind to those frozen gateway bytes, not to the amended scripts. Original maps remain unchanged; resolve their three gateway entries through these explicit frozen bindings. `artifact-map.json` records current amendment files and gateway hashes.

Reproduce from `apps/web` with:

```sh
/opt/homebrew/opt/node@24/bin/node performance/fixture-transport-security-20261009/verify-transport.mjs
```

No source dependencies, operating data, provider calls, freeze or production settings changed. Owned fixture children and sentinels were closed.
