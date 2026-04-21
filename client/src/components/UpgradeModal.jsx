import { useNavigate } from 'react-router-dom';
import Modal from './Modal';
import {
  PLAN_LABELS,
  FEATURE_META,
  requiredPlan,
} from '../../../shared/index.js';

/**
 * Upgrade prompt shown when a user taps a feature their plan doesn't include.
 *
 * Props (use one of these):
 *   - feature: string key from FEATURES (looks up label + description + required plan)
 *   - OR plan: string — the plan required (e.g. 'GROWTH')
 *   - title, body: optional overrides if the defaults aren't a good fit
 *     (e.g. "Property limit reached" for the limit-exceeded case)
 */
export default function UpgradeModal({
  open,
  onClose,
  feature,
  plan,
  title,
  body,
  extra,
}) {
  const navigate = useNavigate();
  const needsPlan = plan || (feature ? requiredPlan(feature) : 'GROWTH');
  const planName = PLAN_LABELS[needsPlan] || needsPlan;
  const meta = feature ? FEATURE_META[feature] : null;

  const resolvedTitle = title
    || (meta ? `Upgrade to ${planName} to unlock ${meta.label}` : `Upgrade to ${planName}`);
  const resolvedBody = body || meta?.desc || null;

  const goBilling = () => {
    onClose?.();
    navigate('/billing');
  };

  return (
    <Modal open={open} onClose={onClose} title={resolvedTitle}>
      <div className="modal-form">
        {resolvedBody && <p className="upgrade-modal-body">{resolvedBody}</p>}
        {extra}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Not now
          </button>
          <button type="button" className="btn-primary" onClick={goBilling}>
            Upgrade to {planName}
          </button>
        </div>
      </div>
    </Modal>
  );
}
