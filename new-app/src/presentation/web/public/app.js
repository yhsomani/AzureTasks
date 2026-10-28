/**
 * Azure DevOps 3in1 Task Automation Studio — Modern Frontend Controller
 * Complete feature parity, reactive rendering, interactive charts, and live telemetry.
 */

/* ------------------------------------------------------------------ state */
const state = {
  currentView: 'dashboard',
  viewerMode: false,
  status: null,
  config: null,
  people: [],
  teamDirty: false,
  teamSaving: false,
  selectedKeys: new Set(),
  lifecycleKeys: new Set(),
  explorerData: null,
  selectedExplorerKeys: new Set(),
  burndownData: null,
  myWorkRequestVersion: 0,
  journal: [],
  scheduler: null,
  charts: { effort: null, status: null },
  overviewChartData: null,
  pendingPlan: null,
  dashboardPlan: null,
  pendingPlanSignature: null,
  planRequestVersion: 0,
  isExecuting: false,
  cache: new Map(), // SWR client-side cache
  abortControllers: new Map(), // Per-key abort controllers for active requests
  pendingReads: new Map(),
  latestReads: new Map(),
  readGeneration: 0,
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
    const cached = state.cache.get(url);
    const now = Date.now();
    if (!forceFresh && cached && (now - cached.timestamp < maxAgeMs)) {
      state.cache.delete(url);
      state.cache.set(url, cached);
      return cached.data;
    }
    if (!forceFresh && swr && cached && typeof options.onStale === 'function') {
      options.onStale(cached.data);
    }
    const requestKey = `${url}:${state.readGeneration}:${abortKey || ''}:${forceFresh ? 'fresh' : 'ordinary'}`;
    const pending = state.pendingReads.get(requestKey);
    if (pending) return pending;
    let controller;
    if (abortKey) {
      state.abortControllers.get(abortKey)?.abort();
      controller = new AbortController();
      state.abortControllers.set(abortKey, controller);
    }
    const generation = state.readGeneration;
    const owner = {};
    state.latestReads.set(url, owner);
    const request = (async () => {
      const res = await fetch(`/api${url}`, controller ? { signal: controller.signal } : {});
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (controller?.signal.aborted) throw new DOMException('Request superseded.', 'AbortError');
      if (generation === state.readGeneration && state.latestReads.get(url) === owner) {
        state.cache.delete(url);
        state.cache.set(url, { data: json.data, timestamp: Date.now() });
        while (state.cache.size > 50) state.cache.delete(state.cache.keys().next().value);
      }
      return json.data;
    })();
    state.pendingReads.set(requestKey, request);
    try {
      return await request;
    } finally {
      state.pendingReads.delete(requestKey);
      if (state.latestReads.get(url) === owner) state.latestReads.delete(url);
      if (abortKey && state.abortControllers.get(abortKey) === controller) {
        state.abortControllers.delete(abortKey);
      }
    }
  },

  async post(url, body) {
    if (state.viewerMode && !(url === '/tasks/plan' ||
      (['/tasks/close-today', '/tasks/activate-today'].includes(url) && body?.dryRun === true))) {
      throw new Error('Read-only viewer credentials cannot change Azure tasks, scheduling or settings.');
    }
    const preview = url === '/tasks/plan' ||
      (['/tasks/close-today', '/tasks/activate-today'].includes(url) && body?.dryRun === true);
    if (!preview) api.invalidateCache();
    try {
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
    } finally {
      if (!preview) api.invalidateCache();
    }
  },

  invalidateCache(pattern) {
    state.readGeneration += 1;
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

  const textSpan = document.createElement('span');
  textSpan.className = 'toast-msg';
  textSpan.textContent = msg;
  t.append(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = '✕';
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 200);
  };
  closeBtn.addEventListener('click', dismiss);
  t.append(closeBtn);

  stack.append(t);
  const timeoutMs = type === 'err' ? 8000 : 4000;
  setTimeout(dismiss, timeoutMs);
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

let previousActiveElement = null;

function showModal(selector, focusSelector) {
  const modal = $(selector);
  if (!modal) return;
  previousActiveElement = document.activeElement;
  modal.classList.add('open');
  if (focusSelector) {
    setTimeout(() => $(focusSelector)?.focus(), 50);
  } else {
    setTimeout(() => {
      const first = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      first?.focus();
    }, 50);
  }
}

function hideModal(target) {
  const modal = typeof target === 'string' ? $(target) : target;
  if (modal) modal.classList.remove('open');
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    try { 
      previousActiveElement.focus(); 
    } catch {
      // Element may have been removed from DOM; silently ignore focus failure
    }
    previousActiveElement = null;
  }
}

function trapModalFocus(e) {
  if (e.key !== 'Tab') return;
  const modal = document.querySelector('.modal-overlay.open');
  if (!modal) return;
  const focusable = Array.from(modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter(node => node.getClientRects().length > 0);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!modal.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
 
function handleModalEscapeKey(e) {
  if (e.key !== 'Escape') return;
  const modal = document.querySelector('.modal-overlay.open');
  if (!modal) return;
  e.preventDefault();
  hideModal(modal);
}
 
function validateForm(form) {
  const errors = {};
  const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
   
  inputs.forEach(input => {
    const errorId = input.getAttribute('aria-describedby');
    const errorEl = errorId ? document.getElementById(errorId) : null;
     
    if (!input.value.trim()) {
      errors[input.id] = `This field is required`;
      input.setAttribute('aria-invalid', 'true');
      if (errorEl) {
        errorEl.textContent = `This field is required`;
        errorEl.style.display = 'block';
      }
    } else if (input.type === 'email' && !isValidEmail(input.value)) {
      errors[input.id] = `Please enter a valid email address`;
      input.setAttribute('aria-invalid', 'true');
      if (errorEl) {
        errorEl.textContent = `Please enter a valid email address`;
        errorEl.style.display = 'block';
      }
    } else {
      input.setAttribute('aria-invalid', 'false');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    }
  });
   
  return Object.keys(errors).length === 0;
}
 
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
 
function focusFirstInvalidInput(form) {
  const invalidInput = form.querySelector('input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]');
  if (invalidInput) {
    invalidInput.focus();
  }
}

function isoDateInTimeZone(date = new Date(), timeZone = state.config?.timezone || 'Asia/Kolkata') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
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
  lifecycle: ['Task lifecycle', 'Current-workday activation and closure'],
  people: ['Team Management', 'Configured team members, roles, PODs, and source task overrides'],
  calendar: ['Work Calendar', 'Project holidays, planned member leave, and working capacity'],
  journal: ['Audit Log', 'Recorded task changes, verification and relation recovery'],
  scheduler: ['Scheduler', 'Automated weekday task generation daemon'],
  logs: ['Live Logs', 'Real-time server logs and event stream'],
  settings: ['Settings', 'Azure DevOps connection, Personal Access Token, and maintenance'],
};

const VIEW_GROUPS = {
  dashboard: 'Overview', mywork: 'Overview',
  explorer: 'Explore work', burndown: 'Explore work',
  planner: 'Create & automate', scheduler: 'Create & automate', lifecycle: 'Create & automate',
  people: 'Manage', calendar: 'Manage', settings: 'Manage',
  journal: 'Monitor', logs: 'Monitor',
};

function closeMobileNav(restoreFocus = false) {
  $('#sidebar')?.classList.remove('open');
  $('#navBackdrop')?.classList.remove('open');
  const trigger = $('#menuBtn');
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.setAttribute('aria-label', 'Open navigation');
  if (restoreFocus) trigger?.focus();
}

function handleHashNavigation() {
  const view = decodeURIComponent(location.hash.slice(1) || 'dashboard');
  if (VIEW_META[view] && state.currentView === view) return;
  switchView(VIEW_META[view] ? view : 'dashboard');
}

function switchView(view) {
  if (!VIEW_META[view]) view = 'dashboard';
  state.currentView = view;
  $$('.nav-item').forEach(b => {
    const active = b.dataset.view === view;
    b.classList.toggle('active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  closeMobileNav();
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

  const [title, subtitle] = VIEW_META[view];
  const vt = $('#viewTitle');
  const vs = $('#viewSubtitle');
  if (vt) vt.textContent = title;
  if (vs) vs.textContent = subtitle;
  const viewStatus = $('#viewStatus');
  if (viewStatus) viewStatus.textContent = `${title} view opened`;
  const breadcrumb = $('#viewBreadcrumb');
  if (breadcrumb) breadcrumb.textContent = `${VIEW_GROUPS[view]} / ${title}`;
  if (location.hash !== `#${view}`) location.hash = view;
  const forceFresh = Boolean(state.isDataDirty);
  if (view === 'dashboard') refreshDashboard();
  if (view === 'burndown') refreshBurndown({ forceFresh });
  if (view === 'mywork') refreshMyWork({ forceFresh });
  if (view === 'explorer') refreshExplorer({ forceFresh });
  if (view === 'planner') {
    renderPlannerPeople().then(runPlanPreview).catch(err => toast(err.message, 'err'));
  }
  if (view === 'people') loadPeople();
  if (view === 'calendar') loadCalendar();
  if (view === 'journal') refreshJournal();
  if (view === 'scheduler') refreshScheduler();
  if (view === 'settings') fillSettings();
  if (view === 'lifecycle') renderLifecycleScope().catch(error => toast(error.message, 'err'));

  // Always refresh connection status when navigating to any view
  refreshStatus();
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
  }).catch(err => {
    if ($('#kpiPeople')) $('#kpiPeople').textContent = 'Unavailable';
    if ($('#kpiMode')) $('#kpiMode').textContent = 'Configuration unavailable';
    console.warn('Dashboard configuration unavailable:', err.message);
  });

  // 2. Scheduler state
  api.get('/scheduler', { swr: true, maxAgeMs: 15000 }).then(sched => {
    state.scheduler = sched;
    const ks = $('#kpiSched');
    const kh = $('#kpiSchedHint');
    if (ks) ks.textContent = sched.running ? 'Running' : 'Disabled';
    if (kh) kh.textContent = sched.nextRun ? `Next: ${new Date(sched.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'weekdays 09:30';
  }).catch(err => {
    if ($('#kpiSched')) $('#kpiSched').textContent = 'Unavailable';
    if ($('#kpiSchedHint')) $('#kpiSchedHint').textContent = err.message;
  });

  const dp = $('#dashboardPlan');
  if (dp) dp.textContent = 'Loading current-week coverage...';

  // 4. Timeline journal
  api.get('/journal?limit=6', { swr: true, maxAgeMs: 20000 }).then(j => {
    renderTimeline(j.entries);
  }).catch(err => {
    const timeline = $('#dashboardJournal');
    if (timeline) timeline.textContent = `Audit history unavailable: ${err.message}`;
  });

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
    if (dp) {
      const summary = data.summary;
      dp.textContent = summary
        ? `${summary.existingCombinations} covered, ${summary.missingCombinations} missing, ${summary.duplicateCombinations} duplicate member-days in the current week.`
        : 'Coverage details unavailable.';
    }
  }).catch(err => {
    // A failed Azure read is not an empty workload or a different date range.
    // Surface the error rather than swallowing it and leaving stale statistics.
    if (insightsContainer) {
      insightsContainer.textContent = `Live task coverage unavailable: ${err.message}. Check Azure DevOps connection and permissions.`;
    }
    state.explorerData = null;
    if (dp) dp.textContent = `Coverage unavailable: ${err.message}`;
  });

  // 6. Daily Pull Request Tracking
  refreshDailyPrCounts();
}

let dailyPrTimer = null;

async function refreshDailyPrCounts(options = {}) {
  const forceFresh = Boolean(options.forceFresh);
  const container = $('#dailyPrContainer');
  const kpiVal = $('#kpiPrsToday');
  const lastUpdated = $('#dailyPrLastUpdated');

  if (container && (!state.dailyPrData || forceFresh)) {
    container.innerHTML = `
      <div style="padding:16px;">
        <div class="skeleton-row skeleton" style="height:32px; margin-bottom:8px;"></div>
        <div class="skeleton-row skeleton"></div>
      </div>
    `;
  }

  try {
    const data = await api.get('/github/daily-prs', {
      swr: !forceFresh,
      forceFresh,
      maxAgeMs: 25000,
      abortKey: 'dashboard-daily-prs',
      onStale: (stale) => {
        state.dailyPrData = stale;
        renderDailyPrTracking(stale);
      },
    });
    state.dailyPrData = data;
    renderDailyPrTracking(data);
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (kpiVal) kpiVal.textContent = '—';
    if (lastUpdated) lastUpdated.textContent = 'Failed to load';
    if (container) {
      container.innerHTML = `<p class="muted" style="color:var(--danger); padding:16px;">Unable to load daily PR activity: ${escapeHtml(err.message)}</p>`;
    }
  }

  // Setup auto-refresh timer (every 60s when on dashboard in browser environment)
  if (!dailyPrTimer && typeof setInterval === 'function') {
    dailyPrTimer = setInterval(() => {
      if (state.currentView === 'dashboard') {
        refreshDailyPrCounts({ forceFresh: true });
      }
    }, 60000);
  }
}

function renderDailyPrTracking(data) {
  const kpiVal = $('#kpiPrsToday');
  const kpiHint = $('#kpiPrsHint');
  const lastUpdated = $('#dailyPrLastUpdated');
  const container = $('#dailyPrContainer');

  if (!data || !container) return;

  const total = Number.isFinite(data.totalPrsToday) ? data.totalPrsToday : 0;
  const totalOpen = Number.isFinite(data.totalOpenPrsToday) ? data.totalOpenPrsToday : 0;
  const totalMerged = Number.isFinite(data.totalMergedPrsToday) ? data.totalMergedPrsToday : 0;

  if (kpiVal) kpiVal.textContent = total;
  if (kpiHint) kpiHint.textContent = `${totalOpen} Open · ${totalMerged} Merged · ${data.targetDate || 'Today'}`;
  if (lastUpdated) lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  const members = data.members || [];
  if (members.length === 0) {
    container.innerHTML = '<p class="empty-state muted">No PR activity available. Add team members and map their GitHub accounts in Team.</p>';
    return;
  }

  const table = el('table', { class: 'table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { style: 'width:24%;' }, 'Team Member'),
      el('th', { style: 'text-align:center; width:16%;' }, 'PRs Raised Today'),
      el('th', { style: 'width:30%;' }, 'Open PR'),
      el('th', { style: 'width:30%;' }, 'Merged PR'),
    ])),
  ]);

  const tbody = el('tbody');
  for (const m of members) {
    const prCount = m.prCount || 0;
    const openList = m.openPrs || (m.pullRequests ? m.pullRequests.filter(p => p.state === 'open') : []);
    const mergedList = m.mergedPrs || (m.pullRequests ? m.pullRequests.filter(p => Boolean(p.mergedAt)) : []);
    const badgeClass = prCount > 0 ? 'badge SUCCESS' : 'badge default';

    // Helper to render a list of PR links
    const renderPrList = (prItems, emptyText) => {
      if (!m.githubUsername) {
        return el('span', { class: 'muted small' }, 'No GitHub account mapped');
      }
      if (!prItems || prItems.length === 0) {
        return el('span', { class: 'muted small' }, emptyText);
      }
      const listContainer = el('div', { style: 'display:flex; flex-direction:column; gap:4px;' });
      for (const pr of prItems) {
        const repoTag = pr.repositoryName ? `[${pr.repositoryName}] ` : '';
        const prRow = el('div', { class: 'small', style: 'display:flex; align-items:center; gap:6px;' }, [
          el('a', {
            href: pr.htmlUrl,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'ado-link',
            style: 'font-weight:600; text-decoration:none;',
          }, `${repoTag}#${pr.number}`),
          el('span', {
            style: 'max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
            title: pr.title,
          }, pr.title),
        ]);
        listContainer.append(prRow);
      }
      return listContainer;
    };

    const openCellContent = el('div', {}, [
      openList.length > 0
        ? el('div', { style: 'margin-bottom:4px;' }, el('span', { class: 'pill ok', style: 'font-size:11px;' }, `${openList.length} Open`))
        : null,
      renderPrList(openList, '0 open'),
    ]);

    const mergedCellContent = el('div', {}, [
      mergedList.length > 0
        ? el('div', { style: 'margin-bottom:4px;' }, el('span', { class: 'pill merged' }, `${mergedList.length} Merged`))
        : null,
      renderPrList(mergedList, '0 merged'),
    ]);

    const memberIdentity = el('div', {}, [
      el('strong', {}, m.name || m.key),
      m.githubUsername ? el('span', { class: 'pill', style: 'margin-left:6px; font-size:11px;' }, `@${m.githubUsername}`) : null,
    ]);

    tbody.append(el('tr', {}, [
      el('td', {}, memberIdentity),
      el('td', { style: 'text-align:center;' }, el('span', { class: badgeClass }, String(prCount))),
      el('td', { style: 'vertical-align:top;' }, openCellContent),
      el('td', { style: 'vertical-align:top;' }, mergedCellContent),
    ]));
  }

  // Footer summary row (Total)
  const tfoot = el('tfoot', {}, el('tr', { style: 'font-weight:700; background:var(--bg-elev-2);' }, [
    el('td', {}, 'Total PRs Created / Updated Today'),
    el('td', { style: 'text-align:center;' }, el('span', { class: total > 0 ? 'badge SUCCESS' : 'badge default' }, String(total))),
    el('td', {}, el('span', { class: 'pill ok' }, `${totalOpen} Total Open`)),
    el('td', {}, el('span', { class: 'pill merged' }, `${totalMerged} Total Merged`)),
  ]));

  table.append(tbody);
  table.append(tfoot);

  container.innerHTML = '';
  container.append(el('div', { class: 'table-wrap' }, table));
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
        el('span', { class: 'muted small' }, planned.length ? `${planned.length} to create` :
          p.status === 'SOURCE_NOT_FOUND' ? 'Source unavailable' : 'Nothing to create'),
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
    container.innerHTML = '<p class="empty-state muted">No members in this preview. Check enabled members in Team, then review the planning window.</p>';
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
    container.innerHTML = '<p class="empty-state muted">No execution history yet. Reviewed task creation and repairs will appear here when recorded.</p>';
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
  if (!Array.isArray(data.matrix) || data.matrix.length === 0) {
    container.textContent = 'No task data for this period. Check the selected dates and Azure DevOps connection.';
    return;
  }

  const insights = [];
  data.matrix.forEach(row => {
    if (row.stats.missingCount > 0) {
      insights.push(`<li><span class="insight-label warn">Missing tasks:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.missingCount} missing daily task(s) in this period.</li>`);
    }
    if ((row.stats.stateCounts['Active'] || 0) > 3) {
      insights.push(`<li><span class="insight-label info">High WIP:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.stateCounts['Active']} active tasks concurrently.</li>`);
    }
    if (row.stats.duplicateCount > 0) {
      insights.push(`<li><span class="insight-label bad">Duplicates:</span> <strong>${escapeHtml(row.person.name)}</strong> has ${row.stats.duplicateCount} duplicate tasks requiring review.</li>`);
    }
  });

  if (insights.length === 0) {
    container.textContent = 'No missing-task or duplicate warnings in the loaded Azure work items. Work completion has not been verified.';
  } else {
    container.innerHTML = `<ul class="insight-list">${insights.slice(0, 5).join('')}</ul>`;
  }
}

