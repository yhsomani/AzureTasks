/**
 * Azure DevOps 3in1 Task Automation Studio — Modern Frontend Controller
 * Complete feature parity, reactive rendering, interactive charts, and live telemetry.
 */

/* ------------------------------------------------------------------ state */
const state = {
  currentView: 'dashboard',
  status: null,
  config: null,
  people: [],
  selectedKeys: new Set(),
  explorerData: null,
  selectedExplorerKeys: new Set(),
  burndownData: null,
  journal: [],
  scheduler: null,
  charts: { effort: null, status: null },
  pendingPlan: null,
  cache: new Map(), // SWR client-side cache
  abortControllers: new Map(), // Per-key abort controllers for active requests
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ----------------------------------------------------------------- api */
const api = {
  /**
   * Cached GET with optional SWR (Stale-While-Revalidate)
   */
  async get(url, options = {}) {
    const { swr = false, maxAgeMs = 30000, abortKey = null, forceFresh = false } = options;

    if (abortKey) {
      if (state.abortControllers.has(abortKey)) {
        state.abortControllers.get(abortKey).abort();
      }
      const controller = new AbortController();
      state.abortControllers.set(abortKey, controller);
    }

    const cached = state.cache.get(url);
    const now = Date.now();

    // If cache is fresh and not forced to refresh, return immediately
    if (!forceFresh && cached && (now - cached.timestamp < maxAgeMs)) {
      return cached.data;
    }

    // If SWR requested and we have stale cached data, call onStale if provided and fetch in background
    if (!forceFresh && swr && cached && typeof options.onStale === 'function') {
      try {
        options.onStale(cached.data);
      } catch {}
    }

    const fetchOpts = {};
    if (abortKey && state.abortControllers.has(abortKey)) {
      fetchOpts.signal = state.abortControllers.get(abortKey).signal;
    }

    try {
      const res = await fetch(`/api${url}`, fetchOpts);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      state.cache.set(url, { data: json.data, timestamp: Date.now() });
      if (abortKey) state.abortControllers.delete(abortKey);
      return json.data;
    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was aborted by user navigation or newer query
        if (cached) return cached.data;
        throw err;
      }
      if (abortKey) state.abortControllers.delete(abortKey);
      throw err;
    }
  },

  async post(url, body) {
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data;
  },

  invalidateCache(pattern) {
    if (!pattern) {
      state.cache.clear();
      return;
    }
    for (const key of state.cache.keys()) {
      if (key.includes(pattern)) {
        state.cache.delete(key);
      }
    }
  },
};

/* ------------------------------------------------------------- toast & dom */
function toast(msg, type = 'ok') {
  const stack = $('#toasts');
  if (!stack) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  stack.append(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 200);
  }, 4000);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined) node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined) continue;
    if (typeof c === 'string' || typeof c === 'number') node.append(document.createTextNode(String(c)));
    else node.append(c);
  }
  return node;
}

function badge(status) {
  const cls = status ? status.replace(/[^A-Za-z0-9_-]/g, '_') : 'default';
  return el('span', { class: `badge ${cls}` }, status || '—');
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.max(1, Math.floor(diff))}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatDateShort(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso;
  }
}

function getAdoWorkItemUrl(id) {
  if (!id) return '#';
  const org = state.status?.organization || 'BFLDevOpsOrg';
  const project = state.status?.project || '3in1_Agile_Projects';
  return `https://dev.azure.com/${org}/${project}/_workitems/edit/${id}`;
}

/* -------------------------------------------------------------- navigation */
const VIEW_META = {
  dashboard: ['Dashboard', 'Track daily contributions, monitor team workloads, and automate tasks'],
  burndown: ['Daily Burndown', 'Monthly work tracking, completed hours, and daily effort allocation'],
  mywork: ['My Work', 'Personalized task assignment, completion status, and quick links'],
  explorer: ['Task Explorer', 'Intelligent date-range coverage matrix and team work inspection'],
  planner: ['Task Planner', 'Preview creation window and execute tasks with duplicate safeguards'],
  people: ['Team Management', 'Configured team members, roles, PODs, and source task overrides'],
  journal: ['Audit Log', 'Cryptographic execution record of created tasks, fields, and relations'],
  scheduler: ['Scheduler', 'Automated weekday task generation daemon'],
  logs: ['Live Logs', 'Real-time server logs and event stream'],
  settings: ['Settings', 'Azure DevOps connection, Personal Access Token, and maintenance'],
};

function switchView(view) {
  if (!VIEW_META[view]) view = 'dashboard';
  state.currentView = view;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

  const [title, subtitle] = VIEW_META[view];
  const vt = $('#viewTitle');
  const vs = $('#viewSubtitle');
  if (vt) vt.textContent = title;
  if (vs) vs.textContent = subtitle;

  location.hash = view;
  if (view === 'dashboard') refreshDashboard();
  if (view === 'burndown') refreshBurndown();
  if (view === 'mywork') refreshMyWork();
  if (view === 'explorer') refreshExplorer();
  if (view === 'planner') {
    renderPlannerPeople();
    runPlanPreview();
  }
  if (view === 'people') loadPeople();
  if (view === 'journal') refreshJournal();
  if (view === 'scheduler') refreshScheduler();
  if (view === 'settings') fillSettings();
}

/* ------------------------------------------------------------- system status */
async function refreshStatus() {
  try {
    const s = await api.get('/status', { swr: true, maxAgeMs: 15000 });
    state.status = s;
    const badgeEl = $('#connBadge');
    const textEl = $('#connText');
    const kpiVal = $('#kpiConn');
    const tagEl = $('#orgProjectTag');

    if (s.connected) {
      if (badgeEl) badgeEl.className = 'conn ok';
      if (textEl) textEl.textContent = 'Connected';
      if (kpiVal) kpiVal.textContent = 'Active';
    } else {
      if (badgeEl) badgeEl.className = 'conn bad';
      if (textEl) textEl.textContent = 'Disconnected';
      if (kpiVal) kpiVal.textContent = 'Disconnected';
    }

    if (tagEl && s.organization) {
      tagEl.textContent = `${s.organization} / ${s.project || 'Agile'}`;
    }
  } catch {
    const badgeEl = $('#connBadge');
    const textEl = $('#connText');
    const kpiVal = $('#kpiConn');
    if (badgeEl) badgeEl.className = 'conn bad';
    if (textEl) textEl.textContent = 'Unreachable';
    if (kpiVal) kpiVal.textContent = 'Offline';
  }
}

async function ensureConfig(force = false) {
  if (!state.config || force) {
    state.config = await api.get('/config', { swr: !force, maxAgeMs: 60000, forceFresh: force });
  }
  return state.config;
}

/* --------------------------------------------------------------- dashboard */
async function refreshDashboard() {
  refreshStatus();

  // 1. Instant or cached config display
  ensureConfig().then(cfg => {
    const active = cfg.people.filter(p => p.enabled !== false);
    const kpiP = $('#kpiPeople');
    if (kpiP) kpiP.textContent = active.length;
    const kpiTz = $('#kpiWindowRange');
    if (kpiTz) kpiTz.textContent = `${cfg.timezone || 'Asia/Kolkata'}`;
    const kpiMode = $('#kpiMode');
    if (kpiMode) kpiMode.textContent = `Mode: ${cfg.thursdayMode === 'FOLLOWING' ? 'Following Thursday' : 'Current Week'}`;
  }).catch(() => {});

  // 2. Scheduler state
  api.get('/scheduler', { swr: true, maxAgeMs: 15000 }).then(sched => {
    state.scheduler = sched;
    const ks = $('#kpiSched');
    const kh = $('#kpiSchedHint');
    if (ks) ks.textContent = sched.running ? 'Running' : 'Disabled';
    if (kh) kh.textContent = sched.nextRun ? `Next: ${new Date(sched.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'weekdays 09:30';
  }).catch(() => {});

  // 3. Plan Preview: render cached or progressive skeleton
  const dp = $('#dashboardPlan');
  if (dp && !state.pendingPlan) {
    dp.innerHTML = `
      <div class="skeleton-text skeleton" style="width:60%;"></div>
      <div class="skeleton-text skeleton" style="width:85%;"></div>
      <div class="skeleton-text skeleton" style="width:70%;"></div>
    `;
  }
  api.post('/tasks/plan', { all: true }).then(plan => {
    state.pendingPlan = plan;
    renderPlanPreview(plan);
  }).catch(err => {
    if (dp) dp.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  });

  // 4. Timeline journal
  api.get('/journal?limit=6', { swr: true, maxAgeMs: 20000 }).then(j => {
    renderTimeline(j.entries);
  }).catch(() => {});

  // 5. Insights & Overview Charts with SWR
  const insightsContainer = $('#insightsContainer');
  if (insightsContainer && !state.explorerData) {
    insightsContainer.innerHTML = '<div class="skeleton-text skeleton" style="width:75%;"></div>';
  }

  api.get('/explorer?preset=this_week', {
    swr: true,
    maxAgeMs: 60000,
    abortKey: 'dashboard-explorer',
    onStale: (data) => {
      renderOverviewCharts(data);
      generateInsights(data);
    },
  }).then(data => {
    renderOverviewCharts(data);
    generateInsights(data);
  }).catch(() => {
    api.get('/explorer?preset=current_month', {
      swr: true,
      maxAgeMs: 60000,
      abortKey: 'dashboard-explorer',
      onStale: (data) => {
        renderOverviewCharts(data);
        generateInsights(data);
      },
    }).then(data => {
      renderOverviewCharts(data);
      generateInsights(data);
    }).catch(() => {});
  });
}

function renderPlanPreview(plan) {
  const container = $('#dashboardPlan');
  if (!container) return;
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
      block.append(el('p', { class: 'muted small', style: 'padding-top:4px' }, p.statusMessage));
    }
    container.append(block);
  }

  if (!plan.personPlans.length) {
    container.innerHTML = '<p class="muted">No team members configured.</p>';
  } else {
    container.prepend(el('p', { class: 'muted small', style: 'margin-bottom:8px' },
      `${totalPlanned} task(s) to create · Window ${plan.todayIso} → ${plan.nextThursdayIso}`));
  }
}

function renderTimeline(entries) {
  const container = $('#dashboardJournal');
  if (!container) return;
  container.innerHTML = '';
  if (!entries?.length) {
    container.innerHTML = '<p class="muted">No execution history yet.</p>';
    return;
  }
  for (const e of entries) {
    const mainEl = el('span', { class: 'tl-main' }, [
      el('span', {}, `${e.personName} · ${e.title} `),
      e.createdWorkItemId ? el('a', {
        href: getAdoWorkItemUrl(e.createdWorkItemId),
        target: '_blank',
        class: 'ado-link',
        title: `Open task #${e.createdWorkItemId} in Azure DevOps`,
      }, `#${e.createdWorkItemId} ↗`) : null,
    ]);
    container.append(el('div', { class: 'tl-item' }, [
      el('span', { class: 'tl-time' }, timeAgo(e.timestamp)),
      mainEl,
      badge(e.fieldCopyStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED'),
    ]));
  }
}

