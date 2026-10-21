import { parseSettings, type Settings } from '../../core/settings';
import { loadSettings, saveSettings } from '../../platform/settings';
import { applyI18n } from '../../ui/i18n';

applyI18n();

const form = document.getElementById('form') as HTMLFormElement;
const saved = document.getElementById('saved') as HTMLElement;

type Field = HTMLInputElement | HTMLSelectElement;
const field = (name: keyof Settings) => form.elements.namedItem(name) as Field | null;

function fill(settings: Settings) {
  for (const [name, value] of Object.entries(settings) as [keyof Settings, unknown][]) {
    const el = field(name);
    if (!el) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = String(value);
  }
}

function read(): Settings {
  const raw: Record<string, unknown> = {};
  for (const el of Array.from(form.elements) as Field[]) {
    if (!el.name) continue;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') raw[el.name] = el.checked;
    else if (el instanceof HTMLInputElement && (el.type === 'number' || el.type === 'range')) raw[el.name] = Number(el.value);
    else raw[el.name] = el.value;
  }
  // Out-of-range input falls back to the default for that field rather than
  // being saved; refilling the form shows the user what was kept.
  return parseSettings(raw);
}

let timer: ReturnType<typeof setTimeout> | undefined;

form.addEventListener('change', async () => {
  const settings = read();
  await saveSettings(settings);
  fill(settings);
  saved.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => (saved.hidden = true), 1500);
});

document.getElementById('shortcuts')!.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

void (async () => {
  fill(await loadSettings());
  const [command] = (await chrome.commands.getAll()).filter((c) => c.name === '_execute_action');
  if (command?.shortcut) document.getElementById('shortcut')!.textContent = command.shortcut;
})();
