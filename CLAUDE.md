# CLAUDE.md

Guidance for working in this repository.

## What this is

Pagesmith, a Manifest V3 Chrome extension that captures the full length of a
web page. It scrolls the page one screen at a time, takes a
`captureVisibleTab` frame at each step, and draws the frames into
`OffscreenCanvas` tiles in the service worker. Output is PNG/JPEG/PDF and
stays on the machine.

TypeScript, WXT, Vitest, Playwright. No runtime dependencies, and the bundle is
deliberately unminified.

## Comment style

Comments explain **why**, never what. A comment that restates the line below
it gets deleted.

## Architecture: the one rule

**`src/core` may not import `chrome`, touch the DOM, or import anything outside
`src/core`.** ESLint enforces it and `scripts/guard-core-purity.mjs` checks it
in CI.

| Layer | Holds |
| --- | --- |
| `src/core` | geometry (scroll plan, placement, tiles), settings validation, filenames, PDF writer, message types |
| `src/platform` | `chrome.*` wrappers, IndexedDB capture store, settings storage |
| `src/background` | the capture loop |
| `src/entrypoints` | service worker, page agent, popup, viewer (`capture.html`), options |

## Geometry rules that are easy to break

- **Draw at the reported offset, not the requested one.** The browser clamps
  scrolling at the edges. Drawing at the requested offset duplicates the last
  strip. `agent:scroll` returns the actual position for this reason.
- **Measure the scale from the frame**: `frame.width / window.innerWidth`. Do
  not trust `devicePixelRatio`, which is wrong when the tab is zoomed.
- **Round once, in output space** (`place()`), so adjacent frames meet on the
  same row at fractional ratios like 1.25.
- **Plan rows one at a time** (`nextRowOffset`), because pages grow while they
  are scrolled.
- **Tiles are at most 16,384 px per side.** A canvas larger than the GPU
  backend accepts does not throw. It draws nothing and encodes blank.

## Page agent

`src/entrypoints/page-agent.ts` is the only code that runs in a web page:
- **Injection:** on demand, under `activeTab`. Never add a `content_scripts` entry.
- **Changes:** every change it makes is a `data-pagesmith-*` attribute, given
  effect by `PAGE_CSS`. The service worker applies that stylesheet with
  `scripting.insertCSS`, which page CSP cannot block.
- **Restore:** removing the attributes and the stylesheet puts the page back.
  Never set inline styles.
- **What it returns:** sizes and offsets only.

## Rate limit

Chrome allows 2 `captureVisibleTab` calls per second. `platform/chrome.ts`
spaces calls 520 ms apart and retries on the quota error. Do not remove the
spacing to "speed up" captures.

## Guards

`npm run guard` runs against `dist/`, so build first.

| Guard | Asserts |
| --- | --- |
| core | `src/core` purity |
| egress | no network primitives or remote URLs in the bundle |
| manifest | permissions match `scripts/permissions-baseline.json` |
| refs | every manifest path exists |
| locales | key parity across locales, store field limits |
| paths | no absolute build-machine paths in the bundle |

Adding a permission requires all three of these:
- a baseline entry with a justification
- a `SECURITY.md` changelog line
- the `permissions-change` PR label

## Locales

Five locales: en, fr, de, es, ja. HTML carries English text plus `data-i18n`
keys, and `ui/i18n.ts` swaps in the translation. Add every new key to all five
files; the locale guard fails otherwise.

## Tests

- `npm run test:coverage`: unit tests. `src/core` has a 95% floor.
- `npm run test:e2e`: builds, makes `dist/chrome-granted` (with `<all_urls>`,
  because Playwright cannot click the toolbar to grant `activeTab`), then
  captures fixture pages and samples pixels at every seam. The fixtures cover
  a fixed header, a sticky bar and an inner scroller.
