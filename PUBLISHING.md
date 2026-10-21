# Publishing to the Chrome Web Store

From a tagged release to a live listing.

## How signing works

You never sign anything. You upload a plain `.zip`, and Google signs it into a
`.crx` with a key you do not hold. Nothing in the published artifact ties it
to a commit. That is why releases are reproducible and attested, and why the
`.zip` you upload must be the one attached to the GitHub release, not a local
build.

## One-time setup

1. Register at the Chrome Web Store developer console.
2. Pay the one-time developer fee.
3. Accept the developer agreement.
4. Enable GitHub Pages for `docs/` so the privacy policy URL resolves.

## Assets

Icons and promo tiles are generated from `scripts/lib/logo.mjs`:

```bash
npm run icons
```

| Asset | Size | Where |
| --- | --- | --- |
| Extension icons | 16 / 32 / 48 / 128 | `src/public/icons/`, bundled automatically |
| Store icon | 128 × 128 | `assets/store/store-icon-128.png` |
| Small promo tile | 440 × 280 | `assets/store/promo-small-440x280.png` |
| Marquee promo tile | 1400 × 560 | `assets/store/promo-marquee-1400x560.png` |
| Screenshots | 1280 × 800 exactly | `assets/store/screenshots/` (to be produced) |

Screenshots must be exactly 1280 × 800 or 640 × 400. A DevTools capture on a
Retina display is written at 2560 × 1600, and the store rejects it with an
error that does not mention the size. Take them with `deviceScaleFactor: 1`.

## Release and upload

Tag last, not first. `release.yml` attests whatever the tag points at, so the
commit must already be on `main` with CI green.

```bash
npm pkg set version=0.2.0
git commit -am "Release 0.2.0"
git push origin main
gh run watch                       # wait for CI and Security

git tag -a v0.2.0 -m "Pagesmith 0.2.0"
git push origin v0.2.0
```

`release.yml` re-runs every gate, then:
1. builds and packages
2. confirms the build reproduces
3. generates the SBOM
4. attests provenance
5. publishes the release

Check the artifact before uploading it:

```bash
V=0.2.0
gh release download "v$V" --repo bcollard/pagesmith -D /tmp/ps
cd /tmp/ps && shasum -a 256 -c SHA256SUMS
gh attestation verify "pagesmith-$V.zip" --repo bcollard/pagesmith
cd - && node scripts/verify-reproducible.mjs "/tmp/ps/pagesmith-$V.zip"
```

**Never move a tag.** If review rejects a build and code has to change, bump
the version and tag again.

### Before you submit

- [ ] The zip is the one from the release page
- [ ] `gh attestation verify` passes on that exact file
- [ ] `SECURITY.md` changelog updated if permissions moved
- [ ] `store-listing/*.md` still matches what the extension does
- [ ] `npm run guard` green

## Listing

| Field | Source |
| --- | --- |
| Name, summary | `_locales/<locale>/messages.json`, from the package |
| Detailed description | `store-listing/<locale>.md`, pasted per language |
| Category | Productivity → Tools |

Upload the package **before** editing listing text. The language tabs only
appear for locales the uploaded package declares.

### Privacy tab

| Field | Answer |
| --- | --- |
| Single purpose | Capturing the full length of a web page as an image or PDF |
| Data collection | None |
| Privacy policy URL | `https://bcollard.github.io/pagesmith/privacy.html` |

Justifications the reviewer will ask for:

- **`activeTab`:** temporary access to the tab the user invokes the extension
  on, required by `chrome.tabs.captureVisibleTab` and for injecting the page
  agent. No host permissions are requested.
- **`scripting`:** injects a script that scrolls the page step by step and
  hides fixed elements while the capture runs, then restores the page.
- **`storage`:** user settings, and the progress of a running capture.

Answer **no** to every data-use question.

## After it is published

1. Put the store link in `README.md`.
2. Record the extension ID. Updates must go to the same listing; a new listing
   is a different extension to every existing user.
