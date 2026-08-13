async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // A non-JSON body on an error response is still worth reporting.
  }
  if (!res.ok) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  status: () => request('/api/status'),
  listSites: () => request('/api/sites'),
  // `port` is optional: null lets the server allocate one.
  createSite: (name, serve, port = null) =>
    request('/api/sites', { method: 'POST', body: JSON.stringify({ name, serve, port }) }),
  deleteSite: (id, deleteFiles) =>
    request(`/api/sites/${id}?deleteFiles=${deleteFiles ? 'true' : 'false'}`, {
      method: 'DELETE',
    }),
  setServing: (id, serving) =>
    request(`/api/sites/${id}/serving`, {
      method: 'POST',
      body: JSON.stringify({ serving }),
    }),
  startTor: () => request('/api/tor/start', { method: 'POST' }),
  stopTor: () => request('/api/tor/stop', { method: 'POST' }),
};

/**
 * Subscribe to the server's event stream. EventSource reconnects on its own,
 * so the returned function only needs to close it.
 */
export function subscribe(handlers) {
  const source = new EventSource('/api/events');
  for (const [event, handler] of Object.entries(handlers)) {
    if (event === 'open' || event === 'error') continue;
    source.addEventListener(event, (e) => {
      try {
        handler(JSON.parse(e.data));
      } catch {
        // Ignore malformed frames rather than killing the stream.
      }
    });
  }
  if (handlers.open) source.addEventListener('open', handlers.open);
  if (handlers.error) source.addEventListener('error', handlers.error);
  return () => source.close();
}

/**
 * Copy text to the OS clipboard. The async Clipboard API needs a secure
 * context, which http://localhost satisfies; the textarea path covers the
 * case where the app is reached over a plain-http LAN address instead.
 */
export async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('Copy command was rejected');
  } finally {
    document.body.removeChild(textarea);
  }
}
