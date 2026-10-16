import { useState, type FormEvent } from 'react';

interface DataApiControl {
  enabled: boolean;
  overrideEnabled: boolean;
  statusCode: number;
  message: string;
}

const defaults: DataApiControl = {
  enabled: true,
  overrideEnabled: false,
  statusCode: 503,
  message: 'API temporarily unavailable',
};

export default function SetPage() {
  const [settings, setSettings] = useState(defaults);
  const [code, setCode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const unlockSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/data/control', {
        headers: { 'X-Set-Code': code },
      });
      if (!response.ok) throw new Error('Incorrect code.');
      setSettings(await response.json());
      setUnlocked(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not unlock settings.');
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');

    try {
      const response = await fetch('/api/data/control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Set-Code': code },
        body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save settings');
      setSettings(result);
      setNotice('Saved.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 px-5 py-12 text-stone-900">
      {!unlocked ? (
        <form
          onSubmit={unlockSettings}
          className="mx-auto max-w-md space-y-5 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-xl font-semibold">Guardrail debugging</h1>
          <label className="block space-y-1.5 text-sm font-medium">
            Code
            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="w-full rounded-md border border-stone-300 px-3 py-2 font-mono"
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Checking…' : 'Unlock'}
          </button>
          <span aria-live="polite" className="ml-3 text-sm text-stone-500">{notice}</span>
        </form>
      ) : (
      <form
        onSubmit={saveSettings}
        className="mx-auto max-w-md space-y-6 rounded-xl border border-stone-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">API response settings</h1>
          <p className="mt-1 text-sm text-stone-500">Control responses from /api/data.</p>
        </div>

        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            className="h-4 w-4 accent-stone-900"
          />
          Allow /api/data requests
        </label>

        <label className="flex items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={settings.overrideEnabled}
            onChange={(event) => setSettings({ ...settings, overrideEnabled: event.target.checked })}
            className="h-4 w-4 accent-stone-900"
          />
          Use custom response while API is enabled
        </label>

        <label className="block space-y-1.5 text-sm font-medium">
          Custom response status code
          <input
            type="number"
            min="200"
            max="599"
            value={settings.statusCode}
            onChange={(event) => setSettings({ ...settings, statusCode: Number(event.target.value) })}
            className="w-full rounded-md border border-stone-300 px-3 py-2 font-mono"
            required
          />
        </label>

        <label className="block space-y-1.5 text-sm font-medium">
          Custom response message
          <textarea
            value={settings.message}
            maxLength={2000}
            onChange={(event) => setSettings({ ...settings, message: event.target.value })}
            className="min-h-24 w-full rounded-md border border-stone-300 px-3 py-2"
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading || saving}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <span aria-live="polite" className="ml-3 text-sm text-stone-500">
          {notice}
        </span>
      </form>
      )}
    </main>
  );
}
