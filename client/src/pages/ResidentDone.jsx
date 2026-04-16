import { useNavigate } from 'react-router-dom';

export default function ResidentDone() {
  const navigate = useNavigate();

  return (
    <div className="resident-done">
      <div className="resident-done-emoji">{'\u{1F3E0}'}</div>
      <h1>Thanks!</h1>
      <p className="resident-done-msg">Your check is submitted.</p>
      <p className="resident-done-sub">Your property manager will review it shortly.</p>
      <button
        className="btn-resident-secondary"
        onClick={() => navigate('/resident')}
      >
        Back to Home
      </button>
    </div>
  );
}
