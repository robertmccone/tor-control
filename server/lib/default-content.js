function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Starter page written into every new site directory. */
export function defaultIndexHtml(name) {
  const safeName = escapeHtml(name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 2rem;
    background: #0b0f14;
    color: #e6edf3;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main {
    max-width: 34rem;
    text-align: center;
    background: #121821;
    border: 1px solid #1f2937;
    border-radius: 14px;
    padding: 2.5rem 2rem;
  }
  h1 { margin: 0 0 .5rem; font-size: 1.75rem; letter-spacing: -.02em; }
  p { margin: 0 0 1.25rem; color: #9aa7b5; }
  code {
    display: inline-block;
    background: #0b0f14;
    border: 1px solid #1f2937;
    border-radius: 6px;
    padding: .35rem .6rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .85rem;
    color: #7dd3a8;
  }
  .badge {
    display: inline-block;
    margin-bottom: 1rem;
    padding: .25rem .7rem;
    border-radius: 999px;
    background: rgba(125, 211, 168, .12);
    border: 1px solid rgba(125, 211, 168, .3);
    color: #7dd3a8;
    font-size: .75rem;
    text-transform: uppercase;
    letter-spacing: .08em;
  }
</style>
</head>
<body>
  <main>
    <div class="badge">Online</div>
    <h1>${safeName}</h1>
    <p>Your Tor hidden service is live. Replace this page by editing <code>index.html</code> in the site folder.</p>
  </main>
</body>
</html>
`;
}
