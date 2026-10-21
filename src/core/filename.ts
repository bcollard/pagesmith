/* Filenames for downloaded captures, from a user-editable template.
 *
 *   {title}  page title          {host}  hostname without "www."
 *   {date}   YYYY-MM-DD          {time}  HH-MM-SS (local time)
 *   {path}   URL path, slashes turned into dashes
 *
 * The result goes to an <a download> attribute. Chrome sanitises that too,
 * but by replacing characters with underscores and silently dropping names it
 * dislikes, so cleaning it here keeps the name predictable. */

export interface FilenameContext {
  url: string;
  title: string;
  date: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
  } catch {
    return '';
  }
}

/* Characters Windows, macOS or Chrome's download manager reject or treat
   specially, plus control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;

export function sanitize(name: string): string {
  return name
    .replace(UNSAFE, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^[.\- ]+|[.\- ]+$/g, '')
    .slice(0, 150)
    .trim();
}

export function renderFilename(template: string, ctx: FilenameContext): string {
  const d = ctx.date;
  const values: Record<string, string> = {
    title: ctx.title,
    host: hostOf(ctx.url),
    path: pathOf(ctx.url),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
  };
  const filled = template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
  return sanitize(filled) || 'pagesmith';
}

/* Suffixes multi-part output so the parts sort in page order. */
export function partName(base: string, index: number, total: number, ext: string): string {
  if (total <= 1) return `${base}.${ext}`;
  const width = String(total).length;
  return `${base}-part${String(index + 1).padStart(width, '0')}.${ext}`;
}
