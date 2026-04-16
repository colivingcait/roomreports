import { useState, useEffect, useCallback } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { syncAll, getPendingCount } from '../lib/offlineStore';

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const checkPending = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  // Check pending count periodically
  useEffect(() => {
    checkPending();
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, [checkPending]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && pendingCount > 0 && !syncing) {
      handleSync();
    }
  }, [isOnline, pendingCount]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncAll((completed, total) => {
        setSyncResult({ completed, total });
      });
      if (result.remaining === 0) {
        setSyncResult({ done: true });
        setTimeout(() => setSyncResult(null), 3000);
      } else {
        setSyncResult({ remaining: result.remaining });
      }
    } catch {
      setSyncResult({ error: true });
    } finally {
      setSyncing(false);
      checkPending();
    }
  };

  // Don't show anything if online and nothing pending
  if (isOnline && pendingCount === 0 && !syncResult) return null;

  return (
    <div className={`offline-banner ${isOnline ? 'online' : 'offline'}`}>
      {!isOnline && (
        <>
          <span className="offline-dot" />
          <span>Offline Mode — changes saved locally</span>
          {pendingCount > 0 && (
            <span className="offline-count">{pendingCount} pending</span>
          )}
        </>
      )}

      {isOnline && syncing && (
        <>
          <span className="syncing-spinner" />
          <span>
            Syncing...
            {syncResult && !syncResult.done && (
              <> ({syncResult.completed}/{syncResult.total})</>
            )}
          </span>
        </>
      )}

      {isOnline && !syncing && syncResult?.done && (
        <>
          <span className="sync-check">&#10003;</span>
          <span>All changes synced</span>
        </>
      )}

      {isOnline && !syncing && syncResult?.error && (
        <>
          <span>Sync failed — </span>
          <button className="offline-retry" onClick={handleSync}>Retry</button>
        </>
      )}

      {isOnline && !syncing && pendingCount > 0 && !syncResult && (
        <>
          <span>{pendingCount} change{pendingCount !== 1 ? 's' : ''} to sync — </span>
          <button className="offline-retry" onClick={handleSync}>Sync Now</button>
        </>
      )}
    </div>
  );
}