function renderOverviewCharts(data) {
  if (data) state.overviewChartData = data;
  if (typeof Chart === 'undefined' || !data) return;
  const styles = getComputedStyle(document.documentElement);
  const token = (name, fallback = styles.color) => styles.getPropertyValue(name).trim() || fallback;
  const palette = {
    accent: token('--accent'),
    warn: token('--warn'),
    ok: token('--ok'),
    info: token('--info', token('--accent')),
    muted: token('--muted'),
    text: token('--text'),
    border: token('--border'),
    surface: token('--surface'),
  };
  const animation = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 350 };
  const tooltip = {
    backgroundColor: palette.surface,
    titleColor: palette.text,
    bodyColor: palette.text,
    borderColor: palette.border,
    borderWidth: 1,
  };

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
          backgroundColor: [palette.accent, palette.warn, palette.ok, palette.info, palette.muted],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation,
        plugins: {
          legend: { position: 'bottom', labels: { color: palette.muted, font: { size: 12 }, usePointStyle: true } },
          tooltip,
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
        let hasRecordedHours = false;
        data.matrix.forEach(row => {
          const cell = row.cells[d.dateIso];
          for (const task of cell?.tasks || []) {
            if (task.completedWork != null) {
              dailyWork += task.completedWork;
              hasRecordedHours = true;
            }
          }
        });
        // Chart.js skips null rather than drawing a fictional zero-hours bar.
        values.push(hasRecordedHours ? dailyWork : null);
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
          backgroundColor: palette.accent,
          borderRadius: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation,
        plugins: { legend: { display: false }, tooltip },
        scales: {
          y: { beginAtZero: true, grid: { color: palette.border }, ticks: { color: palette.muted }, border: { color: palette.border } },
          x: { grid: { display: false }, ticks: { color: palette.muted }, border: { color: palette.border } },
        },
      },
    });
  }
}

/* ------------------------------------------------------------- daily burndown */
async function refreshBurndown(options = {}) {
  const selector = $('#burndownMonthSelector');
  if (selector && !selector.value) {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    selector.value = ym;
  }
  loadBurndownMonth(options);
}

async function loadBurndownMonth(options = {}) {
  const forceFresh = options.forceFresh === true;
  const container = $('#burndownMatrixContainer');
  if (!container) return;
  const ym = $('#burndownMonthSelector')?.value;
  if (!ym) return;

  const [y, m] = ym.split('-');
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  const start = `${ym}-01`;
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const url = `/explorer?startDate=${start}&endDate=${end}`;

  if (!state.burndownData || forceFresh) {
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
      swr: !forceFresh,
      forceFresh,
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
    container.innerHTML = `<p class="muted" style="color:var(--danger); padding:24px;">Unable to load work tracking: ${escapeHtml(err.message)}</p>`;
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
    const completedLabel = row.stats.totalCompletedWork == null
      ? 'Not recorded'
      : `${row.stats.totalCompletedWork}h${row.stats.unrecordedCompletedWorkTasks ? ' (partial)' : ''}`;
    tr.append(el('td', { style: 'font-weight:bold; color:var(--accent);' }, completedLabel));
    tr.append(el('td', {}, String(row.stats.createdCount)));

    dates.forEach(d => {
      const cell = row.cells[d.dateIso];
      if (cell.isWeekend) {
        tr.append(el('td', { class: 'cell-status cell-weekend' }, 'WO'));
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const recorded = cell.tasks.filter(t => t.completedWork != null);
        const completed = recorded.reduce((sum, t) => sum + t.completedWork, 0);
        tr.append(el('td', { class: 'cell-status cell-created' },
          el('button', {
            type: 'button',
            class: 'matrix-cell-action',
            title: `Inspect ${cell.tasks.length} task(s) for ${row.person.name} · ${d.formattedDate}`,
            onclick: () => openDateInspectModal(cell, row.person),
          }, recorded.length ? `${completed}h${recorded.length < cell.tasks.length ? '*' : ''}` : '—')));
      } else {
        tr.append(el('td', { class: 'cell-status cell-missing' },
          el('button', {
            type: 'button',
            class: 'matrix-cell-action',
            title: `Inspect missing task for ${row.person.name} · ${d.formattedDate}`,
            onclick: () => openDateInspectModal(cell, row.person),
          }, '—')));
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
async function refreshMyWork(options = {}) {
  const requestVersion = ++state.myWorkRequestVersion;
  const forceFresh = options.forceFresh === true;
  const cfg = await ensureConfig(forceFresh);
  if (requestVersion !== state.myWorkRequestVersion) return;
  const select = $('#myWorkPersonSelect');
  const activePeople = cfg.people.filter(p => p.enabled !== false);

  if (select) {
    const currentVal = select.value;
    const currentOptionKeys = Array.from(select.options).map(o => o.value);
    const activeKeys = activePeople.map(p => p.key);

    if (currentOptionKeys.join(',') !== activeKeys.join(',')) {
      select.innerHTML = '';
      activePeople.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.key;
        opt.textContent = `${p.name} (${p.assignedTo})`;
        select.append(opt);
      });
      if (options.targetKey && activeKeys.includes(options.targetKey)) {
        select.value = options.targetKey;
      } else if (activeKeys.includes(currentVal)) {
        select.value = currentVal;
      }
    } else if (options.targetKey && activeKeys.includes(options.targetKey)) {
      select.value = options.targetKey;
    }
  }

  const personKey = select?.value || activePeople[0]?.key;
  if (!personKey) {
    $('#myWorkContainer').innerHTML = '<p class="muted">No configured team members.</p>';
    return;
  }

  const url = `/explorer?preset=current_month&users=${encodeURIComponent(personKey)}`;
  const container = $('#myWorkContainer');
  if (container) {
    const cached = !forceFresh ? state.cache.get(url) : null;
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
      swr: !forceFresh,
      forceFresh,
      maxAgeMs: 30000,
      abortKey: 'mywork-query',
      onStale: (stale) => {
        if (requestVersion === state.myWorkRequestVersion && $('#myWorkPersonSelect')?.value === personKey) {
          renderMyWorkContent(stale, personKey);
        }
      },
    });
    if (requestVersion !== state.myWorkRequestVersion || $('#myWorkPersonSelect')?.value !== personKey) return;
    renderMyWorkContent(data, personKey);
  } catch (err) {
    if (requestVersion !== state.myWorkRequestVersion || err.name === 'AbortError') return;
    if (container) container.innerHTML = `<p class="muted" style="color:var(--danger);">${escapeHtml(err.message)}</p>`;
  }
}

function renderMyWorkContent(data, personKey) {
  const container = $('#myWorkContainer');
  if (!container) return;

  const targetKey = String(personKey || '').trim().toLowerCase();
  const myTasks = (data.detailedTasks || []).filter(t => 
    t.taskId && (
      t.person?.key?.toLowerCase() === targetKey ||
      t.person?.assignedTo?.toLowerCase() === targetKey ||
      t.person?.name?.toLowerCase() === targetKey
    )
  );
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
      el('td', {}, el('a', { href: t.url || getAdoWorkItemUrl(t.taskId), target: '_blank', style: 'color:var(--accent); font-weight:600;' }, `#${t.taskId}`)),
      el('td', { class: 'title-cell' }, t.title || '—'),
      el('td', {}, el('span', { class: `state-tag state-${stateCls}` }, t.state || 'New')),
      el('td', {}, t.completedWork == null ? 'Not recorded' : `${t.completedWork}h`),
      el('td', {}, el('a', { href: t.url || getAdoWorkItemUrl(t.taskId), target: '_blank', class: 'btn small ghost' }, 'Open in ADO ↗')),
    ]));
  });
  table.append(tbody);

  container.innerHTML = '';
  container.append(el('div', { class: 'table-wrap' }, table));
}

/* ------------------------------------------------------------ task explorer */
function mergeExplorerSnapshots(snapshots) {
  const first = snapshots[0];
  const numeric = ['expectedCombinations', 'existingCombinations', 'missingCombinations',
    'duplicateCombinations', 'recordedCompletedWorkTasks', 'unrecordedCompletedWorkTasks'];
  const summary = { ...first.summary, stateCounts: { ...first.summary.stateCounts } };
  for (const key of numeric) summary[key] = snapshots.reduce((sum, item) => sum + (item.summary[key] || 0), 0);
  for (const key of Object.keys(summary.stateCounts)) {
    summary.stateCounts[key] = snapshots.reduce((sum, item) => sum + (item.summary.stateCounts[key] || 0), 0);
  }
  for (const key of ['totalCompletedWork', 'totalRemainingWork']) {
    summary[key] = snapshots.every(item => item.summary[key] !== null && item.summary[key] !== undefined)
      ? snapshots.reduce((sum, item) => sum + item.summary[key], 0) : null;
  }
  summary.totalSelectedUsers = snapshots.reduce((sum, item) => sum + item.users.length, 0);
  summary.overallCoveragePercent = summary.expectedCombinations
    ? Math.round(summary.existingCombinations * 10000 / summary.expectedCombinations) / 100 : 0;
  return {
    dateRange: first.dateRange, dates: first.dates, summary,
    users: snapshots.flatMap(item => item.users),
    matrix: snapshots.flatMap(item => item.matrix),
    detailedTasks: snapshots.flatMap(item => item.detailedTasks),
    warnings: snapshots.flatMap(item => item.warnings || []),
  };
}

