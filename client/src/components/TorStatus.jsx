import { Loader2, Play, Power, ShieldCheck, ShieldAlert } from 'lucide-react';

const PRESENTATION = {
  running: { label: 'Tor running', tone: 'text-online-400', dot: 'bg-online-400', Icon: ShieldCheck },
  starting: { label: 'Bootstrapping', tone: 'text-amber-400', dot: 'bg-amber-400', Icon: Loader2 },
  stopping: { label: 'Stopping', tone: 'text-amber-400', dot: 'bg-amber-400', Icon: Loader2 },
  stopped: { label: 'Tor stopped', tone: 'text-ink-400', dot: 'bg-ink-400', Icon: Power },
  error: { label: 'Tor error', tone: 'text-red-400', dot: 'bg-red-400', Icon: ShieldAlert },
};

export default function TorStatus({ tor, onStart, onStop, busy }) {
  const view = PRESENTATION[tor.status] ?? PRESENTATION.stopped;
  const { Icon } = view;
  const isTransitioning = tor.status === 'starting' || tor.status === 'stopping';
  const running = tor.status === 'running';

  return (
    <section className="rounded-2xl border border-ink-700 bg-ink-850/80 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`rounded-xl border border-ink-700 bg-ink-900 p-2 ${view.tone}`}>
            <Icon size={17} className={isTransitioning ? 'animate-spin' : ''} aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${view.dot}`} />
              <span className="text-sm font-semibold text-ink-100">{view.label}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-400">
              {tor.status === 'running'
                ? `Control port ${tor.controlPort} · private instance`
                : tor.bootstrapMessage || 'Not connected'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={running ? onStop : onStart}
          disabled={busy || isTransitioning}
          className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
            running
              ? 'border-ink-600 bg-ink-800 text-ink-100 hover:bg-ink-700 focus-visible:ring-accent-500/70'
              : 'border-accent-500 bg-accent-600 text-white hover:bg-accent-500 focus-visible:ring-accent-400'
          }`}
        >
          {busy || isTransitioning ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : running ? (
            <Power size={13} aria-hidden="true" />
          ) : (
            <Play size={13} aria-hidden="true" />
          )}
          {running ? 'Stop Tor' : 'Start Tor'}
        </button>
      </div>

      {tor.status === 'starting' && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[11px] text-ink-400">
            <span>{tor.bootstrapMessage || 'Connecting to the Tor network'}</span>
            <span className="font-mono-tight">{tor.bootstrapProgress}%</span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-ink-700"
            role="progressbar"
            aria-valuenow={tor.bootstrapProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Tor bootstrap progress"
          >
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-500 ease-out"
              style={{ width: `${tor.bootstrapProgress}%` }}
            />
          </div>
        </div>
      )}

      {tor.lastError && tor.status !== 'running' && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {tor.lastError}
        </p>
      )}
    </section>
  );
}
