// Static single-file editor for rules.yml. Served on GET /editor and bundled
// into the compiled binary so no external asset files are required at runtime.
export const editorPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GEXDIS — Rules Editor</title>
<style>
  :root {
    --bg: #0f1419;
    --panel: #171c23;
    --panel-2: #1f262f;
    --border: #2a3340;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #2f81f7;
    --accent-hover: #3b8cff;
    --danger: #f85149;
    --success: #3fb950;
    --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    display: flex;
    min-height: 100vh;
  }
  .sidebar {
    width: 240px;
    background: var(--panel);
    border-right: 1px solid var(--border);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    flex-shrink: 0;
  }
  .brand { font-size: 16px; font-weight: 700; letter-spacing: .4px; }
  .brand span { color: var(--accent); }
  .sidebar label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; }
  .sidebar input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 13px;
  }
  .sidebar .hint { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .sidebar button.secondary {
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
  }
  .sidebar button.secondary:hover { border-color: var(--accent); }
  .main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .toolbar .spacer { flex: 1; }
  .toolbar input[type=text] {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 13px;
    flex: 1;
    min-width: 200px;
  }
  button.primary {
    background: var(--accent);
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 9px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  button.primary:hover { background: var(--accent-hover); }
  button.primary:disabled { opacity: .5; cursor: not-allowed; }
  .editor-wrap { flex: 1; min-height: 0; padding: 16px; }
  #editor {
    width: 100%;
    height: 100%;
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    resize: none;
    white-space: pre;
    tab-size: 2;
  }
  #editor:focus { outline: none; border-color: var(--accent); }
  #editor:disabled, button:disabled, input:disabled { opacity: .55; }
  .banner {
    display: none;
    margin: 0 16px 12px;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--mono);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 180px;
    overflow: auto;
  }
  .banner.show { display: block; }
  .banner.error { background: rgba(248,81,73,.12); border: 1px solid var(--danger); color: #ff8b82; }
  .banner.success { background: rgba(63,185,80,.12); border: 1px solid var(--success); color: #7ee787; }
  .banner.info { background: rgba(47,129,247,.12); border: 1px solid var(--accent); color: #79c0ff; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-ok { background: var(--success); box-shadow: 0 0 6px var(--success); }
  .status-bad { background: var(--danger); box-shadow: 0 0 6px var(--danger); }
  .status-none { background: var(--muted); }
</style>
</head>
<body>
  <aside class="sidebar">
    <div class="brand">GEXDIS <span>/ rules</span></div>
    <label for="token">Rules token</label>
    <input id="token" type="text" placeholder="(press Enter to load)" autocomplete="off" />
    <div class="hint">Token is only sent with requests and kept in your browser's session storage — it is never embedded in the page.</div>
    <button id="reload-btn" class="secondary">Reconnect</button>
    <button id="help-btn" class="secondary">How to use</button>
  </aside>

  <div class="main">
    <div class="toolbar">
      <span id="status"><span class="status-dot status-none" id="status-dot"></span><span id="status-text">Disconnected</span></span>
      <span class="spacer"></span>
      <input id="test-url" type="text" placeholder="https://…  URL to test match against rules" />
      <button id="test-btn" class="primary" disabled>Test rules match</button>
      <button id="save-btn" class="primary" disabled>Save rules</button>
    </div>
    <div id="banner" class="banner"></div>
    <div class="editor-wrap">
      <textarea id="editor" spellcheck="false" disabled aria-label="rules.yml content"></textarea>
    </div>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const dot = $('status-dot'), statusText = $('status-text');
  const editor = $('editor'), tokenEl = $('token'), banner = $('banner');
  const saveBtn = $('save-btn'), testBtn = $('test-btn'), testUrl = $('test-url');
  const SESSION_KEY = 'gexdis.rules.token';

  tokenEl.value = sessionStorage.getItem(SESSION_KEY) || '';
  let token = tokenEl.value;

  function setStatus(text, kind) {
    statusText.textContent = text;
    dot.className = 'status-dot status-' + (kind || 'none');
  }
  function showBanner(kind, text) {
    banner.className = 'banner ' + kind + ' show';
    banner.textContent = text;
  }
  function clearBanner() { banner.className = 'banner'; banner.textContent = ''; }

  function authHeaders() {
    const t = tokenEl.value.trim();
    return t ? { 'x-rules-token': t } : {};
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    if (res.status === 401) throw new Error('Unauthorized — check the rules token.');
    return res;
  }

  async function load() {
    clearBanner();
    token = tokenEl.value.trim();
    if (!token) {
      setStatus('Awaiting token', 'none');
      editor.disabled = true; saveBtn.disabled = true; testBtn.disabled = true;
      return;
    }
    sessionStorage.setItem(SESSION_KEY, token);
    setStatus('Loading…', 'none');
    try {
      const res = await api('/api/rules');
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('Failed to load: HTTP ' + res.status));
      }
      editor.value = await res.text();
      editor.disabled = false;
      saveBtn.disabled = false;
      testBtn.disabled = false;
      setStatus('Connected', 'ok');
    } catch (e) {
      editor.disabled = true; saveBtn.disabled = true; testBtn.disabled = true;
      setStatus('Unauthorized / error', 'bad');
      showBanner('error', String(e.message || e));
    }
  }

  async function save() {
    clearBanner();
    setStatus('Saving…', 'none');
    saveBtn.disabled = true;
    try {
      const res = await api('/api/rules', {
        method: 'PUT',
        body: editor.value,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || ('Save failed: HTTP ' + res.status));
      }
      setStatus('Saved', 'ok');
      showBanner('success', 'Rules saved and validated. Changes are active on the next request.');
    } catch (e) {
      setStatus('Save failed', 'bad');
      showBanner('error', String(e.message || e));
    } finally {
      saveBtn.disabled = false;
    }
  }

  async function testMatch() {
    clearBanner();
    const url = testUrl.value.trim();
    if (!url) { showBanner('error', 'Enter a URL to test.'); return; }
    let parsed;
    try { parsed = new URL(url); } catch { showBanner('error', 'The URL is not valid.'); return; }
    if (!/^https?:$/.test(parsed.protocol)) { showBanner('error', 'The URL must use http or https.'); return; }
    setStatus('Testing…', 'none');
    testBtn.disabled = true;
    try {
      const res = await api('/process?url=' + encodeURIComponent(url) + '&dry_run=true');
      const body = await res.text();
      let pretty;
      try { pretty = JSON.stringify(JSON.parse(body), null, 2); } catch { pretty = body; }
      if (!res.ok) {
        setStatus('No match', 'bad');
        showBanner('error', 'No rule matched:\\n' + pretty);
      } else {
        setStatus('Matched', 'ok');
        showBanner('success', 'Match OK:\\n' + pretty);
      }
    } catch (e) {
      setStatus('Test failed', 'bad');
      showBanner('error', String(e.message || e));
    } finally {
      testBtn.disabled = false;
    }
  }

  tokenEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  $('reload-btn').addEventListener('click', load);
  saveBtn.addEventListener('click', save);
  testBtn.addEventListener('click', testMatch);
  $('help-btn').addEventListener('click', () => {
    showBanner('info', [
      'GEXDIS Rules Editor',
      '',
      '1. Enter the RULES_TOKEN (if configured) and press Enter to load rules.yml.',
      '2. Edit the YAML in the editor. Rules are raw text, so comments/formatting are kept.',
      '3. "Save rules" validates on the server and persists the file. Invalid YAML is rejected.',
      '4. "Test rules match" runs a dry-run immediately: paste a URL to preview which rules and assets would match.',
      '',
      'Rules apply to the next /process request with no restart needed.',
    ].join('\\n'));
  });

  if (token) load();
})();
</script>
</body>
</html>
`;
