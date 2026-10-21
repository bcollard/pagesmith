/* Thin wrappers over the chrome.* calls Pagesmith makes. Kept here so
 * src/core stays free of browser APIs and so the full list of what the
 * extension asks Chrome to do fits on one screen. */

import type { AgentRequest, AgentResponse, Job } from '../core/protocol';
import { JOB_KEY } from '../core/protocol';

/* Chrome allows MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2. Spacing calls
   just over 500 ms apart avoids the quota error in the common case; the retry
   below covers clock jitter and captures started by other extensions, which
   share nothing with ours but the error message suggests otherwise. */
const CAPTURE_SPACING_MS = 520;
const CAPTURE_RETRIES = 6;
let lastCaptureAt = 0;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isQuotaError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND');
}

/* PNG, always: lossless intermediate frames, so the only lossy step is the
   one the user chose when exporting. */
export async function captureVisibleTab(windowId: number): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + CAPTURE_SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } catch (err) {
      if (!isQuotaError(err) || attempt >= CAPTURE_RETRIES) throw err;
    }
  }
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  return chrome.tabs.get(tabId);
}

/* Injected on demand under the activeTab grant -- there is no content_scripts
   entry, so Pagesmith runs in no page the user has not asked it to capture. */
export async function injectAgent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['/page-agent.js'] });
}

export async function sendToAgent<T extends AgentRequest>(tabId: number, message: T): Promise<AgentResponse<T['type']>> {
  const response: unknown = await chrome.tabs.sendMessage(tabId, message);
  if (response && typeof response === 'object' && 'error' in response) {
    throw new Error(String((response as { error: unknown }).error));
  }
  return response as AgentResponse<T['type']>;
}

export async function setJob(job: Job): Promise<void> {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

export async function getJob(): Promise<Job | null> {
  const stored = await chrome.storage.session.get(JOB_KEY);
  return (stored[JOB_KEY] as Job | undefined) ?? null;
}

export function onJobChange(listener: (job: Job | null) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'session' || !(JOB_KEY in changes)) return;
    listener((changes[JOB_KEY]?.newValue as Job | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/* The badge shows progress when the popup has been closed mid-capture. */
export async function setBadge(tabId: number, text: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1D5FA8' });
  await chrome.action.setBadgeText({ tabId, text });
}

export async function openViewer(captureId: string, besideTab: chrome.tabs.Tab): Promise<void> {
  const url = chrome.runtime.getURL(`/capture.html?id=${encodeURIComponent(captureId)}`);
  const props: chrome.tabs.CreateProperties = { url, index: besideTab.index + 1 };
  if (besideTab.id !== undefined) props.openerTabId = besideTab.id;
  if (besideTab.windowId !== undefined) props.windowId = besideTab.windowId;
  await chrome.tabs.create(props);
}
