import React, { useState } from 'react';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { app } from './firebase';

const auth = getAuth(app);

const LoginPage: React.FC<{ onLogin: (user: any) => void }> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      onLogin(userCredential.user);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(120deg, #3949ab 0%, #1a237e 100%)',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 4px 32px #0002',
        padding: '48px 36px',
        minWidth: 340,
        maxWidth: 380,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <img src="/vite.svg" alt="Logo" style={{ width: 64, marginBottom: 18 }} />
        <h2 style={{ color: '#1a237e', fontWeight: 700, marginBottom: 18, fontSize: 28, letterSpacing: 1 }}>Welcome to Airtech Inventory ERP System</h2>
        <form onSubmit={handleLogin} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid #c5cae9',
              fontSize: 16,
              outline: 'none',
              boxShadow: '0 1px 4px #0001',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              padding: '12px 16px',
              borderRadius: 8,
              border: '1px solid #c5cae9',
              fontSize: 16,
              outline: 'none',
              boxShadow: '0 1px 4px #0001',
            }}
          />
          <button type="submit" disabled={loading} style={{
            background: '#3949ab',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '12px 0',
            fontWeight: 600,
            fontSize: 18,
            letterSpacing: 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: '0 2px 8px #3949ab33',
            transition: 'background 0.2s',
          }}>{loading ? 'Logging in...' : 'Login'}</button>
          {error && <div style={{ color: '#d32f2f', marginTop: 8, textAlign: 'center', fontWeight: 500 }}>{error}</div>}
        </form>
        <div style={{ marginTop: 24, color: '#3949ab', fontSize: 15, textAlign: 'center', opacity: 0.8 }}>
          <span>Airtech Inventory ERP System &copy; {new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
