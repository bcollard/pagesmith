# Security

Pagesmith takes pictures of whatever page you are looking at. Those pictures
can contain anything, so this document lays out why the extension is safe to
install, in a form you can check rather than take on trust.

## Captures never leave the machine

- **No network code in the shipped bundle.** It contains no `fetch`, `XMLHttpRequest`,
  `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, native messaging
  or uninstall URL. [`scripts/guard-egress.mjs`](scripts/guard-egress.mjs)
  scans the **built** output (`dist/`) for each of these, for remote
  `src`/`href` attributes in HTML, and for remote `url()`/`@import` in CSS. CI
  fails on any hit. The allowlist in
  [`scripts/egress-allowlist.json`](scripts/egress-allowlist.json) is empty
  except for XML namespace identifiers, which are names, not addresses.
- **Data URLs are decoded without `fetch`.** Decoding a `data:` URL with
  `fetch` would be harmless, but it would be the only network primitive in
  the bundle, and an exception in the guard. They are decoded with `atob`
  instead.
- **Storage.** Captures are stored as PNG Blobs in the extension's own IndexedDB.
  Only the extension's own pages and service worker can read them. The newest
  20 are kept by default (configurable), and older ones are deleted when a new
  capture is saved.
- **No runtime dependencies.** No third-party code ships in the extension. The
  PDF writer is about 150 lines in [`src/core/pdf.ts`](src/core/pdf.ts).

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Temporary access to the one tab the user invoked Pagesmith on, by toolbar click or shortcut. Required by `captureVisibleTab` and `scripting.executeScript`. Ends when the tab navigates or closes. |
| `scripting` | Injects `page-agent.js` and the capture stylesheet into that tab. |
| `storage` | `storage.local` for settings; `storage.session` for the progress of a running capture. |

That is the complete list. Each entry is justified in
[`scripts/permissions-baseline.json`](scripts/permissions-baseline.json), and
[`scripts/guard-manifest.mjs`](scripts/guard-manifest.mjs) fails CI if the
built manifest drifts from it.

Requested neither at install nor optionally:

| Not requested | Why not |
| --- | --- |
| Host permissions / `<all_urls>` | `activeTab` covers the one tab being captured. The end-to-end tests use a separate test-only build with `<all_urls>` (`scripts/make-granted-build.mjs`), and `scripts/pack.mjs` never packages it. |
| `tabs` | `activeTab` already exposes the URL and title of the tab being captured. |
| `downloads` | Saving uses an `<a download>` link from the viewer page, which goes through Chrome's own download UI. |
| `clipboardWrite` | `navigator.clipboard.write` from an extension page after a click needs no permission. |
| `webNavigation`, `debugger`, `cookies`, `history` | Not needed for screenshots. All are on the guard's forbidden list. |

Widening the set requires all three of these in the same pull request:
- an updated baseline file
- an entry in the changelog below
- the `permissions-change` label

`ci.yml` enforces the label.

## What the page agent can do

`page-agent.js` is the only Pagesmith code that runs inside a web page.

- **When it runs:** it is injected on demand into the tab being captured. There is no
  `content_scripts` entry, so it never runs anywhere else.
- **Isolation:** it runs in Chrome's isolated world, so the page's own scripts can neither
  see it nor call it.
- **Who it listens to:** it accepts messages only from the extension's own ID.
- **What it changes:** it measures, scrolls, marks elements with `data-pagesmith-*` attributes
  and restores them. It returns sizes and scroll offsets only: no text, no
  DOM, no URLs.
- **Styling:** its stylesheet is applied with `chrome.scripting.insertCSS`, which the
  page's Content-Security-Policy does not block. It is removed with
  `removeCSS` when the capture ends, including on failure.

The service worker accepts `capture:start` only from the extension's own pages.
It checks the sender URL as well as the extension ID, because the page agent
shares the ID.

## Invariants, and how each one is enforced

| Invariant | Author time | CI, against `dist/` |
| --- | --- | --- |
| No network egress | ESLint `no-restricted-globals` | `guard-egress.mjs` |
| No dynamic code execution | ESLint `no-eval`, `no-implied-eval`, `no-new-func` | MV3 CSP |
| Least permission | — | `guard-manifest.mjs` against the baseline |
| `src/core` is pure | ESLint `no-restricted-globals` for `chrome` | `guard-core-purity.mjs` |
| Every manifest path exists | — | `guard-manifest-refs.mjs` |
| No build-machine paths in the bundle | — | `guard-build-paths.mjs` |
| Locales complete and within store limits | — | `guard-locales.mjs` |

## Release integrity

The Chrome Web Store signs the `.crx` itself from an uploaded `.zip`. The
developer never signs anything, so the store signature says nothing about
which source the bytes came from. Each release therefore has two more
properties:

1. **A reproducible build.** Fixed timestamps, sorted entries, no absolute
   paths. Anyone can rebuild a tag and compare byte for byte with
   `scripts/verify-reproducible.mjs`.
2. **A provenance attestation.** `release.yml` attests the exact `.zip` with
   `actions/attest-build-provenance`, binding it to this repository, commit
   and workflow run. Check it with `gh attestation verify`.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository. Please do not file
a public issue for something exploitable.

## Changelog of security-relevant changes

- **0.1.0:** initial permission set: `activeTab`, `scripting`, `storage`. No host
  permissions, no optional permissions.
