import { DEFAULT_SETTINGS, parseSettings } from './settings';
import { isRestrictedUrl, isScriptBlockedButCapturable } from './protocol';

describe('parseSettings', () => {
  it('returns defaults for nothing stored', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and replaces invalid ones individually', () => {
    const parsed = parseSettings({ format: 'jpeg', jpegQuality: 7, maxPageHeight: 12000, unknown: true });
    expect(parsed.format).toBe('jpeg');
    expect(parsed.jpegQuality).toBe(DEFAULT_SETTINGS.jpegQuality);
    expect(parsed.maxPageHeight).toBe(12000);
    expect(parsed).not.toHaveProperty('unknown');
  });

  it('has the documented defaults', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({
      format: 'png',
      fixedElements: 'after-first',
      preScroll: true,
      captureDelayMs: 150,
      pdfPaper: 'a4',
    });
  });
});

describe('restricted pages', () => {
  it('refuses browser-internal pages', () => {
    for (const url of ['chrome://settings', 'chrome-extension://abc/x.html', 'about:blank', 'view-source:https://a.b', undefined]) {
      expect(isRestrictedUrl(url)).toBe(true);
    }
  });

  it('allows ordinary pages', () => {
    expect(isRestrictedUrl('https://example.com/')).toBe(false);
    expect(isRestrictedUrl('file:///tmp/a.html')).toBe(false);
  });

  it('treats the Web Store as visible-only', () => {
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isScriptBlockedButCapturable('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isScriptBlockedButCapturable('https://chrome.google.com/webstore/detail/x')).toBe(true);
    expect(isScriptBlockedButCapturable('https://chrome.google.com/search')).toBe(false);
    expect(isScriptBlockedButCapturable('chrome://settings')).toBe(false);
    expect(isScriptBlockedButCapturable(undefined)).toBe(false);
  });
});

describe('field validation', () => {
  it('rejects wrong types, out-of-range numbers and blank templates', () => {
    const parsed = parseSettings({
      format: 'gif',
      preScroll: 'yes',
      captureDelayMs: 150.5,
      maxPageHeight: Number.POSITIVE_INFINITY,
      filenameTemplate: '   ',
      keepCaptures: 0,
    });
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts every documented enum value', () => {
    for (const fixedElements of ['after-first', 'always', 'never']) {
      expect(parseSettings({ fixedElements }).fixedElements).toBe(fixedElements);
    }
    for (const pdfPaper of ['a4', 'letter', 'fit']) {
      expect(parseSettings({ pdfPaper }).pdfPaper).toBe(pdfPaper);
    }
  });
});
