/* ==========================================================================
   3in1 Task Studio — front-end controller
   Vanilla ES module. Talks to /api. No build step.
   ========================================================================== */

const api = {
  async req(method, path, body) {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* non-json */ }
    if (!res.ok || (payload && payload.success === false)) {
      throw new Error(payload?.error || `Request failed (${res.status})`);
    }
    return payload?.data;
  },
  get: (p) => api.req('GET', p),
  post: (p, b) => api.req('POST', p, b),
};

/* ------------------------------------------------------------------ state */
const state = {
  config: null,
  status: null,
  people: [],
  selectedKeys: new Set(),
  scheduler: null,
  journal: [],
};

/* ------------------------------------------------------------------ utils */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function toast(message, kind = 'ok') {
  const t = el('div', { class: `toast ${kind}` }, message);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}

const BADGE_LABELS = {
  PLANNED: 'Planned',
  CREATED: 'Created',
  WEEKEND_SKIP: 'Weekend',
  DUPLICATE: 'Duplicate',
  DUPLICATE_ALREADY_EXISTS: 'Exists',
  MULTIPLE_EXISTING_TASKS: 'Multiple exist',
  FUTURE_TASK_WARN: 'Ahead',
  NO_TASKS_NEEDED: 'Up to date',
  FAILED: 'Failed',
  SUCCESS: 'Success',
  PARTIAL: 'Partial',
  SOURCE_NOT_FOUND: 'No source',
  READY: 'Ready',
};

const badge = (status) =>
  el('span', { class: `badge ${status}` }, BADGE_LABELS[status] || status);

/* ------------------------------------------------------------------ views */
const VIEWS = {
  dashboard: { title: 'Dashboard', subtitle: "System health and today's picture" },
  planner: { title: 'Planner', subtitle: 'Preview and execute task creation' },
  explorer: { title: 'Explorer', subtitle: 'Per-person coverage across the window' },
  people: { title: 'Team', subtitle: 'Manage team members and identities' },
  journal: { title: 'Audit Log', subtitle: 'Every creation recorded and verifiable' },
  scheduler: { title: 'Scheduler', subtitle: 'Automated weekday runs' },
  logs: { title: 'Logs', subtitle: 'Live structured output' },
  settings: { title: 'Settings', subtitle: 'Connection and credentials' },
};

function switchView(view) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === `view-${view}`));
  $('#viewTitle').textContent = VIEWS[view].title;
  $('#viewSubtitle').textContent = VIEWS[view].subtitle;
  $('#sidebar').classList.remove('open');
  location.hash = view;
  if (view === 'dashboard') refreshDashboard();
  if (view === 'explorer') refreshExplorer();
  if (view === 'journal') refreshJournal();
  if (view === 'scheduler') refreshScheduler();
  if (view === 'people') renderPeople();
  if (view === 'settings') fillSettings();
}

/* ------------------------------------------------------------ connection */
async function refreshStatus() {
  const badgeEl = $('#connBadge');
  try {
    state.status = await api.get('/status');
    const ok = state.status.connected;
    badgeEl.className = `conn ${ok ? 'ok' : 'bad'}`;
    $('#connText').textContent = ok ? 'Connected' : (state.status.patConfigured ? 'Error' : 'No PAT');
    $('#kpiConn').textContent = ok ? 'Online' : 'Offline';
    $('#kpiConnHint').textContent = ok
      ? `${state.status.organization}/${state.status.project}`
      : (state.status.errorMessage || 'Not configured');
  } catch (err) {
    badgeEl.className = 'conn bad';
    $('#connText').textContent = 'Unreachable';
    $('#kpiConn').textContent = 'Error';
    $('#kpiConnHint').textContent = err.message;
  }
}

