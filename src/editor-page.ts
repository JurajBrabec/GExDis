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
    font-size: 14px;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .hidden { display: none !important; }
  .muted { color: var(--muted); }
  .small { font-size: 12px; }
  .spacer { flex: 1; }
  input, textarea, select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 7px 9px;
    font-family: var(--mono);
    font-size: 13px;
  }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
  input:disabled, textarea:disabled { opacity: .55; }
  button {
    font: inherit;
    font-size: 13px;
    border-radius: 6px;
    padding: 7px 12px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--panel-2);
    color: var(--text);
    white-space: nowrap;
  }
  button:hover { border-color: var(--accent); }
  button:disabled { opacity: .5; cursor: not-allowed; border-color: var(--border); }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button.primary:hover { background: var(--accent-hover); }
  button.danger { color: #ff8b82; }
  button.danger:hover { border-color: var(--danger); }
  button.icon { padding: 4px 9px; background: transparent; border-color: transparent; color: var(--muted); }
  button.icon:hover { color: var(--danger); border-color: transparent; }
  button.small { padding: 4px 10px; font-size: 12px; }
  .topbar, .testbar, .tabs {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .brand { font-size: 16px; font-weight: 700; letter-spacing: .4px; margin-right: 6px; }
  .brand span { color: var(--accent); }
  #token { width: 240px; }
  #test-url { flex: 1; min-width: 260px; }
  #status { font-size: 13px; color: var(--muted); }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .status-ok { background: var(--success); box-shadow: 0 0 6px var(--success); }
  .status-bad { background: var(--danger); box-shadow: 0 0 6px var(--danger); }
  .status-none { background: var(--muted); }
  .tabs { padding: 0 16px; gap: 2px; }
  .tab {
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 12px 14px;
    color: var(--muted);
    border-bottom: 2px solid transparent;
  }
  .tab[aria-pressed="true"] { color: var(--text); border-bottom-color: var(--accent); }
  .tab:hover { border-color: transparent; color: var(--text); }
  .tab:hover { border-bottom-color: var(--accent); }
  .banner {
    display: none;
    margin: 12px 16px 0;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--mono);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 160px;
    overflow: auto;
  }
  .banner.show { display: block; }
  .banner.error { background: rgba(248,81,73,.12); border: 1px solid var(--danger); color: #ff8b82; }
  .banner.success { background: rgba(63,185,80,.12); border: 1px solid var(--success); color: #7ee787; }
  .banner.info { background: rgba(47,129,247,.12); border: 1px solid var(--accent); color: #79c0ff; }
  .split { display: grid; grid-template-columns: 280px 1fr; flex: 1; min-height: 0; }
  .list { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; background: var(--panel); }
  .list-tools { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--border); }
  .list-tools input { flex: 1; min-width: 0; }
  #rule-list { overflow: auto; flex: 1; }
  .rule-item {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    border-radius: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    padding: 10px 12px;
  }
  .rule-item:hover { background: var(--panel-2); border-color: var(--border); }
  .rule-item.active { background: var(--panel-2); box-shadow: inset 3px 0 0 var(--accent); }
  .rule-name { font-family: var(--mono); font-size: 13px; }
  .badges { display: flex; gap: 4px; margin-top: 4px; }
  .badge { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; }
  .form-wrap { overflow: auto; min-height: 0; padding: 16px 20px 40px; }
  .form-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .form-head h2 { margin: 0; font-size: 18px; font-family: var(--mono); }
  .placeholders { margin-bottom: 14px; }
  .section { border-top: 1px solid var(--border); padding: 14px 0; }
  .section h3 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
  .section .hint { font-size: 12px; color: var(--muted); margin-bottom: 8px; line-height: 1.5; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .row .grow { flex: 1; min-width: 0; }
  .row .key { width: 160px; }
  .row .target { width: 200px; }
  .arrow { color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-family: var(--mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    color: var(--muted);
    background: var(--panel);
  }
  .chip:hover { color: var(--text); }
  .field-row { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; }
  .field-row label { width: 70px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .field-row input { flex: 1; min-width: 0; }
  .problems { list-style: none; margin: 0 0 12px; padding: 10px 14px; border-radius: 6px; font-size: 13px; }
  .problems li { color: #ff8b82; margin: 2px 0; }
  .problems.ok { color: #7ee787; background: rgba(63,185,80,.12); border: 1px solid var(--success); }
  .problems.bad { background: rgba(248,81,73,.08); border: 1px solid var(--danger); }
  .results { margin-top: 8px; font-family: var(--mono); font-size: 12px; line-height: 1.7; }
  .res-ok { color: #7ee787; }
  .res-bad { color: #ff8b82; }
  .res-na { color: var(--muted); }
  .raw { display: flex; flex-direction: column; flex: 1; min-height: 0; padding: 16px; gap: 10px; }
  .raw-tools { display: flex; gap: 10px; align-items: center; }
  #raw {
    flex: 1;
    min-height: 0;
    width: 100%;
    background: var(--panel);
    border-radius: 8px;
    padding: 14px;
    line-height: 1.6;
    resize: none;
    white-space: pre;
    tab-size: 2;
  }
  dialog {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 10px;
    width: min(900px, 92vw);
    padding: 0;
  }
  dialog::backdrop { background: rgba(0,0,0,.6); }
  .dialog-body { padding: 20px; display: flex; flex-direction: column; gap: 10px; }
  .dialog-body h2 { margin: 0; font-size: 16px; }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 6px; }
  .diff {
    font-family: var(--mono);
    font-size: 12px;
    line-height: 1.5;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 0;
    max-height: 52vh;
    overflow: auto;
    white-space: pre;
  }
  .diff .line { padding: 0 12px; }
  .diff .add { background: rgba(63,185,80,.15); color: #7ee787; }
  .diff .del { background: rgba(248,81,73,.15); color: #ff8b82; }
  .diff .ctx { color: var(--muted); }
  .diff .gap { padding: 2px 12px; color: var(--muted); }
  .help-list { margin: 0; padding-left: 20px; line-height: 1.7; font-size: 13px; }
  .asset-list { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow: auto; }
  .asset-item { text-align: left; font-family: var(--mono); font-size: 12px; background: var(--bg); }
</style>
</head>
<body>
  <header class="topbar">
    <div class="brand">GEXDIS <span>/ rules</span></div>
    <input id="token" type="text" placeholder="Rules token (Enter to connect)" autocomplete="off" />
    <button id="connect-btn">Connect</button>
    <span id="status"><span class="status-dot status-none" id="status-dot"></span><span id="status-text">Disconnected</span></span>
    <span class="spacer"></span>
    <button id="undo-btn" class="hidden" title="Restore the previous saved version of rules.yml">Undo last save</button>
    <button id="help-btn">How to use</button>
  </header>

  <div class="testbar">
    <input id="test-url" type="text" placeholder="https://github.com/owner/repo/releases/tag/… — dry-run which rules match" />
    <button id="test-btn" disabled>Test URL match</button>
  </div>

  <div id="banner" class="banner"></div>

  <nav class="tabs">
    <button class="tab" data-view="rules" aria-pressed="true">Rules</button>
    <button class="tab" data-view="raw" aria-pressed="false">Raw YAML</button>
    <span class="spacer"></span>
    <span id="rule-count" class="muted small"></span>
  </nav>

  <section id="view-rules" class="split">
    <aside class="list">
      <div class="list-tools">
        <input id="search" type="text" placeholder="Search rules" />
        <button id="new-btn" class="primary" disabled>+ New</button>
      </div>
      <div id="rule-list"></div>
    </aside>
    <div class="form-wrap"><div id="form"></div></div>
  </section>

  <section id="view-raw" class="raw hidden">
    <div class="raw-tools">
      <span class="muted small">Edits here keep comments and formatting. The server validates before anything is written.</span>
      <span class="spacer"></span>
      <button id="validate-btn" disabled>Validate</button>
      <button id="save-raw-btn" class="primary" disabled>Review and save</button>
    </div>
    <textarea id="raw" spellcheck="false" disabled aria-label="rules.yml content"></textarea>
  </section>

  <datalist id="targets">
    <option value="/app/bin"></option>
    <option value="/app/bin/"></option>
    <option value="/app/download"></option>
    <option value="/app/download/"></option>
    <option value="/app/release"></option>
  </datalist>

  <dialog id="confirm-dialog">
    <form method="dialog" class="dialog-body">
      <h2 id="confirm-title"></h2>
      <div id="confirm-summary" class="muted small"></div>
      <div id="confirm-diff" class="diff"></div>
      <div class="dialog-actions">
        <button value="cancel" formnovalidate>Cancel</button>
        <button value="confirm" class="primary">Save</button>
      </div>
    </form>
  </dialog>

  <dialog id="ask-dialog">
    <form method="dialog" class="dialog-body">
      <h2 id="ask-title"></h2>
      <div id="ask-message" class="muted small"></div>
      <div class="dialog-actions">
        <button value="cancel">Cancel</button>
        <button value="confirm" class="primary" id="ask-ok">OK</button>
      </div>
    </form>
  </dialog>

  <dialog id="new-dialog">
    <form method="dialog" class="dialog-body">
      <h2>New GitHub rule</h2>
      <div class="muted small">Enter owner/name or a github.com URL.</div>
      <input id="new-repo" type="text" placeholder="owner/name" autocomplete="off" />
      <div class="dialog-actions">
        <button value="cancel">Cancel</button>
        <button value="confirm" class="primary">Create</button>
      </div>
    </form>
  </dialog>

  <dialog id="asset-dialog">
    <form method="dialog" class="dialog-body" onsubmit="return false">
      <h2>Choose a release asset</h2>
      <div id="asset-source" class="muted small"></div>
      <input id="asset-filter" type="text" placeholder="Filter assets" autocomplete="off" />
      <div id="asset-list" class="asset-list"></div>
      <div class="dialog-actions">
        <button type="button" id="asset-cancel">Cancel</button>
        <button type="button" id="asset-manual">Enter manually</button>
      </div>
    </form>
  </dialog>

  <dialog id="help-dialog">
    <form method="dialog" class="dialog-body">
      <h2>How to use the rules editor</h2>
      <ol class="help-list">
        <li>Enter the rules token (if one is configured) and press Enter or Connect.</li>
        <li>Pick a rule on the left, or create one with + New from a GitHub repository.</li>
        <li>Edit the fields. Placeholder chips insert {NAME} at the cursor of the last field you clicked.</li>
        <li>Paste an asset file name under Test against an asset to see which patterns and copy rules would apply.</li>
        <li>Save rule shows a diff first. Confirming writes the file; the previous version is kept as rules.yml.bak.</li>
        <li>Undo last save restores that backup. Undoing again returns to the newer version.</li>
        <li>Raw YAML edits the whole file, including peeplink rules and comments.</li>
      </ol>
      <div class="dialog-actions"><button value="close" class="primary">Close</button></div>
    </form>
  </dialog>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'gexdis.rules.token';
  const BUILTINS = ['SEMVER', 'DOWNLOADED', 'UNPACKED'];
  const GITHUB_CAPTURES = ['ORG', 'REPO', 'TAG'];
  const SEMVER_SRC = 'v?(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)';
  const PLACEHOLDER = /\\{([A-Za-z][A-Za-z0-9_]*)\\}/g;
  const GROUP = /\\(\\?<([A-Za-z][A-Za-z0-9_]*)>/g;
  const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
  const TEMPLATES = {
    single: { get: [''], unpack: [], remove: [], copy: ['^{DOWNLOADED}$:/app/download/'] },
    zip: {
      get: [''],
      unpack: ['{DOWNLOADED}'],
      remove: [],
      copy: ['^{UNPACKED}/.+[.]exe$:/app/bin/', '^{DOWNLOADED}$:/app/download/'],
    },
  };

  const state = {
    connected: false,
    rules: [],
    raw: '',
    rawDirty: false,
    hasBackup: false,
    view: 'rules',
    selected: null,
    isNew: false,
    original: null,
    draft: null,
    asset: '',
    lastInput: null,
    search: '',
  };
  let token = sessionStorage.getItem(SESSION_KEY) || '';
  $('token').value = token;

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children || [])) {
      if (child) node.append(child);
    }
    return node;
  }

  function setStatus(text, kind) {
    $('status-text').textContent = text;
    $('status-dot').className = 'status-dot status-' + (kind || 'none');
  }

  function showBanner(kind, text) {
    const banner = $('banner');
    banner.className = 'banner ' + kind + ' show';
    banner.textContent = text;
  }

  function clearBanner() {
    $('banner').className = 'banner';
    $('banner').textContent = '';
  }

  function authHeaders() {
    const value = $('token').value.trim();
    return value ? { 'x-rules-token': value } : {};
  }

  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {}, authHeaders());
    const res = await fetch(path, Object.assign({}, options, { headers }));
    if (res.status === 401) throw new Error('Unauthorized — check the rules token.');
    return res;
  }

  async function apiJson(path, options = {}) {
    const res = await api(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    return body;
  }

  function jsonOptions(method, body) {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }

  function updateEnabled() {
    const on = state.connected;
    $('new-btn').disabled = !on;
    $('validate-btn').disabled = !on;
    $('save-raw-btn').disabled = !on;
    $('test-btn').disabled = !on;
    $('raw').disabled = !on;
    $('undo-btn').classList.toggle('hidden', !(on && state.hasBackup));
  }

  // The repo shown in the form: org + repo, or the name when it already is owner/repo.
  function repoOf(rule) {
    if (rule.repo) return rule.org ? rule.org + '/' + rule.repo : rule.repo;
    return rule.name && rule.name.includes('/') ? rule.name : '';
  }

  // Parses a plain https://github.com/owner/repo/releases[/tag/X|/latest] pattern; null when it needs Raw YAML.
  function migrationFromUrl(url) {
    const plain = (url || '').replace(/\\\\/g, '');
    const match = /^\\^?https:\\/\\/github\\.com\\/([^/]+)\\/([^/]+)\\/releases\\/(?:tag\\/(.+?)|latest)\\$?$/i.exec(plain);
    if (!match) return null;
    const repo = match[1] + '/' + match[2];
    if (!isRepo(repo)) return null;
    if (match[3] === undefined) return { repo, tag: '' };
    if (!/^[A-Za-z0-9_.-]+$/.test(match[3])) return null;
    return { repo, tag: match[3] };
  }

  // present: fields the rule has in YAML; touched: fields edited in this session. Only these are sent on save.
  function draftFromRule(rule) {
    return {
      name: rule.name || '',
      repo: repoOf(rule),
      tag: rule.tag || '',
      setPairs: Object.entries(rule.set || {}),
      get: (rule.get || []).slice(),
      unpack: (rule.unpack || []).slice(),
      remove: (rule.remove || []).slice(),
      copy: (rule.copy || []).slice(),
      present: new Set(Object.keys(rule)),
      touched: new Set(),
      template: 'single',
    };
  }

  function touch(draft, field) {
    draft.touched.add(field);
  }

  function sends(draft, field) {
    if (draft.present.has(field) || draft.touched.has(field)) return true;
    if (field === 'tag') return draft.tag.trim() !== '';
    if (field === 'set') return draft.setPairs.some(([key]) => key);
    return false;
  }

  function payload(draft) {
    const out = { name: draft.name.trim(), repo: draft.repo.trim() };
    if (sends(draft, 'tag')) out.tag = draft.tag.trim();
    if (sends(draft, 'set')) {
      const set = {};
      for (const [key, value] of draft.setPairs) {
        if (key) set[key] = value;
      }
      out.set = set;
    }
    for (const field of ['get', 'unpack', 'remove', 'copy']) {
      if (sends(draft, field)) out[field] = draft[field];
    }
    return out;
  }

  function isDirty() {
    if (!state.draft) return false;
    if (state.isNew) return state.draft.name !== '' || state.draft.repo !== '';
    const current = JSON.stringify(payload(state.draft));
    const saved = JSON.stringify(payload(draftFromRule(state.original)));
    return current !== saved;
  }

  function rawPending() {
    return state.rawDirty && $('raw').value !== state.raw;
  }

  function openDialog(dialog, focusTarget) {
    return new Promise((resolve) => {
      const finish = (value) => {
        dialog.close();
        resolve(value);
      };
      dialog.querySelector('[value="confirm"]').onclick = (event) => {
        event.preventDefault();
        finish(true);
      };
      dialog.querySelector('[value="cancel"]').onclick = (event) => {
        event.preventDefault();
        finish(false);
      };
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(false);
      };
      dialog.showModal();
      if (focusTarget) {
        focusTarget.focus();
        focusTarget.select();
      }
    });
  }

  function askDialog(title, message, okLabel) {
    $('ask-title').textContent = title;
    $('ask-message').textContent = message;
    $('ask-ok').textContent = okLabel;
    return openDialog($('ask-dialog'));
  }

  // Asks before discarding unsaved rule edits and/or raw YAML edits; on discard, the raw buffer is reset.
  async function allowDiscard(includeForm, includeRaw) {
    const formPending = includeForm && isDirty();
    const rawNow = includeRaw && rawPending();
    if (!formPending && !rawNow) return true;
    const what = [formPending ? 'rule edits' : '', rawNow ? 'raw YAML edits' : ''].filter(Boolean).join(' and ');
    const ok = await askDialog('Discard changes?', 'Unsaved ' + what + ' will be lost.', 'Discard');
    if (ok && rawNow) {
      state.rawDirty = false;
      $('raw').value = state.raw;
    }
    return ok;
  }

  function guardDiscard() {
    return allowDiscard(true, false);
  }

  function loadDraft(name) {
    const rule = state.rules.find((item) => item.name === name);
    state.selected = rule ? rule.name : null;
    state.isNew = false;
    state.original = rule || null;
    state.draft = rule ? draftFromRule(rule) : null;
  }

  async function refresh() {
    const rawRes = await api('/api/rules');
    if (!rawRes.ok) {
      const body = await rawRes.json().catch(() => ({}));
      throw new Error(body.error || ('Failed to load rules: HTTP ' + rawRes.status));
    }
    state.raw = await rawRes.text();
    state.rawDirty = false;
    state.rules = (await apiJson('/api/rules/github')).rules;
    state.hasBackup = (await apiJson('/api/rules/backup')).available;
    if (!state.isNew) {
      const keep = state.rules.some((rule) => rule.name === state.selected);
      loadDraft(keep ? state.selected : (state.rules[0] ? state.rules[0].name : null));
    }
    renderAll();
  }

  async function connect() {
    token = $('token').value.trim();
    clearBanner();
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
    if (state.connected && !(await allowDiscard(true, true))) return;
    setStatus('Loading…', 'none');
    try {
      await refresh();
      state.connected = true;
      setStatus('Connected', 'ok');
    } catch (error) {
      state.connected = false;
      setStatus('Unauthorized / error', 'bad');
      showBanner('error', String(error.message || error));
    }
    updateEnabled();
    renderAll();
  }

  async function select(name) {
    if (name === state.selected && !state.isNew) return;
    if (!(await guardDiscard())) return;
    loadDraft(name);
    renderAll();
  }

  function lineDiff(a, b) {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    const ma = a.slice(start, endA);
    const mb = b.slice(start, endB);
    const n = ma.length;
    const m = mb.length;
    const table = [];
    for (let i = 0; i <= n; i++) table.push(new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = ma[i] === mb[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    const ops = [];
    for (let k = 0; k < start; k++) ops.push({ t: ' ', s: a[k] });
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        ops.push({ t: ' ', s: ma[i] });
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        ops.push({ t: '-', s: ma[i++] });
      } else {
        ops.push({ t: '+', s: mb[j++] });
      }
    }
    while (i < n) ops.push({ t: '-', s: ma[i++] });
    while (j < m) ops.push({ t: '+', s: mb[j++] });
    for (let k = endA; k < a.length; k++) ops.push({ t: ' ', s: a[k] });
    return ops;
  }

  function renderDiff(ops) {
    const CONTEXT = 2;
    const show = new Array(ops.length).fill(false);
    ops.forEach((op, index) => {
      if (op.t === ' ') return;
      for (let k = Math.max(0, index - CONTEXT); k <= Math.min(ops.length - 1, index + CONTEXT); k++) show[k] = true;
    });
    const names = { '+': 'add', '-': 'del', ' ': 'ctx' };
    const lines = [];
    let gap = false;
    ops.forEach((op, index) => {
      if (!show[index]) {
        if (!gap) lines.push(el('div', { class: 'gap', text: '…' }));
        gap = true;
        return;
      }
      gap = false;
      lines.push(el('div', { class: 'line ' + names[op.t], text: op.t + ' ' + op.s }));
    });
    if (lines.length === 0) lines.push(el('div', { class: 'gap', text: 'No line changes.' }));
    return lines;
  }

  function confirmDiff(title, oldText, newText) {
    const ops = lineDiff(oldText.split('\\n'), newText.split('\\n'));
    const added = ops.filter((op) => op.t === '+').length;
    const removed = ops.filter((op) => op.t === '-').length;
    $('confirm-title').textContent = title;
    $('confirm-summary').textContent = '+' + added + ' / −' + removed + ' lines. The current file is kept as rules.yml.bak.';
    $('confirm-diff').replaceChildren(...renderDiff(ops));
    const dialog = $('confirm-dialog');
    return openDialog(dialog);
  }

  async function commit(method, path, body, title) {
    const options = jsonOptions(method, body);
    const preview = await apiJson(path + (path.includes('?') ? '&' : '?') + 'preview=true', options);
    if (preview.text === state.raw) {
      showBanner('info', 'No changes to save.');
      return false;
    }
    if (!(await confirmDiff(title, state.raw, preview.text))) return false;
    await apiJson(path, options);
    return true;
  }

  function expand(value, captures) {
    let unresolved = false;
    const out = value.replace(PLACEHOLDER, (_match, name) => {
      if (!Object.prototype.hasOwnProperty.call(captures, name)) {
        unresolved = true;
        return '';
      }
      return captures[name];
    });
    return unresolved ? null : out;
  }

  function execSafe(pattern, text) {
    try {
      return new RegExp(pattern, 'i').exec(text);
    } catch {
      return null;
    }
  }

  function groupsOf(match) {
    return Object.fromEntries(Object.entries(match.groups || {}).filter(([, value]) => value !== undefined));
  }

  function groupNames(patterns) {
    const names = [];
    for (const pattern of patterns) {
      for (const match of pattern.matchAll(GROUP)) names.push(match[1]);
    }
    return names;
  }

  // Captures GitHub release URLs provide at runtime, plus set variables and named groups from the patterns.
  function availablePlaceholders(draft) {
    const names = [
      ...BUILTINS,
      ...GITHUB_CAPTURES,
      ...draft.setPairs.map((pair) => pair[0]).filter(Boolean),
      ...groupNames(draft.get),
      ...groupNames(draft.setPairs.map((pair) => pair[1])),
    ];
    return [...new Set(names)];
  }

  function validate(draft) {
    const problems = [];
    if (!draft) return problems;
    const name = draft.name.trim();
    if (!name) problems.push('Name is required.');
    if (name && state.rules.some((rule) => rule.name === name && (state.isNew || rule.name !== state.selected))) {
      problems.push('Another rule is already named "' + name + '".');
    }
    const repo = draft.repo.trim();
    if (!repo) {
      problems.push('Repository is required (owner/name).');
    } else if (!repo.includes('{')) {
      const parts = repo.split('/');
      if (parts.length !== 2 || parts.some((part) => !part || /\\s/.test(part))) {
        problems.push('Repository must look like owner/name.');
      }
    }
    const keys = [];
    for (const [key] of draft.setPairs) {
      if (!key) {
        problems.push('A variable has no name.');
      } else if (!KEY.test(key)) {
        problems.push('Variable "' + key + '" must start with a letter and use only letters, digits or _.');
      } else if (keys.includes(key)) {
        problems.push('Variable "' + key + '" is defined twice.');
      }
      keys.push(key);
    }
    const known = new Set(availablePlaceholders(draft));
    const checks = [];
    if (draft.tag) checks.push(['tag', draft.tag, false]);
    for (const [key, value] of draft.setPairs) checks.push(['variable ' + key, value, true]);
    draft.get.forEach((pattern, index) => checks.push(['get #' + (index + 1), pattern, true]));
    draft.unpack.forEach((pattern, index) => checks.push(['unpack #' + (index + 1), pattern, true]));
    draft.remove.forEach((pattern, index) => checks.push(['remove #' + (index + 1), pattern, true]));
    draft.copy.forEach((entry, index) => {
      const split = entry.indexOf(':');
      if (split < 1 || split === entry.length - 1) {
        problems.push('copy #' + (index + 1) + ' must be "source:target".');
        return;
      }
      checks.push(['copy #' + (index + 1) + ' source', entry.slice(0, split), true]);
    });
    for (const [label, value, isRegex] of checks) {
      if (isRegex && !value.trim()) {
        problems.push(label + ' is empty.');
        continue;
      }
      for (const match of value.matchAll(PLACEHOLDER)) {
        if (!known.has(match[1])) problems.push(label + ' uses unknown placeholder {' + match[1] + '}.');
      }
      if (isRegex) {
        try {
          new RegExp(value.replace(PLACEHOLDER, 'x'), 'i');
        } catch (error) {
          problems.push(label + ' is not a valid regex: ' + error.message);
        }
      }
    }
    return [...new Set(problems)];
  }

  function evaluateAsset(draft, asset) {
    const captures = { SEMVER: SEMVER_SRC };
    for (const [key, value] of draft.setPairs) {
      const expanded = expand(value, captures);
      if (key && KEY.test(key) && expanded !== null) captures[key] = expanded;
    }
    const lines = [];
    let matched = false;
    draft.get.forEach((pattern, index) => {
      const label = 'get #' + (index + 1);
      if (matched) {
        lines.push(['na', label + ' not needed, an earlier pattern matched']);
        return;
      }
      const expanded = expand(pattern, captures);
      if (expanded === null) {
        lines.push(['bad', label + ' has an unknown placeholder']);
        return;
      }
      const match = execSafe(expanded, encodeURIComponent(asset));
      if (match) {
        matched = true;
        Object.assign(captures, groupsOf(match));
        lines.push(['ok', label + ' matches']);
      } else {
        lines.push(['bad', label + ' does not match']);
      }
    });
    if (!asset) {
      lines.length = 0;
      lines.push(['na', 'Paste an asset file name to test.']);
    } else if (!matched) {
      lines.push(['bad', 'No get pattern matches this asset.']);
    } else {
      draft.copy.forEach((entry, index) => {
        const label = 'copy #' + (index + 1);
        const split = entry.indexOf(':');
        if (split < 1) {
          lines.push(['bad', label + ' needs source:target']);
          return;
        }
        const source = entry.slice(0, split);
        const target = entry.slice(split + 1);
        if (source.includes('{UNPACKED}')) {
          lines.push(['na', label + ' applies to archive contents → ' + target]);
          return;
        }
        const expanded = expand(source, Object.assign({ DOWNLOADED: asset }, captures));
        if (expanded === null) {
          lines.push(['bad', label + ' has an unknown placeholder']);
          return;
        }
        lines.push(execSafe(expanded, asset) ? ['ok', label + ' → ' + target] : ['na', label + ' does not match this file']);
      });
    }
    return lines;
  }

  function renderMatch() {
    const box = $('match-results');
    if (!box || !state.draft) return;
    box.replaceChildren(
      ...evaluateAsset(state.draft, state.asset).map(([kind, text]) =>
        el('div', { class: 'res-' + kind, text: (kind === 'ok' ? '✓ ' : kind === 'bad' ? '✗ ' : '· ') + text }),
      ),
    );
  }

  function renderProblems() {
    const box = $('problems');
    if (!box || !state.draft) return;
    const problems = validate(state.draft);
    const list = el('ul', { class: 'problems ' + (problems.length ? 'bad' : 'ok') },
      problems.length ? problems.map((text) => el('li', { text })) : [el('li', { text: 'All checks pass.' })]);
    box.replaceChildren(list);
    if (state.refs) {
      state.refs.save.disabled = !state.connected || problems.length > 0 || (!state.isNew && !isDirty());
    }
  }

  function afterEdit() {
    renderProblems();
    renderMatch();
  }

  function focusKey(key) {
    const node = $('form').querySelector('[data-key="' + key + '"]');
    if (node) node.focus();
  }

  function removeButton(onClick) {
    return el('button', { class: 'icon', text: '✕', title: 'Remove', onclick: onClick });
  }

  function addButton(text, onClick) {
    return el('button', { class: 'small', text, onclick: onClick });
  }

  function section(title, hint, children) {
    return el('section', { class: 'section' }, [
      el('h3', { text: title }),
      hint ? el('div', { class: 'hint', text: hint }) : null,
      ...children,
    ]);
  }

  function isRepo(value) {
    const parts = value.split('/');
    return parts.length === 2 && parts.every((part) => part && !/\\s/.test(part)) && !value.includes('{');
  }

  // Turns an asset file name into a GET pattern matched at the end of the download URL: the first version
  // becomes {SEMVER}, the rest is escaped. The name is matched in its URL-encoded form, as in download URLs.
  function assetPattern(name) {
    const escape = (text) => text.replace(/[.*+?^|()[\\]{}$\\\\]/g, '\\\\$&');
    const encoded = encodeURIComponent(name);
    const match = /v?\\d+[.]\\d+[.]\\d+/.exec(encoded);
    if (!match) return escape(encoded) + '$';
    return escape(encoded.slice(0, match.index)) + '{SEMVER}' + escape(encoded.slice(match.index + match[0].length)) + '$';
  }

  function applyAssetToGet(name, replaceEmpty) {
    const draft = state.draft;
    const pattern = assetPattern(name);
    state.asset = name;
    touch(draft, 'get');
    const empty = replaceEmpty ? draft.get.findIndex((item) => !item.trim()) : -1;
    if (empty >= 0) draft.get[empty] = pattern;
    else draft.get.push(pattern);
  }

  // Resolves to the chosen asset name, '' for manual entry, or null when cancelled.
  function pickAsset(repo, tag) {
    const dialog = $('asset-dialog');
    const list = $('asset-list');
    const filter = $('asset-filter');
    const wanted = tag && !tag.includes('{') ? tag : '';
    let assets = [];
    $('asset-source').textContent = repo + ' · ' + (wanted ? 'release ' + wanted : 'latest release') +
      (tag && !wanted ? ' (tag uses placeholders, showing latest)' : '');
    filter.value = '';
    list.replaceChildren(el('div', { class: 'muted small', text: 'Loading assets…' }));
    return new Promise((resolve) => {
      const finish = (value) => {
        dialog.close();
        resolve(value);
      };
      const visible = () => {
        const query = filter.value.trim().toLowerCase();
        return assets.filter((name) => !query || name.toLowerCase().includes(query));
      };
      const render = () => {
        const items = visible().map((name) =>
          el('button', { type: 'button', class: 'asset-item', text: name, onclick: () => finish(name) }));
        list.replaceChildren(...(items.length ? items : [
          el('div', { class: 'muted small', text: assets.length ? 'No asset matches the filter.' : 'No downloadable assets found.' }),
        ]));
      };
      filter.oninput = render;
      filter.onkeydown = (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (visible().length) finish(visible()[0]);
      };
      $('asset-cancel').onclick = () => finish(null);
      $('asset-manual').onclick = () => finish('');
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(null);
      };
      dialog.showModal();
      filter.focus();
      const params = new URLSearchParams({ repo });
      if (wanted) params.set('tag', wanted);
      apiJson('/api/github/assets?' + params.toString())
        .then((body) => {
          assets = body.assets;
          render();
        })
        .catch((error) => {
          list.replaceChildren(el('div', { class: 'res-bad', text: String(error.message || error) }));
        });
    });
  }

  async function addGetPattern() {
    const draft = state.draft;
    const repo = draft.repo.trim();
    const picked = isRepo(repo) ? await pickAsset(repo, draft.tag.trim()) : '';
    if (picked === null) return;
    if (picked) {
      applyAssetToGet(picked, false);
      renderForm();
      return;
    }
    touch(draft, 'get');
    draft.get.push('');
    renderForm();
    focusKey('get:' + (draft.get.length - 1));
  }

  function listEditor(draft, field, placeholder) {
    const wrap = el('div');
    draft[field].forEach((value, index) => {
      const input = el('input', {
        value,
        placeholder,
        class: 'grow',
        'data-key': field + ':' + index,
        oninput: (event) => {
          draft[field][index] = event.target.value;
          touch(draft, field);
          afterEdit();
        },
        onfocus: (event) => {
          state.lastInput = event.target;
        },
      });
      wrap.append(el('div', { class: 'row' }, [
        input,
        removeButton(() => {
          draft[field].splice(index, 1);
          touch(draft, field);
          renderForm();
        }),
      ]));
    });
    wrap.append(addButton('+ Add pattern', field === 'get' ? addGetPattern : () => {
      draft[field].push('');
      touch(draft, field);
      renderForm();
      focusKey(field + ':' + (draft[field].length - 1));
    }));
    return wrap;
  }

  function copyEditor(draft) {
    const wrap = el('div');
    draft.copy.forEach((entry, index) => {
      const split = entry.indexOf(':');
      const sourceText = split < 0 ? entry : entry.slice(0, split);
      const targetText = split < 0 ? '' : entry.slice(split + 1);
      const sourceInput = el('input', {
        value: sourceText,
        placeholder: 'source regex, e.g. ^{DOWNLOADED}$',
        class: 'grow',
        'data-key': 'copy:s:' + index,
        oninput: (event) => {
          draft.copy[index] = event.target.value + ':' + targetInput.value;
          touch(draft, 'copy');
          afterEdit();
        },
        onfocus: (event) => {
          state.lastInput = event.target;
        },
      });
      const targetInput = el('input', {
        value: targetText,
        placeholder: 'target directory or file',
        class: 'target',
        list: 'targets',
        'data-key': 'copy:t:' + index,
        oninput: (event) => {
          draft.copy[index] = sourceInput.value + ':' + event.target.value;
          touch(draft, 'copy');
          afterEdit();
        },
        onfocus: (event) => {
          state.lastInput = event.target;
        },
      });
      wrap.append(el('div', { class: 'row' }, [
        sourceInput,
        el('span', { class: 'arrow', text: '→' }),
        targetInput,
        removeButton(() => {
          draft.copy.splice(index, 1);
          touch(draft, 'copy');
          renderForm();
        }),
      ]));
    });
    wrap.append(addButton('+ Add copy rule', () => {
      draft.copy.push(':/app/download');
      touch(draft, 'copy');
      renderForm();
      focusKey('copy:s:' + (draft.copy.length - 1));
    }));
    return wrap;
  }

  function setEditor(draft) {
    const wrap = el('div');
    draft.setPairs.forEach((pair, index) => {
      const keyInput = el('input', {
        value: pair[0],
        placeholder: 'NAME',
        class: 'key',
        'data-key': 'set:k:' + index,
        oninput: (event) => {
          pair[0] = event.target.value;
          touch(draft, 'set');
          afterEdit();
        },
        onfocus: (event) => {
          state.lastInput = event.target;
        },
      });
      const valueInput = el('input', {
        value: pair[1],
        placeholder: 'value, e.g. Tool-Setup-{SEMVER}[.]exe$',
        class: 'grow',
        'data-key': 'set:v:' + index,
        oninput: (event) => {
          pair[1] = event.target.value;
          touch(draft, 'set');
          afterEdit();
        },
        onfocus: (event) => {
          state.lastInput = event.target;
        },
      });
      wrap.append(el('div', { class: 'row' }, [
        keyInput,
        valueInput,
        removeButton(() => {
          draft.setPairs.splice(index, 1);
          touch(draft, 'set');
          renderForm();
        }),
      ]));
    });
    wrap.append(addButton('+ Add variable', () => {
      draft.setPairs.push(['', '']);
      touch(draft, 'set');
      renderForm();
      focusKey('set:k:' + (draft.setPairs.length - 1));
    }));
    return wrap;
  }

  function textField(label, draft, key, placeholder) {
    const input = el('input', {
      value: draft[key],
      placeholder,
      class: 'grow',
      oninput: (event) => {
        draft[key] = event.target.value;
        touch(draft, key);
        afterEdit();
      },
      onfocus: (event) => {
        state.lastInput = event.target;
      },
    });
    return el('div', { class: 'field-row' }, [el('label', { text: label }), input]);
  }

  function tagField(draft) {
    const input = el('input', {
      value: draft.tag,
      placeholder: 'empty = latest release',
      class: 'grow',
      oninput: (event) => {
        draft.tag = event.target.value;
        touch(draft, 'tag');
        afterEdit();
      },
      onfocus: (event) => {
        state.lastInput = event.target;
      },
    });
    const setTag = (value) => {
      input.value = value;
      draft.tag = value;
      touch(draft, 'tag');
      afterEdit();
    };
    return el('div', null, [
      el('div', { class: 'field-row' }, [el('label', { text: 'Tag' }), input]),
      el('div', { class: 'chips' }, [
        el('button', { class: 'chip', text: 'latest', onclick: () => setTag('') }),
        el('button', { class: 'chip', text: 'desktop-{SEMVER}', onclick: () => setTag('desktop-{SEMVER}') }),
        el('button', { class: 'chip', text: 'cli-{SEMVER}', onclick: () => setTag('cli-{SEMVER}') }),
      ]),
    ]);
  }

  function placeholderChips(draft) {
    return el('div', { class: 'placeholders' }, [
      el('div', { class: 'muted small', text: 'Placeholders: click a field, then a chip to insert it.' }),
      el('div', { class: 'chips' }, availablePlaceholders(draft).map((name) =>
        el('button', { class: 'chip', text: '{' + name + '}', onclick: () => insertPlaceholder(name) }),
      )),
    ]);
  }

  function insertPlaceholder(name) {
    const input = state.lastInput;
    if (!input || !input.isConnected) {
      showBanner('info', 'Click a field first, then the placeholder chip to insert.');
      return;
    }
    const token = '{' + name + '}';
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    input.setSelectionRange(start + token.length, start + token.length);
    input.focus();
    input.dispatchEvent(new Event('input'));
  }

  function applyTemplate(draft, name) {
    const template = TEMPLATES[name];
    draft.template = name;
    for (const field of ['get', 'unpack', 'remove', 'copy']) {
      draft[field] = template[field].slice();
      touch(draft, field);
    }
  }

  // Rules defined by a url are shown read-only until migrated to repo and tag.
  function renderUrlRule(form) {
    state.refs = null;
    const migration = migrationFromUrl(state.original.url);
    form.append(
      el('div', { class: 'form-head' }, [
        el('h2', { text: state.selected }),
        el('span', { class: 'spacer' }),
        el('button', { class: 'danger', text: 'Delete rule', onclick: deleteRule }),
      ]),
      el('div', { class: 'problems bad' }, [
        el('div', { text: 'This rule is defined by a URL: ' + state.original.url + '. The editor works with repo and tag, so migrate it first.' }),
        migration
          ? el('div', { class: 'row' }, [
              el('button', {
                class: 'primary',
                text: 'Migrate to ' + migration.repo + (migration.tag ? ' @ ' + migration.tag : ' (latest)'),
                onclick: () => migrateRule(migration),
              }),
            ])
          : el('div', { class: 'muted small', text: 'This URL cannot be expressed as repo and tag. Edit the rule in Raw YAML.' }),
      ]),
    );
  }

  async function migrateRule(migration) {
    if (!(await allowDiscard(false, true))) return;
    state.draft.repo = migration.repo;
    state.draft.tag = migration.tag;
    touch(state.draft, 'repo');
    touch(state.draft, 'tag');
    await saveRule();
  }

  function renderForm() {
    const form = $('form');
    form.replaceChildren();
    if (!state.connected) {
      form.append(el('p', { class: 'muted', text: 'Connect with the rules token to edit rules.' }));
      state.refs = null;
      return;
    }
    const draft = state.draft;
    if (!draft) {
      form.append(el('p', { class: 'muted', text: 'No rules yet. Use + New to add one from a GitHub repository.' }));
      state.refs = null;
      return;
    }
    if (!state.isNew && state.original && state.original.url) {
      renderUrlRule(form);
      return;
    }

    const save = el('button', { class: 'primary', text: state.isNew ? 'Create rule' : 'Save rule', onclick: saveRule });
    const revert = state.isNew ? null : el('button', { text: 'Revert', title: 'Discard unsaved edits. With no unsaved edits, restores the previous rules.yml.', onclick: revertRule });
    const remove = state.isNew ? null : el('button', { class: 'danger', text: 'Delete rule', onclick: deleteRule });
    const templateSelect = state.isNew ? el('select', {
      'aria-label': 'Template',
      onchange: (event) => {
        applyTemplate(draft, event.target.value);
        renderForm();
      },
    }, [
      el('option', { value: 'single', text: 'Template: single file', selected: draft.template === 'single' ? '' : undefined }),
      el('option', { value: 'zip', text: 'Template: zip archive', selected: draft.template === 'zip' ? '' : undefined }),
    ]) : null;

    state.refs = { save, revert };
    form.append(
      el('div', { class: 'form-head' }, [
        el('h2', { text: state.isNew ? 'New GitHub rule' : state.selected }),
        el('span', { class: 'spacer' }),
        templateSelect,
        revert,
        remove,
        save,
      ].filter(Boolean)),
      el('div', { id: 'problems' }),
      placeholderChips(draft),
      section('Source', 'Repository on GitHub. The release tag is optional; leave it empty for the latest release.', [
        textField('Name', draft, 'name', 'short rule name, usually the repo name'),
        textField('Repo', draft, 'repo', 'owner/name'),
        tagField(draft),
      ]),
      section('Variables', 'Named values reused in patterns as {NAME}. Defined in order, so later variables can use earlier ones.', [
        setEditor(draft),
      ]),
      section('Get', 'Regex patterns for release assets to download. The first matching pattern wins.', [
        listEditor(draft, 'get', 'regex, e.g. tool-{SEMVER}-x64[.]exe$'),
      ]),
      section('Unpack', 'Archives to extract. Use {DOWNLOADED} for the downloaded file.', [
        listEditor(draft, 'unpack', '{DOWNLOADED}'),
      ]),
      section('Remove', 'Old files in /app/download matching these patterns are deleted before copying.', [
        listEditor(draft, 'remove', '^/app/download/{PATTERN}'),
      ]),
      section('Copy', 'Source regex on the file name, then the target directory or file. {UNPACKED} is an extracted file.', [
        copyEditor(draft),
      ]),
      section('Test against an asset', 'Paste a release asset file name to see which get pattern and copy rules would apply.', [
        el('div', { class: 'row' }, [
          el('input', {
            value: state.asset,
            placeholder: 'e.g. tool-1.2.3-x64.exe',
            class: 'grow',
            oninput: (event) => {
              state.asset = event.target.value;
              renderMatch();
            },
          }),
        ]),
        el('div', { id: 'match-results', class: 'results' }),
      ]),
    );
    renderProblems();
    renderMatch();
  }

  function renderList() {
    const query = state.search.trim().toLowerCase();
    const items = state.rules
      .filter((rule) => !query || (rule.name + ' ' + (rule.repo || '')).toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    $('rule-count').textContent = state.rules.length + ' GitHub rules';
    const list = $('rule-list');
    list.replaceChildren(...items.map((rule) => {
      const badges = [];
      if (rule.tag) badges.push(el('span', { class: 'badge', text: 'tag' }));
      if (rule.set && Object.keys(rule.set).length) badges.push(el('span', { class: 'badge', text: 'set' }));
      if (rule.unpack && rule.unpack.length) badges.push(el('span', { class: 'badge', text: 'zip' }));
      const active = !state.isNew && rule.name === state.selected;
      return el('button', { class: 'rule-item' + (active ? ' active' : ''), onclick: () => select(rule.name) }, [
        el('div', { class: 'rule-name', text: rule.name }),
        el('div', { class: 'muted small', text: rule.repo || '' }),
        el('div', { class: 'badges' }, badges),
      ]);
    }));
  }

  function renderRaw() {
    if (!state.rawDirty) $('raw').value = state.raw;
  }

  function renderAll() {
    renderList();
    renderForm();
    renderRaw();
    updateEnabled();
  }

  async function saveRule() {
    const draft = state.draft;
    const problems = validate(draft);
    if (problems.length) {
      showBanner('error', 'Fix these before saving:\\n' + problems.join('\\n'));
      return;
    }
    if (!(await allowDiscard(false, true))) return;
    clearBanner();
    const body = payload(draft);
    try {
      const saved = state.isNew
        ? await commit('POST', '/api/rules/github', body, 'Create rule ' + body.name)
        : await commit('PUT', '/api/rules/github/' + encodeURIComponent(state.selected), body, 'Save rule ' + state.selected);
      if (!saved) return;
      state.isNew = false;
      state.selected = body.name;
      await refresh();
      showBanner('success', 'Saved "' + body.name + '". Changes apply to the next /process request.');
    } catch (error) {
      showBanner('error', String(error.message || error));
    }
  }

  async function deleteRule() {
    const name = state.selected;
    if (!(await allowDiscard(true, true))) return;
    if (state.rules.length === 1 && !(await askDialog('Delete the last GitHub rule?', 'No GitHub rules will remain. The built-in defaults then apply to every GitHub URL, which can download far more than you intend. Continue?', 'Delete'))) return;
    clearBanner();
    try {
      if (!(await commit('DELETE', '/api/rules/github/' + encodeURIComponent(name), undefined, 'Delete rule ' + name))) return;
      state.selected = null;
      await refresh();
      showBanner('success', 'Deleted "' + name + '".');
    } catch (error) {
      showBanner('error', String(error.message || error));
    }
  }

  function parseRepo(text) {
    const cleaned = text.trim()
      .replace(/^(https?:\\/\\/)?(www\\.)?github\\.com\\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\\.git$/, '')
      .replace(/\\/+$/, '');
    const parts = cleaned.split('/');
    return parts.length >= 2 && parts[0] && parts[1] ? parts[0] + '/' + parts[1] : '';
  }

  function parseGithubUrl(text) {
    const trimmed = text.trim();
    const repo = parseRepo(trimmed);
    const match = /github[.]com\\/[^\\/]+\\/[^\\/]+\\/releases\\/tag\\/([^\\/?#]+)/i.exec(trimmed);
    const tag = match ? decodeURIComponent(match[1]) : '';
    return { repo, tag: tag === 'latest' ? '' : tag };
  }

  async function newRule() {
    if (!(await guardDiscard())) return;
    const dialog = $('new-dialog');
    const input = $('new-repo');
    const testValue = $('test-url').value.trim();
    input.value = parseGithubUrl(testValue).repo ? testValue : '';
    const confirmed = await openDialog(dialog, input);
    if (!confirmed) return;
    const parsed = parseGithubUrl(input.value);
    const repo = parsed.repo;
    if (!repo) {
      showBanner('error', 'Enter a GitHub repository as owner/name or as a github.com URL.');
      return;
    }
    clearBanner();
    state.isNew = true;
    state.selected = null;
    state.original = null;
    state.draft = { name: repo.split('/')[1], repo, tag: parsed.tag, setPairs: [], present: new Set(), touched: new Set(), template: 'single', get: [], unpack: [], remove: [], copy: [] };
    applyTemplate(state.draft, 'single');
    state.view = 'rules';
    setView('rules');
    renderAll();
    const picked = await pickAsset(repo, parsed.tag);
    if (picked && state.isNew) applyAssetToGet(picked, true);
    renderAll();
  }

  function setView(view) {
    state.view = view;
    $('view-rules').classList.toggle('hidden', view !== 'rules');
    $('view-raw').classList.toggle('hidden', view !== 'raw');
    for (const tab of document.querySelectorAll('.tab')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.view === view));
    }
  }

  async function validateRaw() {
    clearBanner();
    await apiJson('/api/rules/validate', { method: 'POST', body: $('raw').value, headers: { 'content-type': 'text/plain' } });
    showBanner('success', 'The YAML is valid and the rules resolve.');
  }

  async function saveRaw() {
    clearBanner();
    if (!(await allowDiscard(true, false))) return;
    const text = $('raw').value;
    try {
      await validateRaw();
      if (!(await confirmDiff('Save raw YAML', state.raw, text))) return;
      await apiJson('/api/rules', { method: 'PUT', body: text });
      await refresh();
      showBanner('success', 'Rules saved and validated. Changes are active on the next request.');
    } catch (error) {
      showBanner('error', String(error.message || error));
    }
  }

  async function revertRule() {
    if (isDirty()) {
      state.draft = draftFromRule(state.original);
      renderForm();
      return;
    }
    if (!state.hasBackup) {
      showBanner('info', 'Nothing to revert: there is no saved change to undo.');
      return;
    }
    await undo();
  }

  async function undo() {
    if (!(await allowDiscard(true, true))) return;
    if (!(await askDialog('Undo last save?', 'Restore the previous saved rules.yml. The current file becomes the new backup, so Undo again reverts this.', 'Restore'))) return;
    clearBanner();
    try {
      await apiJson('/api/rules/undo', { method: 'POST' });
      await refresh();
      showBanner('success', 'Restored the previous rules.yml.');
    } catch (error) {
      showBanner('error', String(error.message || error));
    }
  }

  async function testMatch() {
    clearBanner();
    const url = $('test-url').value.trim();
    if (!url) { showBanner('error', 'Enter a URL to test.'); return; }
    let parsed;
    try { parsed = new URL(url); } catch { showBanner('error', 'The URL is not valid.'); return; }
    if (!/^https?:$/.test(parsed.protocol)) { showBanner('error', 'The URL must use http or https.'); return; }
    setStatus('Testing…', 'none');
    $('test-btn').disabled = true;
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
    } catch (error) {
      setStatus('Test failed', 'bad');
      showBanner('error', String(error.message || error));
    } finally {
      $('test-btn').disabled = !state.connected;
    }
  }

  $('token').addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
  $('connect-btn').addEventListener('click', connect);
  $('search').addEventListener('input', (event) => { state.search = event.target.value; renderList(); });
  $('new-btn').addEventListener('click', newRule);
  $('new-repo').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    $('new-dialog').querySelector('[value="confirm"]').click();
  });
  $('undo-btn').addEventListener('click', undo);
  $('test-btn').addEventListener('click', testMatch);
  $('validate-btn').addEventListener('click', () => validateRaw().catch((error) => showBanner('error', String(error.message || error))));
  $('save-raw-btn').addEventListener('click', saveRaw);
  $('raw').addEventListener('input', () => { state.rawDirty = true; });
  $('help-btn').addEventListener('click', () => $('help-dialog').showModal());
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      if (tab.dataset.view === 'rules' && state.view === 'raw') renderAll();
      setView(tab.dataset.view);
    });
  }

  setView('rules');
  renderAll();
  if (token) connect();
})();
</script>
</body>
</html>
`;
