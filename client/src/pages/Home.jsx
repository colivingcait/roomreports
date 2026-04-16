import { useEffect, useState } from 'react';

function Home() {
  const [status, setStatus] = useState('Loading...');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus('Server unreachable'));
  }, []);

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>RoomReport</h1>
      <p>Property inspection platform for coliving operators</p>
      <p>
        Server status: <strong>{status}</strong>
      </p>
    </div>
  );
}

export default Home;
