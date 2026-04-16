import { useRef, useCallback, useState, useEffect } from 'react';
import { queueSave, updateCachedItem } from '../lib/offlineStore';
import { useOnlineStatus } from './useOnlineStatus';

export function useAutoSave(inspectionId) {
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | offline | error
  const timers = useRef({});
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (saveStatus === 'saved') {
      const t = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  const saveItem = useCallback((itemId, data) => {
    if (timers.current[itemId]) clearTimeout(timers.current[itemId]);

    setSaveStatus('saving');

    // Always update local cache immediately
    updateCachedItem(itemId, data).catch(() => {});

    timers.current[itemId] = setTimeout(async () => {
      if (!navigator.onLine) {
        // Queue for later sync
        await queueSave(inspectionId, itemId, data);
        setSaveStatus('offline');
        return;
      }

      try {
        const res = await fetch(`/api/inspections/${inspectionId}/items/${itemId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Save failed');
        setSaveStatus('saved');
      } catch {
        // Network error — queue for sync
        await queueSave(inspectionId, itemId, data);
        setSaveStatus('offline');
      }
    }, 500);
  }, [inspectionId]);

  return { saveItem, saveStatus, isOnline };
}
