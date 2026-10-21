/* Opening the popup starts a capture of the active tab; after that the popup
 * only displays progress, which the service worker publishes in
 * storage.session. Closing it does not stop anything. */

import type { BackgroundResponse, Job } from '../../core/protocol';
import { getJob, onJobChange } from '../../platform/chrome';
import { applyI18n, t } from '../../ui/i18n';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $('status');
const fill = $('bar-fill');
const bar = fill.parentElement!;
const hint = $('hint');
const error = $('error');
const retry = $<HTMLButtonElement>('retry');

applyI18n();

$('options').addEventListener('click', () => void chrome.runtime.openOptionsPage());
$('recent').addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('/capture.html') });
  window.close();
});

/* `?tab=<id>` targets a specific tab instead of the active one. Used by the
   end-to-end tests, which cannot click the toolbar button; harmless
   otherwise, because a tab Pagesmith has no access to still cannot be
   captured. */
async function targetTabId(): Promise<number | null> {
  const param = new URLSearchParams(location.search).get('tab');
  if (param && /^\d+$/.test(param)) return Number(param);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function setProgress(fraction: number) {
  const pct = Math.round(fraction * 100);
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
}

function render(job: Job | null, tabId: number | null) {
  error.hidden = true;
  retry.hidden = true;
  if (!job) return;

  if (job.status === 'running') {
    hint.hidden = false;
    status.textContent =
      tabId !== null && job.tabId !== tabId ? t('popupBusy') : t('popupCapturing', String(Math.round(job.progress * 100)));
    setProgress(job.progress);
    return;
  }

  if (job.status === 'done' && job.tabId === tabId) {
    hint.hidden = true;
    status.textContent = t('popupDone');
    setProgress(1);
    // The viewer tab opening takes focus and closes the popup anyway; this
    // covers the case where it opened in a window that is not focused.
    setTimeout(() => window.close(), 800);
    return;
  }

  if (job.status === 'error' && job.tabId === tabId) {
    hint.hidden = true;
    status.textContent = '';
    error.hidden = false;
    error.textContent =
      job.error === 'restricted-page'
        ? t('errRestricted')
        : job.error === 'no-tab'
          ? t('errNoTab')
          : t('errFailed', job.detail);
    retry.hidden = job.error === 'restricted-page';
  }
}

async function start(tabId: number) {
  setProgress(0);
  status.textContent = t('popupPreparing');
  const response = (await chrome.runtime.sendMessage({ type: 'capture:start', tabId })) as BackgroundResponse;
  if (!response.accepted) status.textContent = t('popupBusy');
}

async function main() {
  const tabId = await targetTabId();
  onJobChange((job) => render(job, tabId));
  retry.addEventListener('click', () => tabId !== null && void start(tabId));

  if (tabId === null) {
    render({ status: 'error', tabId: -1, error: 'no-tab', detail: '' }, -1);
    return;
  }

  const job = await getJob();
  if (job?.status === 'running') render(job, tabId);
  else await start(tabId);
}

void main();
