# Third-Party Notices

Fraud Watch is licensed under the MIT License (see [`LICENSE`](./LICENSE)).
It is built with, and distributes, third-party software under the licenses
listed below. This file is provided to comply with the attribution and
notice-retention requirements of those licenses. Retain this file (and the
`LICENSE` file) when redistributing this software.

## License summary of dependencies

The dependency tree is predominantly permissive. A snapshot of license types
across installed packages:

| License | Notes |
| --- | --- |
| MIT | Majority of dependencies (e.g. `wxt`, `vite`, `esbuild`). |
| ISC | Permissive, attribution-only. |
| BSD-2-Clause / BSD-3-Clause | Permissive, attribution-only. |
| Apache-2.0 | e.g. `typescript` (build-time). Attribution + patent grant. |
| MPL-2.0 | Weak (file-level) copyleft — see below. |
| 0BSD / BlueOak-1.0.0 | Permissive. |
| Dual `MIT OR GPL-3.0`, `BSD-3-Clause OR GPL-2.0` | Used under the permissive (MIT / BSD) option. |

Run `npx wxt build` and inspect `node_modules` for the authoritative, current
license of each package; the table above is a convenience summary and may drift
as dependencies update.

## MPL-2.0 components (notice + source availability)

The following components are licensed under the Mozilla Public License 2.0
(<https://www.mozilla.org/en-US/MPL/2.0/>). They are used **unmodified** and are
**build/development tooling only — none are bundled into the shipped extension**
(verified: no MPL-2.0 code appears in `.output/`). They are listed for
completeness and notice preservation. MPL-2.0 permits this use provided the
covered files remain under MPL-2.0 and their notices are preserved.

- **web-ext-run** — Firefox dev/packaging tool, used only by `wxt -b firefox` /
  `wxt zip -b firefox`. Source: <https://github.com/mozilla/web-ext>
- **fx-runner** — Firefox launcher used by the above. Source:
  <https://github.com/mozilla/node-fx-runner>
- **lightningcss** (and its platform binary, e.g. `lightningcss-darwin-arm64`) —
  build-time CSS transformer pulled in by Vite. Its output CSS is shipped, but
  its own code is not. Source: <https://github.com/parcel-bundler/lightningcss>

If you modify any of the MPL-2.0 covered files, you must make the source of those
modified files available under MPL-2.0.

> Note: as of WXT 0.20, the runtime browser wrapper is `@wxt-dev/browser` (MIT),
> not Mozilla's `webextension-polyfill` (MPL-2.0). No MPL-2.0 code is distributed
> in the built extension.

## Interoperating projects (not bundled)

Fraud Watch can *optionally* talk to a self-hosted **sloptotal** server over its
HTTP API. sloptotal's own code is **not** included in or distributed with this
project — the user runs their own instance and configures its URL. sloptotal is
a separate work under its own license; see
<https://github.com/pablocaeg/sloptotal>. The API client in `lib/slop/` and the
local heuristic in `lib/slop/heuristics.ts` are original code and are covered by
this project's MIT License.