async function refreshExplorer(options = {}) {
  const requestVersion = ++state.explorerRequestVersion || (state.explorerRequestVersion = 1);
  const forceFresh = options.forceFresh === true;
  const cfg = await ensureConfig(forceFresh);
  if (requestVersion !== state.explorerRequestVersion) return;
  renderExplorerUserPills(cfg);
  const keys = [...state.selectedExplorerKeys];
  const matrixWrap = $('#explorerMatrixWrap');
  const stamp = $('#explorerLastRefresh');
  if (!keys.length) {
    state.explorerData = null;
    if (matrixWrap) matrixWrap.textContent = 'Select at least one team member to view task coverage.';
    if (stamp) stamp.textContent = 'No members selected';
    renderExplorerList([]);
    renderExplorerKpis({
      totalSelectedUsers: 0, totalWorkingDates: 0, expectedCombinations: 0,
      existingCombinations: 0, missingCombinations: 0, duplicateCombinations: 0,
      overallCoveragePercent: 0, stateCounts: {},
    });
    return;
  }

  const preset = $('#explorerPreset')?.value || 'today_to_next_thursday';
  const start = $('#explorerStart')?.value;
  const end = $('#explorerEnd')?.value;
  let query = `preset=${encodeURIComponent(preset)}`;
  if (preset === 'custom' && start && end) {
    query = `startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
  }
  const selected = new Set(keys);
  const completed = new Map();
  const failures = new Map();
  const progress = () => {
    if (requestVersion !== state.explorerRequestVersion) return;
    const finished = completed.size + failures.size;
    if (stamp) stamp.textContent = `Loaded ${finished} of ${keys.length} members${failures.size ? ` · ${failures.size} failed` : ''}`;
    if (completed.size) {
      const merged = mergeExplorerSnapshots(keys.filter(key => completed.has(key)).map(key => completed.get(key)));
      state.explorerData = merged;
      renderExplorerKpis(merged.summary);
      renderExplorerMatrix(merged);
      renderExplorerList(merged.detailedTasks);
      if (matrixWrap && finished < keys.length) {
        const pending = document.createElement('p');
        pending.className = 'muted small';
        pending.setAttribute('role', 'status');
        pending.textContent = `Loading remaining members… ${finished}/${keys.length}`;
        matrixWrap.prepend(pending);
      }
      if (completed.size === 1 && merged.dateRange) {
        if ($('#explorerStart')) $('#explorerStart').value = merged.dateRange.startDate;
        if ($('#explorerEnd')) $('#explorerEnd').value = merged.dateRange.endDate;
      }
    }
    if (finished === keys.length && failures.size && matrixWrap) {
      const notice = document.createElement('p');
      notice.className = 'muted';
      notice.setAttribute('role', 'alert');
      notice.textContent = `${failures.size} member(s) could not load. Displayed totals cover only loaded members. Retry with Refresh.`;
      matrixWrap.prepend(notice);
    }
    if (finished === keys.length && !failures.size && stamp) stamp.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  };
  if (matrixWrap) matrixWrap.innerHTML = '<div role="status" class="muted" style="padding:24px;">Loading members… 0/' + keys.length + '</div>';
  if (stamp) stamp.textContent = `Loading 0 of ${keys.length} members`;
  state.explorerData = null;

  // Limit parallel Azure queries; render each completed member without waiting for the slowest.
  let cursor = 0;
  const worker = async () => {
    while (cursor < keys.length && requestVersion === state.explorerRequestVersion) {
      const key = keys[cursor++];
      if (!selected.has(key)) continue;
      try {
        const data = await api.get(`/explorer?${query}&users=${encodeURIComponent(key)}`, {
          swr: false, forceFresh, maxAgeMs: 30000,
        });
        if (requestVersion !== state.explorerRequestVersion) return;
        completed.set(key, data);
      } catch (err) {
        if (requestVersion !== state.explorerRequestVersion) return;
        failures.set(key, err);
      }
      progress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, keys.length) }, () => worker()));
  if (requestVersion !== state.explorerRequestVersion) return;
  if (!completed.size && matrixWrap) {
    matrixWrap.textContent = `Unable to load selected members. ${[...failures.values()][0]?.message || 'Please retry.'}`;
  }
}

function renderExplorerUserPills(cfg) {
  const container = $('#explorerUserPills');
  if (!container) return;
  const active = cfg.people.filter(p => p.enabled !== false);

  // Ensure every active person is selected unless explicitly deselected by user
  active.forEach(p => {
    if (!state.deselectedExplorerKeys || !state.deselectedExplorerKeys.has(p.key)) {
      state.selectedExplorerKeys.add(p.key);
    }
  });

  container.innerHTML = '';
  active.forEach(p => {
    const on = state.selectedExplorerKeys.has(p.key);
    const pill = el('button', {
      type: 'button',
      'aria-pressed': String(on),
      'data-member-key': p.key,
      class: `user-pill ${on ? 'on' : ''}`,
      onclick: () => {
        if (state.selectedExplorerKeys.has(p.key)) {
          state.selectedExplorerKeys.delete(p.key);
          if (!state.deselectedExplorerKeys) state.deselectedExplorerKeys = new Set();
          state.deselectedExplorerKeys.add(p.key);
        } else {
          state.selectedExplorerKeys.add(p.key);
          if (state.deselectedExplorerKeys) state.deselectedExplorerKeys.delete(p.key);
        }
        renderExplorerUserPills(cfg);
        Array.from(container.querySelectorAll('button.user-pill')).find(button => button.dataset.memberKey === p.key)?.focus();
        refreshExplorer({ forceFresh: true });
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
    tr.append(el('td', { class: 'sticky-col' }, [
      el('button', {
        class: 'matrix-cell-action',
        type: 'button',
        title: `Inspect tasks assigned to ${row.person.name}`,
        onclick: () => openUserInspectModal(row),
      }, [
        el('span', { style: 'font-weight:600; color:var(--accent);' }, `${row.person.name} ↗`),
        el('span', { class: 'muted small' }, `${row.stats.createdCount}/${row.stats.totalWorkingDays} (${row.stats.coveragePercent}%)`),
      ]),
    ]));

    dates.forEach(d => {
      const cell = row.cells[d.dateIso];
      if (cell.isWeekend) {
        tr.append(el('td', { class: 'cell-status cell-weekend' }, 'WO'));
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const cls = cell.status === 'DUPLICATE' ? 'cell-duplicate' : 'cell-created';
        const txt = cell.tasks.length > 1 ? `x${cell.tasks.length}` : '✓';
        const inspect = el('button', {
          type: 'button',
          class: 'matrix-cell-action',
          title: `Inspect task #${cell.primaryTask?.id || ''} for ${row.person.name}`,
          onclick: () => openDateInspectModal(cell, row.person),
        }, txt);
        tr.append(el('td', { class: `cell-status ${cls}` }, inspect));
      } else if (cell.status === 'MISSING') {
        const inspect = el('button', {
          type: 'button',
          class: 'matrix-cell-action',
          title: `Inspect missing task for ${row.person.name}`,
          onclick: () => openDateInspectModal(cell, row.person),
        }, 'Inspect');
        tr.append(el('td', { class: 'cell-status cell-missing' }, inspect));
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
    let actionEl = document.createTextNode('—');
    if (t.url) {
      actionEl = el('a', { href: t.url, target: '_blank', class: 'btn small ghost' }, 'Open ↗');
    } else if (t.status === 'MISSING' && t.isEligibleForCreation === true && t.person?.key && t.dateIso) {
      actionEl = el('button', {
        class: 'btn small primary',
        onclick: () => createSingleCellTask(t.person.key, t.dateIso, t.person.name, t.formattedDate),
      }, '+ Create');
    }

    const tr = el('tr', {}, [
      el('td', { style: 'font-weight:600;' }, t.formattedDate),
      el('td', {}, t.person.name),
      el('td', {}, t.taskId ? el('a', { href: t.url || '#', target: '_blank', style: 'color:var(--accent); font-weight:600;' }, `#${t.taskId}`) : '—'),
      el('td', { class: 'title-cell' }, t.title || 'Missing Task'),
      el('td', {}, t.state ? el('span', { class: `state-tag state-${t.state.toLowerCase()}` }, t.state) : '—'),
      el('td', {}, t.completedWork != null ? `${t.completedWork}h` : 'Not recorded'),
      el('td', {}, badge(t.status)),
      el('td', {}, actionEl),
    ]);
    tbody.append(tr);
  });
}

// One write per member/date at a time; Azure idempotency is also enforced in
// the backend, but rapid UI clicks must not initiate overlapping requests.
const pendingExplorerCreation = new Set();

async function createSingleCellTask(personKey, dateIso, personName, formattedDate) {
  const key = `${personKey}:${dateIso}`;
  if (pendingExplorerCreation.has(key)) return false;
  if (!window.confirm(`Create a real Azure DevOps task for ${personName || personKey} on ${formattedDate || dateIso}? This action writes to the configured project.`)) {
    return false;
  }
  pendingExplorerCreation.add(key);
  try {
    toast(`Creating task for ${personName || personKey} on ${formattedDate || dateIso}...`, 'warn');
    const res = await api.post('/tasks/adhoc', {
      confirm: true,
      personKey,
      targetIsoDate: dateIso,
    });
    if (!res?.task?.id) throw new Error('Azure DevOps did not return a created work-item ID.');
    if (res.auditWarning) {
      toast(`Created task #${res.task.id}, but the audit needs attention: ${res.auditWarning}`, 'warn');
    } else {
      toast(`Created Azure task #${res.task.id} for ${personName || personKey}`, 'ok');
    }
    await Promise.allSettled([
      refreshExplorer({ forceFresh: true }),
      runPlanPreview(),
      state.currentView === 'mywork' ? refreshMyWork({ forceFresh: true }) : Promise.resolve(),
    ]);
    return true;
  } catch (err) {
    toast(`Failed to create task: ${err.message}`, 'err');
    return false;
  } finally {
    pendingExplorerCreation.delete(key);
  }
}

