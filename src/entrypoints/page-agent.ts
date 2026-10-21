/* The page agent: the only Pagesmith code that runs inside a web page.
 *
 * Injected by the service worker into the tab being captured, under the
 * activeTab grant, and nowhere else. It runs in Chrome's isolated world, so
 * the page cannot see or call it. It measures, scrolls, hides and restores,
 * and reports nothing back beyond sizes and scroll offsets: no page text, no
 * DOM, no URLs.
 *
 * Every change it makes is an attribute in ATTR, given effect by PAGE_CSS
 * (inserted by the service worker), so restoring the page is removing those
 * attributes and that stylesheet. Inline styles the page set are never
 * touched. */

import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import type { Size } from '../core/geometry';
import type { AgentRequest, PageMetrics, ScrollResult } from '../core/protocol';
import { ATTR } from '../core/page-style';

declare global {
  // Isolated-world global, shared by every injection into the same document.
  var __pagesmithAgent: boolean | undefined;
}

export default defineUnlistedScript(() => {
  /* executeScript runs the file again on every capture, but the isolated
     world -- and the listener registered in it -- survives between captures
     of the same document. A second listener would answer every message
     twice. */
  if (globalThis.__pagesmithAgent) return;
  globalThis.__pagesmithAgent = true;

  let scroller: HTMLElement | null = null;
  let initialWindow = { x: 0, y: 0 };
  let initialScroller = { x: 0, y: 0 };

  const nextFrame = () =>
    new Promise<void>((resolve) => {
      // Two frames: one for the scroll to apply, one for the paint that
      // follows it. The timeout covers a tab whose rAF is being throttled.
      const timer = setTimeout(resolve, 120);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve();
        }),
      );
    });
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  function allElements(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('body *'));
  }

  function windowSize(): Size {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function documentExtent(): Size {
    const se = document.scrollingElement ?? document.documentElement;
    return {
      width: Math.max(se.scrollWidth, window.innerWidth),
      height: Math.max(se.scrollHeight, window.innerHeight),
    };
  }

  /* Pages that scroll an inner container keep the document exactly one
     viewport tall. For those, the largest visible element that actually
     scrolls vertically is taken to be the page. A threshold of a fifth of the
     viewport skips dropdowns and code blocks that happen to scroll. */
  function findInnerScroller(): HTMLElement | null {
    const view = window.innerWidth * window.innerHeight;
    let best: HTMLElement | null = null;
    let bestArea = view * 0.2;
    for (const el of allElements()) {
      // Cheap layout reads first; getComputedStyle only for the survivors.
      if (el.scrollHeight <= el.clientHeight + 1 || el.clientHeight < 100) continue;
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      const area = Math.max(0, w) * Math.max(0, h);
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best;
  }

  function scrollTarget(x: number, y: number) {
    if (scroller) scroller.scrollTo({ left: x, top: y, behavior: 'instant' });
    else window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }

  function position(): { x: number; y: number } {
    return scroller ? { x: scroller.scrollLeft, y: scroller.scrollTop } : { x: window.scrollX, y: window.scrollY };
  }

  function extent(): Size {
    return scroller ? { width: scroller.scrollWidth, height: scroller.scrollHeight } : documentExtent();
  }

  function metrics(): Omit<PageMetrics, 'initialScroll'> {
    const win = windowSize();
    if (!scroller) {
      return {
        target: 'window',
        extent: documentExtent(),
        viewport: win,
        crop: { x: 0, y: 0, width: win.width, height: win.height },
        window: win,
      };
    }
    const r = scroller.getBoundingClientRect();
    const x = Math.max(0, r.left + scroller.clientLeft);
    const y = Math.max(0, r.top + scroller.clientTop);
    const width = Math.min(scroller.clientWidth, win.width - x);
    const height = Math.min(scroller.clientHeight, win.height - y);
    return {
      target: 'element',
      extent: extent(),
      viewport: { width, height },
      crop: { x, y, width, height },
      window: win,
    };
  }

  /* position:sticky elements are made position:relative, which leaves them
     exactly where they sit in the flow: a sticky header ends up once at the
     top of the image instead of once per screenful. */
  function neutraliseSticky() {
    for (const el of allElements()) {
      if (getComputedStyle(el).position === 'sticky') el.setAttribute(ATTR.sticky, '');
    }
  }

  /* Re-run before every frame, not once: headers that turn fixed only after
     the page has scrolled past them are common. Skipped:
       - anything containing the inner scroller, since app shells are often a
         fixed container around the scrolling area;
       - anything covering most of the viewport, which is a background layer
         or a modal, and hiding it blanks the frame. */
  function hideFixed(): number {
    const view = window.innerWidth * window.innerHeight;
    let hidden = 0;
    for (const el of allElements()) {
      if (el.hasAttribute(ATTR.hidden)) continue;
      if (getComputedStyle(el).position !== 'fixed') continue;
      if (scroller && el.contains(scroller)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= view * 0.8) continue;
      el.setAttribute(ATTR.hidden, '');
      hidden++;
    }
    return hidden;
  }

  async function prepare(preScroll: boolean, limit: number): Promise<PageMetrics> {
    initialWindow = { x: window.scrollX, y: window.scrollY };
    neutraliseSticky();

    const doc = documentExtent();
    scroller = doc.height > window.innerHeight + 1 || doc.width > window.innerWidth + 1 ? null : findInnerScroller();
    if (scroller) {
      scroller.setAttribute(ATTR.scroller, '');
      initialScroller = { x: scroller.scrollLeft, y: scroller.scrollTop };
    }
    await nextFrame();

    /* One pass from top to bottom before the real capture. Lazy-loading
       images and scroll-triggered sections request their content when they
       come into view; by the time their frame is taken they have had a whole
       pass to arrive. */
    if (preScroll) {
      const step = metrics().viewport.height;
      for (let y = 0; step > 0 && y < Math.min(extent().height, limit); y += step) {
        scrollTarget(0, y);
        await wait(60);
      }
    }

    scrollTarget(0, 0);
    await nextFrame();
    await wait(100);
    return { ...metrics(), initialScroll: scroller ? initialScroller : initialWindow };
  }

  async function scroll(x: number, y: number): Promise<ScrollResult> {
    scrollTarget(x, y);
    await nextFrame();
    return { ...position(), extent: extent() };
  }

  function restore() {
    for (const name of Object.values(ATTR)) {
      for (const el of document.querySelectorAll(`[${name}]`)) el.removeAttribute(name);
    }
    if (scroller) scroller.scrollTo({ left: initialScroller.x, top: initialScroller.y, behavior: 'instant' });
    window.scrollTo({ left: initialWindow.x, top: initialWindow.y, behavior: 'instant' });
    scroller = null;
    return { restored: true as const };
  }

  async function handle(msg: AgentRequest): Promise<unknown> {
    switch (msg.type) {
      case 'agent:prepare':
        return prepare(msg.preScroll, msg.limit);
      case 'agent:scroll':
        return scroll(msg.x, msg.y);
      case 'agent:hide-fixed':
        return { hidden: hideFixed() };
      case 'agent:restore':
        return restore();
    }
  }

  chrome.runtime.onMessage.addListener((msg: AgentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || typeof msg?.type !== 'string' || !msg.type.startsWith('agent:')) {
      return false;
    }
    handle(msg).then(sendResponse, (err: unknown) =>
      sendResponse({ error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });
});
