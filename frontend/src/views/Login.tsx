// Shared-password login. Swap for Google/OAuth by replacing this view + lib/auth on the backend.
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { Button, Card, Input } from '../components/ui.tsx';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <Card>
        <h1>PWA Starter</h1>
        <form onSubmit={submit}>
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? '…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
