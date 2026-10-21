/* Markup carries English text plus a data-i18n key; this swaps in the
 * translation. The English stays in the HTML so a page is readable even if
 * a key is missing, and guard-locales.mjs fails the build when one is. */

export function t(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

const ATTRS = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
] as const;

export function applyI18n(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const message = chrome.i18n.getMessage(el.dataset['i18n'] ?? '');
    if (message) el.textContent = message;
  }
  for (const [data, attr] of ATTRS) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${data}]`)) {
      const message = chrome.i18n.getMessage(el.getAttribute(data) ?? '');
      if (message) el.setAttribute(attr, message);
    }
  }
  document.documentElement.lang = chrome.i18n.getUILanguage();
}
