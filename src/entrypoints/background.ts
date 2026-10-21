import { defineBackground } from 'wxt/utils/define-background';
import type { BackgroundRequest, BackgroundResponse } from '../core/protocol';
import { isRunning, runCapture } from '../background/capture';
import { getJob, setJob } from '../platform/chrome';

export default defineBackground(() => {
  /* A job still marked running when the worker starts belongs to a worker
     that was stopped mid-capture. Nothing will finish it, and the popup would
     show its progress bar forever. */
  void getJob().then((job) => {
    if (job?.status === 'running' && !isRunning()) {
      void setJob({ status: 'error', tabId: job.tabId, error: 'capture-failed', detail: 'interrupted' });
    }
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
    /* Only extension pages may start a capture. The page agent shares the
       extension id, so the id alone does not tell them apart; the sender URL
       does, because the agent runs on the web page's URL. */
    const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('/'));
    if (!fromExtensionPage || msg?.type !== 'capture:start' || typeof msg.tabId !== 'number') return false;

    let response: BackgroundResponse;
    if (isRunning()) {
      response = { accepted: false, reason: 'busy' };
    } else {
      void runCapture(msg.tabId);
      response = { accepted: true };
    }
    sendResponse(response);
    return false;
  });
});
