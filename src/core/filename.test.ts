import { partName, renderFilename, sanitize } from './filename';

const date = new Date(2026, 9, 21, 9, 5, 7);

describe('renderFilename', () => {
  it('fills the default template', () => {
    expect(renderFilename('{host}-{date}-{time}', { url: 'https://www.example.com/a', title: 'x', date })).toBe(
      'example.com-2026-10-21-09-05-07',
    );
  });

  it('turns the path into dashes', () => {
    expect(renderFilename('{path}', { url: 'https://e.com/docs/guide/', title: '', date })).toBe('docs-guide');
  });

  it('removes characters filesystems reject', () => {
    expect(renderFilename('{title}', { url: '', title: 'Q3: "plan" <draft>/v2?', date })).toBe('Q3- -plan- -draft-v2');
  });

  it('leaves unknown placeholders alone', () => {
    expect(renderFilename('{nope}-{date}', { url: '', title: '', date })).toBe('{nope}-2026-10-21');
  });

  it('falls back to a fixed name when nothing is left', () => {
    expect(renderFilename('{title}', { url: 'not a url', title: '///', date })).toBe('pagesmith');
    expect(renderFilename('{host}', { url: 'not a url', title: '', date })).toBe('pagesmith');
  });
});

describe('sanitize', () => {
  it('trims leading dots so the file is not hidden', () => {
    expect(sanitize('..env')).toBe('env');
  });

  it('caps the length', () => {
    expect(sanitize('a'.repeat(400))).toHaveLength(150);
  });
});

describe('partName', () => {
  it('adds no suffix for a single image', () => {
    expect(partName('page', 0, 1, 'png')).toBe('page.png');
  });

  it('zero-pads part numbers so they sort', () => {
    expect(partName('page', 0, 12, 'jpg')).toBe('page-part01.jpg');
    expect(partName('page', 11, 12, 'jpg')).toBe('page-part12.jpg');
  });
});
