import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Welcome, {user?.name}</h1>
          <p className="page-subtitle">Here&apos;s your overview</p>
        </div>
      </div>
      <div className="empty-state">
        <p>Dashboard coming soon</p>
      </div>
    </div>
  );
}
