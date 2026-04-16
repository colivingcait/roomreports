import { useRef, useCallback, useState, useEffect } from 'react';

const pendingQueue = [];

function processQueue() {
  while (pendingQueue.length > 0) {
    const { url, body } = pendingQueue.shift();
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    }).catch(() => {
      pendingQueue.unshift({ url, body });
    });
  }
}

// Listen for online event to flush queue
if (typeof window !== 'undefined') {
  window.addEventListener('online', processQueue);
}

export function useAutoSave(inspectionId) {
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const timers = useRef({});

  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  const saveItem = useCallback((itemId, data) => {
    // Clear existing debounce for this item
    if (timers.current[itemId]) clearTimeout(timers.current[itemId]);

    setSaveStatus('saving');

    timers.current[itemId] = setTimeout(async () => {
      const url = `/api/inspections/${inspectionId}/items/${itemId}`;
      const body = data;

      if (!navigator.onLine) {
        pendingQueue.push({ url, body });
        setSaveStatus('saved');
        return;
      }

      try {
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveStatus('saved');
      } catch {
        pendingQueue.push({ url, body });
        setSaveStatus('error');
      }
    }, 500);
  }, [inspectionId]);

  return { saveItem, saveStatus };
}
