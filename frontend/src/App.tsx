import { useEffect, useState } from 'react';
import { api } from './lib/api.ts';
import { useQuery, useIsFetching, mutate, clearCache } from './lib/query.ts';
import { pushState, enablePush, disablePush, sendTestPush, type PushState } from './lib/push.ts';
import { Button, Card, Input } from './components/ui.tsx';
import { ChatWidget } from './components/ChatWidget.tsx';
import { Login } from './views/Login.tsx';

type Tab = 'notes' | 'chat' | 'settings';
interface Note {
  id: string;
  title?: string;
  body?: string;
}

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('notes');
  const fetching = useIsFetching();

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="center muted">Loading…</div>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  return (
    <div className="app">
      {fetching && <div className="spinner" aria-hidden />}
      <main className="content">
        {tab === 'notes' && <NotesView />}
        {tab === 'chat' && <ChatWidget />}
        {tab === 'settings' && <SettingsView onLogout={() => setAuthed(false)} />}
      </main>
      <nav className="tabbar">
        <TabButton id="notes" tab={tab} setTab={setTab} label="Notes" />
        <TabButton id="chat" tab={tab} setTab={setTab} label="Chat" />
        <TabButton id="settings" tab={tab} setTab={setTab} label="Settings" />
      </nav>
    </div>
  );
}

function TabButton({ id, tab, setTab, label }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; label: string }) {
  return (
    <button className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)}>
      {label}
    </button>
  );
}

function NotesView() {
  const notes = useQuery<Note[]>('notes') || [];
  const [title, setTitle] = useState('');

  async function add(): Promise<void> {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    // Optimistic: show the note immediately (temp id), reconcile with the server's row after.
    await mutate<Note[]>(
      'notes',
      (prev) => [{ id: `tmp-${Date.now()}`, title: t }, ...(prev ?? [])],
      () => api.create('notes', { title: t }),
    ).catch(() => {}); // rollback already handled inside mutate
  }
  async function del(id: string): Promise<void> {
    await mutate<Note[]>(
      'notes',
      (prev) => (prev ?? []).filter((n) => n.id !== id),
      () => api.remove('notes', id),
    ).catch(() => {});
  }

  return (
    <div className="view">
      <h2>Notes</h2>
      <p className="muted">Demo of the generic CRUD resource + offline query cache.</p>
      <div className="row">
        <Input
          placeholder="New note"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button onClick={() => void add()}>Add</Button>
      </div>
      {notes.map((n) => (
        <Card key={n.id} className="note">
          <span>{n.title}</span>
          <Button variant="danger" onClick={() => void del(n.id)}>
            ✕
          </Button>
        </Card>
      ))}
    </div>
  );
}

function SettingsView({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<PushState>('off');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    pushState().then(setState);
  }, []);

  async function toggle(): Promise<void> {
    setMsg('');
    try {
      if (state === 'on') {
        await disablePush();
      } else {
        await enablePush();
      }
      setState(await pushState());
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function test(): Promise<void> {
    setMsg('');
    try {
      const sent = await sendTestPush();
      setMsg(`Sent to ${sent} device(s).`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function logout(): Promise<void> {
    await api.logout();
    clearCache();
    onLogout();
  }

  return (
    <div className="view">
      <h2>Settings</h2>
      <Card>
        <h3>Notifications</h3>
        <p className="muted">Web Push status: {state}</p>
        {state === 'unsupported' ? (
          <p className="muted">This browser/device doesn't support Web Push (install the PWA on iOS).</p>
        ) : (
          <div className="row">
            <Button onClick={() => void toggle()}>{state === 'on' ? 'Disable' : 'Enable'}</Button>
            <Button variant="ghost" onClick={() => void test()} disabled={state !== 'on'}>
              Send test notification
            </Button>
          </div>
        )}
        {msg && <p className="muted">{msg}</p>}
      </Card>
      <Button variant="ghost" onClick={() => void logout()}>
        Log out
      </Button>
    </div>
  );
}
