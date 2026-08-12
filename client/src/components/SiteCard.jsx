import { useState } from 'react';
import { Folder, Globe, Loader2, Server, Trash2 } from 'lucide-react';
import QrCode from './QrCode.jsx';
import CopyButton from './CopyButton.jsx';

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-online-500/80' : 'bg-ink-600'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function SiteCard({ site, onDelete, onToggleServing, busy }) {
  const [confirming, setConfirming] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);

  const online = site.published;

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-ink-700 bg-ink-850/80 backdrop-blur transition-colors hover:border-ink-600">
      <div className="flex flex-col gap-5 p-5 sm:flex-row">
        <div className="min-w-0 flex-1">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-ink-100" title={site.name}>
                {site.name}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      online ? 'bg-online-400 animate-pulse-ring' : 'bg-ink-400'
                    }`}
                  />
                  {online ? 'Published' : 'Offline'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Server size={11} aria-hidden="true" />
                  127.0.0.1:{site.port}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setConfirming((v) => !v)}
              disabled={busy}
              aria-label={`Delete ${site.name}`}
              className="rounded-lg border border-transparent p-2 text-ink-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 size={15} aria-hidden="true" />
              )}
            </button>
          </header>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
              <Globe size={11} aria-hidden="true" />
              Onion address
            </div>
            {site.onion ? (
              <div className="flex flex-wrap items-start gap-2">
                <code className="break-onion min-w-0 flex-1 rounded-lg border border-ink-700 bg-ink-950 px-2.5 py-2 font-mono-tight text-[11.5px] leading-relaxed text-accent-400">
                  {site.onion}
                </code>
                <CopyButton value={site.url} />
              </div>
            ) : (
              <p className="text-sm text-ink-400">Not published</p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-ink-700/70 pt-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-300">
              <Toggle
                checked={site.serving}
                disabled={busy}
                onChange={(next) => onToggleServing(site, next)}
                label={`Serve content for ${site.name}`}
              />
              Serve local content
            </label>
            <span
              className="inline-flex min-w-0 items-center gap-1.5 text-xs text-ink-400"
              title={site.dir}
            >
              <Folder size={11} className="shrink-0" aria-hidden="true" />
              <span className="truncate font-mono-tight">{site.dir}</span>
            </span>
          </div>
        </div>

        {site.url && (
          <div className="flex shrink-0 justify-center sm:justify-start">
            <QrCode value={site.url} size={168} />
          </div>
        )}
      </div>

      {confirming && (
        <div className="border-t border-red-500/25 bg-red-500/[0.07] px-5 py-4">
          <p className="text-sm text-ink-100">
            Remove <span className="font-semibold">{site.name}</span>? This unpublishes the onion
            service permanently — the address cannot be recovered.
          </p>
          <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-800 accent-red-500"
            />
            Also delete the site folder and its contents
          </label>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                onDelete(site, deleteFiles);
              }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              Remove site
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-xs font-medium text-ink-100 transition-colors hover:bg-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
