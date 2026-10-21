/* The attributes the page agent sets and the stylesheet that gives them
 * effect, shared so the two cannot disagree.
 *
 * The stylesheet is inserted by the service worker with
 * chrome.scripting.insertCSS rather than as a <style> element from the agent:
 * insertCSS is exempt from the page's Content-Security-Policy, and a strict
 * style-src would otherwise block it on exactly the sites (banks, GitHub,
 * Google properties) where people most often want a clean capture. */

export const ATTR = {
  scroller: 'data-pagesmith-scroller',
  sticky: 'data-pagesmith-sticky',
  hidden: 'data-pagesmith-hidden',
} as const;

export const PAGE_CSS = `
html, body, [${ATTR.scroller}] {
  scrollbar-width: none !important;
  scroll-behavior: auto !important;
}
html::-webkit-scrollbar, body::-webkit-scrollbar, [${ATTR.scroller}]::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}
[${ATTR.sticky}] {
  position: relative !important;
  top: auto !important;
  bottom: auto !important;
  left: auto !important;
  right: auto !important;
}
[${ATTR.hidden}] {
  visibility: hidden !important;
  animation: none !important;
  transition: none !important;
}
`;
