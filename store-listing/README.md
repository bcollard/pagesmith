# Store listing copy

The text pasted into the Chrome Web Store dashboard, kept here so it can be
reviewed and diffed.

| Field | Where it comes from |
| --- | --- |
| Name | `src/public/_locales/<locale>/messages.json` → `extName`. Automatic; read-only in the dashboard. |
| Summary | same file → `extDescription`. Automatic. |
| Detailed description | `store-listing/<locale>.md`, **pasted by hand**, per language |
| Screenshots | `assets/store/screenshots/`, 1280 × 800 exactly |

Category (**Productivity → Tools**), promo tiles, website and support URLs are
global and set once.

**Upload the package before editing any listing text.** The language selector
only offers languages the *uploaded package* declares under `_locales/`.

## Copy rules these files follow

- No superlatives, no generic praise.
- No term repeated across name, summary and description. That is keyword
  spam, which is grounds for suspension. The name carries "Full Page
  Screenshot", so the body says "capture the whole page" and "scrolling
  capture" instead.
- **No sentence has another extension as its subject**, named or not. Claims
  about other software are unverifiable and read as disparagement. Make the
  point about this extension instead: "Pagesmith makes no network requests"
  can be checked against the bundle.
- Opens with what it does, not how it is built. "Single purpose not clear" is
  a documented rejection reason.
