import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Globe, Loader2, X } from 'lucide-react';
import { api, subscribe } from './api.js';
import TorStatus from './components/TorStatus.jsx';
import CreateSiteForm from './components/CreateSiteForm.jsx';
import SiteCard from './components/SiteCard.jsx';

const INITIAL_TOR = {
  status: 'stopped',
  bootstrapProgress: 0,
  bootstrapMessage: '',
  controlPort: 9151,
  lastError: null,
};

function Toast({ toast, onDismiss }) {
  const isError = toast.kind === 'error';
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
        isError
          ? 'border-red-500/40 bg-red-950/85 text-red-200'
          : 'border-online-500/40 bg-emerald-950/85 text-emerald-200'
      }`}
    >
      {isError && <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span className="break-onion min-w-0 flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function App() {
  const [tor, setTor] = useState(INITIAL_TOR);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [torBusy, setTorBusy] = useState(false);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message, kind = 'error') => {
      toastSeq.current += 1;
      const id = toastSeq.current;
      setToasts((current) => [...current, { id, message, kind }]);
      setTimeout(() => dismissToast(id), 6000);
      return id;
    },
    [dismissToast],
  );

  const markBusy = useCallback((id, busy) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Initial load, then keep in sync with the server's event stream.
  useEffect(() => {
    let active = true;

    api
      .status()
      .then((data) => {
        if (!active) return;
        setTor(data.tor);
        setSites(data.sites);
      })
      .catch((err) => {
        if (active) pushToast(`Could not reach the backend: ${err.message}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const unsubscribe = subscribe({
      'tor-status': (state) => setTor(state),
      sites: (data) => setSites(data.sites),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [pushToast]);

  const refreshSites = useCallback(async () => {
    try {
      const { sites: next } = await api.listSites();
      setSites(next);
    } catch {
      // The event stream will resync shortly; no need to surface this.
    }
  }, []);

  const handleCreate = async (name, serve, port) => {
    setCreating(true);
    try {
      const { site, warning } = await api.createSite(name, serve, port);
      await refreshSites();
      if (warning) pushToast(`Site created, but serving failed: ${warning}`);
      else pushToast(`“${site.name}” is live at ${site.onion}`, 'success');
      return true;
    } catch (err) {
      pushToast(err.message);
      return false;
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (site, deleteFiles) => {
    markBusy(site.id, true);
    try {
      await api.deleteSite(site.id, deleteFiles);
      await refreshSites();
      pushToast(`Removed “${site.name}”`, 'success');
    } catch (err) {
      pushToast(err.message);
    } finally {
      markBusy(site.id, false);
    }
  };

  const handleToggleServing = async (site, serving) => {
    markBusy(site.id, true);
    try {
      await api.setServing(site.id, serving);
      await refreshSites();
    } catch (err) {
      pushToast(err.message);
      await refreshSites();
    } finally {
      markBusy(site.id, false);
    }
  };

  const handleTorStart = async () => {
    setTorBusy(true);
    try {
      const { restored } = await api.startTor();
      await refreshSites();
      const failed = (restored ?? []).filter((r) => !r.ok);
      for (const entry of failed) {
        pushToast(`Could not restore “${entry.name}”: ${entry.error}`);
      }
    } catch (err) {
      pushToast(err.message);
    } finally {
      setTorBusy(false);
    }
  };

  const handleTorStop = async () => {
    setTorBusy(true);
    try {
      await api.stopTor();
      await refreshSites();
    } catch (err) {
      pushToast(err.message);
    } finally {
      setTorBusy(false);
    }
  };

  const torRunning = tor.status === 'running';
  const publishedCount = sites.filter((s) => s.published).length;

  return (
    <div className="min-h-screen">
      {/* inset-x + max-w keeps long onion addresses inside the viewport */}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-50 ml-auto flex max-w-sm flex-col gap-2 sm:left-auto">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>

      <div className="mx-auto max-w-4xl px-5 py-10">
        <header className="mb-8 flex items-center gap-3">
          <div className="rounded-xl border border-accent-500/30 bg-accent-600/15 p-2.5 text-accent-400">
            <Globe size={20} aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-100">TorControl</h1>
            <p className="text-xs text-ink-400">
              Create and manage local Tor hidden services
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-5">
          <TorStatus
            tor={tor}
            busy={torBusy}
            onStart={handleTorStart}
            onStop={handleTorStop}
          />

          <CreateSiteForm
            onCreate={handleCreate}
            creating={creating}
            disabled={!torRunning}
          />

          <section>
            <div className="mb-3 flex items-baseline justify-between px-1">
              <h2 className="text-sm font-semibold text-ink-100">
                Sites
                {sites.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-ink-400">
                    {publishedCount} of {sites.length} published
                  </span>
                )}
              </h2>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-ink-700 bg-ink-850/60 py-14 text-sm text-ink-400">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Loading…
              </div>
            ) : sites.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-850/40 py-14 text-center">
                <Globe size={26} className="mx-auto mb-3 text-ink-600" aria-hidden="true" />
                <p className="text-sm text-ink-300">No hidden services yet</p>
                <p className="mt-1 text-xs text-ink-400">
                  Create one above and its .onion address will appear here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {sites.map((site) => (
                  <SiteCard
                    key={site.id}
                    site={site}
                    busy={busyIds.has(site.id)}
                    onDelete={handleDelete}
                    onToggleServing={handleToggleServing}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="mt-10 border-t border-ink-700/60 pt-5 text-center text-[11px] text-ink-400">
          Sites are reachable only while this app and its Tor instance are running.
        </footer>
      </div>
    </div>
  );
}