/* ------------------------------------------------------------- inspect modals */
function openDateInspectModal(cell, person) {
  const modal = $('#dateInspectModal');
  if (!modal) return;
  $('#dateInspectTitle').textContent = `${person.name} — ${cell.formattedDate} (${cell.dayOfWeek})`;

  const sumBox = $('#dateInspectSummary');
  if (sumBox) {
    const isDup = (cell.tasks && cell.tasks.length > 1) || cell.status === 'DUPLICATE';
    const statusText = isDup ? 'DUPLICATE' : (cell.tasks && cell.tasks.length === 1 ? 'CREATED' : cell.status);
    const pillClass = isDup ? 'warn' : (statusText === 'CREATED' ? 'ok' : 'warn');
    sumBox.innerHTML = `
      <span class="pill ${pillClass}">${statusText}</span>
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
            `State: ${t.state} | Completed: ${t.completedWork == null ? 'Not recorded' : `${t.completedWork}h`} | Remaining: ${t.remainingWork == null ? 'Not recorded' : `${t.remainingWork}h`}`),
        ]));
      });
    } else {
      cList.innerHTML = '<p class="muted small">No work items created for this date.</p>';
    }
  }

  const mList = $('#dateInspectMissingList');
  const createSingleBtn = $('#btnCreateSingleMissingTask');
  if (mList) {
    mList.innerHTML = '';
    if (cell.status === 'MISSING') {
      mList.innerHTML = `
        <div class="inspect-warning">
          Task is missing for <strong>${escapeHtml(person.name)}</strong> on ${cell.formattedDate}.
          ${cell.isEligibleForCreation ? 'This date is within the current creation window and eligible to be created.' : 'This date is outside the rolling window.'}
        </div>
      `;
      if (createSingleBtn) {
        createSingleBtn.style.display = cell.isEligibleForCreation ? 'inline-flex' : 'none';
        createSingleBtn.onclick = async () => {
          createSingleBtn.disabled = true;
          createSingleBtn.textContent = 'Creating in ADO...';
          try {
            if (await createSingleCellTask(person.key, cell.dateIso, person.name, cell.formattedDate)) {
              hideModal('#dateInspectModal');
            }
          } finally {
            createSingleBtn.disabled = false;
            createSingleBtn.textContent = 'Create Task for this Date';
          }
        };
      }
    } else {
      mList.innerHTML = '<p class="muted small">No missing task flagged.</p>';
      if (createSingleBtn) createSingleBtn.style.display = 'none';
    }
  }

  showModal('#dateInspectModal', '#btnCloseDateInspectModal');
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
      <div class="stat-chip"><b>${row.stats.totalCompletedWork == null ? 'Not recorded' : `${row.stats.totalCompletedWork}h${row.stats.unrecordedCompletedWorkTasks ? ' (partial)' : ''}`}</b><span>Completed Work</span></div>
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

  showModal('#userInspectModal', '#btnCloseUserInspectModal');
}

/* ----------------------------------------------------------------- planner */
async function renderPlannerPeople() {
  const cfg = await ensureConfig();
  const picker = $('#personPicker');
  if (!picker) return;
  picker.innerHTML = '';
  const active = cfg.people.filter(p => p.enabled !== false);
  if (!active.length) {
    picker.append(el('p', { class: 'muted' }, 'No enabled team members. Add members in Team before creating tasks.'));
    return;
  }

  // Ensure every active person is selected unless explicitly deselected by user
  active.forEach(p => {
    if (!state.deselectedKeys || !state.deselectedKeys.has(p.key)) {
      state.selectedKeys.add(p.key);
    }
  });

  updatePlannerMemberPill(active.length);

  for (const p of active) {
    const on = state.selectedKeys.has(p.key);
    const chip = el('button', {
      type: 'button',
      'aria-pressed': String(on),
      'data-member-key': p.key,
      class: `person-chip ${on ? 'on' : ''}`,
      onclick: async () => {
        if (state.selectedKeys.has(p.key)) {
          state.selectedKeys.delete(p.key);
          if (!state.deselectedKeys) state.deselectedKeys = new Set();
          state.deselectedKeys.add(p.key);
        } else {
          state.selectedKeys.add(p.key);
          if (state.deselectedKeys) state.deselectedKeys.delete(p.key);
        }
        updatePlannerMemberPill(active.length);
        await renderPlannerPeople();
        Array.from(picker.querySelectorAll('.person-chip')).find(button => button.dataset.memberKey === p.key)?.focus();
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
    pill.textContent = 'No members selected';
    pill.className = 'pill warn';
  } else {
    pill.textContent = `${count} of ${totalActive} selected`;
    pill.className = 'pill';
  }
}

function plannerSelectionSignature() {
  return JSON.stringify({
    people: [...state.selectedKeys].sort(),
    asOf: $('#asOf')?.value || '',
    thursdayMode: $('#thursdayMode')?.value || 'CURRENT',
  });
}

function setPlannerExecuteReady(ready) {
  const button = $('#executeBtn');
  if (button) {
    button.disabled = !ready;
    button.title = ready ? 'Review exact tasks before creation' : 'Preview pending tasks before creating';
  }
}

async function runPlanPreview() {
  const matrixWrap = $('#planMatrixWrap');
  const results = $('#planResults');
  const statusPill = $('#plannerAutoRefreshStatus');
  const signature = plannerSelectionSignature();
  const requestVersion = ++state.planRequestVersion;
  state.pendingPlan = null;
  state.pendingPlanSignature = null;
  setPlannerExecuteReady(false);
  if (statusPill) { statusPill.textContent = 'Updating…'; statusPill.className = 'pill warn'; }

  if (state.selectedKeys.size === 0) {
    const message = 'Select at least one team member to preview or create tasks.';
    if (matrixWrap) matrixWrap.textContent = message;
    if (results) results.textContent = message;
    if (statusPill) { statusPill.textContent = 'Select members'; statusPill.className = 'pill warn'; }
    if ($('#kpiPlanMembers')) $('#kpiPlanMembers').textContent = '0';
    if ($('#kpiPlanToCreate')) $('#kpiPlanToCreate').textContent = '0';
    if ($('#kpiPlanExisting')) $('#kpiPlanExisting').textContent = '0';
    return;
  }

  if (matrixWrap) matrixWrap.innerHTML = '<div style="padding:20px;"><div class="skeleton-row skeleton"></div><div class="skeleton-row skeleton"></div></div>';
  if (results) results.textContent = 'Checking existing tasks and planned dates…';

  try {
    const plan = await api.post('/tasks/plan', {
      personKeys: [...state.selectedKeys],
      asOf: $('#asOf')?.value || undefined,
      thursdayMode: $('#thursdayMode')?.value || undefined,
    });
    if (requestVersion !== state.planRequestVersion || signature !== plannerSelectionSignature()) return;
    state.pendingPlan = plan;
    state.pendingPlanSignature = signature;
    renderPlanMatrix(plan);
    renderPlanResults(plan);
    const count = plan.personPlans.reduce((sum, person) =>
      sum + (person.plannedDates || []).filter(date => date.status === 'PLANNED').length, 0);
    setPlannerExecuteReady(count > 0);
    if (statusPill) {
      statusPill.textContent = count > 0 ? `${count} pending · ready to review` : 'No pending tasks';
      statusPill.className = count > 0 ? 'pill warn' : 'pill ok';
    }
  } catch (err) {
    if (requestVersion !== state.planRequestVersion) return;
    state.pendingPlan = null;
    state.pendingPlanSignature = null;
    setPlannerExecuteReady(false);
    if (matrixWrap) matrixWrap.textContent = `Preview failed: ${err.message}`;
    if (results) results.textContent = `Preview failed: ${err.message}`;
    if (statusPill) { statusPill.textContent = 'Preview failed'; statusPill.className = 'pill bad'; }
    toast(`Could not preview tasks: ${err.message}`, 'err');
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
        : el('div', { class: 'small', style: 'color:var(--warn); margin-top:2px;' }, 'No source task'),
    ]);

    if (hasPlanned) {
      const btnRunMember = el('button', {
        class: 'btn-action-person',
        style: 'margin-top: 6px;',
        onclick: (e) => {
          e.stopPropagation();
          runForMember(memberKey, planItem.person.name);
        },
      }, `Create for ${planItem.person.name.split(' ')[0]}`);
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
        } else if (planItem.status === 'SOURCE_NOT_FOUND') {
          const btn = el('button', {
            class: 'btn-action-cell',
            style: 'border-style:dashed;',
            title: `Create ad-hoc task for ${planItem.person.name} on ${d.formattedTitleDate}`,
            onclick: () => openAdHocModal(memberKey, d.isoDate),
          }, '+ Create');
          td.append(btn);
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
        td.innerHTML = `<span class="cell-status cell-duplicate" title="${escapeHtml(item.skipReason || 'Multiple tasks')}">Duplicate</span>`;
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
      confirm: true,
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

function runForCell(personKey, personName, isoDate) {
  // A matrix cell represents one date. Never run a multi-day batch from this action.
  openAdHocModal(personKey, isoDate);
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
      block.append(el('p', { class: 'muted small', style: 'color:var(--warn);' }, 'No source task discovered.'));
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
  if (state.selectedKeys.size === 0) {
    toast('Select at least one team member before creating tasks.', 'warn');
    return;
  }
  if (!state.pendingPlan || state.pendingPlanSignature !== plannerSelectionSignature()) {
    toast('Review an up-to-date plan before executing tasks.', 'warn');
    runPlanPreview();
    return;
  }
  const plannedCount = state.pendingPlan.personPlans.reduce((sum, person) =>
    sum + (person.plannedDates || []).filter(date => date.status === 'PLANNED').length, 0);
  if (plannedCount === 0) {
    toast('No pending tasks to create for this selection.', 'ok');
    return;
  }

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
      list.innerHTML = '<li class="muted">No tasks need creation in this reviewed window. Existing work completion has not been verified.</li>';
    }
  } else {
    list.innerHTML = `<li>Evaluate and create pending tasks for: <strong>${keys.length ? keys.join(', ') : 'All enabled team members'}</strong></li>`;
  }

  showModal('#confirmModal', '#btnConfirmExecute');
}

async function executeCreation() {
  if (state.isExecuting) return;
  if (state.selectedKeys.size === 0 ||
      !state.pendingPlan ||
      state.pendingPlanSignature !== plannerSelectionSignature()) {
    hideModal('#confirmModal');
    toast('Review an up-to-date plan before executing tasks.', 'warn');
    return;
  }
  state.isExecuting = true;
  hideModal('#confirmModal');
  const confirmButton = $('#btnConfirmExecute');
  if (confirmButton) confirmButton.disabled = true;

  const btn = $('#executeBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Creating tasks...'; }

  // Open console drawer to view execution
  openConsoleDrawer();

  try {
    const keys = [...state.selectedKeys];
    const res = await api.post('/tasks/execute', {
      confirm: true,
      personKeys: keys.length ? keys : undefined,
      asOf: $('#asOf')?.value || undefined,
      thursdayMode: $('#thursdayMode')?.value || undefined,
      dryRun: false,
    });
    const taskFailures = Number(res.totalTaskFailureCount) || 0;
    const sourceFailures = Number(res.totalSourceFailureCount) || 0;
    const relationFailures = Number(res.totalRelationFailureCount) || 0;
    const auditWarnings = (res.personResults || []).flatMap(p => p.auditWarnings || []);
    if (taskFailures + sourceFailures + relationFailures + auditWarnings.length > 0) {
      toast(`Azure accepted ${res.totalCreatedCount || 0} task(s), skipped ${res.totalDuplicateCount || 0} duplicates; ${taskFailures} task failure(s), ${sourceFailures} source failure(s), ${relationFailures} relation failure(s), ${auditWarnings.length} audit/read-back warning(s). Review Audit log.`, 'warn');
    } else {
      toast(`Azure accepted ${res.totalCreatedCount || 0} task(s), skipped ${res.totalDuplicateCount || 0} duplicates. Verify final state in Azure.`, 'ok');
    }
    refreshDashboard();
    runPlanPreview();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    state.isExecuting = false;
    state.pendingPlan = null;
    state.pendingPlanSignature = null;
    setPlannerExecuteReady(false);
    if (confirmButton) confirmButton.disabled = false;
    if (btn) btn.textContent = 'Review & confirm';
  }
}

/* ------------------------------------------------------------- team members */
function updateTeamDirtyState(dirty = true) {
  state.teamDirty = dirty;
  const status = $('#teamSaveStatus');
  if (status) status.textContent = dirty
    ? 'Unsaved team changes. Save before planning tasks with the new roster.'
    : 'Team configuration saved. Task data is not automatically changed.';
  const save = $('#savePeopleBtn');
  if (save) save.disabled = !dirty || state.teamSaving;
}

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
    row.append(field('Title Prefix', input(p.titlePrefix || '', v => state.people[idx].titlePrefix = v ? v : undefined)));
    row.append(field('GitHub Handle', input(p.githubUsername || '', v => state.people[idx].githubUsername = v || undefined)));
    row.append(field('GitHub Repositories (owner/repo, comma-separated)', input(
      (p.githubRepositories || []).join(', '), v =>
        state.people[idx].githubRepositories = v.split(',').map(s => s.trim()).filter(Boolean)
    )));
    row.append(field('GitHub Branches (comma-separated)', input(
      (p.githubBranches || []).join(', '), v =>
        state.people[idx].githubBranches = v.split(',').map(s => s.trim()).filter(Boolean)
    )));
    
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
      onclick: () => { state.people.splice(idx, 1); updateTeamDirtyState(); renderPeople(); },
    }, 'Remove');
    row.append(del);

    // Auto-close toggle
    const acLabel = el('label', { class: 'field', style: 'flex-direction:row; align-items:center; gap:8px; cursor:pointer;' });
    const acCheck = el('input', { type: 'checkbox' });
    acCheck.checked = state.people[idx].autoCloseEnabled !== false;
    acCheck.addEventListener('change', () => {
      state.people[idx].autoCloseEnabled = acCheck.checked;
      updateTeamDirtyState();
      renderEodAutoClosePersonList(); // Keep scheduler panel in sync
    });
    acLabel.append(acCheck, el('span', { style: 'font-size:12.5px;' }, 'Auto-close'));
    row.append(acLabel);

    list.append(row);
  });
}

function field(label, control) {
  return el('label', { class: 'field' }, [el('span', {}, label), control]);
}

function input(value, onChange, type = 'text') {
  const node = el('input', { type, value: value ?? '' });
  node.addEventListener('input', () => { onChange(node.value); updateTeamDirtyState(); });
  return node;
}

async function loadPeople() {
  if (state.teamDirty) return; // Preserve edits across navigation; never discard a draft.
  const cfg = await ensureConfig(true);
  if (state.teamDirty) return; // Ignore an in-flight load after the user began editing.
  state.people = cfg.people.map(p => ({ ...p }));
  renderPeople();
  updateTeamDirtyState(false);
}

async function savePeople() {
  if (state.teamSaving || !state.teamDirty) return;
  state.teamSaving = true;
  updateTeamDirtyState(true);
  const button = $('#savePeopleBtn');
  if (button) button.textContent = 'Saving…';
  try {
    await api.post('/config/people', { people: state.people });
    api.invalidateCache('/config');
    api.invalidateCache('/explorer');
    api.invalidateCache('/tasks');
    if (!state.config) state.config = { people: [] };
    state.config.people = state.people.map(p => ({ ...p }));

    // Invalidate all derived plans without silently widening either selection.
    api.invalidateCache();
    state.explorerData = null;
    state.pendingPlan = null;
    state.pendingPlanSignature = null;
    state.burndownData = null;
    state.isDataDirty = true;
    const enabled = new Set(state.people.filter(p => p.enabled !== false).map(p => p.key));
    for (const key of state.selectedKeys) if (!enabled.has(key)) state.selectedKeys.delete(key);
    for (const key of state.selectedExplorerKeys) if (!enabled.has(key)) state.selectedExplorerKeys.delete(key);
    if ($('#kpiPeople')) $('#kpiPeople').textContent = enabled.size;
    updateTeamDirtyState(false);
    toast('Team configuration saved. Review a fresh task plan before creating work items.', 'ok');
  } catch (err) {
    updateTeamDirtyState(true);
    toast(err.message, 'err');
  } finally {
    state.teamSaving = false;
    if (button) button.textContent = 'Save team';
    updateTeamDirtyState(state.teamDirty);
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
  if ($('#personTitlePrefixInput')) $('#personTitlePrefixInput').value = '';
  $('#personSourceIdInput').value = '';
  if ($('#personGithubInput')) $('#personGithubInput').value = '';
  if ($('#personReposInput')) $('#personReposInput').value = '';
  if ($('#personBranchesInput')) $('#personBranchesInput').value = '';
  if ($('#personAutoCloseInput')) $('#personAutoCloseInput').checked = true; // Default: include in auto-close
  showModal('#personModal', '#personKeyInput');
}

async function savePersonFromModal() {
  const form = $('#personModalForm');
  
  // Validate form
  if (!validateForm(form)) {
    focusFirstInvalidInput(form);
    toast('Please fix the errors in the form', 'err');
    return;
  }
  
  const key = $('#personKeyInput').value.trim();
  const name = $('#personNameInput').value.trim();
  const assignedTo = $('#personEmailInput').value.trim();
  const pod = $('#personPodInput').value.trim();
  const role = $('#personRoleInput').value.trim();
  const titlePrefix = $('#personTitlePrefixInput')?.value.trim();
  const sourceTaskId = $('#personSourceIdInput').value.trim();
  const githubUsername = $('#personGithubInput')?.value?.trim();
  const githubRepositories = ($('#personReposInput')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
  const githubBranches = ($('#personBranchesInput')?.value || '').split(',').map(x => x.trim()).filter(Boolean);
  const autoCloseEnabled = $('#personAutoCloseInput') ? Boolean($('#personAutoCloseInput').checked) : true;

  // Check duplicate key in local state
  if (state.people.some(p => p.key.toLowerCase() === key.toLowerCase())) {
    const errorEl = document.getElementById('personKeyError');
    if (errorEl) {
      errorEl.textContent = `Member key "${key}" already exists. Please choose a unique key.`;
      errorEl.style.display = 'block';
    }
    $('#personKeyInput').setAttribute('aria-invalid', 'true');
    toast(`Member key "${key}" already exists. Please choose a unique key.`, 'err');
    $('#personKeyInput').focus();
    return;
  }

  const newMember = {
    key,
    name,
    assignedTo,
    pod: pod || undefined,
    role: role || undefined,
    titlePrefix: titlePrefix || undefined,
    sourceTaskId: sourceTaskId ? Number(sourceTaskId) : undefined,
    githubUsername: githubUsername || undefined,
    githubRepositories,
    githubBranches,
    enabled: true,
    autoCloseEnabled,
  };

  state.people.push(newMember);
  renderPeople();
  hideModal('#personModal');

  // Immediately persist to backend and fetch data for the new member
  try {
    toast(`Saving ${name} and fetching team data…`, 'info');
    await api.post('/config/people', { people: state.people });
    api.invalidateCache();
    if (!state.config) state.config = { people: [] };
    state.config.people = state.people.map(p => ({ ...p }));
    
    // Automatically select the new member in Explorer & Planner
    state.selectedKeys.add(key);
    state.selectedExplorerKeys.add(key);
    
    state.explorerData = null;
    state.burndownData = null;
    state.pendingPlan = null;
    state.isDataDirty = true;
    updateTeamDirtyState(false);
    
    const enabled = new Set(state.people.filter(p => p.enabled !== false).map(p => p.key));
    if ($('#kpiPeople')) $('#kpiPeople').textContent = enabled.size;
    
    toast(`Added and saved ${name}. Fetching live tasks…`, 'ok');
    
    // Proactively refresh Explorer and Burndown if active or available
    if (typeof refreshExplorer === 'function') {
      refreshExplorer({ forceFresh: true });
    }
    if (typeof loadBurndownMonth === 'function') {
      loadBurndownMonth({ forceFresh: true });
    }
    if (typeof runPlanPreview === 'function') {
      runPlanPreview();
    }
  } catch (err) {
    updateTeamDirtyState(true);
    toast(`Added ${name} to draft, but failed to auto-save: ${err.message}`, 'err');
  }
}

// Prevent Enter submission without inline event handlers. The browser shell
// intentionally disallows inline scripts through Content-Security-Policy.
const personForm = $('#personModalForm');
if (personForm) {
  personForm.addEventListener('submit', e => e.preventDefault());
  personForm.addEventListener('input', e => {
    if (e.target.hasAttribute('required')) {
      const errorId = e.target.getAttribute('aria-describedby');
      if (errorId) {
        const errorEl = document.getElementById(errorId);
        e.target.setAttribute('aria-invalid', 'false');
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.style.display = 'none';
        }
      }
    }
  });
}

$('#adHocForm')?.addEventListener('submit', e => e.preventDefault());

// Add Escape key handler to close modals
document.addEventListener('keydown', handleModalEscapeKey);

// Add keyboard navigation for modals
document.addEventListener('keydown', trapModalFocus);

/* ---------------------------------------------------------------- audit log */
async function refreshJournal() {
  const status = $('#journalResultStatus');
  if (status) status.textContent = 'Loading audit history…';
  try {
    const data = await api.get('/journal?limit=250');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    state.journal = entries;
    const stats = $('#journalStats');
    if (stats) {
      stats.innerHTML = '';
      stats.append(
        el('div', { class: 'stat-chip' }, [el('b', {}, String(data.totalEntries ?? entries.length)), el('span', {}, 'Total Log Entries')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(data.incompleteEntriesCount)), el('span', {}, 'Incomplete Relation Copies')]),
      );
    }
    const tbody = $('#journalTable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (status) status.textContent = entries.length
      ? `${entries.length} audit record(s) loaded. Review incomplete relations before repairing them.`
      : 'No audit records found for this workspace.';
    if (entries.length === 0) {
      tbody.append(el('tr', {}, el('td', { colspan: '8' },
        el('span', { role: 'status', class: 'muted' }, 'No audit records. Created tasks and repairs will appear here when recorded.'))));
      return;
    }
    for (const e of entries) {
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
    if (status) status.textContent = `Unable to load audit records: ${err.message}`;
    const tbody = $('#journalTable tbody');
    if (tbody) {
      tbody.innerHTML = '';
      tbody.append(el('tr', {}, el('td', { colspan: '8' }, `Unable to load audit records: ${err.message}`)));
    }
    toast(err.message, 'err');
  }
}

/* ------------------------------------------------------------- work calendar (S09) */
let calendarState = {
  calendar: { version: 0, defaultHours: 8, memberHours: {}, exceptions: [] },
  timezone: 'UTC',
  members: [],
  isDirty: false,
};

async function loadCalendar() {
  const listEl = $('#calendarExceptionsList');
  const statusEl = $('#calendarStatusText');
  try {
    if (statusEl) statusEl.textContent = 'Loading calendar configuration…';
    const resp = await api.get('/calendar', { forceFresh: true });
    if (resp) {
      calendarState.calendar = resp.calendar || { version: 0, defaultHours: 8, memberHours: {}, exceptions: [] };
      calendarState.timezone = resp.timezone || 'UTC';
      calendarState.members = resp.members || [];
      calendarState.isDirty = false;
      renderCalendarView();
    }
  } catch (err) {
    if (listEl) listEl.innerHTML = `<p class="muted" style="color:var(--danger); padding:16px;">Failed to load calendar: ${escapeHtml(err.message)}</p>`;
    if (statusEl) statusEl.textContent = 'Failed to load calendar.';
    toast(err.message, 'err');
  }
}

function renderCalendarView() {
  const tzEl = $('#calendarTimezone');
  const defHoursEl = $('#calendarDefaultHours');
  const countEl = $('#calendarExceptionCount');
  const listEl = $('#calendarExceptionsList');
  const statusEl = $('#calendarStatusText');
  const saveBtn = $('#calendarSaveBtn');

  if (tzEl) tzEl.textContent = calendarState.timezone;
  if (defHoursEl) defHoursEl.textContent = `${calendarState.calendar.defaultHours || 8}h`;
  const exceptions = calendarState.calendar.exceptions || [];
  if (countEl) countEl.textContent = String(exceptions.length);
  if (saveBtn) saveBtn.disabled = !calendarState.isDirty || state.viewerMode;

  if (!listEl) return;
  listEl.innerHTML = '';

  if (exceptions.length === 0) {
    listEl.innerHTML = '<p class="muted" style="padding:16px;">No calendar exceptions configured. All working days are calculated using default capacity.</p>';
    if (statusEl) statusEl.textContent = 'Calendar loaded. No exceptions configured.';
    return;
  }

  const table = el('table', { class: 'table' });
  const thead = el('thead', {}, el('tr', {}, [
    el('th', {}, 'Date range'),
    el('th', {}, 'Type'),
    el('th', {}, 'Scope / Member'),
    el('th', {}, 'Capacity'),
    el('th', {}, 'Note'),
    el('th', {}, 'Actions'),
  ]));

  const tbody = el('tbody');
  exceptions.forEach((exc, index) => {
    const isSingle = exc.startDate === exc.endDate || !exc.endDate;
    const dateRange = isSingle ? exc.startDate : `${exc.startDate} → ${exc.endDate}`;
    const scopeLabel = exc.personKey ? (calendarState.members.find(m => m.key === exc.personKey)?.name || exc.personKey) : 'All members (Project-wide)';
    const typeBadge = el('span', { class: `pill ${exc.type === 'holiday' ? 'warn' : 'info'}` }, exc.type || 'leave');
    const capacityText = exc.type === 'holiday' ? '0h (Holiday)' : (exc.availableHours !== undefined ? `${exc.availableHours}h` : '0h (Full leave)');

    const removeBtn = el('button', {
      type: 'button',
      class: 'btn small ghost danger',
      'aria-label': `Remove exception for ${dateRange}`,
    }, 'Remove');

    removeBtn.addEventListener('click', () => {
      calendarState.calendar.exceptions.splice(index, 1);
      calendarState.isDirty = true;
      renderCalendarView();
    });

    tbody.append(el('tr', {}, [
      el('td', {}, dateRange),
      el('td', {}, typeBadge),
      el('td', {}, scopeLabel),
      el('td', {}, capacityText),
      el('td', { class: 'muted small' }, exc.reason || '—'),
      el('td', {}, removeBtn),
    ]));
  });

  table.append(thead, tbody);
  listEl.append(table);
  if (statusEl) statusEl.textContent = `Calendar loaded. ${exceptions.length} exception(s) configured.`;
}

async function saveCalendar() {
  const saveBtn = $('#calendarSaveBtn');
  const statusEl = $('#calendarStatusText');
  try {
    if (saveBtn) saveBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Saving calendar…';
    const resp = await api.post('/calendar', { calendar: calendarState.calendar });
    if (resp?.calendar) {
      calendarState.calendar = resp.calendar;
      calendarState.isDirty = false;
      renderCalendarView();
      toast('Calendar saved successfully.', 'ok');
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Error saving calendar: ${err.message}`;
    toast(err.message, 'err');
    if (saveBtn) saveBtn.disabled = false;
  }
}