function generateInsights(data) {
  const container = $('#insightsContainer');
  if (!container || !data) return;

  const insights = [];
  data.matrix.forEach(row => {
    if (row.stats.missingCount > 0) {
      insights.push(`<li><span style="color:var(--warn); font-weight:600;">⚠️ Missing Tasks:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.missingCount} missing daily task(s) in this period.</li>`);
    }
    if ((row.stats.stateCounts['Active'] || 0) > 3) {
      insights.push(`<li><span style="color:var(--accent); font-weight:600;">ℹ️ High WIP:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.stateCounts['Active']} active tasks concurrently.</li>`);
    }
    if (row.stats.duplicateCount > 0) {
      insights.push(`<li><span style="color:var(--danger); font-weight:600;">🛡️ Duplicates:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.duplicateCount} duplicate tasks requiring review.</li>`);
    }
  });

  if (insights.length === 0) {
    container.innerHTML = `<p style="color:var(--ok);">✨ All configured team members are completely up to date with zero task gaps for this period!</p>`;
  } else {
    container.innerHTML = `<ul style="margin:0; padding-left:18px; line-height:1.7;">${insights.slice(0, 5).join('')}</ul>`;
  }
}

function renderOverviewCharts(data) {
  if (typeof Chart === 'undefined' || !data) return;

  // 1. Status distribution donut
  const statusCanvas = $('#statusDistributionChart');
  if (statusCanvas) {
    const s = data.summary.stateCounts || {};
    const labels = ['New', 'Active', 'Closed', 'Resolved', 'Other'];
    const values = [s.New || 0, s.Active || 0, s.Closed || 0, s.Resolved || 0, s.Other || 0];

    if (state.charts.status) state.charts.status.destroy();
    state.charts.status = new Chart(statusCanvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: ['#6366f1', '#f59e0b', '#22c55e', '#3b82f6', '#94a3b8'],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#93a4b8', font: { size: 12 } } },
        },
      },
    });
  }

  // 2. Daily effort trend bar
  const effortCanvas = $('#effortTrendChart');
  if (effortCanvas) {
    const labels = [];
    const values = [];

    data.dates.forEach(d => {
      if (!d.isWeekend) {
        labels.push(d.formattedDate);
        let dailyWork = 0;
        data.matrix.forEach(row => {
          const cell = row.cells[d.dateIso];
          if (cell?.tasks) {
            dailyWork += cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
          }
        });
        values.push(dailyWork);
      }
    });

    if (state.charts.effort) state.charts.effort.destroy();
    state.charts.effort = new Chart(effortCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Completed Work (hours)',
          data: values,
          backgroundColor: '#0078d4',
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
          x: { grid: { display: false } },
        },
      },
    });
  }
}

/* ------------------------------------------------------------- daily burndown */
async function refreshBurndown() {
  const selector = $('#burndownMonthSelector');
  if (selector && !selector.value) {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    selector.value = ym;
  }
  loadBurndownMonth();
}

async function loadBurndownMonth() {
  const container = $('#burndownMatrixContainer');
  if (!container) return;
  const ym = $('#burndownMonthSelector')?.value;
  if (!ym) return;

  const [y, m] = ym.split('-');
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const start = `${ym}-01`;
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const url = `/explorer?startDate=${start}&endDate=${end}`;

  if (!state.burndownData) {
    container.innerHTML = `
      <div style="padding:20px;">
        <div class="skeleton-row skeleton" style="height:44px; margin-bottom:12px;"></div>
        <div class="skeleton-row skeleton"></div>
        <div class="skeleton-row skeleton"></div>
        <div class="skeleton-row skeleton"></div>
      </div>
    `;
  }

  try {
    const data = await api.get(url, {
      swr: true,
      maxAgeMs: 45000,
      abortKey: 'burndown-query',
      onStale: (stale) => {
        state.burndownData = stale;
        renderBurndownTable(stale);
      },
    });
    state.burndownData = data;
    renderBurndownTable(data);
  } catch (err) {
    if (err.name === 'AbortError') return;
    container.innerHTML = `<p class="muted" style="color:var(--danger); padding:24px;">❌ Error: ${escapeHtml(err.message)}</p>`;
  }
}

function renderBurndownTable(data) {
  const container = $('#burndownMatrixContainer');
  if (!container) return;
  const { dates, matrix } = data;

  const table = el('table', { class: 'matrix-table' });
  const thead = el('thead');
  const hRow = el('tr', {}, [
    el('th', { class: 'sticky-col' }, 'Team Member'),
    el('th', {}, 'Total Hours'),
    el('th', {}, 'Tasks'),
  ]);

  dates.forEach(d => {
    hRow.append(el('th', {}, [
      el('div', {}, d.formattedDate),
      el('div', { class: 'muted small', style: 'font-weight:normal;' }, d.dayOfWeek.slice(0, 3)),
    ]));
  });
  thead.append(hRow);
  table.append(thead);

  const tbody = el('tbody');
  matrix.forEach(row => {
    const tr = el('tr');
    tr.append(el('td', { class: 'sticky-col' }, [
      el('div', { style: 'font-weight:600;' }, row.person.name),
      el('div', { class: 'muted small' }, `${row.person.pod || 'Team'} · ${row.person.role || 'Member'}`),
    ]));
    tr.append(el('td', { style: 'font-weight:bold; color:var(--accent);' }, `${row.stats.totalCompletedWork}h`));
    tr.append(el('td', {}, String(row.stats.createdCount)));

    dates.forEach(d => {
      const cell = row.cells[d.dateIso];
      if (cell.isWeekend) {
        tr.append(el('td', { class: 'cell-status cell-weekend' }, 'WO'));
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
        const td = el('td', {
          class: 'cell-status cell-created',
          title: `Tasks: ${cell.tasks.length} | Completed: ${completed}h`,
          onclick: () => openDateInspectModal(cell, row.person),
        }, completed > 0 ? `${completed}h` : String(cell.tasks.length));
        tr.append(td);
      } else {
        const td = el('td', {
          class: 'cell-status cell-missing',
          title: 'Missing task',
          onclick: () => openDateInspectModal(cell, row.person),
        }, '0');
        tr.append(td);
      }
    });

    tbody.append(tr);
  });
  table.append(tbody);

  container.innerHTML = '';
  const wrap = el('div', { class: 'matrix-container' }, table);
  container.append(wrap);
}

