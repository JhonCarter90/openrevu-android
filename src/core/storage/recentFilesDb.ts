// Persistenza locale dei PDF recenti in IndexedDB (bytes + eventuale FileSystemFileHandle)
// Permette di riaprire direttamente qualsiasi documento recente senza doverlo riselezionare dal PC.

const DB_NAME = 'openrevu_recent_files_db';
const DB_VERSION = 1;
const STORE_NAME = 'files';

export interface StoredRecentFile {
  fileName: string;
  bytes?: ArrayBuffer;
  handle?: any; // FileSystemFileHandle quando disponibile
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB non disponibile'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'fileName' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecentFileData(
  fileName: string,
  bytes?: Uint8Array,
  handle?: any
): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Preserva l'eventuale handle o bytes esistenti se uno dei due non viene passato
    const existing = await new Promise<StoredRecentFile | undefined>((resolve) => {
      const getReq = store.get(fileName);
      getReq.onsuccess = () => resolve(getReq.result as StoredRecentFile | undefined);
      getReq.onerror = () => resolve(undefined);
    });

    const record: StoredRecentFile = {
      fileName,
      bytes: bytes ? bytes.slice().buffer : existing?.bytes,
      handle: handle !== undefined ? handle : existing?.handle,
      updatedAt: Date.now(),
    };
    store.put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignora errori di quota o browser privati
  }
}

export async function loadRecentFileData(
  fileName: string
): Promise<{ bytes?: Uint8Array; handle?: any } | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const record = await new Promise<StoredRecentFile | undefined>((resolve) => {
      const req = store.get(fileName);
      req.onsuccess = () => resolve(req.result as StoredRecentFile | undefined);
      req.onerror = () => resolve(undefined);
    });
    db.close();
    if (!record) return null;
    return {
      bytes: record.bytes ? new Uint8Array(record.bytes) : undefined,
      handle: record.handle,
    };
  } catch {
    return null;
  }
}

export async function deleteRecentFileData(fileName: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(fileName);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Ignora
  }
}