function openAddExceptionModal() {
  const dialog = el('dialog', { class: 'modal', id: 'addExceptionModal' });
  const form = el('form', { method: 'dialog', class: 'modal-body' });

  form.innerHTML = `
    <header class="modal-header">
      <h3>Add Calendar Exception</h3>
      <button type="button" class="btn small ghost close-modal-btn" aria-label="Close dialog">✕</button>
    </header>
    <div class="modal-content" style="display:flex; flex-direction:column; gap:12px; margin-top:12px;">
      <label class="field">
        <span>Exception Type</span>
        <select id="newExcType">
          <option value="holiday">Holiday (Project-wide, 0h)</option>
          <option value="leave">Planned Leave (0h default)</option>
        </select>
      </label>
      <label class="field">
        <span>Team Member (Leave only)</span>
        <select id="newExcMember">
          <option value="">All members (Project-wide)</option>
          ${calendarState.members.map(m => `<option value="${escapeHtml(m.key)}">${escapeHtml(m.name)}</option>`).join('')}
        </select>
      </label>
      <div class="row gap">
        <label class="field" style="flex:1;">
          <span>Start Date</span>
          <input type="date" id="newExcStart" required />
        </label>
        <label class="field" style="flex:1;">
          <span>End Date (Optional)</span>
          <input type="date" id="newExcEnd" />
        </label>
      </div>
      <label class="field">
        <span>Reason or Note (Optional)</span>
        <input type="text" id="newExcReason" placeholder="e.g. Diwali Holiday, Vacation" maxlength="100" />
      </label>
    </div>
    <footer class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
      <button type="button" class="btn ghost close-modal-btn">Cancel</button>
      <button type="submit" class="btn primary" id="saveNewExceptionBtn">Add Exception</button>
    </footer>
  `;

  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();

  const closeDialog = () => {
    dialog.close();
    dialog.remove();
  };

  form.querySelectorAll('.close-modal-btn').forEach(b => b.addEventListener('click', closeDialog));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = $('#newExcType', form).value;
    const member = $('#newExcMember', form).value;
    const start = $('#newExcStart', form).value;
    const end = $('#newExcEnd', form).value || start;
    const reason = $('#newExcReason', form).value.trim();

    if (!start) {
      toast('Start date is required.', 'err');
      return;
    }
    if (end < start) {
      toast('End date cannot be earlier than start date.', 'err');
      return;
    }

    const newException = {
      type,
      startDate: start,
      endDate: end,
      reason: reason || undefined,
      ...(member ? { personKey: member } : {}),
      availableHours: 0,
    };

    calendarState.calendar.exceptions.push(newException);
    calendarState.isDirty = true;
    closeDialog();
    renderCalendarView();
    toast('Exception added to draft. Click "Save calendar" to persist.', 'info');
  });
}

/* ------------------------------------------------------- eod auto-close selector */

/**
 * Render the per-person auto-close toggle list in the Scheduler → EOD section.
 * Reads from state.people (cached from /config). Saves directly to /config/people.
 */