/* ----------------------------------------------------------------- my work */
async function refreshMyWork() {
  const cfg = await ensureConfig();
  const select = $('#myWorkPersonSelect');
  if (select && select.children.length === 0) {
    select.innerHTML = '';
    cfg.people.filter(p => p.enabled !== false).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.name} (${p.assignedTo})`;
      select.append(opt);
    });
  }

  const personKey = select?.value || cfg.people[0]?.key;
  if (!personKey) {
    $('#myWorkContainer').innerHTML = '<p class="muted">No configured team members.</p>';
    return;
  }

  const url = `/explorer?preset=current_month&users=${encodeURIComponent(personKey)}`;
  const container = $('#myWorkContainer');
  if (container) {
    const cached = state.cache.get(url);
    if (!cached) {
      container.innerHTML = `
        <div style="padding:16px;">
          <div class="skeleton-row skeleton"></div>
          <div class="skeleton-row skeleton"></div>
        </div>
      `;
    }
  }

  try {
    const data = await api.get(url, {
      swr: true,
      maxAgeMs: 30000,
      abortKey: 'mywork-query',
      onStale: (stale) => renderMyWorkContent(stale, personKey),
    });
    renderMyWorkContent(data, personKey);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (container) container.innerHTML = `<p class="muted" style="color:var(--danger);">${escapeHtml(err.message)}</p>`;
  }
}

function renderMyWorkContent(data, personKey) {
  const container = $('#myWorkContainer');
  if (!container) return;

  const myTasks = (data.detailedTasks || []).filter(t => t.person.key === personKey && t.taskId);
  if (!myTasks.length) {
    container.innerHTML = '<p class="muted">No tasks found for this member in the current month.</p>';
    return;
  }

  const table = el('table', { class: 'table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Date'),
      el('th', {}, 'Task ID'),
      el('th', {}, 'Title'),
      el('th', {}, 'State'),
      el('th', {}, 'Completed (h)'),
      el('th', {}, 'Action'),
    ])),
  ]);

  const tbody = el('tbody');
  myTasks.forEach(t => {
    const stateCls = (t.state || 'new').toLowerCase();
    tbody.append(el('tr', {}, [
      el('td', { style: 'font-weight:600;' }, t.formattedDate),
      el('td', {}, el('a', { href: t.url || '#', target: '_blank', style: 'color:var(--accent); font-weight:600;' }, `#${t.taskId}`)),
      el('td', { class: 'title-cell' }, t.title || '—'),
      el('td', {}, el('span', { class: `state-tag state-${stateCls}` }, t.state || 'New')),
      el('td', {}, `${t.completedWork || 0}h`),
      el('td', {}, el('a', { href: t.url || '#', target: '_blank', class: 'btn small ghost' }, 'Open in ADO ↗')),
    ]));
  });
  table.append(tbody);

  container.innerHTML = '';
  container.append(el('div', { class: 'table-wrap' }, table));
}

/* ------------------------------------------------------------ task explorer */
async function refreshExplorer() {
  const cfg = await ensureConfig();
  renderExplorerUserPills(cfg);

  const preset = $('#explorerPreset')?.value || 'today_to_next_thursday';
  const start = $('#explorerStart')?.value;
  const end = $('#explorerEnd')?.value;

  let query = `preset=${encodeURIComponent(preset)}`;
  if (preset === 'custom' && start && end) {
    query = `startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
  }

  if (state.selectedExplorerKeys.size > 0) {
    query += `&users=${encodeURIComponent([...state.selectedExplorerKeys].join(','))}`;
  }

  const matrixWrap = $('#explorerMatrixWrap');
  if (matrixWrap && !state.explorerData) {
    matrixWrap.innerHTML = `
      <div style="padding:24px;">
        <div class="skeleton-row skeleton" style="height:44px; margin-bottom:12px;"></div>
        <div class="skeleton-row skeleton"></div>
        <div class="skeleton-row skeleton"></div>
        <div class="skeleton-row skeleton"></div>
      </div>
    `;
  }

  try {
    const data = await api.get(`/explorer?${query}`, {
      swr: true,
      maxAgeMs: 30000,
      abortKey: 'explorer-query',
      onStale: (stale) => {
        state.explorerData = stale;
        renderExplorerKpis(stale.summary);
        renderExplorerMatrix(stale);
        renderExplorerList(stale.detailedTasks);
      },
    });
    state.explorerData = data;

    const lr = $('#explorerLastRefresh');
    if (lr) lr.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

    // Update preset dates in UI inputs
    if (data.dateRange) {
      if ($('#explorerStart')) $('#explorerStart').value = data.dateRange.startDate;
      if ($('#explorerEnd')) $('#explorerEnd').value = data.dateRange.endDate;
    }

    renderExplorerKpis(data.summary);
    renderExplorerMatrix(data);
    renderExplorerList(data.detailedTasks);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (matrixWrap) matrixWrap.innerHTML = `<p class="muted" style="color:var(--danger); padding:24px;">❌ Error: ${escapeHtml(err.message)}</p>`;
  }
}

function renderExplorerUserPills(cfg) {
  const container = $('#explorerUserPills');
  if (!container) return;
  const active = cfg.people.filter(p => p.enabled !== false);

  if (state.selectedExplorerKeys.size === 0) {
    active.forEach(p => state.selectedExplorerKeys.add(p.key));
  }

  container.innerHTML = '';
  active.forEach(p => {
    const on = state.selectedExplorerKeys.has(p.key);
    const pill = el('span', {
      class: `user-pill ${on ? 'on' : ''}`,
      onclick: () => {
        if (state.selectedExplorerKeys.has(p.key)) state.selectedExplorerKeys.delete(p.key);
        else state.selectedExplorerKeys.add(p.key);
        renderExplorerUserPills(cfg);
        refreshExplorer();
      },
    }, [
      el('span', {}, p.name),
      el('span', { class: 'muted small' }, `(${p.key})`),
    ]);
    container.append(pill);
  });

  const tag = $('#explorerPillsTag');
  if (tag) {
    const count = state.selectedExplorerKeys.size;
    tag.textContent = count === active.length ? 'All selected' : `${count} of ${active.length} selected`;
  }
}

function renderExplorerKpis(s) {
  if (!s) return;
  if ($('#kpiExpUsers')) $('#kpiExpUsers').textContent = s.totalSelectedUsers;
  if ($('#kpiExpWorkingDays')) $('#kpiExpWorkingDays').textContent = s.totalWorkingDates;
  if ($('#kpiExpExpected')) $('#kpiExpExpected').textContent = s.expectedCombinations;
  if ($('#kpiExpCreated')) $('#kpiExpCreated').textContent = s.existingCombinations;
  if ($('#kpiExpCoveragePct')) $('#kpiExpCoveragePct').textContent = `${s.overallCoveragePercent}% coverage`;
  if ($('#kpiExpMissing')) $('#kpiExpMissing').textContent = s.missingCombinations;
  if ($('#kpiExpDuplicates')) $('#kpiExpDuplicates').textContent = s.duplicateCombinations;

  const statesBox = $('#kpiExpStates');
  if (statesBox && s.stateCounts) {
    statesBox.innerHTML = `
      <span class="state-tag state-new">New: ${s.stateCounts.New || 0}</span>
      <span class="state-tag state-active">Active: ${s.stateCounts.Active || 0}</span>
      <span class="state-tag state-closed">Closed: ${s.stateCounts.Closed || 0}</span>
      <span class="state-tag state-resolved">Resolved: ${s.stateCounts.Resolved || 0}</span>
    `;
  }
}

function renderExplorerMatrix(data) {
  const container = $('#explorerMatrixWrap');
  if (!container) return;
  const { dates, matrix } = data;

  const table = el('table', { class: 'matrix-table' });
  const thead = el('thead');
  const hRow = el('tr', {}, [
    el('th', { class: 'sticky-col' }, 'Team Member'),
  ]);

  dates.forEach(d => {
    hRow.append(el('th', {}, [
      el('div', {}, d.formattedDate),
      el('div', { class: 'muted small', style: 'font-weight:normal;' }, d.dayOfWeek.slice(0, 3)),
    ]));
  });
  thead.append(hRow);
  table.append(thead);

  const tbody = el('tbody');
  matrix.forEach(row => {
    const tr = el('tr');
    tr.append(el('td', { class: 'sticky-col', style: 'cursor:pointer;', onclick: () => openUserInspectModal(row) }, [
      el('div', { style: 'font-weight:600; color:var(--accent);' }, `${row.person.name} ↗`),
      el('div', { class: 'muted small' }, `${row.stats.createdCount}/${row.stats.totalWorkingDays} (${row.stats.coveragePercent}%)`),
    ]));

    dates.forEach(d => {
      const cell = row.cells[d.dateIso];
      if (cell.isWeekend) {
        tr.append(el('td', { class: 'cell-status cell-weekend' }, 'WO'));
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const cls = cell.status === 'DUPLICATE' ? 'cell-duplicate' : 'cell-created';
        const txt = cell.tasks.length > 1 ? `x${cell.tasks.length}` : '✓';
        const td = el('td', {
          class: `cell-status ${cls}`,
          title: `Task #${cell.primaryTask?.id || ''}: ${cell.primaryTask?.title || ''}`,
          onclick: () => openDateInspectModal(cell, row.person),
        }, txt);
        tr.append(td);
      } else if (cell.status === 'MISSING') {
        const td = el('td', {
          class: 'cell-status cell-missing',
          title: 'Missing task — eligible for creation',
          onclick: () => openDateInspectModal(cell, row.person),
        }, '—');
        tr.append(td);
      } else {
        tr.append(el('td', { class: 'cell-status', style: 'opacity:0.3;' }, '·'));
      }
    });

    tbody.append(tr);
  });
  table.append(tbody);

  container.innerHTML = '';
  container.append(table);
}

