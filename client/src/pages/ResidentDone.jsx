import { useNavigate, useLocation } from 'react-router-dom';

export default function ResidentDone() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMoveIn = location.state?.type === 'MOVE_IN_OUT';

  return (
    <div className="resident-done">
      <div className="resident-done-emoji">{'\u{1F3E0}'}</div>
      <h1>{isMoveIn ? 'Welcome home!' : 'Thanks!'}</h1>
      <p className="resident-done-msg">
        {isMoveIn
          ? 'Your move-in inspection is saved.'
          : 'Your check is submitted.'}
      </p>
      <p className="resident-done-sub">
        {isMoveIn
          ? 'Your property manager will review it shortly. Your photos serve as the baseline for your room.'
          : 'Your property manager will review it shortly.'}
      </p>
      <button
        className="btn-resident-secondary"
        onClick={() => navigate('/resident')}
      >
        Back to Home
      </button>
    </div>
  );
}