function renderEodAutoClosePersonList() {
  const container = $('#eodAutoClosePersonList');
  if (!container) return;

  const people = (state.config && state.config.people) ? state.config.people : (state.people || []);
  const enabledPeople = people.filter(p => p.enabled !== false);

  if (enabledPeople.length === 0) {
    container.innerHTML = '<p class="muted small">No active team members configured. Add members in the Team section first.</p>';
    return;
  }

  container.innerHTML = '';
  for (const p of enabledPeople) {
    const isAutoClose = p.autoCloseEnabled !== false;

    const pill = el('label', {
      style: [
        'display:flex; align-items:center; gap:8px; padding:8px 14px; border-radius:var(--radius-sm);',
        'border:1.5px solid ' + (isAutoClose ? 'var(--ok)' : 'var(--border)') + ';',
        'background:' + (isAutoClose ? 'rgba(0,200,120,0.07)' : 'var(--surface-hover)') + ';',
        'cursor:pointer; min-width:160px; transition:border 0.15s, background 0.15s;',
      ].join(''),
      title: isAutoClose ? 'Click to exclude from auto-close' : 'Click to include in auto-close',
    });

    const chk = el('input', { type: 'checkbox' });
    chk.checked = isAutoClose;
    chk.setAttribute('aria-label', `Auto-close for ${p.name}`);

    const nameSpan = el('span', { style: 'font-size:13px; font-weight:500;' }, p.name);
    const badge = el('span', {
      class: isAutoClose ? 'pill ok' : 'pill muted',
      style: 'font-size:11px; margin-left:auto;',
    }, isAutoClose ? '✓ Included' : '✗ Excluded');

    pill.append(chk, nameSpan, badge);

    chk.addEventListener('change', async () => {
      // Update local state
      const personInState = (state.people || []).find(sp => sp.key === p.key);
      const personInConfig = (state.config && state.config.people) ? state.config.people.find(sp => sp.key === p.key) : null;
      const newValue = chk.checked;
      if (personInState) personInState.autoCloseEnabled = newValue;
      if (personInConfig) personInConfig.autoCloseEnabled = newValue;

      // Visual update on the pill
      pill.style.borderColor = newValue ? 'var(--ok)' : 'var(--border)';
      pill.style.background = newValue ? 'rgba(0,200,120,0.07)' : 'var(--surface-hover)';
      pill.title = newValue ? 'Click to exclude from auto-close' : 'Click to include in auto-close';
      badge.textContent = newValue ? '✓ Included' : '✗ Excluded';
      badge.className = newValue ? 'pill ok' : 'pill muted';
      badge.style.fontSize = '11px';
      badge.style.marginLeft = 'auto';

      // Persist immediately
      try {
        const allPeople = (state.config && state.config.people) ? state.config.people : (state.people || []);
        await api.post('/config/people', { people: allPeople });
        api.invalidateCache('/config');
        toast(`${p.name} ${newValue ? 'included in' : 'excluded from'} auto-close`, 'ok');
      } catch (err) {
        toast(`Failed to save auto-close setting: ${err.message}`, 'err');
        // Roll back
        chk.checked = !newValue;
        if (personInState) personInState.autoCloseEnabled = !newValue;
        if (personInConfig) personInConfig.autoCloseEnabled = !newValue;
        pill.style.borderColor = !newValue ? 'var(--ok)' : 'var(--border)';
        pill.style.background = !newValue ? 'rgba(0,200,120,0.07)' : 'var(--surface-hover)';
        badge.textContent = !newValue ? '✓ Included' : '✗ Excluded';
        badge.className = !newValue ? 'pill ok' : 'pill muted';
      }
    });

    container.append(pill);
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
    if ($('#schedAutoStartLabel')) $('#schedAutoStartLabel').textContent = s.autoStart ? 'Enabled' : 'Disabled';
    
    if ($('#schedLast')) {
      if (s.lastRun) {
        const res = s.lastRunResult ? s.lastRunResult.toUpperCase() : 'OUTCOME UNKNOWN';
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

    // EOD auto-close fields
    const eodEnabled = s.autoCloseEnabled === true;
    if ($('#eodStatusPill')) {
      $('#eodStatusPill').textContent = eodEnabled ? '🟢 Enabled' : '⚪ Disabled';
      $('#eodStatusPill').style.color = eodEnabled ? 'var(--ok)' : 'var(--muted)';
    }
    if ($('#eodWindowDisplay')) {
      $('#eodWindowDisplay').textContent = `${s.autoCloseStartTime || '18:15'} – ${s.autoCloseEndTime || '18:45'}`;
    }
    if ($('#eodNextDisplay')) {
      $('#eodNextDisplay').textContent = s.nextAutoClose ? new Date(s.nextAutoClose).toLocaleString() : '—';
    }
    if ($('#eodLastDisplay')) {
      if (s.lastAutoClose) {
        const res = s.lastAutoCloseResult ? s.lastAutoCloseResult.toUpperCase() : 'ATTEMPTED (OUTCOME UNKNOWN)';
        $('#eodLastDisplay').textContent = `${res} (${new Date(s.lastAutoClose).toLocaleTimeString()})`;
      } else {
        $('#eodLastDisplay').textContent = 'No runs yet';
      }
    }
    if ($('#eodStartTimeInput') && document.activeElement !== $('#eodStartTimeInput')) {
      $('#eodStartTimeInput').value = s.autoCloseStartTime || '18:15';
    }
    if ($('#eodEndTimeInput') && document.activeElement !== $('#eodEndTimeInput')) {
      $('#eodEndTimeInput').value = s.autoCloseEndTime || '18:45';
    }
    if ($('#eodEnableCheck')) {
      $('#eodEnableCheck').checked = eodEnabled;
    }

    // Daily activation (5:30 PM) fields
    const autoActiveEnabled = s.autoActiveEnabled !== false;
    if ($('#activeStatusPill')) {
      $('#activeStatusPill').textContent = autoActiveEnabled ? '🟢 Enabled' : '⚪ Disabled';
      $('#activeStatusPill').style.color = autoActiveEnabled ? 'var(--ok)' : 'var(--muted)';
    }
    if ($('#activeTimeDisplay')) {
      $('#activeTimeDisplay').textContent = s.autoActiveTime || '17:30';
    }
    if ($('#activeNextDisplay')) {
      $('#activeNextDisplay').textContent = s.nextAutoActive ? new Date(s.nextAutoActive).toLocaleString() : '—';
    }
    if ($('#activeLastDisplay')) {
      if (s.lastAutoActive) {
        const res = s.lastAutoActiveResult ? s.lastAutoActiveResult.toUpperCase() : 'ATTEMPTED';
        $('#activeLastDisplay').textContent = `${res} (${new Date(s.lastAutoActive).toLocaleTimeString()})`;
      } else {
        $('#activeLastDisplay').textContent = 'No runs yet';
      }
    }
    if ($('#activeTimeInput') && document.activeElement !== $('#activeTimeInput')) {
      $('#activeTimeInput').value = s.autoActiveTime || '17:30';
    }
    if ($('#activeEnableCheck')) {
      $('#activeEnableCheck').checked = autoActiveEnabled;
    }

    // Populate the per-person auto-close selector from current config
    await ensureConfig();
    renderEodAutoClosePersonList();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function toggleScheduler(enable) {
  if (enable && !window.confirm('Enable unattended task creation for the configured members and schedule? Review the selected team and time first.')) {
    const toggle = $('#schedToggle');
    if (toggle) toggle.checked = false;
    return;
  }
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

async function saveEodSchedulerConfig() {
  try {
    const autoCloseStartTime = $('#eodStartTimeInput')?.value?.trim() || '18:15';
    const autoCloseEndTime = $('#eodEndTimeInput')?.value?.trim() || '18:45';
    const autoClose = Boolean($('#eodEnableCheck')?.checked);

    await api.post('/scheduler/config', { autoClose, autoCloseStartTime, autoCloseEndTime });
    toast('EOD Auto-close settings saved successfully', 'ok');
    refreshScheduler();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveActiveSchedulerConfig() {
  try {
    const autoActiveTime = $('#activeTimeInput')?.value?.trim() || '17:30';
    const autoActive = Boolean($('#activeEnableCheck')?.checked);

    await api.post('/scheduler/config', { autoActive, autoActiveTime });
    toast('Daily task activation settings saved successfully', 'ok');
    refreshScheduler();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function runSchedulerNow() {
  if (!window.confirm('Run the scheduled task creation now for the configured team? This may create Azure DevOps work items.')) return;
  try {
    toast('Starting scheduler execution…');
    const res = await api.post('/scheduler/run-now', { confirm: true, all: true });
    // api.post returns response.data; this endpoint returns scheduler status
    // there. HTTP 200 means the run was accepted, not completed.
    toast('Scheduler run requested. Check Activity and Logs for its result.', 'ok');
    setTimeout(refreshScheduler, 1500);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function renderLifecycleScope() {
  const config = await ensureConfig();
  const members = $('#lifecycleMembers');
  if (!members) return;
  members.replaceChildren();
  const enabled = config.people.filter(person => person.enabled !== false);
  const eligible = new Set(enabled.map(person => person.key));
  state.lifecycleKeys = new Set([...state.lifecycleKeys].filter(key => eligible.has(key)));
  for (const person of enabled) {
    const selected = state.lifecycleKeys.has(person.key);
    members.append(el('button', {
      type: 'button', class: `person-chip${selected ? ' on' : ''}`, 'aria-pressed': String(selected),
      onclick: () => {
        if (state.lifecycleKeys.has(person.key)) state.lifecycleKeys.delete(person.key);
        else state.lifecycleKeys.add(person.key);
        state.eodPreviewReadyAt = 0;
        state.activePreviewReadyAt = 0;
        renderLifecycleScope();
      },
    }, person.name));
  }
  const workday = $('#lifecycleWorkday');
  if (workday) workday.textContent = `${isoDateInTimeZone(new Date(), config.timezone)} (${config.timezone})`;
  const status = $('#lifecycleScopeStatus');
  if (status) status.textContent = `${state.lifecycleKeys.size} of ${enabled.length} enabled members selected`;
}

function lifecycleSelection() {
  if (state.currentView !== 'lifecycle') return { all: true };
  const personKeys = [...state.lifecycleKeys].sort();
  if (!personKeys.length) throw new Error('Select at least one team member for the lifecycle preview.');
  return { personKeys };
}

async function triggerEodClosure(dryRun = false) {
  let scope;
  try { scope = lifecycleSelection(); } catch (error) { toast(error.message, 'warn'); return; }
  const signature = JSON.stringify(scope);
  if (!dryRun && state.eodPreviewScope !== signature) {
    toast('Member scope changed. Preview EOD closure again.', 'warn');
    return;
  }
  if (!dryRun) {
    if (!state.eodPreviewReadyAt || Date.now() - state.eodPreviewReadyAt > 120000) {
      toast('Preview EOD closure before executing. The preview must be less than two minutes old.', 'warn');
      triggerEodClosure(true);
      return;
    }
    if (!window.confirm('Close the work items shown in the EOD preview? This updates Azure DevOps immediately.')) return;
    state.eodPreviewReadyAt = 0;
  } else {
    state.eodPreviewReadyAt = 0;
  }
  const modal = $('#eodModal');
  const summaryEl = $('#eodModalSummary');
  const tbody = $('#eodModalTable tbody');
  const executeBtn = $('#btnExecuteEodConfirmed');
  const title = $('#eodModalTitle');

  if (title) title.textContent = dryRun ? 'End-of-Day Task Closure Preview (Dry Run)' : 'Closing Today Tasks...';
  if (executeBtn) executeBtn.style.display = 'none';

  showModal('#eodModal', '#btnCloseEodModal');
  if (summaryEl) summaryEl.innerHTML = '<span class="muted">Loading candidate tasks and fetching GitHub PR deliverables...</span>';
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:24px;">Analyzing tasks for today...</td></tr>';

  try {
    const res = await api.post('/tasks/close-today', { dryRun, ...scope, confirm: !dryRun });
    if (dryRun) state.eodPreviewScope = signature;
    state.lastEodResult = res;

    if (summaryEl) {
      summaryEl.innerHTML = '';
      summaryEl.append(
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalFound)), el('span', {}, 'Tasks Found')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalClosed)), el('span', {}, dryRun ? 'Eligible to Close' : 'Closed Successfully')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalAlreadyClosed)), el('span', {}, 'Already Closed')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalFailed)), el('span', {}, 'Failed')]),
      );
    }

    if (tbody) {
      tbody.innerHTML = '';
      if (!res.results || res.results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="muted" style="text-align:center; padding:24px;">No candidate tasks found for today.</td></tr>';
      } else {
        for (const r of res.results) {
          const prBadge = r.prCount > 0
            ? el('span', { class: 'pill ok' }, `${r.prCount} PR(s) today`)
            : el('span', { class: 'pill muted' }, '0 PRs today');

          let statusBadge;
          if (r.status === 'closed') {
            statusBadge = el('span', { class: 'pill ok' }, 'Closure accepted');
          } else if (r.status === 'simulated') {
            statusBadge = el('span', { class: 'pill', style: 'border:1px dashed var(--accent);' }, 'Ready to Close');
          } else if (r.status === 'already_closed') {
            statusBadge = el('span', { class: 'pill muted' }, 'Already Closed');
          } else {
            statusBadge = el('span', { class: 'pill danger' }, 'Failed');
          }

          const tr = el('tr', {}, [
            el('td', { style: 'font-weight:600;' }, r.personName),
            el('td', {}, [
              el('a', { href: getAdoWorkItemUrl(r.taskId), target: '_blank', class: 'ado-link' }, `#${r.taskId} ↗`),
              el('div', { class: 'muted small' }, r.taskTitle),
            ]),
            el('td', {}, el('code', {}, r.githubUsername || '—')),
            el('td', {}, [
              el('div', {}, prBadge),
              el('div', { class: 'muted small', style: 'max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, r.summaryText),
            ]),
            el('td', {}, r.remainingWork == null ? 'Not recorded' : String(r.remainingWork) + 'h'),
            el('td', {}, r.completedWork == null ? 'Not recorded' : String(r.completedWork) + 'h'),
            el('td', {}, statusBadge),
          ]);
          tbody.append(tr);
        }
      }
    }

    if (dryRun && res.totalClosed > 0 && res.totalFailed === 0) state.eodPreviewReadyAt = Date.now();
    if (executeBtn) {
      if (dryRun && res.totalClosed > 0 && res.totalFailed === 0) {
        executeBtn.style.display = 'inline-block';
        executeBtn.disabled = false;
        executeBtn.textContent = `Execute EOD Closure in Azure DevOps (${res.totalClosed} tasks)`;
      } else {
        executeBtn.style.display = 'none';
      }
    }

    if (dryRun) {
      if (res.totalFailed > 0) {
        toast(`EOD preview incomplete: ${res.totalFailed} task(s) failed checks. Resolve errors before closing.`, 'warn');
      } else if (res.totalClosed === 0 && res.totalAlreadyClosed > 0) {
        toast(`All ${res.totalAlreadyClosed} task(s) are already closed.`, 'ok');
      } else {
        toast(`Preview complete: ${res.totalClosed} task(s) eligible for closure.`, 'ok');
      }
    } else {
      const auditWarnings = (res.results || []).filter(item => item.auditWarning);
      if (res.totalFailed > 0) {
        toast(`EOD partially failed: ${res.totalClosed} closure(s) accepted, ${res.totalFailed} failed. Review the details.`, 'warn');
      } else if (auditWarnings.length > 0) {
        toast(`Azure accepted ${res.totalClosed} closure(s), but ${auditWarnings.length} audit record(s) failed to save. Review Logs and reconcile before another run.`, 'warn');
      } else {
        toast(`Azure accepted ${res.totalClosed} closure(s). Confirm final state in Azure DevOps.`, 'ok');
      }
    }
    refreshDashboard();
  } catch (err) {
    state.eodPreviewReadyAt = 0;
    if (executeBtn) executeBtn.style.display = 'none';
    toast(`EOD closure failed: ${err.message}`, 'err');
    if (summaryEl) summaryEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeHtml(err.message)}</span>`;
  }
}

async function triggerActivation(dryRun = false) {
  let scope;
  try { scope = lifecycleSelection(); } catch (error) { toast(error.message, 'warn'); return; }
  const signature = JSON.stringify(scope);
  if (!dryRun && state.activePreviewScope !== signature) {
    toast('Member scope changed. Preview activation again.', 'warn');
    return;
  }
  if (!dryRun) {
    if (!state.activePreviewReadyAt || Date.now() - state.activePreviewReadyAt > 120000) {
      toast('Preview activation before executing. The preview must be less than two minutes old.', 'warn');
      triggerActivation(true);
      return;
    }
    if (!window.confirm("Activate the tasks shown in the preview? Existing descriptions and recorded work values will be preserved.")) return;
    state.activePreviewReadyAt = 0;
  } else {
    state.activePreviewReadyAt = 0;
  }

  const modal = $('#activeModal');
  const summaryEl = $('#activeModalSummary');
  const tbody = $('#activeModalTable tbody');
  const executeBtn = $('#btnExecuteActiveConfirmed');
  const title = $('#activeModalTitle');

  if (title) title.textContent = dryRun ? "Daily Task Activation Preview (Dry Run)" : "Activating Today's Tasks...";
  if (executeBtn) executeBtn.style.display = 'none';

  showModal('#activeModal', '#btnCloseActiveModal');
  if (summaryEl) summaryEl.innerHTML = '<span class="muted">Loading candidate tasks and fetching GitHub PR deliverables...</span>';
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">Analyzing tasks for today...</td></tr>';

  try {
    const res = await api.post('/tasks/activate-today', { dryRun, ...scope, confirm: !dryRun });
    if (dryRun) state.activePreviewScope = signature;
    state.lastActiveResult = res;

    if (summaryEl) {
      summaryEl.innerHTML = '';
      summaryEl.append(
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalFound)), el('span', {}, 'Tasks Found')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalActivated)), el('span', {}, dryRun ? 'Eligible to Activate' : 'Activated Successfully')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalAlreadyActive)), el('span', {}, 'Already Active (Untouched)')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalAlreadyClosed)), el('span', {}, 'Already Closed')]),
        el('div', { class: 'stat-chip' }, [el('b', {}, String(res.totalFailed)), el('span', {}, 'Failed')]),
      );
    }

    if (tbody) {
      tbody.innerHTML = '';
      if (!res.results || res.results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center; padding:24px;">No candidate tasks found for today.</td></tr>';
      } else {
        for (const r of res.results) {
          const prBadge = r.prCount > 0
            ? el('span', { class: 'pill ok' }, `${r.prCount} PR(s) today`)
            : el('span', { class: 'pill muted' }, '0 PRs today');

          let statusBadge;
          if (r.status === 'activated') {
            statusBadge = el('span', { class: 'pill ok' }, r.verified ? 'Activation verified' : 'Accepted; verification pending');
          } else if (r.status === 'simulated') {
            statusBadge = el('span', { class: 'state-pill ready-activate' }, 'Ready to Activate');
          } else if (r.status === 'already_active') {
            statusBadge = el('span', { class: 'state-pill already-active' }, 'Already Active');
          } else if (r.status === 'already_closed') {
            statusBadge = el('span', { class: 'pill muted' }, 'Already Closed');
          } else {
            statusBadge = el('span', { class: 'pill danger' }, 'Failed');
          }

          const tr = el('tr', {}, [
            el('td', { style: 'font-weight:600;' }, r.personName),
            el('td', {}, [
              el('a', { href: getAdoWorkItemUrl(r.taskId), target: '_blank', class: 'ado-link' }, `#${r.taskId} ↗`),
              el('div', { class: 'muted small' }, r.taskTitle),
            ]),
            el('td', {}, el('code', {}, r.githubUsername || '—')),
            el('td', {}, [
              el('div', {}, prBadge),
              el('div', { class: 'muted small', style: 'max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, r.summaryText),
            ]),
            el('td', {}, el('span', { class: 'pill muted' }, r.previousState || 'Not recorded')),
            el('td', {}, statusBadge),
          ]);
          tbody.append(tr);
        }
      }
    }

    if (dryRun && res.totalActivated > 0 && res.totalFailed === 0) state.activePreviewReadyAt = Date.now();
    if (executeBtn) {
      if (dryRun && res.totalActivated > 0 && res.totalFailed === 0) {
        executeBtn.style.display = 'inline-block';
        executeBtn.disabled = false;
        executeBtn.textContent = `Execute Activation in Azure DevOps (${res.totalActivated} tasks)`;
      } else {
        executeBtn.style.display = 'none';
      }
    }

    if (dryRun) {
      if (res.totalFailed > 0) {
        toast(`Activation preview incomplete: ${res.totalFailed} task(s) failed checks.`, 'warn');
      } else if (res.totalActivated === 0 && res.totalAlreadyActive > 0) {
        toast(`All candidate task(s) (${res.totalAlreadyActive}) are already active.`, 'ok');
      } else {
        toast(`Preview complete: ${res.totalActivated} task(s) eligible for activation.`, 'ok');
      }
    } else {
      if (res.totalFailed > 0) {
        toast(`Activation partially failed: ${res.totalActivated} activated, ${res.totalFailed} failed.`, 'warn');
      } else {
        toast(`Azure accepted ${res.totalActivated} task activation(s).`, 'ok');
      }
    }
    refreshDashboard();
  } catch (err) {
    state.activePreviewReadyAt = 0;
    if (executeBtn) executeBtn.style.display = 'none';
    toast(`Task activation failed: ${err.message}`, 'err');
    if (summaryEl) summaryEl.innerHTML = `<span style="color:var(--danger);">Error: ${escapeHtml(err.message)}</span>`;
  }
}

