import { openDB } from 'idb';

const DB_NAME = 'roomreport-offline';
const DB_VERSION = 1;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Queue for pending item saves
        if (!db.objectStoreNames.contains('saveQueue')) {
          const store = db.createObjectStore('saveQueue', { keyPath: 'id', autoIncrement: true });
          store.createIndex('itemId', 'itemId');
        }
        // Queue for pending photo uploads
        if (!db.objectStoreNames.contains('photoQueue')) {
          db.createObjectStore('photoQueue', { keyPath: 'id', autoIncrement: true });
        }
        // Local cache of inspection items for offline viewing
        if (!db.objectStoreNames.contains('itemCache')) {
          db.createObjectStore('itemCache', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

// ─── Save Queue ─────────────────────────────────────────

export async function queueSave(inspectionId, itemId, data) {
  const db = await getDB();
  // Remove any existing queued save for this item (keep latest only)
  const tx = db.transaction('saveQueue', 'readwrite');
  const index = tx.store.index('itemId');
  const existing = await index.getAll(itemId);
  for (const entry of existing) {
    await tx.store.delete(entry.id);
  }
  await tx.store.add({
    inspectionId,
    itemId,
    data,
    timestamp: Date.now(),
  });
  await tx.done;
}

export async function getSaveQueue() {
  const db = await getDB();
  return db.getAll('saveQueue');
}

export async function removeSaveEntry(id) {
  const db = await getDB();
  await db.delete('saveQueue', id);
}

export async function clearSaveQueue() {
  const db = await getDB();
  await db.clear('saveQueue');
}

// ─── Photo Queue ────────────────────────────────────────

export async function queuePhoto(inspectionId, itemId, blob, filename) {
  const db = await getDB();
  await db.add('photoQueue', {
    inspectionId,
    itemId,
    blob,
    filename,
    timestamp: Date.now(),
  });
}

export async function getPhotoQueue() {
  const db = await getDB();
  return db.getAll('photoQueue');
}

export async function removePhotoEntry(id) {
  const db = await getDB();
  await db.delete('photoQueue', id);
}

// ─── Item Cache ─────────────────────────────────────────

export async function cacheItems(items) {
  const db = await getDB();
  const tx = db.transaction('itemCache', 'readwrite');
  for (const item of items) {
    await tx.store.put(item);
  }
  await tx.done;
}

export async function getCachedItem(itemId) {
  const db = await getDB();
  return db.get('itemCache', itemId);
}

export async function updateCachedItem(itemId, data) {
  const db = await getDB();
  const existing = await db.get('itemCache', itemId);
  if (existing) {
    await db.put('itemCache', { ...existing, ...data });
  }
}

// ─── Sync ───────────────────────────────────────────────

export async function syncAll(onProgress) {
  const saves = await getSaveQueue();
  const photos = await getPhotoQueue();
  const total = saves.length + photos.length;
  let completed = 0;

  // Sync item saves in order
  for (const entry of saves) {
    try {
      const res = await fetch(`/api/inspections/${entry.inspectionId}/items/${entry.itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(entry.data),
      });
      if (res.ok) {
        await removeSaveEntry(entry.id);
      }
    } catch {
      // Will retry next sync
      break;
    }
    completed++;
    onProgress?.(completed, total);
  }

  // Sync photo uploads
  for (const entry of photos) {
    try {
      const form = new FormData();
      form.append('photo', entry.blob, entry.filename);
      const res = await fetch(`/api/inspections/${entry.inspectionId}/items/${entry.itemId}/photos`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (res.ok) {
        await removePhotoEntry(entry.id);
      }
    } catch {
      break;
    }
    completed++;
    onProgress?.(completed, total);
  }

  const remaining = await getSaveQueue();
  const remainingPhotos = await getPhotoQueue();
  return { synced: completed, remaining: remaining.length + remainingPhotos.length };
}

export async function getPendingCount() {
  const saves = await getSaveQueue();
  const photos = await getPhotoQueue();
  return saves.length + photos.length;
}