function renderExplorerList(items) {
  const tbody = $('#explorerListTable tbody');
  const countTag = $('#explorerListCount');
  if (!tbody) return;

  const query = $('#explorerListSearch')?.value?.toLowerCase().trim();
  let filtered = items || [];
  if (query) {
    filtered = filtered.filter(t =>
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.person?.name && t.person.name.toLowerCase().includes(query)) ||
      (t.taskId && String(t.taskId).includes(query))
    );
  }

  if (countTag) countTag.textContent = `Showing ${filtered.length} items`;
  tbody.innerHTML = '';

  filtered.forEach(t => {
    const tr = el('tr', {}, [
      el('td', { style: 'font-weight:600;' }, t.formattedDate),
      el('td', {}, t.person.name),
      el('td', {}, t.taskId ? el('a', { href: t.url || '#', target: '_blank', style: 'color:var(--accent); font-weight:600;' }, `#${t.taskId}`) : '—'),
      el('td', { class: 'title-cell' }, t.title || 'Missing Task'),
      el('td', {}, t.state ? el('span', { class: `state-tag state-${t.state.toLowerCase()}` }, t.state) : '—'),
      el('td', {}, t.completedWork !== undefined ? `${t.completedWork}h` : '—'),
      el('td', {}, badge(t.status)),
      el('td', {}, t.url ? el('a', { href: t.url, target: '_blank', class: 'btn small ghost' }, 'Open') : '—'),
    ]);
    tbody.append(tr);
  });
}

/* ------------------------------------------------------------- inspect modals */
function openDateInspectModal(cell, person) {
  const modal = $('#dateInspectModal');
  if (!modal) return;
  $('#dateInspectTitle').textContent = `${person.name} — ${cell.formattedDate} (${cell.dayOfWeek})`;

  const sumBox = $('#dateInspectSummary');
  if (sumBox) {
    sumBox.innerHTML = `
      <span class="pill ${cell.status === 'CREATED' ? 'ok' : 'warn'}">${cell.status}</span>
      <span class="pill">${cell.isWeekend ? 'Weekend' : 'Working Day'}</span>
    `;
  }

  const cList = $('#dateInspectCreatedList');
  if (cList) {
    cList.innerHTML = '';
    if (cell.tasks && cell.tasks.length > 0) {
      cell.tasks.forEach(t => {
        cList.append(el('div', { style: 'background:var(--bg-elev-2); padding:10px 14px; border-radius:var(--radius-sm); margin-bottom:8px;' }, [
          el('div', { style: 'font-weight:600;' }, [
            el('a', { href: t.url, target: '_blank', style: 'color:var(--accent); text-decoration:none;' }, `#${t.id} — ${t.title}`),
          ]),
          el('div', { class: 'muted small', style: 'margin-top:4px;' },
            `State: ${t.state} | Completed: ${t.completedWork || 0}h | Remaining: ${t.remainingWork || 0}h`),
        ]));
      });
    } else {
      cList.innerHTML = '<p class="muted small">No work items created for this date.</p>';
    }
  }

  const mList = $('#dateInspectMissingList');
  if (mList) {
    mList.innerHTML = '';
    if (cell.status === 'MISSING') {
      mList.innerHTML = `
        <div style="background:rgba(217,139,11,0.12); border:1px solid rgba(217,139,11,0.3); padding:10px 14px; border-radius:var(--radius-sm); font-size:13px; color:var(--warn);">
          ⚡ Task is missing for <strong>${escapeHtml(person.name)}</strong> on ${cell.formattedDate}.
          ${cell.isEligibleForCreation ? 'This date is within the current creation window and eligible to be created.' : 'This date is outside the rolling window.'}
        </div>
      `;
    } else {
      mList.innerHTML = '<p class="muted small">No missing task flagged.</p>';
    }
  }

  modal.classList.add('open');
}

function openUserInspectModal(row) {
  const modal = $('#userInspectModal');
  if (!modal) return;
  $('#userInspectTitle').textContent = `${row.person.name} (${row.person.assignedTo})`;

  const sumBox = $('#userInspectSummary');
  if (sumBox) {
    sumBox.innerHTML = `
      <div class="stat-chip"><b>${row.stats.createdCount}/${row.stats.totalWorkingDays}</b><span>Created / Days</span></div>
      <div class="stat-chip"><b>${row.stats.coveragePercent}%</b><span>Coverage</span></div>
      <div class="stat-chip"><b>${row.stats.totalCompletedWork}h</b><span>Completed Work</span></div>
      <div class="stat-chip"><b>${row.stats.missingCount}</b><span>Missing Tasks</span></div>
    `;
  }

  const timeline = $('#userInspectTimeline');
  if (timeline) {
    timeline.innerHTML = '';
    Object.values(row.cells).forEach(cell => {
      const firstTask = cell.tasks?.[0];
      const mainEl = el('span', { class: 'tl-main' });
      if (firstTask) {
        mainEl.append(
          el('a', {
            href: firstTask.url || getAdoWorkItemUrl(firstTask.id),
            target: '_blank',
            class: 'ado-link',
            style: 'font-weight:600;',
          }, `#${firstTask.id}`),
          document.createTextNode(` — ${firstTask.title}`)
        );
      } else {
        mainEl.textContent = cell.isWeekend ? 'Weekend (Off)' : 'Missing Task';
      }

      timeline.append(el('div', { class: 'tl-item' }, [
        el('span', { class: 'tl-time' }, cell.formattedDate),
        mainEl,
        badge(cell.status),
      ]));
    });
  }

  modal.classList.add('open');
}

/* ----------------------------------------------------------------- planner */
async function renderPlannerPeople() {
  const cfg = await ensureConfig();
  const picker = $('#personPicker');
  if (!picker) return;
  picker.innerHTML = '';
  const active = cfg.people.filter(p => p.enabled !== false);
  if (!active.length) {
    picker.append(el('p', { class: 'muted' }, 'No enabled team members. Add some in the Team tab.'));
    return;
  }

  if (state.selectedKeys.size === 0) active.forEach(p => state.selectedKeys.add(p.key));

  updatePlannerMemberPill(active.length);

  for (const p of active) {
    const on = state.selectedKeys.has(p.key);
    const chip = el('label', {
      class: `person-chip ${on ? 'on' : ''}`,
      onclick: () => {
        if (state.selectedKeys.has(p.key)) state.selectedKeys.delete(p.key);
        else state.selectedKeys.add(p.key);
        updatePlannerMemberPill(active.length);
        renderPlannerPeople();
        runPlanPreview();
      },
    }, [
      el('span', {}, p.name),
      el('span', { class: 'muted small' }, p.role || p.pod || p.assignedTo),
    ]);
    picker.append(chip);
  }
}

function updatePlannerMemberPill(totalActive) {
  const pill = $('#plannerMembersTag');
  if (!pill) return;
  const count = state.selectedKeys.size;
  if (count === totalActive) {
    pill.textContent = `All ${totalActive} selected`;
    pill.className = 'pill ok';
  } else if (count === 0) {
    pill.textContent = 'None selected (previewing all)';
    pill.className = 'pill warn';
  } else {
    pill.textContent = `${count} of ${totalActive} selected`;
    pill.className = 'pill';
  }
}

async function runPlanPreview() {
  const matrixWrap = $('#planMatrixWrap');
  const results = $('#planResults');
  const statusPill = $('#plannerAutoRefreshStatus');
  if (statusPill) { statusPill.textContent = 'Updating…'; statusPill.className = 'pill warn'; }

  if (matrixWrap && !state.pendingPlan) {
    matrixWrap.innerHTML = `
      <div style="padding:20px;">
        <div class="skeleton-row skeleton" style="height:40px; margin-bottom:12px;"></div>
        <div class="skeleton-row skeleton"></div>
        <div class="skeleton-row skeleton"></div>
      </div>
    `;
  }
  if (results && !state.pendingPlan) {
    results.innerHTML = `
      <div style="padding:16px;">
        <div class="skeleton-text skeleton" style="width:50%;"></div>
        <div class="skeleton-text skeleton" style="width:80%;"></div>
      </div>
    `;
  }

  try {
    const keys = [...state.selectedKeys];
    const plan = await api.post('/tasks/plan', {
      personKeys: keys.length ? keys : undefined,
      asOf: $('#asOf')?.value || undefined,
      thursdayMode: $('#thursdayMode')?.value || undefined,
    });
    state.pendingPlan = plan;
    renderPlanMatrix(plan);
    renderPlanResults(plan);
    if (statusPill) { statusPill.textContent = 'Up to date'; statusPill.className = 'pill ok'; }
  } catch (err) {
    if (matrixWrap) matrixWrap.innerHTML = `<p class="muted" style="color:var(--danger); padding:24px;">❌ Matrix error: ${escapeHtml(err.message)}</p>`;
    if (results) results.innerHTML = `<p class="muted" style="color:var(--danger); padding:16px;">❌ Preview error: ${escapeHtml(err.message)}</p>`;
    if (statusPill) { statusPill.textContent = 'Error'; statusPill.className = 'pill bad'; }
  }
}

