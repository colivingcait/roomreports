import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user, organization, logout } = useAuth();

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ color: '#4A4543', fontSize: '1.5rem', marginBottom: '0.25rem' }}>
            Welcome, {user?.name}
          </h1>
          <p style={{ color: '#8A8583', fontSize: '0.9rem' }}>
            {organization?.name}
          </p>
        </div>
        <button
          onClick={logout}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: 'transparent',
            border: '1px solid #D4D0CE',
            borderRadius: '8px',
            color: '#4A4543',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
        >
          Sign out
        </button>
      </div>
      <div style={{
        backgroundColor: '#fff',
        borderRadius: '12px',
        padding: '3rem',
        textAlign: 'center',
        border: '1px solid #E8E4E1',
      }}>
        <p style={{ color: '#8A8583', fontSize: '1.1rem' }}>
          Dashboard coming soon
        </p>
      </div>
    </div>
  );
}