/* --------------------------------------------------------------- dashboard */
async function refreshDashboard() {
  await refreshStatus();
  try {
    const cfg = await ensureConfig();
    $('#kpiPeople').textContent = cfg.people.filter(p => p.enabled !== false).length;
    $('#kpiTz').textContent = cfg.timezone;
    $('#kpiMode').textContent = `window: ${cfg.thursdayMode === 'FOLLOWING' ? 'following week' : 'current week'}`;

    const sched = await api.get('/scheduler');
    state.scheduler = sched;
    $('#kpiSched').textContent = sched.running ? 'Running' : 'Stopped';
    $('#kpiSchedHint').textContent = sched.nextRun ? `next ${new Date(sched.nextRun).toLocaleString()}` : 'weekdays 09:30';

    if (state.status?.connected) {
      const plan = await api.post('/tasks/plan', { all: true });
      renderPlanPreview(plan);
    } else {
      $('#dashboardPlan').innerHTML = '<p class="muted">Connect a PAT to see the plan.</p>';
    }

    const journal = await api.get('/journal?limit=6');
    renderTimeline(journal.entries);
  } catch (err) {
    $('#dashboardPlan').innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

function renderPlanPreview(plan) {
  const container = $('#dashboardPlan');
  container.innerHTML = '';
  let totalPlanned = 0;
  for (const p of plan.personPlans) {
    const planned = p.plannedDates.filter(d => d.status === 'PLANNED');
    totalPlanned += planned.length;
    const block = el('div', {}, [
      el('div', { class: 'day' }, [
        el('strong', {}, p.person.name),
        el('span', { class: 'muted small' }, planned.length ? `${planned.length} to create` : 'up to date'),
      ]),
    ]);
    for (const d of planned) {
      block.append(el('div', { class: 'day' }, [
        el('span', { class: 'muted small' }, d.formattedTitleDate),
        badge('PLANNED'),
      ]));
    }
    if (!planned.length && p.statusMessage) {
      block.append(el('p', { class: 'muted small', style: 'padding-top:6px' }, p.statusMessage));
    }
    container.append(block);
  }
  if (!plan.personPlans.length) {
    container.innerHTML = '<p class="muted">No people configured.</p>';
  } else {
    container.prepend(el('p', { class: 'muted small', style: 'margin-bottom:8px' },
      `${totalPlanned} task(s) planned · window ${plan.todayIso} → ${plan.nextThursdayIso}`));
  }
}

function renderTimeline(entries) {
  const container = $('#dashboardJournal');
  container.innerHTML = '';
  if (!entries?.length) {
    container.innerHTML = '<p class="muted">No entries yet.</p>';
    return;
  }
  for (const e of entries) {
    container.append(el('div', { class: 'tl-item' }, [
      el('span', { class: 'tl-time' }, timeAgo(e.timestamp)),
      el('span', { class: 'tl-main' }, `${e.personName} · ${e.title}`),
      badge(e.fieldCopyStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED'),
    ]));
  }
}

/* ----------------------------------------------------------------- planner */
async function ensureConfig() {
  if (!state.config) state.config = await api.get('/config');
  return state.config;
}

async function renderPlannerPeople() {
  const cfg = await ensureConfig();
  const picker = $('#personPicker');
  picker.innerHTML = '';
  const active = cfg.people.filter(p => p.enabled !== false);
  if (!active.length) {
    picker.append(el('p', { class: 'muted' }, 'No enabled team members. Add some in the Team tab.'));
    return;
  }
  // Default: all selected
  if (state.selectedKeys.size === 0) active.forEach(p => state.selectedKeys.add(p.key));

  for (const p of active) {
    const on = state.selectedKeys.has(p.key);
    const chip = el('label', {
      class: `person-chip ${on ? 'on' : ''}`,
      onclick: () => {
        if (state.selectedKeys.has(p.key)) state.selectedKeys.delete(p.key);
        else state.selectedKeys.add(p.key);
        renderPlannerPeople();
      },
    }, [
      el('span', {}, p.name),
      el('span', { class: 'muted small' }, p.role || p.pod || p.assignedTo),
    ]);
    picker.append(chip);
  }
}

function selectedKeysOrAll() {
  const cfg = state.config;
  const active = (cfg?.people || []).filter(p => p.enabled !== false).map(p => p.key);
  const keys = [...state.selectedKeys];
  return keys.length === 0 || keys.length === active.length ? [] : keys;
}

async function runPlan() {
  const btn = $('#planBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Planning';
  try {
    const data = await api.post('/tasks/plan', {
      personKeys: selectedKeysOrAll(),
      asOf: $('#asOf').value || undefined,
      thursdayMode: $('#thursdayMode').value,
    });
    renderPlanResults(data);
    toast('Plan generated');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Preview plan';
  }
}

async function runExecute() {
  const btn = $('#executeBtn');
  const keys = selectedKeysOrAll();
  const cfg = state.config;
  const active = (cfg?.people || []).filter(p => p.enabled !== false);
  const names = (keys.length ? active.filter(p => keys.includes(p.key)) : active).map(p => p.name).join(', ');
  if (!confirm(`Create 3in1 tasks for: ${names || 'nobody'}?\n\nThis writes to Azure DevOps and is recorded in the audit log.`)) return;

  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Executing';
  try {
    const data = await api.post('/tasks/execute', {
      personKeys: keys,
      asOf: $('#asOf').value || undefined,
      thursdayMode: $('#thursdayMode').value,
    });
    renderExecuteResults(data);
    toast(`Done: ${data.totalCreatedCount} created, ${data.totalTaskFailureCount} failed`, data.totalTaskFailureCount ? 'warn' : 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Execute creation';
  }
}

function renderPlanResults(data) {
  const root = $('#planResults');
  root.innerHTML = '';
  for (const p of data.personPlans) {
    const block = el('div', { class: 'person-block' });
    block.append(el('h3', {}, [
      p.person.name, ' ',
      badge(p.status),
    ]));
    if (p.statusMessage) block.append(el('p', { class: 'muted small', style: 'margin-bottom:8px' }, p.statusMessage));
    for (const d of p.plannedDates) {
      block.append(el('div', { class: 'day' }, [
        el('span', {}, d.formattedTitleDate),
        badge(d.status),
      ]));
    }
    root.append(block);
  }
}

function renderExecuteResults(data) {
  const root = $('#planResults');
  root.innerHTML = '';
  const summary = el('div', { class: 'stat-chips' }, [
    el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalCreatedCount)), el('span', {}, 'Created')]),
    el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalDuplicateCount)), el('span', {}, 'Duplicates')]),
    el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalTaskFailureCount)), el('span', {}, 'Failures')]),
    el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalSourceFailureCount)), el('span', {}, 'No source')]),
  ]);
  root.append(summary);
  for (const r of data.personResults) {
    const block = el('div', { class: 'person-block' });
    block.append(el('h3', {}, [r.person.name, ' ', badge(r.status)]));
    for (const t of r.createdTasks) {
      block.append(el('div', { class: 'day' }, [
        el('span', {}, `#${t.id} ${t.title}`),
        badge('CREATED'),
      ]));
    }
    for (const f of r.failedTasks) {
      block.append(el('div', { class: 'day' }, [
        el('span', {}, `${f.formattedTitleDate} — ${f.errorMessage || 'failed'}`),
        badge('FAILED'),
      ]));
    }
    root.append(block);
  }
}