function renderPlanMatrix(plan) {
  const matrixWrap = $('#planMatrixWrap');
  if (!matrixWrap) return;
  matrixWrap.innerHTML = '';

  const { todayIso, nextThursdayIso, personPlans } = plan;

  // Update KPIs
  $('#kpiPlanWindow')?.replaceChildren(document.createTextNode(`${formatDateShort(todayIso)} → ${formatDateShort(nextThursdayIso)}`));
  $('#kpiPlanMembers')?.replaceChildren(document.createTextNode(String(personPlans.length)));

  // Construct all dates in the creation window from todayIso to nextThursdayIso
  const allDates = [];
  let curr = todayIso;
  while (curr <= nextThursdayIso) {
    const dObj = new Date(curr + 'T00:00:00Z');
    const dow = dObj.getUTCDay();
    allDates.push({
      isoDate: curr,
      formattedTitleDate: dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      dayOfWeekName: dObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
      isWeekend: dow === 0 || dow === 6,
    });
    // add 1 day
    dObj.setUTCDate(dObj.getUTCDate() + 1);
    curr = dObj.toISOString().slice(0, 10);
  }

  let totalToCreate = 0;
  let totalExisting = 0;

  const table = el('table', { class: 'matrix-table' });
  const thead = el('thead');
  const headerRow = el('tr', {}, [
    el('th', { class: 'sticky-col' }, 'Team Member'),
  ]);

  allDates.forEach(d => {
    headerRow.append(el('th', {}, [
      el('div', {}, d.formattedTitleDate),
      el('div', { style: 'font-size:11px; font-weight:normal; color:var(--text-muted);' }, d.dayOfWeekName),
    ]));
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = el('tbody');
  personPlans.forEach(planItem => {
    const tr = el('tr');
    const hasPlanned = (planItem.plannedDates || []).some(p => p.status === 'PLANNED');
    const memberKey = planItem.person.key || planItem.person.name;

    // Person cell
    const sourceId = planItem.sourceTask?.workItem?.id || planItem.sourceTask?.id;
    const nameCell = el('td', { class: 'sticky-col matrix-person-cell', style: 'vertical-align:top;' }, [
      el('div', { style: 'font-weight:600;' }, planItem.person.name),
      el('div', { class: 'muted small' }, planItem.person.assignedTo),
      sourceId
        ? el('div', { class: 'muted small', style: 'margin-top:2px; font-size:11.5px;' }, [
            document.createTextNode('Source: '),
            el('a', {
              href: getAdoWorkItemUrl(sourceId),
              target: '_blank',
              class: 'ado-link',
              title: `Open source task #${sourceId} in Azure DevOps`,
            }, `#${sourceId} ↗`),
            document.createTextNode(` (${planItem.sourceTask.parsedDate?.formattedTitleDate || ''})`),
          ])
        : el('div', { class: 'small', style: 'color:var(--warn); margin-top:2px;' }, '⚠️ No source task'),
    ]);

    if (hasPlanned) {
      const btnRunMember = el('button', {
        class: 'btn-action-person',
        style: 'margin-top: 6px;',
        onclick: (e) => {
          e.stopPropagation();
          runForMember(memberKey, planItem.person.name);
        },
      }, `⚡ Create for ${planItem.person.name.split(' ')[0]}`);
      nameCell.append(btnRunMember);
    }
    tr.append(nameCell);

    // Each date column
    allDates.forEach(d => {
      const td = el('td');
      const item = (planItem.plannedDates || []).find(p => p.isoDate === d.isoDate);

      if (d.isWeekend) {
        td.innerHTML = '<span class="cell-status cell-weekend">Weekend</span>';
      } else if (!item) {
        if (planItem.status === 'FUTURE_TASK_WARN' || planItem.status === 'NO_TASKS_NEEDED') {
          totalExisting++;
          const srcLink = sourceId ? getAdoWorkItemUrl(sourceId) : '#';
          td.innerHTML = `<a href="${srcLink}" target="_blank" class="cell-status cell-created" style="display:inline-block; text-decoration:none;" title="Covered by schedule (#${sourceId || ''})">✓ Exist ↗</a>`;
        } else {
          td.innerHTML = '<span class="muted">-</span>';
        }
      } else if (item.status === 'WEEKEND_SKIP') {
        td.innerHTML = '<span class="cell-status cell-weekend">Weekend</span>';
      } else if (item.status === 'DUPLICATE_ALREADY_EXISTS' || item.status === 'DUPLICATE') {
        totalExisting++;
        const matchId = item.skipReason?.match(/#(\d+)/)?.[1];
        const link = matchId ? getAdoWorkItemUrl(matchId) : (sourceId ? getAdoWorkItemUrl(sourceId) : '#');
        td.innerHTML = `<a href="${link}" target="_blank" class="cell-status cell-created" style="display:inline-block; text-decoration:none;" title="${escapeHtml(item.skipReason || 'Task exists')}">✓ #${matchId || 'Exist'} ↗</a>`;
      } else if (item.status === 'MULTIPLE_EXISTING_TASKS') {
        totalExisting++;
        td.innerHTML = `<span class="cell-status cell-duplicate" title="${escapeHtml(item.skipReason || 'Multiple tasks')}">⚠️ Duplicate</span>`;
      } else if (item.status === 'PLANNED') {
        totalToCreate++;
        const btn = el('button', {
          class: 'btn-action-cell',
          title: `Create task for ${planItem.person.name} on ${d.formattedTitleDate}`,
          onclick: () => runForCell(memberKey, planItem.person.name, d.isoDate, d.formattedTitleDate),
        }, '+ Create');
        td.append(btn);
      } else {
        td.innerHTML = `<span class="cell-status cell-missing">${item.status}</span>`;
      }
      tr.append(td);
    });

    tbody.append(tr);
  });

  table.append(tbody);
  matrixWrap.append(table);

  $('#kpiPlanToCreate')?.replaceChildren(document.createTextNode(String(totalToCreate)));
  $('#kpiPlanExisting')?.replaceChildren(document.createTextNode(String(totalExisting)));
}

async function runForMember(personKey, personName) {
  if (!confirm(`Create planned Azure DevOps tasks for ${personName || personKey}?`)) return;
  openConsoleDrawer();
  try {
    const res = await api.post('/tasks/execute', {
      personKeys: [personKey],
      asOf: $('#asOf')?.value || undefined,
      thursdayMode: $('#thursdayMode')?.value || undefined,
      dryRun: false,
    });
    toast(`Created ${res.totalCreatedCount} tasks for ${personName || personKey}`, 'ok');
    runPlanPreview();
    refreshDashboard();
  } catch (err) {
    toast(`Creation failed: ${err.message}`, 'err');
  }
}

async function runForCell(personKey, personName, isoDate, dateStr) {
  if (!confirm(`Create Azure DevOps task for ${personName || personKey} on ${dateStr} (${isoDate})?`)) return;
  openConsoleDrawer();
  try {
    const res = await api.post('/tasks/execute', {
      personKeys: [personKey],
      asOf: isoDate,
      thursdayMode: $('#thursdayMode')?.value || undefined,
      dryRun: false,
    });
    toast(`Task created for ${personName || personKey} on ${dateStr}`, 'ok');
    runPlanPreview();
    refreshDashboard();
  } catch (err) {
    toast(`Creation failed: ${err.message}`, 'err');
  }
}

function renderPlanResults(plan) {
  const root = $('#planResults');
  if (!root) return;
  root.innerHTML = '';

  const toCreateCount = plan.personPlans.reduce((sum, p) => sum + (p.plannedDates || []).filter(d => d.status === 'PLANNED').length, 0);

  const summary = el('div', { class: 'row', style: 'justify-content:space-between; margin-bottom:12px;' }, [
    el('strong', {}, `Plan window: ${plan.todayIso} → ${plan.nextThursdayIso}`),
    el('span', { class: `pill ${toCreateCount > 0 ? 'ok' : ''}` }, `${toCreateCount} pending to create`),
  ]);
  root.append(summary);

  for (const p of plan.personPlans) {
    const block = el('div', { class: 'person-block' });
    block.append(el('h3', {}, `${p.person.name} (${p.person.assignedTo})`));

    if (p.sourceTask) {
      const srcId = p.sourceTask.workItem?.id || p.sourceTask.id;
      const srcTitle = p.sourceTask.workItem?.fields?.['System.Title'] || p.sourceTask.title || '';
      block.append(el('p', { class: 'muted small' }, [
        document.createTextNode('Source Task: '),
        srcId ? el('a', {
          href: getAdoWorkItemUrl(srcId),
          target: '_blank',
          class: 'ado-link',
          title: `Open source task #${srcId} in Azure DevOps`,
        }, `#${srcId} ↗`) : null,
        document.createTextNode(` · "${srcTitle}" · ${p.sourceTask.parsedDate?.formattedTitleDate}`),
      ]));
    } else {
      block.append(el('p', { class: 'muted small', style: 'color:var(--warn);' }, '⚠️ No source task discovered.'));
    }

    if (p.statusMessage) {
      block.append(el('p', { class: 'muted small', style: 'color:var(--text-muted); padding: 4px 0;' }, p.statusMessage));
    }

    const grid = el('div', { class: 'plan-preview' });
    for (const d of (p.plannedDates || [])) {
      const matchId = d.skipReason?.match(/#(\d+)/)?.[1];
      const descEl = el('span', {}, [
        document.createTextNode(`${d.formattedTitleDate} — ${d.fullTitle || d.skipReason || ''} `),
        matchId ? el('a', {
          href: getAdoWorkItemUrl(matchId),
          target: '_blank',
          class: 'ado-link',
          style: 'font-size:11.5px;',
          title: `Open task #${matchId} in Azure DevOps`,
        }, `#${matchId} ↗`) : null,
      ]);

      grid.append(el('div', { class: 'day' }, [
        descEl,
        badge(d.status),
      ]));
    }
    block.append(grid);
    root.append(block);
  }
}

function openConfirmationModal() {
  const modal = $('#confirmModal');
  const list = $('#confirmTaskList');
  if (!modal || !list) return;

  list.innerHTML = '';
  const keys = [...state.selectedKeys];

  // If we already previewed the plan, use it
  if (state.pendingPlan) {
    let count = 0;
    for (const p of state.pendingPlan.personPlans) {
      const planned = (p.plannedDates || []).filter(d => d.status === 'PLANNED');
      for (const d of planned) {
        count++;
        list.append(el('li', {}, `${p.person.name} — ${d.fullTitle}`));
      }
    }
    if (count === 0) {
      list.innerHTML = '<li style="color:var(--ok);">All team members are up to date! Zero tasks needed.</li>';
    }
  } else {
    list.innerHTML = `<li>Evaluate and create pending tasks for: <strong>${keys.length ? keys.join(', ') : 'All enabled team members'}</strong></li>`;
  }

  modal.classList.add('open');
}

async function executeCreation() {
  const modal = $('#confirmModal');
  if (modal) modal.classList.remove('open');

  const btn = $('#executeBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating tasks...'; }

  // Open console drawer to view execution
  openConsoleDrawer();

  try {
    const keys = [...state.selectedKeys];
    const res = await api.post('/tasks/execute', {
      personKeys: keys.length ? keys : undefined,
      asOf: $('#asOf')?.value || undefined,
      thursdayMode: $('#thursdayMode')?.value || undefined,
      dryRun: false,
    });
    toast(`Created ${res.totalCreatedCount} tasks, skipped ${res.totalDuplicateCount} duplicates`, 'ok');
    refreshDashboard();
    runPlanPreview();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Execute creation'; }
  }
}

/* ------------------------------------------------------------- team members */
function renderPeople() {
  const list = $('#peopleList');
  if (!list) return;
  list.innerHTML = '';
  state.people.forEach((p, idx) => {
    const row = el('div', { class: 'person-row' });
    row.append(field('Key', input(p.key, v => state.people[idx].key = v)));
    row.append(field('Name', input(p.name, v => state.people[idx].name = v)));
    row.append(field('Assigned to (Email / UPN)', input(p.assignedTo, v => state.people[idx].assignedTo = v)));
    row.append(field('Role / POD', input(p.role || p.pod || '', v => state.people[idx].role = v)));
    
    // Source Task ID field with link
    const srcField = el('label', { class: 'field' });
    const labelRow = el('span', { style: 'display:flex; justify-content:space-between; align-items:center;' }, [
      el('span', {}, 'Source Task ID'),
      p.sourceTaskId ? el('a', {
        href: getAdoWorkItemUrl(p.sourceTaskId),
        target: '_blank',
        class: 'ado-link',
        style: 'font-size:11px;',
        title: 'Open source work item in Azure DevOps',
      }, `#${p.sourceTaskId} ↗`) : el('span', { class: 'muted small', style: 'font-size:10.5px;' }, 'Auto'),
    ]);
    srcField.append(labelRow);
    srcField.append(input(p.sourceTaskId, v => {
      state.people[idx].sourceTaskId = v ? Number(v) : undefined;
    }, 'number'));
    row.append(srcField);

    const del = el('button', {
      class: 'btn ghost small del',
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
  const cfg = await ensureConfig(true);
  state.people = cfg.people.map(p => ({ ...p }));
  renderPeople();
}

async function savePeople() {
  try {
    const res = await api.post('/config/people', { people: state.people });
    state.config.people = state.people.map(p => ({ ...p }));
    api.invalidateCache();
    toast('Team members saved successfully', 'ok');

    // Update people count KPI
    const active = state.people.filter(p => p.enabled !== false);
    if ($('#kpiPeople')) $('#kpiPeople').textContent = active.length;

    // Refresh views to show updated members
    renderPlannerPeople();
    renderExplorerUserPills(state.config);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function openAddPersonModal() {
  const modal = $('#personModal');
  if (!modal) return;
  $('#personKeyInput').value = '';
  $('#personNameInput').value = '';
  $('#personEmailInput').value = '';
  $('#personPodInput').value = '';
  $('#personRoleInput').value = '';
  $('#personSourceIdInput').value = '';
  modal.classList.add('open');
}

async function savePersonFromModal() {
  const key = $('#personKeyInput').value.trim();
  const name = $('#personNameInput').value.trim();
  const assignedTo = $('#personEmailInput').value.trim();
  const pod = $('#personPodInput').value.trim();
  const role = $('#personRoleInput').value.trim();
  const sourceTaskId = $('#personSourceIdInput').value.trim();

  if (!key || !name || !assignedTo) {
    toast('Key, Name, and Assigned To are required', 'err');
    return;
  }

  // Check duplicate key in local state
  if (state.people.some(p => p.key.toLowerCase() === key.toLowerCase())) {
    toast(`Member key "${key}" already exists. Please choose a unique key.`, 'err');
    return;
  }

  const newMember = {
    key,
    name,
    assignedTo,
    pod: pod || undefined,
    role: role || undefined,
    sourceTaskId: sourceTaskId ? Number(sourceTaskId) : undefined,
    enabled: true,
  };

  // Optimistically append to local state and update Team UI immediately
  state.people.push(newMember);
  renderPeople();
  $('#personModal').classList.remove('open');

  toast(`Adding ${name} and syncing Azure DevOps data...`, 'ok');

  try {
    // Persist to backend
    await api.post('/config/people', { people: state.people });
    if (!state.config) state.config = { people: [] };
    state.config.people = state.people.map(p => ({ ...p }));

    // Invalidate caches to ensure fresh data across views
    api.invalidateCache();

    // Select the new member in Explorer & Planner
    state.selectedKeys.add(key);
    state.selectedExplorerKeys.add(key);

    // Update planner & explorer user pills
    renderPlannerPeople();
    renderExplorerUserPills(state.config);

    // Update My Work dropdown if present
    const myWorkSelect = $('#myWorkPersonSelect');
    if (myWorkSelect) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${name} (${assignedTo})`;
      myWorkSelect.append(opt);
    }

    // Trigger progressive background fetch for newly added member across Explorer & Planner
    runPlanPreview();

    // Query explorer specifically for the new member to warm up their data in background
    api.get(`/explorer?preset=today_to_next_thursday&users=${encodeURIComponent(key)}`, { forceFresh: true }).then(() => {
      toast(`✅ Data synchronized for ${name}`, 'ok');
      if (state.currentView === 'explorer') refreshExplorer();
      if (state.currentView === 'burndown') loadBurndownMonth();
      if (state.currentView === 'dashboard') refreshDashboard();
    }).catch(e => {
      console.warn(`Initial sync for ${key}:`, e);
    });

  } catch (err) {
    // Rollback on server error
    state.people = state.people.filter(p => p.key !== key);
    renderPeople();
    toast(`Failed to save team member: ${err.message}`, 'err');
  }
}

/* ---------------------------------------------------------------- audit log */
async function refreshJournal() {
  try {
    const data = await api.get('/journal?limit=250');
    state.journal = data.entries;
    const stats = $('#journalStats');
    if (stats) {
      stats.innerHTML = '';
      stats.append(
        el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalEntries)), el('span', {}, 'Total Log Entries')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(data.incompleteEntriesCount)), el('span', {}, 'Incomplete Relation Copies')]),
      );
    }
    const tbody = $('#journalTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const e of data.entries) {
      tbody.append(el('tr', {}, [
        el('td', {}, new Date(e.timestamp).toLocaleString()),
        el('td', {}, e.personName || '—'),
        el('td', {}, e.targetIsoDate || '—'),
        el('td', { class: 'title-cell' }, e.title || '—'),
        el('td', {}, e.createdWorkItemId ? el('a', {
          href: getAdoWorkItemUrl(e.createdWorkItemId),
          target: '_blank',
          class: 'ado-link',
          title: `Open task #${e.createdWorkItemId} in Azure DevOps`,
        }, `#${e.createdWorkItemId} ↗`) : '—'),
        el('td', {}, badge(e.fieldCopyStatus)),
        el('td', {}, badge(e.relationCopyStatus)),
        el('td', {}, el('span', { class: `pill ${e.verifiedState ? 'ok' : 'warn'}` }, e.verifiedState ? 'Verified' : 'Pending')),
      ]));
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ---------------------------------------------------------------- scheduler */
async function refreshScheduler() {
  try {
    const s = await api.get('/scheduler');
    state.scheduler = s;
    const toggle = $('#schedToggle');
    if (toggle) toggle.checked = s.running;
    const stateLabel = $('#schedState');
    if (stateLabel) stateLabel.textContent = s.running ? 'Running' : 'Stopped';

    if ($('#schedStatusPill')) {
      $('#schedStatusPill').textContent = s.running ? '🟢 Active Daemon' : '⚪ Stopped';
      $('#schedStatusPill').style.color = s.running ? 'var(--ok)' : 'var(--muted)';
    }

    if ($('#schedTimeDisplay')) $('#schedTimeDisplay').textContent = s.startTime || '09:30';
    if ($('#schedTz')) $('#schedTz').textContent = s.timezone || 'Asia/Kolkata';
    if ($('#schedNext')) $('#schedNext').textContent = s.nextRun ? new Date(s.nextRun).toLocaleString() : '—';
    if ($('#schedAutoStartLabel')) $('#schedAutoStartLabel').textContent = s.autoStart ? '✅ Enabled' : '❌ Disabled';
    
    if ($('#schedLast')) {
      if (s.lastRun) {
        const res = s.lastRunResult ? s.lastRunResult.toUpperCase() : 'DONE';
        $('#schedLast').textContent = `${res} (${new Date(s.lastRun).toLocaleTimeString()})`;
      } else {
        $('#schedLast').textContent = 'No runs yet';
      }
    }

    // Populate inputs if not actively focused
    if ($('#schedTimeInput') && document.activeElement !== $('#schedTimeInput')) {
      $('#schedTimeInput').value = s.startTime || '09:30';
    }
    if ($('#schedTzInput') && document.activeElement !== $('#schedTzInput')) {
      $('#schedTzInput').value = s.timezone || 'Asia/Kolkata';
    }
    if ($('#schedAutoStartCheck')) {
      $('#schedAutoStartCheck').checked = Boolean(s.autoStart);
    }
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleScheduler(enable) {
  try {
    const s = await api.post('/scheduler/toggle', { enable, persist: true });
    toast(s.running ? 'Scheduler started (persisted)' : 'Scheduler stopped (persisted)');
    refreshScheduler();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveSchedulerConfig() {
  try {
    const startTime = $('#schedTimeInput')?.value?.trim() || '09:30';
    const timezone = $('#schedTzInput')?.value?.trim() || 'Asia/Kolkata';
    const autoStart = Boolean($('#schedAutoStartCheck')?.checked);

    const s = await api.post('/scheduler/config', { startTime, timezone, autoStart });
    toast('Scheduler configuration saved successfully', 'ok');
    refreshScheduler();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runSchedulerNow() {
  try {
    toast('Triggering immediate scheduler execution...');
    const res = await api.post('/scheduler/run-now');
    if (res.success) {
      toast(res.message || 'Scheduler executed', 'ok');
    } else {
      toast(res.message || 'Could not run scheduler', 'warn');
    }
    setTimeout(refreshScheduler, 1500);
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ----------------------------------------------------------------- settings */
async function fillSettings() {
  const cfg = await ensureConfig();
  if ($('#setOrg')) $('#setOrg').value = cfg.organization || '';
  if ($('#setProject')) $('#setProject').value = cfg.project || '';
  if ($('#setTz')) $('#setTz').value = cfg.timezone || 'Asia/Kolkata';
  if ($('#setStart')) $('#setStart').value = cfg.startTime || '09:30';
}

async function saveSettings() {
  try {
    const body = {
      organization: $('#setOrg').value.trim(),
      project: $('#setProject').value.trim(),
      timezone: $('#setTz').value.trim(),
      startTime: $('#setStart').value.trim(),
    };
    await api.post('/config/settings', body);
    state.config = null;
    toast('Settings saved successfully');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function savePat() {
  const pat = $('#setPat').value.trim();
  if (!pat) {
    toast('Please enter a Personal Access Token', 'err');
    return;
  }
  try {
    const res = await api.post('/config/pat', { pat });
    toast(`PAT updated (${res.patMasked})`);
    $('#setPat').value = '';
    refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function testConnection() {
  toast('Testing Azure DevOps connection...');
  await refreshStatus();
  if (state.status?.connected) {
    toast('Connection successful!', 'ok');
  } else {
    toast('Connection failed. Check PAT and permissions.', 'err');
  }
}

/* ----------------------------------------------------------- ad-hoc task modal */
function openAdHocModal(defaultPersonKey, defaultDate) {
  const modal = $('#adHocModal');
  if (!modal) return;

  const select = $('#adHocPersonSelect');
  if (select) {
    select.innerHTML = '';
    (state.people || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.name} (${p.assignedTo})`;
      select.appendChild(opt);
    });
    if (defaultPersonKey) select.value = defaultPersonKey;
  }

  const dateInput = $('#adHocTargetDate');
  if (dateInput) {
    dateInput.value = defaultDate || new Date().toISOString().split('T')[0];
  }

  if ($('#adHocTitleInput')) $('#adHocTitleInput').value = '';
  if ($('#adHocSourceTaskId')) $('#adHocSourceTaskId').value = '';
  if ($('#adHocEstimateInput')) $('#adHocEstimateInput').value = '';
  if ($('#adHocActivityInput')) $('#adHocActivityInput').value = '';
  if ($('#adHocDescriptionInput')) $('#adHocDescriptionInput').value = '';
  if ($('#adHocBypassDuplicate')) $('#adHocBypassDuplicate').checked = false;

  modal.classList.add('open');
}

function closeAdHocModal() {
  $('#adHocModal')?.classList.remove('open');
}

async function submitAdHocTask() {
  const personKey = $('#adHocPersonSelect')?.value;
  const targetIsoDate = $('#adHocTargetDate')?.value;
  if (!personKey || !targetIsoDate) {
    toast('Please select an assignee and target date', 'warn');
    return;
  }

  const btn = $('#btnSubmitAdHocTask');
  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Creating...';
  }

  try {
    const payload = {
      personKey,
      targetIsoDate,
      customTitle: $('#adHocTitleInput')?.value?.trim() || undefined,
      sourceTaskId: $('#adHocSourceTaskId')?.value ? parseInt($('#adHocSourceTaskId').value, 10) : undefined,
      originalEstimate: $('#adHocEstimateInput')?.value ? parseFloat($('#adHocEstimateInput').value) : undefined,
      activity: $('#adHocActivityInput')?.value?.trim() || undefined,
      description: $('#adHocDescriptionInput')?.value?.trim() || undefined,
      bypassDuplicateCheck: Boolean($('#adHocBypassDuplicate')?.checked),
    };

    toast('Creating task in Azure DevOps...');
    const res = await api.post('/tasks/adhoc', payload);
    const created = res.task;

    toast(`Successfully created #${created.id} - ${created.title}`, 'ok');
    closeAdHocModal();

    // Trigger UI updates
    refreshDashboard();
    if (state.currentView === 'planner') refreshPlanner();
    if (state.currentView === 'explorer') refreshExplorer();
    if (state.currentView === 'journal') refreshJournal();
    if (state.currentView === 'mywork') refreshMyWork();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

/* ----------------------------------------------------------- console drawer */
function openConsoleDrawer() {
  const drawer = $('#executionDrawer');
  if (drawer) drawer.classList.add('open');
}

function toggleConsoleDrawer() {
  const drawer = $('#executionDrawer');
  if (drawer) drawer.classList.toggle('open');
}

function connectLogStream() {
  const term = $('#logStream');
  const drawerBody = $('#drawerBody');
  const statusPill = $('#logStatus');

  const es = new EventSource('/api/logs/stream');
  es.onopen = () => {
    if (statusPill) { statusPill.textContent = 'live'; statusPill.className = 'pill ok'; }
  };
  es.onerror = () => {
    if (statusPill) { statusPill.textContent = 'reconnecting…'; statusPill.className = 'pill warn'; }
  };
  es.onmessage = (event) => {
    try {
      const entry = JSON.parse(event.data);
      const line = `[${new Date(entry.timestamp).toLocaleTimeString()}] [${entry.level}] ${entry.message}\n`;

      if (term) {
        term.append(document.createTextNode(line));
        term.scrollTop = term.scrollHeight;
      }
      if (drawerBody) {
        const span = document.createElement('div');
        span.textContent = line.trim();
        drawerBody.append(span);
        drawerBody.scrollTop = drawerBody.scrollHeight;
      }
    } catch {
      // ignore parse errors
    }
  };
}

/* ------------------------------------------------------------- wiring up */
function wire() {
  // Navigation tabs
  $$('.nav-item').forEach(b => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  // Topbar triggers
  $('#refreshBtn')?.addEventListener('click', () => {
    const current = location.hash.slice(1) || 'dashboard';
    switchView(current);
    toast('Refreshed data');
  });

  $('#quickRunBtn')?.addEventListener('click', () => {
    switchView('planner');
    openConfirmationModal();
  });

  $('#consoleBtn')?.addEventListener('click', toggleConsoleDrawer);
  $('#btnCloseDrawer')?.addEventListener('click', () => $('#executionDrawer')?.classList.remove('open'));

  // Theme toggle
  $('#themeToggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
    try { localStorage.setItem('theme', isDark ? 'light' : 'dark'); } catch {}
  });

  // Planner controls
  $('#planBtn')?.addEventListener('click', runPlanPreview);
  $('#executeBtn')?.addEventListener('click', openConfirmationModal);
  $('#btnConfirmExecute')?.addEventListener('click', executeCreation);
  $('#btnCancelConfirmModal')?.addEventListener('click', () => $('#confirmModal')?.classList.remove('open'));
  $('#btnCloseConfirmModal')?.addEventListener('click', () => $('#confirmModal')?.classList.remove('open'));

  $('#asOf')?.addEventListener('change', runPlanPreview);
  $('#thursdayMode')?.addEventListener('change', runPlanPreview);

  $('#btnSimulateWindow')?.addEventListener('click', () => {
    const today = state.todayIso || new Date().toISOString().slice(0, 10);
    // Advance date to next Thursday + 1 day (Friday) to simulate following week
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
    const daysUntilNextThu = (4 - dow + 7) % 7 || 7;
    dt.setUTCDate(dt.getUTCDate() + daysUntilNextThu + 1);
    const simDate = dt.toISOString().slice(0, 10);
    const asOfInput = $('#asOf');
    if (asOfInput) asOfInput.value = simDate;
    toast(`Simulating creation window as of ${simDate}`, 'ok');
    runPlanPreview();
  });

  $('#btnResetPlannerWindow')?.addEventListener('click', () => {
    const asOfInput = $('#asOf');
    if (asOfInput) asOfInput.value = '';
    const thuMode = $('#thursdayMode');
    if (thuMode) thuMode.value = 'CURRENT';
    toast('Reset planner to current date and window', 'ok');
    runPlanPreview();
  });

  $('#plannerSelectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      const active = cfg.people.filter(p => p.enabled !== false);
      active.forEach(p => state.selectedKeys.add(p.key));
      updatePlannerMemberPill(active.length);
      renderPlannerPeople();
      runPlanPreview();
    });
  });

  $('#plannerDeselectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      state.selectedKeys.clear();
      const active = cfg.people.filter(p => p.enabled !== false);
      updatePlannerMemberPill(active.length);
      renderPlannerPeople();
      runPlanPreview();
    });
  });

  $('#btnTogglePlanMatrix')?.addEventListener('click', () => {
    $('#planMatrixWrap').style.display = 'block';
    $('#planListWrap').style.display = 'none';
    $('#btnTogglePlanMatrix').classList.add('active-tab-btn');
    $('#btnTogglePlanList').classList.remove('active-tab-btn');
  });

  $('#btnTogglePlanList')?.addEventListener('click', () => {
    $('#planMatrixWrap').style.display = 'none';
    $('#planListWrap').style.display = 'block';
    $('#btnTogglePlanList').classList.add('active-tab-btn');
    $('#btnTogglePlanMatrix').classList.remove('active-tab-btn');
  });

  // Burndown controls
  $('#loadBurndownBtn')?.addEventListener('click', loadBurndownMonth);

  // My Work controls
  $('#myWorkPersonSelect')?.addEventListener('change', refreshMyWork);
  $('#myWorkRefreshBtn')?.addEventListener('click', refreshMyWork);

  // Explorer controls
  $('#explorerPreset')?.addEventListener('change', () => {
    const preset = $('#explorerPreset').value;
    if (preset !== 'custom') refreshExplorer();
  });
  $('#explorerApplyBtn')?.addEventListener('click', refreshExplorer);
  $('#exploreRefreshBtn')?.addEventListener('click', refreshExplorer);
  $('#explorerResetBtn')?.addEventListener('click', () => {
    $('#explorerPreset').value = 'today_to_next_thursday';
    refreshExplorer();
  });
  $('#explorerSelectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      cfg.people.filter(p => p.enabled !== false).forEach(p => state.selectedExplorerKeys.add(p.key));
      renderExplorerUserPills(cfg);
      refreshExplorer();
    });
  });
  $('#explorerDeselectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      state.selectedExplorerKeys.clear();
      renderExplorerUserPills(cfg);
      refreshExplorer();
    });
  });
  $('#explorerMemberSearch')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    $$('#explorerUserPills .user-pill').forEach(p => {
      p.style.display = p.textContent.toLowerCase().includes(q) ? 'inline-flex' : 'none';
    });
  });
  $('#btnToggleMatrixView')?.addEventListener('click', () => {
    $('#explorerMatrixWrap').style.display = 'block';
    $('#explorerListWrap').style.display = 'none';
    $('#btnToggleMatrixView').style.fontWeight = '600';
    $('#btnToggleListView').style.fontWeight = 'normal';
  });
  $('#btnToggleListView')?.addEventListener('click', () => {
    $('#explorerMatrixWrap').style.display = 'none';
    $('#explorerListWrap').style.display = 'block';
    $('#btnToggleListView').style.fontWeight = '600';
    $('#btnToggleMatrixView').style.fontWeight = 'normal';
  });
  $('#explorerListSearch')?.addEventListener('input', () => {
    renderExplorerList(state.explorerData?.detailedTasks || []);
  });
  $('#explorerCreateMissingBtn')?.addEventListener('click', async () => {
    switchView('planner');
    runPlanPreview().then(() => openConfirmationModal());
  });

  // Modals close buttons
  $('#btnCloseDateInspectModal')?.addEventListener('click', () => $('#dateInspectModal')?.classList.remove('open'));
  $('#btnCloseDateInspectBtn')?.addEventListener('click', () => $('#dateInspectModal')?.classList.remove('open'));
  $('#btnCloseUserInspectModal')?.addEventListener('click', () => $('#userInspectModal')?.classList.remove('open'));
  $('#btnCloseUserInspectBtn')?.addEventListener('click', () => $('#userInspectModal')?.classList.remove('open'));
  $('#btnClosePersonModal')?.addEventListener('click', () => $('#personModal')?.classList.remove('open'));
  $('#btnCancelPersonModal')?.addEventListener('click', () => $('#personModal')?.classList.remove('open'));

  // Team controls
  $('#addPersonBtn')?.addEventListener('click', openAddPersonModal);
  $('#btnSavePersonModal')?.addEventListener('click', savePersonFromModal);
  $('#savePeopleBtn')?.addEventListener('click', savePeople);

  // Ad-hoc task creation modal
  $('#openAdHocModalBtn')?.addEventListener('click', () => openAdHocModal());
  $('#btnCloseAdHocModal')?.addEventListener('click', closeAdHocModal);
  $('#btnCancelAdHocModal')?.addEventListener('click', closeAdHocModal);
  $('#btnSubmitAdHocTask')?.addEventListener('click', submitAdHocTask);

  // Journal controls
  $('#exportCsv')?.addEventListener('click', () => window.open('/api/journal/export?format=csv', '_blank'));
  $('#exportJson')?.addEventListener('click', () => window.open('/api/journal/export?format=json', '_blank'));

  // Scheduler controls
  $('#schedToggle')?.addEventListener('change', e => toggleScheduler(e.target.checked));
  $('#schedSaveConfigBtn')?.addEventListener('click', saveSchedulerConfig);
  $('#schedRunNowBtn')?.addEventListener('click', runSchedulerNow);

  // Settings controls
  $('#saveSettingsBtn')?.addEventListener('click', saveSettings);
  $('#savePatBtn')?.addEventListener('click', savePat);
  $('#testConnBtn')?.addEventListener('click', testConnection);
  $('#btnRunCreationAll')?.addEventListener('click', () => {
    state.selectedKeys.clear();
    executeCreation();
  });
  $('#btnRepairAll')?.addEventListener('click', async () => {
    toast('Repairing incomplete relationships...');
    try {
      const res = await api.post('/tasks/execute', { all: true, dryRun: false });
      toast('Relations repaired', 'ok');
      refreshJournal();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#togglePatEye')?.addEventListener('click', () => {
    const input = $('#setPat');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Mobile drawer menu
  $('#menuBtn')?.addEventListener('click', () => {
    $('#sidebar')?.classList.toggle('open');
  });

  // Hash routing
  window.addEventListener('hashchange', () => {
    const v = location.hash.slice(1);
    if (v) switchView(v);
  });
}

/* ---------------------------------------------------------------- bootstrap */
async function bootstrap() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch {}

  wire();
  connectLogStream();

  const initial = location.hash.slice(1) || 'dashboard';
  switchView(initial);
}

document.addEventListener('DOMContentLoaded', bootstrap);
