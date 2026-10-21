/* Captured images, kept in the extension's own IndexedDB.
 *
 * Not storage.local: that serialises to JSON, which cannot hold a Blob, and
 * base64 would add a third to every image. IndexedDB stores Blobs natively and
 * is reachable from the service worker that writes captures and the viewer
 * page that reads them, since both run on the extension's origin. Nothing here
 * ever leaves the machine. */

export interface StoredTile {
  /* Position of this tile in the full output, device px. */
  x: number;
  y: number;
  width: number;
  height: number;
  blob: Blob;
}

export interface StoredCapture {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  /* Full output size, device px. */
  width: number;
  height: number;
  /* Device px per CSS px, so the viewer can show the image at page size. */
  scale: number;
  partial: 'visible-only' | 'height-limit' | null;
  tiles: StoredTile[];
}

const DB_NAME = 'pagesmith';
const STORE = 'captures';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export function putCapture(capture: StoredCapture): Promise<IDBValidKey> {
  return run('readwrite', (s) => s.put(capture));
}

export async function getCapture(id: string): Promise<StoredCapture | null> {
  return ((await run('readonly', (s) => s.get(id))) as StoredCapture | undefined) ?? null;
}

export function deleteCapture(id: string): Promise<undefined> {
  return run('readwrite', (s) => s.delete(id));
}

/* Newest first, without the image data: the list in the viewer needs titles
   and dates, and loading every Blob just to show them would be wasteful. */
export async function listCaptures(): Promise<Omit<StoredCapture, 'tiles'>[]> {
  const all = (await run('readonly', (s) => s.getAll())) as StoredCapture[];
  return all
    .map(({ tiles: _tiles, ...meta }) => meta)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/* Deletes all but the newest `keep` captures. */
export async function pruneCaptures(keep: number): Promise<number> {
  const all = await listCaptures();
  const stale = all.slice(keep);
  for (const c of stale) await deleteCapture(c.id);
  return stale.length;
}