/* ---------------------------------------------------------------- explorer */
const CELL_STATE = (status) => {
  if (status === 'PLANNED') return 'missing';
  if (status === 'WEEKEND_SKIP') return 'skip';
  if (status === 'FUTURE_TASK_WARN') return 'warn';
  return 'has';
};

async function refreshExplorer() {
  const root = $('#explorerGrid');
  root.innerHTML = '<p class="muted">Loading coverage…</p>';
  try {
    const plan = await api.post('/tasks/plan', {
      all: true,
      asOf: $('#asOf')?.value || undefined,
    });
    root.innerHTML = '';
    if (!plan.personPlans.length) {
      root.innerHTML = '<p class="muted">No people configured.</p>';
      return;
    }
    for (const p of plan.personPlans) {
      const row = el('div', { class: 'explorer-row' }, [
        el('span', { class: 'explorer-name' }, p.person.name),
      ]);
      const grid = el('div', { class: 'cell-grid' });
      if (!p.plannedDates.length) {
        grid.append(el('span', { class: 'muted small' }, p.statusMessage || 'No dates in window'));
      }
      for (const d of p.plannedDates) {
        const cls = CELL_STATE(d.status);
        grid.append(el('div', { class: `cell ${cls}`, title: d.fullTitle || d.formattedTitleDate }, [
          el('span', { class: 'cell-date' }, d.formattedTitleDate),
          el('span', { class: 'cell-state' }, BADGE_LABELS[d.status] || d.status),
        ]));
      }
      row.append(grid);
      root.append(row);
    }
  } catch (err) {
    root.innerHTML = '';
    root.append(el('p', { class: 'muted' }, err.message));
  }
}


