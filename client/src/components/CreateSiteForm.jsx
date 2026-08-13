import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

export default function CreateSiteForm({ onCreate, disabled, creating }) {
  const [name, setName] = useState('');
  const [serve, setServe] = useState(true);
  const [customPort, setCustomPort] = useState(false);
  const [port, setPort] = useState('');

  const trimmedPort = port.trim();
  const portNumber = Number(trimmedPort);
  const portValid =
    !customPort ||
    (trimmedPort !== '' &&
      /^\d+$/.test(trimmedPort) &&
      portNumber >= 1024 &&
      portNumber <= 65535);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || disabled || creating || !portValid) return;
    const ok = await onCreate(trimmed, serve, customPort ? portNumber : null);
    if (ok) {
      setName('');
      setPort('');
      setCustomPort(false);
    }
  };

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/80 p-5 backdrop-blur">
      <h2 className="text-sm font-semibold text-ink-100">Create a hidden service</h2>
      <p className="mt-1 text-xs text-ink-400">
        A folder and starter page are created automatically, and a free local port is assigned
        unless you pick one.
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label htmlFor="site-name" className="sr-only">
            Site name
          </label>
          <input
            id="site-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My hidden site"
            maxLength={64}
            disabled={disabled || creating}
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3.5 py-2.5 text-sm text-ink-100 placeholder:text-ink-400 transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <button
          type="submit"
          disabled={disabled || creating || !name.trim() || !portValid}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-accent-500 bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:cursor-not-allowed disabled:border-ink-600 disabled:bg-ink-700 disabled:text-ink-400"
        >
          {creating ? (
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          ) : (
            <Plus size={15} aria-hidden="true" />
          )}
          {creating ? 'Creating…' : 'Create site'}
        </button>
      </form>

      <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-300">
        <input
          type="checkbox"
          checked={serve}
          onChange={(e) => setServe(e.target.checked)}
          disabled={disabled || creating}
          className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-800 accent-violet-500"
        />
        Serve the site folder from this app
      </label>

      <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-300">
        <input
          type="checkbox"
          checked={customPort}
          onChange={(e) => setCustomPort(e.target.checked)}
          disabled={disabled || creating}
          className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-800 accent-violet-500"
        />
        Choose the local port myself
      </label>

      {customPort && (
        <div className="mt-2.5 pl-5.5">
          <label htmlFor="site-port" className="sr-only">
            Local port
          </label>
          <input
            id="site-port"
            type="number"
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="8080"
            min={1024}
            max={65535}
            disabled={disabled || creating}
            className="w-32 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-400 transition-colors focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className={`mt-1.5 text-xs ${portValid ? 'text-ink-400' : 'text-amber-400/90'}`}>
            {portValid
              ? 'The onion address forwards port 80 to this local port.'
              : 'Enter a port between 1024 and 65535.'}
          </p>
        </div>
      )}

      {disabled && (
        <p className="mt-3 text-xs text-amber-400/90">Start Tor before creating a site.</p>
      )}
    </section>
  );
}