/* ----------------------------------------------------------------- settings */
async function fillSettings() {
  const cfg = await ensureConfig();
  if ($('#setOrg')) $('#setOrg').value = cfg.organization || '';
  if ($('#setProject')) $('#setProject').value = cfg.project || '';
  if ($('#setWorkItemType')) $('#setWorkItemType').value = cfg.workItemType || '3in1 Task';
  if ($('#setTitlePrefix')) $('#setTitlePrefix').value = cfg.titlePrefix || '3in1_PWA_MyAccount |';
  if ($('#setTz')) $('#setTz').value = cfg.timezone || 'Asia/Kolkata';
  if ($('#setStart')) $('#setStart').value = cfg.startTime || '09:30';
  if ($('#setGhToken')) {
    $('#setGhToken').value = '';
    if (cfg.githubToken) {
      $('#setGhToken').placeholder = `Configured (${cfg.githubToken})`;
    } else {
      $('#setGhToken').placeholder = 'Enter an optional GitHub access token';
    }
  }
  if ($('#setGhOrg')) $('#setGhOrg').value = cfg.githubOrg || '';
  if ($('#setGhSuffix')) $('#setGhSuffix').value = cfg.githubUserSuffix || '_bflghec';
}

async function saveSettings() {
  try {
    const body = {
      organization: $('#setOrg').value.trim(),
      project: $('#setProject').value.trim(),
      workItemType: $('#setWorkItemType')?.value.trim() || undefined,
      titlePrefix: $('#setTitlePrefix')?.value.trim() || undefined,
      timezone: $('#setTz').value.trim(),
      startTime: $('#setStart').value.trim(),
    };
    await api.post('/config/settings', body);
    api.invalidateCache('/config');
    api.invalidateCache('/status');
    state.config = null;
    toast('Settings saved successfully', 'ok');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function saveGhSettings() {
  try {
    const rawToken = $('#setGhToken')?.value?.trim();
    const body = {
      githubToken: rawToken && !rawToken.includes('...') ? rawToken : undefined,
      githubOrg: $('#setGhOrg')?.value?.trim() || undefined,
      githubUserSuffix: $('#setGhSuffix')?.value?.trim() || '_bflghec',
    };
    await api.post('/config/settings', body);
    api.invalidateCache('/config');
    api.invalidateCache('/status');
    state.config = null;
    toast('GitHub settings saved successfully', 'ok');
    refreshStatus();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function testGhResolution() {
  const cfg = await ensureConfig();
  const defaultEmail = cfg.people?.[0]?.assignedTo || '';
  const email = prompt('Enter a corporate email to test GitHub login resolution and PR deliverables:', defaultEmail);
  if (!email) return;

  const resWrap = $('#ghTestResult');
  if (resWrap) {
    resWrap.style.display = 'block';
    resWrap.innerHTML = '<span class="muted">Testing GitHub user resolution & fetching PRs...</span>';
  }

  try {
    const data = await api.get(`/github/test-user?email=${encodeURIComponent(email)}`);
    if (resWrap) {
      const d = data.deliverables;
      resWrap.innerHTML = `
        <div style="margin-bottom:8px;">
          <strong>Email:</strong> <code>${escapeHtml(data.email)}</code> &rarr; <strong>Candidate GitHub Login (not independently verified):</strong> <code style="color:var(--brand-glow); font-size:14px;">${escapeHtml(data.username)}</code>
        </div>
        <div style="margin-bottom:8px;">
          <strong>Deliverables:</strong> ${d.isToday ? '<span class="pill ok">' + (d.pullRequests?.length || 0) + ' PR(s) Today (' + d.sourceDate + ')</span>' : '<span class="pill muted">0 PRs Today (' + d.sourceDate + ')</span>'}
          <span style="margin-left:8px;">${escapeHtml(d.summaryText)}</span>
        </div>
        <div style="border-top:1px solid var(--border); padding-top:8px; font-size:12.5px;">
          <strong>Generated Description Preview:</strong>
          <div style="background:var(--surface); padding:8px 12px; border-radius:4px; margin-top:4px;">
            ${d.htmlDescription}
          </div>
        </div>
      `;
    }
    toast(`GitHub PR lookup completed for candidate username ${data.username}; verify identity in GitHub.`, 'warn');
  } catch (err) {
    if (resWrap) {
      resWrap.innerHTML = `<span style="color:var(--danger);">Resolution error: ${escapeHtml(err.message)}</span>`;
    }
    toast(`GitHub test failed: ${err.message}`, 'err');
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
    api.invalidateCache('/config');
    api.invalidateCache('/status');
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
async function openAdHocModal(defaultPersonKey, defaultDate) {
  const modal = $('#adHocModal');
  if (!modal) return;

  const cfg = await ensureConfig();
  const members = (state.people && state.people.length > 0) ? state.people : (cfg.people || []);

  const select = $('#adHocPersonSelect');
  if (select) {
    select.innerHTML = '';
    members.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = `${p.name} (${p.assignedTo})`;
      select.appendChild(opt);
    });
    if (defaultPersonKey) select.value = defaultPersonKey;
  }

  const dateInput = $('#adHocTargetDate');
  if (dateInput) {
    dateInput.value = defaultDate || isoDateInTimeZone(new Date(), cfg.timezone);
  }

  if ($('#adHocTitleInput')) $('#adHocTitleInput').value = '';
  if ($('#adHocSourceTaskId')) $('#adHocSourceTaskId').value = '';
  if ($('#adHocEstimateInput')) $('#adHocEstimateInput').value = '';
  if ($('#adHocActivityInput')) $('#adHocActivityInput').value = '';
  if ($('#adHocDescriptionInput')) $('#adHocDescriptionInput').value = '';
 
  showModal('#adHocModal', '#adHocPersonSelect');
}

function closeAdHocModal() {
  hideModal('#adHocModal');
}

async function submitAdHocTask() {
  const personKey = $('#adHocPersonSelect')?.value;
  const targetIsoDate = $('#adHocTargetDate')?.value;
  if (!personKey || !targetIsoDate) {
    toast('Please select an assignee and target date', 'warn');
    return;
  }
  if (!window.confirm(`Create a real Azure DevOps work item for ${personKey} on ${targetIsoDate}? This action writes to the configured project.`)) {
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
      confirm: true,
      personKey,
      targetIsoDate,
      customTitle: $('#adHocTitleInput')?.value?.trim() || undefined,
      sourceTaskId: $('#adHocSourceTaskId')?.value ? parseInt($('#adHocSourceTaskId').value, 10) : undefined,
      originalEstimate: $('#adHocEstimateInput')?.value ? parseFloat($('#adHocEstimateInput').value) : undefined,
      activity: $('#adHocActivityInput')?.value?.trim() || undefined,
      description: $('#adHocDescriptionInput')?.value?.trim() || undefined,
     };

     toast('Creating task in Azure DevOps...');
    const res = await api.post('/tasks/adhoc', payload);
    const created = res.task;

    if (res.auditWarning) {
      toast(`Created Azure task #${created.id}, but audit needs attention: ${res.auditWarning}`, 'warn');
    } else {
      toast(`Created Azure task #${created.id} - ${created.title}`, 'ok');
    }
    closeAdHocModal();

    // Trigger UI updates
    refreshDashboard();
    if (state.currentView === 'planner') runPlanPreview();
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
let drawerPreviousFocus = null;

function openConsoleDrawer() {
  const drawer = $('#executionDrawer');
  if (!drawer || drawer.classList.contains('open')) return;
  drawerPreviousFocus = document.activeElement;
  drawer.classList.add('open');
  $('#consoleBtn')?.setAttribute('aria-expanded', 'true');
  $('#btnCloseDrawer')?.focus();
}

function closeConsoleDrawer() {
  $('#executionDrawer')?.classList.remove('open');
  $('#consoleBtn')?.setAttribute('aria-expanded', 'false');
  if (drawerPreviousFocus?.isConnected && !drawerPreviousFocus.disabled) drawerPreviousFocus.focus();
  else $('#consoleBtn')?.focus();
  drawerPreviousFocus = null;
}

function toggleConsoleDrawer() {
  if ($('#executionDrawer')?.classList.contains('open')) closeConsoleDrawer();
  else openConsoleDrawer();
}

const logBuffer = {
  entries: [],
  max: 500,
  level: 'ALL',
  query: '',
  drawerLevel: 'ALL',
};

function renderLogStream() {
  const term = $('#logStream');
  if (!term) return;
  const filtered = logBuffer.entries.filter(e => {
    if (logBuffer.level !== 'ALL' && e.level !== logBuffer.level) return false;
    if (logBuffer.query && !e.line.toLowerCase().includes(logBuffer.query)) return false;
    return true;
  });
  term.textContent = filtered.map(e => e.line).join('');
  term.scrollTop = term.scrollHeight;
}

function renderDrawerLogs() {
  const drawerBody = $('#drawerBody');
  if (!drawerBody) return;
  const filtered = logBuffer.entries.filter(e => {
    if (logBuffer.drawerLevel !== 'ALL' && e.level !== logBuffer.drawerLevel) return false;
    return true;
  });
  drawerBody.textContent = '';
  filtered.forEach(e => {
    const span = document.createElement('div');
    span.textContent = e.line.trim();
    drawerBody.append(span);
  });
  drawerBody.scrollTop = drawerBody.scrollHeight;
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
      const item = { level: entry.level, line, timestamp: entry.timestamp };

      logBuffer.entries.push(item);
      if (logBuffer.entries.length > logBuffer.max) {
        logBuffer.entries.shift();
      }

      if (term) {
        const matchesLevel = logBuffer.level === 'ALL' || item.level === logBuffer.level;
        const matchesQuery = !logBuffer.query || item.line.toLowerCase().includes(logBuffer.query);
        if (matchesLevel && matchesQuery) {
          // Sticky scroll: only auto-scroll if user is near bottom
          const isNearBottom = term.scrollHeight - term.scrollTop - term.clientHeight < 40;
          term.append(document.createTextNode(line));
          if (term.childNodes.length > 500) {
            term.removeChild(term.firstChild);
          }
          if (isNearBottom) {
            term.scrollTop = term.scrollHeight;
          }
        }
      }

      if (drawerBody) {
        const matchesDrawerLevel = logBuffer.drawerLevel === 'ALL' || item.level === logBuffer.drawerLevel;
        if (matchesDrawerLevel) {
          const isNearBottom = drawerBody.scrollHeight - drawerBody.scrollTop - drawerBody.clientHeight < 40;
          const span = document.createElement('div');
          span.textContent = line.trim();
          drawerBody.append(span);
          if (drawerBody.children.length > 500) {
            drawerBody.firstElementChild?.remove();
          }
          if (isNearBottom) {
            drawerBody.scrollTop = drawerBody.scrollHeight;
          }
        }
      }
    } catch {
      // ignore parse errors
    }
  };
}

/* ------------------------------------------------------------- wiring up */
function wire() {
  // Navigation tabs and links between user journeys.
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-view-link]');
    if (!link) return;
    e.preventDefault();
    switchView(link.dataset.viewLink);
    $('#viewTitle')?.focus({ preventScroll: true });
  });

  $('#navBackdrop')?.addEventListener('click', () => closeMobileNav(true));
  // Navigation tabs
  $$('.nav-item').forEach(b => {
    b.addEventListener('click', () => {
      switchView(b.dataset.view);
      $('#viewTitle')?.focus({ preventScroll: true });
    });
  });

  // Topbar triggers
  $('#refreshBtn')?.addEventListener('click', () => {
    state.isDataDirty = true;
    switchView(state.currentView);
    toast('Refreshing this view…');
  });

  $('#quickRunBtn')?.addEventListener('click', () => {
    switchView('planner');
    $('#viewTitle')?.focus({ preventScroll: true });
  });

  $('#consoleBtn')?.addEventListener('click', toggleConsoleDrawer);
  $('#btnCloseDrawer')?.addEventListener('click', closeConsoleDrawer);

  // Live Logs controls
  $('#logLevelFilter')?.addEventListener('change', (e) => {
    logBuffer.level = e.target.value;
    renderLogStream();
  });
  $('#logSearchInput')?.addEventListener('input', (e) => {
    logBuffer.query = e.target.value.toLowerCase().trim();
    renderLogStream();
  });
  $('#btnClearLogs')?.addEventListener('click', () => {
    logBuffer.entries = [];
    const term = $('#logStream');
    if (term) term.textContent = '';
  });

  // Drawer Log controls
  $('#drawerLevelFilter')?.addEventListener('change', (e) => {
    logBuffer.drawerLevel = e.target.value;
    renderDrawerLogs();
  });
  $('#btnClearDrawerLogs')?.addEventListener('click', () => {
    const drawerBody = $('#drawerBody');
    if (drawerBody) drawerBody.textContent = '';
  });

  // Theme toggle
  $('#themeToggle')?.addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') !== 'light';
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
    syncThemeToggle();
    if (state.overviewChartData) renderOverviewCharts(state.overviewChartData);
    try { 
      localStorage.setItem('theme', isDark ? 'light' : 'dark'); 
    } catch {
      // localStorage may be unavailable (private browsing, quota exceeded); theme still applied visually
    }
  });

  // Planner controls
  $('#planBtn')?.addEventListener('click', runPlanPreview);
  $('#executeBtn')?.addEventListener('click', openConfirmationModal);
  $('#btnConfirmExecute')?.addEventListener('click', executeCreation);
  $('#btnCancelConfirmModal')?.addEventListener('click', () => hideModal('#confirmModal'));
  $('#btnCloseConfirmModal')?.addEventListener('click', () => hideModal('#confirmModal'));

  $('#asOf')?.addEventListener('change', runPlanPreview);
  $('#thursdayMode')?.addEventListener('change', runPlanPreview);

  $('#btnSimulateWindow')?.addEventListener('click', () => {
    const today = state.todayIso || isoDateInTimeZone(new Date(), state.config?.timezone);
    // Advance date to next Friday (day 5) or by 7 days to simulate following week
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
    const daysUntilNextFri = (5 - dow + 7) % 7 || 7;
    dt.setUTCDate(dt.getUTCDate() + daysUntilNextFri);
    const simDate = dt.toISOString().slice(0, 10);
    const asOfInput = $('#asOf');
    if (asOfInput) asOfInput.value = simDate;
    toast(`Previewing planning window as of ${simDate}. No tasks have been created.`, 'ok');
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
      state.deselectedKeys = new Set();
      active.forEach(p => state.selectedKeys.add(p.key));
      updatePlannerMemberPill(active.length);
      renderPlannerPeople();
      runPlanPreview();
    });
  });

  $('#plannerDeselectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      const active = cfg.people.filter(p => p.enabled !== false);
      state.selectedKeys.clear();
      state.deselectedKeys = new Set(active.map(p => p.key));
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
    $('#btnTogglePlanMatrix').setAttribute('aria-pressed', 'true');
    $('#btnTogglePlanList').setAttribute('aria-pressed', 'false');
  });

  $('#btnTogglePlanList')?.addEventListener('click', () => {
    $('#planMatrixWrap').style.display = 'none';
    $('#planListWrap').style.display = 'block';
    $('#btnTogglePlanList').classList.add('active-tab-btn');
    $('#btnTogglePlanMatrix').classList.remove('active-tab-btn');
    $('#btnTogglePlanList').setAttribute('aria-pressed', 'true');
    $('#btnTogglePlanMatrix').setAttribute('aria-pressed', 'false');
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
      state.deselectedExplorerKeys = new Set();
      cfg.people.filter(p => p.enabled !== false).forEach(p => state.selectedExplorerKeys.add(p.key));
      renderExplorerUserPills(cfg);
      refreshExplorer();
    });
  });
  $('#explorerDeselectAllBtn')?.addEventListener('click', () => {
    ensureConfig().then(cfg => {
      const active = cfg.people.filter(p => p.enabled !== false);
      state.selectedExplorerKeys.clear();
      state.deselectedExplorerKeys = new Set(active.map(p => p.key));
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
    $('#btnToggleMatrixView').classList.add('active-tab-btn');
    $('#btnToggleListView').classList.remove('active-tab-btn');
    $('#btnToggleMatrixView').setAttribute('aria-pressed', 'true');
    $('#btnToggleListView').setAttribute('aria-pressed', 'false');
  });
  $('#btnToggleListView')?.addEventListener('click', () => {
    $('#explorerMatrixWrap').style.display = 'none';
    $('#explorerListWrap').style.display = 'block';
    $('#btnToggleListView').classList.add('active-tab-btn');
    $('#btnToggleMatrixView').classList.remove('active-tab-btn');
    $('#btnToggleListView').setAttribute('aria-pressed', 'true');
    $('#btnToggleMatrixView').setAttribute('aria-pressed', 'false');
  });
  $('#explorerListSearch')?.addEventListener('input', () => {
    renderExplorerList(state.explorerData?.detailedTasks || []);
  });
  $('#explorerCreateMissingBtn')?.addEventListener('click', () => {
    switchView('planner');
    toast('Review the selected team and date window before confirming creation.');
    $('#viewTitle')?.focus({ preventScroll: true });
  });

  // Dismiss modal on backdrop click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hideModal(overlay);
      }
    });
  });

  // Global keyboard handling: trap modal focus and allow dismissing overlays.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') trapModalFocus(e);
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.modal-overlay.open');
      if (openModal) {
        hideModal(openModal);
        e.preventDefault();
        return;
      }
      const openDrawer = document.querySelector('.drawer.open');
      if (openDrawer) {
        closeConsoleDrawer();
        e.preventDefault();
        return;
      }
      if ($('#sidebar')?.classList.contains('open')) {
        closeMobileNav(true);
        e.preventDefault();
      }
    }
  });

  // Modals close buttons
  $('#btnCloseDateInspectModal')?.addEventListener('click', () => hideModal('#dateInspectModal'));
  $('#btnCloseDateInspectBtn')?.addEventListener('click', () => hideModal('#dateInspectModal'));
  $('#btnCloseUserInspectModal')?.addEventListener('click', () => hideModal('#userInspectModal'));
  $('#btnCloseUserInspectBtn')?.addEventListener('click', () => hideModal('#userInspectModal'));
  $('#btnClosePersonModal')?.addEventListener('click', () => hideModal('#personModal'));
  $('#btnCancelPersonModal')?.addEventListener('click', () => hideModal('#personModal'));

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
  $('#eodSaveConfigBtn')?.addEventListener('click', saveEodSchedulerConfig);
  $('#activeSaveConfigBtn')?.addEventListener('click', saveActiveSchedulerConfig);

  // Daily Activation (5:30 PM) triggers
  $('#lifecycleActivatePreview')?.addEventListener('click', () => triggerActivation(true));
  $('#lifecycleClosePreview')?.addEventListener('click', () => triggerEodClosure(true));
  $('#lifecycleSelectAll')?.addEventListener('click', async () => {
    const config = await ensureConfig();
    state.lifecycleKeys = new Set(config.people.filter(person => person.enabled !== false).map(person => person.key));
    state.eodPreviewReadyAt = 0;
    state.activePreviewReadyAt = 0;
    renderLifecycleScope();
  });
  $('#lifecycleClear')?.addEventListener('click', () => {
    state.lifecycleKeys.clear();
    state.eodPreviewReadyAt = 0;
    state.activePreviewReadyAt = 0;
    renderLifecycleScope();
  });
  $('#activateTodayTasksBtn')?.addEventListener('click', () => triggerActivation(true));
  $('#dashboardActivateTodayBtn')?.addEventListener('click', () => triggerActivation(true));
  $('#plannerActivateTodayBtn')?.addEventListener('click', () => triggerActivation(true));
  $('#activePreviewBtn')?.addEventListener('click', () => triggerActivation(true));
  $('#activeRunNowBtn')?.addEventListener('click', () => triggerActivation(true));
  $('#btnCloseActiveModal')?.addEventListener('click', () => hideModal('#activeModal'));
  $('#btnCloseActiveModalBtn')?.addEventListener('click', () => hideModal('#activeModal'));
  $('#btnExecuteActiveConfirmed')?.addEventListener('click', () => triggerActivation(false));

  // End-of-Day Closure triggers
  $('#closeTodayTasksBtn')?.addEventListener('click', () => triggerEodClosure(true));
  $('#dashboardCloseTodayBtn')?.addEventListener('click', () => triggerEodClosure(true));
  $('#plannerCloseTodayBtn')?.addEventListener('click', () => triggerEodClosure(true));
  $('#eodPreviewBtn')?.addEventListener('click', () => triggerEodClosure(true));
  $('#eodRunNowBtn')?.addEventListener('click', () => triggerEodClosure(true));
  $('#btnCloseEodModal')?.addEventListener('click', () => hideModal('#eodModal'));
  $('#btnCloseEodModalBtn')?.addEventListener('click', () => hideModal('#eodModal'));
  $('#btnExecuteEodConfirmed')?.addEventListener('click', () => triggerEodClosure(false));

  // Per-person auto-close bulk actions
  $('#eodAutoCloseSelectAllBtn')?.addEventListener('click', async () => {
    const allPeople = (state.config && state.config.people) ? state.config.people : (state.people || []);
    for (const p of allPeople) p.autoCloseEnabled = true;
    if (state.people) for (const p of state.people) p.autoCloseEnabled = true;
    renderEodAutoClosePersonList();
    try {
      await api.post('/config/people', { people: allPeople });
      api.invalidateCache('/config');
      toast('All members included in auto-close', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#eodAutoCloseDeselectAllBtn')?.addEventListener('click', async () => {
    const allPeople = (state.config && state.config.people) ? state.config.people : (state.people || []);
    for (const p of allPeople) p.autoCloseEnabled = false;
    if (state.people) for (const p of state.people) p.autoCloseEnabled = false;
    renderEodAutoClosePersonList();
    try {
      await api.post('/config/people', { people: allPeople });
      api.invalidateCache('/config');
      toast('All members excluded from auto-close', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  });

  // Settings controls
  $('#saveSettingsBtn')?.addEventListener('click', saveSettings);
  $('#savePatBtn')?.addEventListener('click', savePat);
  $('#testConnBtn')?.addEventListener('click', testConnection);
  $('#saveGhSettingsBtn')?.addEventListener('click', saveGhSettings);
  $('#testGhBtn')?.addEventListener('click', testGhResolution);

  async function repairRelationships(btn) {
    if (!window.confirm('Repair incomplete task relationships in Azure DevOps? This may update existing work-item links.')) return;
    toast('Repairing incomplete relationships...');
    if (btn) { btn.disabled = true; btn.textContent = 'Repairing...'; }
    try {
      const res = await api.post('/tasks/repair', { confirm: true });
      if (res.total === 0) {
        toast('No incomplete relations found. Everything is healthy!', 'ok');
      } else {
        toast(`Repaired ${res.repaired} of ${res.total} task relation(s).`, res.failed > 0 ? 'warn' : 'ok');
      }
      refreshJournal();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Repair Relationships'; }
    }
  }

  $('#btnRepairAll')?.addEventListener('click', (e) => repairRelationships(e.currentTarget));
  $('#journalRepairBtn')?.addEventListener('click', (e) => repairRelationships(e.currentTarget));

  $('#refreshDailyPrBtn')?.addEventListener('click', () => {
    refreshDailyPrCounts({ forceFresh: true });
    toast('Refreshing daily PR counts from GitHub...', 'ok');
  });

  // Calendar controls (S09)
  $('#calendarAddExceptionBtn')?.addEventListener('click', openAddExceptionModal);
  $('#refreshCalendarBtn')?.addEventListener('click', () => loadCalendar());
  $('#calendarSaveBtn')?.addEventListener('click', saveCalendar);

  $('#togglePatEye')?.addEventListener('click', () => {
    const input = $('#setPat');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const showing = input.type === 'text';
    const toggle = $('#togglePatEye');
    if (toggle) {
      toggle.textContent = showing ? 'Hide' : 'Show';
      toggle.setAttribute('aria-label', showing ? 'Hide Azure DevOps token' : 'Show Azure DevOps token');
      toggle.setAttribute('aria-pressed', String(showing));
    }
  });

  // Mobile drawer menu
  $('#menuBtn')?.addEventListener('click', () => {
    const opened = $('#sidebar')?.classList.toggle('open');
    $('#navBackdrop')?.classList.toggle('open', Boolean(opened));
    $('#menuBtn')?.setAttribute('aria-expanded', String(Boolean(opened)));
    $('#menuBtn')?.setAttribute('aria-label', opened ? 'Close navigation' : 'Open navigation');
    if (opened) $('.sidebar .nav-item.active')?.focus();
  });

  // Hash routing
  window.addEventListener('hashchange', handleHashNavigation);
}

// One read-only session check determines whether write controls should appear
// actionable. The server still enforces the role on every HTTP request.
function applyViewerMode() {
  if (!state.viewerMode) return;
  const main = document.querySelector('main');
  if (main && !$('#viewerModeNotice')) {
    main.prepend(el('div', {
      id: 'viewerModeNotice', class: 'workflow-note', role: 'status'
    }, 'Read-only viewer: inspect data and previews here. Task creation, closure, scheduler changes and configuration edits require operator credentials.'));
  }
  [
    '#executeBtn', '#openAdHocModalBtn', '#btnSubmitAdHocTask', '#explorerCreateMissingBtn',
    '#savePeopleBtn', '#addPersonBtn',
    '#schedSaveConfigBtn', '#schedRunNowBtn', '#eodSaveConfigBtn',
    '#btnExecuteEodConfirmed', '#btnExecuteActiveConfirmed', '#activeSaveConfigBtn', '#saveSettingsBtn', '#savePatBtn',
    '#saveGhSettingsBtn', '#journalRepairBtn', '#btnRepairAll',
    '#calendarSaveBtn', '#calendarAddExceptionBtn',
  ].forEach(selector => {
    const button = $(selector);
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      button.title = 'Operator authorization required';
    }
  });
  const schedulerToggle = $('#schedToggle');
  if (schedulerToggle) schedulerToggle.disabled = true;
}

/* ---------------------------------------------------------------- bootstrap */
function syncThemeToggle() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const toggle = $('#themeToggle');
  toggle?.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  toggle?.setAttribute('aria-pressed', String(isDark));
}

async function bootstrap() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch {
    // localStorage may be unavailable (private browsing); use default theme
  }

  syncThemeToggle();
  wire();
  connectLogStream();
  try {
    const session = await api.get('/session', { forceFresh: true });
    state.viewerMode = session?.role === 'viewer';
    applyViewerMode();
  } catch (error) {
    // Permission failure is visible. Never assume a failed role lookup grants
    // operator rights on a production session.
    state.viewerMode = true;
    applyViewerMode();
    toast('Could not verify operator permissions; write controls are disabled.', 'warn');
  }

  const initial = location.hash.slice(1) || 'dashboard';
  switchView(initial);
  refreshStatus();

  // Periodically refresh connection status every 30s
  setInterval(() => {
    refreshStatus();
  }, 30000);
}

document.addEventListener('DOMContentLoaded', bootstrap);
