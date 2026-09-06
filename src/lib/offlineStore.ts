// IndexedDB 極簡 KV（離線報到用；無外部依賴）
const DB_NAME = 'himitsu-offline';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;  // 私密視窗等環境 IndexedDB 可能不可用——離線功能靜默降級
  }
}

export function kvSet(key: string, value: unknown): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(value, key));
}

export function kvGet<T>(key: string): Promise<T | null> {
  return withStore<T>('readonly', (store) => store.get(key));
}