function renderPeople() {
  const list = $('#peopleList');
  list.innerHTML = '';
  state.people.forEach((p, idx) => {
    const row = el('div', { class: 'person-row' });
    row.append(field('Key', input(p.key, v => state.people[idx].key = v, 'text')));
    row.append(field('Name', input(p.name, v => state.people[idx].name = v, 'text')));
    row.append(field('Assigned to', input(p.assignedTo, v => state.people[idx].assignedTo = v, 'text')));
    row.append(field('Role / POD', input(p.role || p.pod || '', v => state.people[idx].role = v, 'text')));
    const del = el('button', {
      class: 'btn ghost del small',
      onclick: () => { state.people.splice(idx, 1); renderPeople(); },
    }, 'Remove');
    row.append(del);
    list.append(row);
  });
}

function field(label, control) {
  return el('label', { class: 'field' }, [el('span', {}, label), control]);
}

function input(value, onChange, type = 'text') {
  const node = el('input', { type, value: value ?? '' });
  node.addEventListener('input', () => onChange(node.value));
  return node;
}

async function loadPeople() {
  const cfg = await ensureConfig();
  state.people = cfg.people.map(p => ({ ...p }));
  renderPeople();
}

async function savePeople() {
  try {
    await api.post('/config/people', { people: state.people });
    state.config.people = state.people.map(p => ({ ...p }));
    toast('Team saved');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------------------------------------------------------------- journal */
async function refreshJournal() {
  try {
    const data = await api.get('/journal?limit=200');
    state.journal = data.entries;
    const stats = $('#journalStats');
    stats.innerHTML = '';
    stats.append(
      el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalEntries)), el('span', {}, 'Entries')]),
      el('div', { class: 'stat-chip' }, [el('b', {}, String(data.incompleteEntriesCount)), el('span', {}, 'Incomplete relation copies')]),
    );
    const tbody = $('#journalTable tbody');
    tbody.innerHTML = '';
    for (const e of data.entries) {
      tbody.append(el('tr', {}, [
        el('td', {}, new Date(e.timestamp).toLocaleString()),
        el('td', {}, e.personName),
        el('td', {}, e.targetIsoDate),
        el('td', { class: 'title-cell', title: e.title }, e.title),
        el('td', {}, e.createdWorkItemId ? `#${e.createdWorkItemId}` : '—'),
        el('td', {}, badge(e.fieldCopyStatus)),
        el('td', {}, badge(e.relationCopyStatus)),
        el('td', {}, e.verified ? '✓' : '✗'),
      ]));
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* -------------------------------------------------------------- scheduler */
async function refreshScheduler() {
  const sched = await api.get('/scheduler');
  state.scheduler = sched;
  $('#schedToggle').checked = sched.running;
  $('#schedState').textContent = sched.running ? 'Running' : 'Stopped';
  $('#schedTz').textContent = sched.timezone;
  $('#schedNext').textContent = sched.nextRun ? new Date(sched.nextRun).toLocaleString() : '—';
  $('#schedLast').textContent = sched.lastRun
    ? `${sched.lastRunResult || 'done'} · ${timeAgo(sched.lastRun)}`
    : '—';
}

async function toggleScheduler(enabled) {
  try {
    const sched = await api.post('/scheduler/toggle', { enabled });
    state.scheduler = sched;
    toast(enabled ? 'Scheduler started' : 'Scheduler stopped');
    refreshScheduler();
  } catch (err) {
    toast(err.message, 'err');
    refreshScheduler();
  }
}

/* --------------------------------------------------------------- settings */
function fillSettings() {
  const c = state.config;
  if (!c) return;
  $('#setOrg').value = c.organization || '';
  $('#setProject').value = c.project || '';
  $('#setTz').value = c.timezone || '';
  $('#setStart').value = c.startTime || '';
  $('#setPat').value = '';
}

async function saveSettings() {
  try {
    await api.post('/config/settings', {
      organization: $('#setOrg').value,
      project: $('#setProject').value,
      timezone: $('#setTz').value,
      startTime: $('#setStart').value,
    });
    state.config = await api.get('/config');
    toast('Settings saved');
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function savePat() {
  const pat = $('#setPat').value;
  if (!pat) { toast('Enter a PAT first', 'warn'); return; }
  try {
    const data = await api.post('/config/pat', { pat });
    $('#setPat').value = '';
    toast(`PAT saved (${data.patMasked})`);
    await refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ------------------------------------------------------------------- logs */
let logSource = null;
function initLogs() {
  const pre = $('#logStream');
  const append = (entry) => {
    const line = el('div', { class: `l-${entry.level}` }, `[${entry.level.toUpperCase()}] ${entry.message}`);
    pre.append(line);
    while (pre.childNodes.length > 500) pre.removeChild(pre.firstChild);
    pre.scrollTop = pre.scrollHeight;
  };
  api.get('/logs/recent?limit=200').then(entries => {
    pre.innerHTML = '';
    entries.forEach(append);
  }).catch(() => {});

  if (logSource) logSource.close();
  logSource = new EventSource('/api/logs/stream');
  logSource.onopen = () => { $('#logStatus').textContent = 'live'; $('#logStatus').className = 'pill ok'; };
  logSource.onerror = () => { $('#logStatus').textContent = 'reconnecting…'; $('#logStatus').className = 'pill warn'; };
  logSource.onmessage = (ev) => {
    try { append(JSON.parse(ev.data)); } catch { /* ping */ }
  };
}

/* ------------------------------------------------------------------ theme */
function initTheme() {
  const saved = localStorage.getItem('theme');
  document.documentElement.dataset.theme = saved || 'dark';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
}

/* ------------------------------------------------------------------- init */
function wire() {
  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $$('[data-view-link]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.viewLink)));
  $('#themeToggle').addEventListener('click', toggleTheme);
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#refreshBtn').addEventListener('click', () => { state.config = null; refreshDashboard(); loadPeople(); toast('Refreshed'); });
  $('#quickRunBtn').addEventListener('click', () => switchView('planner'));

  $('#planBtn').addEventListener('click', runPlan);
  $('#executeBtn').addEventListener('click', runExecute);
  $('#exploreRefresh').addEventListener('click', refreshExplorer);
  $('#exploreCreateMissing').addEventListener('click', async () => {
    await runExecute();
    refreshExplorer();
  });
  $('#addPersonBtn').addEventListener('click', () => {
    state.people.push({ key: `person${Date.now()}`, name: '', assignedTo: '', role: '', enabled: true });
    renderPeople();
  });
  $('#savePeopleBtn').addEventListener('click', savePeople);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#savePatBtn').addEventListener('click', savePat);
  $('#schedToggle').addEventListener('change', e => toggleScheduler(e.target.checked));
  $('#exportCsv').addEventListener('click', () => window.open('/api/journal/export?format=csv', '_blank'));
  $('#exportJson').addEventListener('click', () => window.open('/api/journal/export?format=json', '_blank'));

  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (VIEWS[v]) switchView(v);
  });
}

async function init() {
  initTheme();
  wire();
  initLogs();
  await refreshDashboard();
  await renderPlannerPeople();
  await loadPeople();
  const startView = location.hash.slice(1);
  if (VIEWS[startView]) switchView(startView);
}

init();
