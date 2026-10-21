/* Messages between the three contexts, as discriminated unions so every
 * handler is checked for exhaustiveness.
 *
 *   popup  ->  background   start a capture
 *   background  ->  page agent   measure, scroll, hide, restore
 *
 * Progress goes the other way through storage.session rather than messages:
 * the popup may be closed and reopened mid-capture, and a message sent while
 * it is closed is lost, while a stored value is read again on open. */

import type { Rect, Size } from './geometry';
import type { Settings } from './settings';

export type FixedMode = Settings['fixedElements'];

export interface PageMetrics {
  /* "window" when the document scrolls, "element" for apps that scroll an
     inner container (webmail, chat, dashboards) and keep the document still. */
  target: 'window' | 'element';
  /* Full scrollable size of the target, CSS px. */
  extent: Size;
  /* Visible size of the target, CSS px -- one scroll step. */
  viewport: Size;
  /* Where the target's visible area sits in the captured frame, CSS px. */
  crop: Rect;
  /* The browser viewport, CSS px. The captured frame covers exactly this, so
     its width against the frame's pixel width gives the device pixel ratio. */
  window: Size;
  /* Scroll position before Pagesmith touched the page, restored afterwards. */
  initialScroll: { x: number; y: number };
}

export interface ScrollResult {
  /* Where the target actually ended up, which at the edges is not where it
     was asked to go. */
  x: number;
  y: number;
  /* Re-measured, because scrolling is what makes lazy content appear. */
  extent: Size;
}

export type AgentRequest =
  | { type: 'agent:prepare'; preScroll: boolean; limit: number }
  | { type: 'agent:scroll'; x: number; y: number }
  | { type: 'agent:hide-fixed' }
  | { type: 'agent:restore' };

export type AgentResponse<T extends AgentRequest['type']> = T extends 'agent:prepare'
  ? PageMetrics
  : T extends 'agent:scroll'
    ? ScrollResult
    : T extends 'agent:hide-fixed'
      ? { hidden: number }
      : { restored: true };

export type BackgroundRequest = { type: 'capture:start'; tabId: number };

export type BackgroundResponse = { accepted: true } | { accepted: false; reason: 'busy' };

/* The state of the current or most recent capture, kept in storage.session
   under JOB_KEY. */
export type Job =
  | { status: 'running'; tabId: number; progress: number; startedAt: number }
  | { status: 'done'; tabId: number; captureId: string; partial: PartialReason | null }
  | { status: 'error'; tabId: number; error: CaptureErrorCode; detail: string };

export const JOB_KEY = 'job';

/* Why a capture holds less than the full page. */
export type PartialReason = 'visible-only' | 'height-limit';

export type CaptureErrorCode = 'restricted-page' | 'capture-failed' | 'no-tab';

/* The Web Store refuses scripting from every extension. Matched by hostname
   rather than URL prefix so the bundle carries no external URL literal for
   the egress guard to have to excuse. */
function isWebStore(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return (
      hostname === 'chromewebstore.google.com' ||
      (hostname === 'chrome.google.com' && pathname.startsWith('/webstore'))
    );
  } catch {
    return false;
  }
}

/* Chrome refuses to script these, whatever the permissions. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    /^(chrome|chrome-extension|edge|about|devtools|view-source|chrome-search|chrome-untrusted):/i.test(url) ||
    isWebStore(url)
  );
}

/* Pages where scripting is refused but captureVisibleTab still works, so the
   visible area is the best available result. */
export function isScriptBlockedButCapturable(url: string | undefined): boolean {
  return url !== undefined && isWebStore(url);
}
