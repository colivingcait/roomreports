import { useCallback, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { canAccess, planLimit, requiredPlan } from '../../../shared/index.js';

/**
 * Hook for feature gating with soft-gate UX.
 *
 * Returns:
 *   - can(feature) — true if the user's org is allowed (always true during beta)
 *   - limit(resource) — numeric limit (or Infinity)
 *   - needed(feature) — required plan string
 *   - gate: { open, feature, plan, title, body } — current upgrade prompt
 *   - promptUpgrade(opts) — show the modal for `{ feature }` or `{ plan, title, body }`
 *   - dismiss() — close the modal
 *   - isBeta — true if the org is on beta access
 */
export function useFeatureGate() {
  const { organization } = useAuth();
  const [gate, setGate] = useState({ open: false });

  const can = useCallback(
    (feature) => canAccess(organization, feature),
    [organization],
  );

  const limit = useCallback(
    (resource) => planLimit(organization, resource),
    [organization],
  );

  const promptUpgrade = useCallback((opts) => {
    setGate({ open: true, ...opts });
  }, []);

  const dismiss = useCallback(() => {
    setGate((g) => ({ ...g, open: false }));
  }, []);

  return {
    can,
    limit,
    needed: requiredPlan,
    gate,
    promptUpgrade,
    dismiss,
    isBeta: !!organization?.isBeta,
    plan: organization?.plan || 'OPERATOR',
  };
}
