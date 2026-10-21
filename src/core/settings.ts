/* User settings and their validation.
 *
 * Hand-written rather than zod: nine flat fields do not justify ~170 KB of
 * schema library in both the service worker and every page, in a bundle that
 * is shipped unminified so it can be read.
 *
 * Each field falls back to its own default, so a stored value that is
 * missing, from an older version, or hand-edited into nonsense costs that one
 * field rather than the whole object. Settings are never a reason for a
 * capture to fail. */

export interface Settings {
  format: 'png' | 'jpeg';
  jpegQuality: number;
  /* What to do with position:fixed elements -- sticky headers, cookie bars,
     chat bubbles. Left alone they appear once per screenful.
       after-first  keep them in the first frame, hide them afterwards
       always       hide them in every frame
       never        leave them alone */
  fixedElements: 'after-first' | 'always' | 'never';
  /* Scroll through the page once before capturing so lazy-loaded images have
     been requested by the time their frame is taken. */
  preScroll: boolean;
  /* Wait after each scroll, for content that animates or loads on scroll.
     Chrome allows two captureVisibleTab calls per second regardless. */
  captureDelayMs: number;
  /* Cap on the output height in CSS px. Infinite feeds never end on their
     own, and memory use grows with every row. */
  maxPageHeight: number;
  filenameTemplate: string;
  pdfPaper: 'a4' | 'letter' | 'fit';
  /* How many captures the viewer keeps; older ones are deleted when a new
     capture is saved. */
  keepCaptures: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  format: 'png',
  jpegQuality: 0.92,
  fixedElements: 'after-first',
  preScroll: true,
  captureDelayMs: 150,
  maxPageHeight: 40000,
  filenameTemplate: '{host}-{date}-{time}',
  pdfPaper: 'a4',
  keepCaptures: 20,
});

type Validator<T> = (value: unknown) => value is T;

const oneOf =
  <T extends string>(...allowed: T[]): Validator<T> =>
  (v): v is T =>
    typeof v === 'string' && (allowed as string[]).includes(v);

const numberIn =
  (min: number, max: number, integer = false): Validator<number> =>
  (v): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!integer || Number.isInteger(v));

const boolean: Validator<boolean> = (v): v is boolean => typeof v === 'boolean';

const text =
  (min: number, max: number): Validator<string> =>
  (v): v is string =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;

const VALIDATORS: { [K in keyof Settings]: Validator<Settings[K]> } = {
  format: oneOf('png', 'jpeg'),
  jpegQuality: numberIn(0.5, 1),
  fixedElements: oneOf('after-first', 'always', 'never'),
  preScroll: boolean,
  captureDelayMs: numberIn(0, 3000, true),
  maxPageHeight: numberIn(2000, 200000, true),
  filenameTemplate: text(1, 200),
  pdfPaper: oneOf('a4', 'letter', 'fit'),
  keepCaptures: numberIn(1, 200, true),
};

export function parseSettings(value: unknown): Settings {
  const input = (value !== null && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SETTINGS } as Record<keyof Settings, unknown>;
  for (const key of Object.keys(VALIDATORS) as (keyof Settings)[]) {
    const candidate = input[key];
    if ((VALIDATORS[key] as Validator<unknown>)(candidate)) out[key] = candidate;
  }
  return out as Settings;
}
