// Azure DevOps 3in1 Task Automation Studio - Client Application

let appState = {
  config: null,
  status: null,
  planData: null,
  journal: null,
  scheduler: null,
  activeTab: 'dashboard',
  simulationDate: null,
  explorerData: null,
  explorerSelectedUsers: [],
  explorerViewMode: 'matrix',
  explorerSearchQuery: '',
  explorerSort: { col: 'date', asc: true },
  explorerStateFilter: 'all',
  explorerStatusFilter: 'all',
};

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupTabs();
  setupEventListeners();
  loadAll();
});

// Theme Management
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);

  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  document.getElementById('themeIcon').textContent = theme === 'dark' ? '☀️' : '🌙';
}

// Tab Navigation
function setupTabs() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  
  const syncHash = () => {
    let target = window.location.hash.substring(1);
    const validTabs = Array.from(tabs).map(t => t.getAttribute('data-tab'));
    if (!validTabs.includes(target)) {
      target = validTabs[0] || 'overview';
    }
    
    appState.activeTab = target;
    tabs.forEach((t) => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    
    const activeTabBtn = document.querySelector(`.nav-tab-btn[data-tab="${target}"]`);
    const activePane = document.getElementById(`tab-${target}`);
    
    if (activeTabBtn) {
      activeTabBtn.classList.add('active');
      activeTabBtn.setAttribute('aria-selected', 'true');
    }
    if (activePane) activePane.classList.add('active');
    
    if (target === 'explorer') loadExplorer();
    if (target === 'team') renderTeamTable();
    if (target === 'burndown') loadBurndown();
  };

  window.addEventListener('hashchange', syncHash);

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      window.location.hash = target;
    });
  });

  syncHash();
}

// Event Listeners
function setupEventListeners() {
  const btnLoadBurndown = document.getElementById('btnLoadBurndown');
  if (btnLoadBurndown) {
    btnLoadBurndown.addEventListener('click', () => {
      const selector = document.getElementById('burndownMonthSelector');
      const selectedMonth = selector ? selector.value : null;
      loadBurndown(selectedMonth);
    });
  }

  document.getElementById('btnRefreshMatrix').addEventListener('click', () => {
    appState.simulationDate = null;
    loadLiveMatrix();
  });

  document.getElementById('btnSimulateWindow').addEventListener('click', () => {
    // Dynamic next cycle simulation date
    const today = getTodayIsoBrowser();
    const nextThu = getNextThursdayBrowser(today, appState.config?.thursdayMode || 'CURRENT');
    const nextCycleDate = addDaysBrowser(nextThu, 1);
    appState.simulationDate = nextCycleDate;
    logToTerminal(`Simulating execution window as of next cycle (${appState.simulationDate})...`, 'info');
    loadLiveMatrix(appState.simulationDate);
  });

  document.getElementById('btnRunCreation').addEventListener('click', openConfirmModal);
  document.getElementById('btnConfirmExecute').addEventListener('click', executeTasks);
  document.getElementById('btnCancelConfirmModal').addEventListener('click', closeConfirmModal);
  document.getElementById('btnCloseConfirmModal').addEventListener('click', closeConfirmModal);

  document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);
  const btnToggleDrawer = document.getElementById('btnToggleDrawer');
  if (btnToggleDrawer) {
    btnToggleDrawer.addEventListener('click', () => {
      const drawer = document.getElementById('executionDrawer');
      if (drawer.classList.contains('active')) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }

  // Team Modal
  document.getElementById('btnAddPerson').addEventListener('click', () => openPersonModal());
  document.getElementById('btnClosePersonModal').addEventListener('click', closePersonModal);
  document.getElementById('btnCancelPersonModal').addEventListener('click', closePersonModal);
  document.getElementById('btnSavePerson').addEventListener('click', savePerson);

  // Date & User Inspect Modal close buttons
  const btnCloseDateInspect = document.getElementById('btnCloseDateInspectBtn');
  if (btnCloseDateInspect) btnCloseDateInspect.addEventListener('click', closeDateInspectModal);
  const btnCloseDateInspectModal = document.getElementById('btnCloseDateInspectModal');
  if (btnCloseDateInspectModal) btnCloseDateInspectModal.addEventListener('click', closeDateInspectModal);
  
  const btnCloseUserInspect = document.getElementById('btnCloseUserInspectBtn');
  if (btnCloseUserInspect) btnCloseUserInspect.addEventListener('click', closeUserInspectModal);
  const btnCloseUserInspectModal = document.getElementById('btnCloseUserInspectModal');
  if (btnCloseUserInspectModal) btnCloseUserInspectModal.addEventListener('click', closeUserInspectModal);

  // Settings
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);
  document.getElementById('btnTestConn').addEventListener('click', testConnection);
  const btnSavePat = document.getElementById('btnSavePat');
  if (btnSavePat) btnSavePat.addEventListener('click', savePat);

  const btnTogglePat = document.getElementById('btnTogglePatVisibility');
  if (btnTogglePat) {
    btnTogglePat.addEventListener('click', () => {
      const input = document.getElementById('settingPat');
      if (input.type === 'password') {
        input.type = 'text';
        btnTogglePat.textContent = '🙈';
        btnTogglePat.title = 'Hide PAT text';
      } else {
        input.type = 'password';
        btnTogglePat.textContent = '👁️';
        btnTogglePat.title = 'Show PAT text';
      }
    });
  }

  // Daily Scheduler Toggle
  const btnToggleSched = document.getElementById('btnToggleScheduler');
  if (btnToggleSched) btnToggleSched.addEventListener('click', toggleScheduler);

  // Repair

  document.getElementById('btnRepairAll').addEventListener('click', runRepair);

  // Task Explorer Event Listeners
  setupExplorerEventListeners();
}

// Initial Data Load
async function loadAll() {
  await loadStatus();
  await loadConfig();
  await loadScheduler();
  await loadLiveMatrix();
  await loadBurndown();
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.success) {
      appState.status = json.data;
      renderStatus(json.data);
    }
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

function renderStatus(status) {
  const badge = document.getElementById('connectionBadge');
  if (status.connected) {
    badge.className = 'badge-pill badge-connected';
    badge.innerHTML = '<span class="pulse-dot"></span> Azure DevOps Connected';
    badge.title = `Connected to ${status.organization}/${status.project}`;
  } else {
    badge.className = 'badge-pill badge-disconnected';
    badge.innerHTML = '<span class="pulse-dot"></span> Connection Error';
    badge.title = status.errorMessage || 'Connection verification failed';
  }

  document.getElementById('orgProjectTag').textContent = `${status.organization} / ${status.project}`;

  // Populate settings form
  document.getElementById('settingOrg').value = status.organization;
  document.getElementById('settingProject').value = status.project;
  document.getElementById('settingTimezone').value = status.timezone;
  document.getElementById('settingThursdayMode').value = status.thursdayMode;

  const patHint = document.getElementById('patStatusHint');
  if (patHint) {
    if (status.patConfigured && status.connected) {
      patHint.textContent = `Status: Active & Verified (Masked: ${status.patMasked || '••••••••'})`;
      patHint.style.color = 'var(--success)';
    } else if (status.patConfigured && !status.connected) {
      patHint.textContent = `Status: Configured, but connection failed: ${status.errorMessage || 'Check Organization / Project'}`;
      patHint.style.color = 'var(--warning)';
    } else {
      patHint.textContent = 'Status: Missing / Not Configured. Please enter a PAT to enable live operations.';
      patHint.style.color = 'var(--danger)';
    }
  }
}

async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.success) {
      appState.config = json.data;
      renderTeamTable();
      initExplorerUsers();
      document.getElementById('kpiPeopleCount').textContent = appState.config.people.length;
      document.getElementById('settingStartTime').value = appState.config.startTime || '09:30';
    }
  } catch (err) {
    console.error('Config fetch error:', err);
  }
}

async function loadLiveMatrix(asOfDate) {
  const tbody = document.getElementById('matrixBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">
        Analyzing Azure DevOps work items and planning creation window...
      </td>
    </tr>
  `;

  try {
    const url = asOfDate ? '/api/tasks/plan' : '/api/tasks/live';
    const opts = asOfDate
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asOf: asOfDate }),
        }
      : { method: 'GET' };

    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();

    if (json.success) {
      appState.planData = json.data;
      renderMatrix(json.data);
    } else {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">Error: ${json.error || 'Unknown error'}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--danger); padding: 2rem;">Failed to connect to backend: ${err.message}</td></tr>`;
  }
}

function renderMatrix(data) {
  const { todayIso, nextThursdayIso, personPlans } = data;

  // Window KPI
  document.getElementById('kpiWindowRange').textContent = `${formatDateShort(todayIso)} → ${formatDateShort(nextThursdayIso)}`;

  // Collect all unique planned dates across all person plans
  const dateMap = new Map();
  personPlans.forEach((p) => {
    p.plannedDates.forEach((d) => {
      if (!dateMap.has(d.isoDate)) {
        dateMap.set(d.isoDate, {
          isoDate: d.isoDate,
          formattedTitleDate: d.formattedTitleDate,
          dayOfWeekName: d.dayOfWeekName,
          isWeekend: d.isWeekend,
        });
      }
    });
  });

  const allDates = Array.from(dateMap.values()).sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  // Render Header
  const theadRow = document.getElementById('matrixHeaderRow');
  theadRow.innerHTML = '<th>Team Member</th>';
  allDates.forEach((d) => {
    const th = document.createElement('th');
    th.innerHTML = `<div>${d.formattedTitleDate}</div><div style="font-size: 0.725rem; font-weight: normal; color: var(--text-muted);">${d.dayOfWeekName}</div>`;
    theadRow.appendChild(th);
  });

  // Render Body
  const tbody = document.getElementById('matrixBody');
  tbody.innerHTML = '';

  let totalToCreate = 0;
  let totalExisting = 0;
  const plannedItemsList = [];

  personPlans.forEach((plan) => {
    const tr = document.createElement('tr');

    // Person name column
    const nameTd = document.createElement('td');
    nameTd.className = 'matrix-person-cell';
    const hasPlanned = plan.plannedDates.some((p) => p.status === 'PLANNED');
    const memberKey = plan.person.key || plan.person.name;
    nameTd.innerHTML = `
      <span>${plan.person.name}</span>
      <span class="matrix-person-email">${plan.person.assignedTo}</span>
      ${
        plan.sourceTask
          ? `<span style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Source: #${plan.sourceTask.workItem.id} (${plan.sourceTask.parsedDate.formattedTitleDate})</span>`
          : `<span style="font-size: 0.72rem; color: var(--warning);">⚠️ No valid source task</span>`
      }
      ${
        hasPlanned
          ? `<button class="btn btn-primary btn-sm btn-action-person" style="margin-top: 5px; padding: 2px 8px; font-size: 0.72rem; align-self: flex-start;" onclick="runForMember('${memberKey}')">⚡ Create for ${plan.person.name.split(' ')[0]}</button>`
          : ''
      }
    `;
    tr.appendChild(nameTd);

    // Each date column
    allDates.forEach((d) => {
      const td = document.createElement('td');
      const item = plan.plannedDates.find((p) => p.isoDate === d.isoDate);

      if (!item) {
        td.innerHTML = '<span style="color: var(--text-muted);">-</span>';
      } else if (item.status === 'WEEKEND_SKIP') {
        td.innerHTML = `<span class="status-pill status-weekend">Weekend</span>`;
      } else if (item.status === 'DUPLICATE_ALREADY_EXISTS' || item.status === 'DUPLICATE') {
        totalExisting++;
        const existingId = item.existingWorkItemIds && item.existingWorkItemIds[0];
        const link = existingId
          ? `https://dev.azure.com/${appState.status.organization}/${appState.status.project}/_workitems/edit/${existingId}`
          : '#';
        td.innerHTML = `
          <a href="${link}" target="_blank" class="status-pill status-duplicate" title="Task already exists" style="text-decoration: none;">
            ✓ #${existingId || 'Exist'}
          </a>
        `;
      } else if (item.status === 'MULTIPLE_EXISTING_TASKS') {
        totalExisting++;
        const ids = item.existingWorkItemIds || [];
        const links = ids.map(id => {
          const url = `https://dev.azure.com/${appState.status.organization}/${appState.status.project}/_workitems/edit/${id}`;
          return `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline;">#${id}</a>`;
        }).join(', ');
        td.innerHTML = `<span class="status-pill status-warning" title="${ids.length} tasks on this date: ${ids.map(id => '#'+id).join(', ')}">⚠️ ${ids.length}× ${links}</span>`;
      } else if (item.status === 'PLANNED') {
        totalToCreate++;
        plannedItemsList.push({
          person: plan.person,
          title: item.fullTitle,
          date: item.formattedTitleDate,
        });
        td.innerHTML = `<button class="status-pill status-planned btn-action-cell" style="cursor: pointer; border: 1px solid var(--brand-primary);" onclick="runForCell('${memberKey}', '${d.isoDate}')" title="Click to create task for ${plan.person.name} on ${d.formattedTitleDate}">+ Create (09:30)</button>`;
      } else {
        td.innerHTML = `<span class="status-pill status-warning">${item.status}</span>`;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  document.getElementById('kpiToCreateCount').textContent = totalToCreate;
  document.getElementById('kpiExistingCount').textContent = totalExisting;

  // Render Detailed Planned List Card
  const listContainer = document.getElementById('plannedTaskList');
  if (plannedItemsList.length === 0) {
    listContainer.innerHTML = `
      <div style="color: var(--text-muted); font-size: 0.9rem;">
        No pending tasks to create in this window. All configured team members have existing tasks or are ahead of the schedule!
      </div>
    `;
  } else {
    listContainer.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem;">
        ${plannedItemsList
          .map(
            (p) => `
          <div style="background: var(--bg-muted); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.75rem;">
            <div style="font-weight: 600; font-size: 0.875rem;">${p.title}</div>
            <div style="font-size: 0.775rem; color: var(--text-secondary); margin-top: 0.25rem;">
              Assignee: ${p.person.name} &bull; Start: 09:30 AM IST &bull; State: New
            </div>
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }
}

// Team Management
function renderTeamTable() {
  if (!appState.config || !appState.config.people) return;
  const tbody = document.getElementById('teamTableBody');
  tbody.innerHTML = '';

  appState.config.people.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong></td>
      <td><code>${escapeHtml(p.assignedTo)}</code></td>
      <td>${escapeHtml(p.pod || '-')}</td>
      <td>${escapeHtml(p.role || '-')}</td>
      <td>${p.sourceTaskId ? `<code>#${p.sourceTaskId}</code>` : '<span style="color: var(--text-muted);">Auto-discover latest</span>'}</td>
      <td>
        <span class="status-pill ${p.enabled !== false ? 'status-duplicate' : 'status-weekend'}">
          ${p.enabled !== false ? 'Enabled' : 'Disabled'}
        </span>
      </td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-primary btn-sm" onclick="runForMember('${p.key || p.name}')" title="Run task creation for ${p.name}">⚡ Run</button>
        <button class="btn btn-secondary btn-sm" onclick="editPerson(${idx})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deletePerson(${idx})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openPersonModal(index = null) {
  const modal = document.getElementById('personModal');
  const title = document.getElementById('personModalTitle');
  const nameInput = document.getElementById('personNameInput');
  const emailInput = document.getElementById('personEmailInput');
  const podInput = document.getElementById('personPodInput');
  const roleInput = document.getElementById('personRoleInput');
  const sourceIdInput = document.getElementById('personSourceIdInput');
  const editIndex = document.getElementById('editPersonIndex');

  if (index !== null) {
    const p = appState.config.people[index];
    title.textContent = 'Edit Team Member';
    nameInput.value = p.name;
    emailInput.value = p.assignedTo;
    if (podInput) podInput.value = p.pod || '';
    if (roleInput) roleInput.value = p.role || '';
    sourceIdInput.value = p.sourceTaskId || '';
    editIndex.value = index;
  } else {
    title.textContent = 'Add Team Member';
    nameInput.value = '';
    emailInput.value = '';
    if (podInput) podInput.value = '';
    if (roleInput) roleInput.value = '';
    sourceIdInput.value = '';
    editIndex.value = '';
  }

  modal.classList.add('active');
}

function closePersonModal() {
  document.getElementById('personModal').classList.remove('active');
}

function closeDateInspectModal() {
  document.getElementById('dateInspectModal').classList.remove('active');
}

function closeUserInspectModal() {
  document.getElementById('userInspectModal').classList.remove('active');
}

window.editPerson = (idx) => openPersonModal(idx);

window.deletePerson = async (idx) => {
  if (!confirm(`Are you sure you want to remove ${appState.config.people[idx].name}?`)) return;
  const people = [...appState.config.people];
  people.splice(idx, 1);
  await savePeopleToServer(people);
};

async function savePerson() {
  const name = document.getElementById('personNameInput').value.trim();
  const email = document.getElementById('personEmailInput').value.trim();
  const podInput = document.getElementById('personPodInput');
  const roleInput = document.getElementById('personRoleInput');
  const pod = podInput ? podInput.value.trim() : undefined;
  const role = roleInput ? roleInput.value.trim() : undefined;
  const sourceId = document.getElementById('personSourceIdInput').value.trim();
  const editIndex = document.getElementById('editPersonIndex').value;

  if (!name || !email) {
    alert('Please enter both name and email.');
    return;
  }

  const people = [...appState.config.people];
  const key = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  const personObj = {
    key,
    name,
    assignedTo: email,
    pod: pod || undefined,
    role: role || undefined,
    sourceTaskId: sourceId ? parseInt(sourceId, 10) : undefined,
    enabled: true,
  };

  if (editIndex !== '') {
    people[parseInt(editIndex, 10)] = personObj;
  } else {
    people.push(personObj);
  }

  await savePeopleToServer(people);
  closePersonModal();
}

async function savePeopleToServer(people) {
  try {
    const res = await fetch('/api/config/people', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ people }),
    });
    const json = await res.json();
    if (json.success) {
      await loadConfig();
      await loadLiveMatrix();
      await loadExplorer();
      await loadBurndown();
    } else {
      alert(`Error saving member: ${json.error}`);
    }
  } catch (err) {
    alert(`Failed to save: ${err.message}`);
  }
}

// Confirmation & Task Execution
function openConfirmModal() {
  const toCreateCount = parseInt(document.getElementById('kpiToCreateCount').textContent, 10);
  if (!toCreateCount || toCreateCount === 0) {
    alert('No tasks required to create for any member in the current window.');
    return;
  }

  const list = document.getElementById('confirmTaskList');
  list.innerHTML = '';
  appState.planData.personPlans.forEach((p) => {
    const toCreate = p.plannedDates.filter((d) => d.status === 'PLANNED');
    toCreate.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.fullTitle} for ${p.person.name} (${p.person.assignedTo})`;
      list.appendChild(li);
    });
  });

  document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('active');
}

let logEventSource = null;

function openDrawer() {
  const drawer = document.getElementById('executionDrawer');
  if (drawer) drawer.classList.add('active');
  connectLogStream();
}

function closeDrawer() {
  const drawer = document.getElementById('executionDrawer');
  if (drawer) drawer.classList.remove('active');
  disconnectLogStream();
}

function connectLogStream() {
  if (logEventSource) return;
  try {
    logEventSource = new EventSource('/api/logs/stream');
    logEventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'init' && Array.isArray(payload.logs)) {
          const drawerBody = document.getElementById('drawerBody');
          if (drawerBody && drawerBody.children.length === 0) {
            payload.logs.forEach((log) => {
              appendLogLine(log.message, log.level.toLowerCase(), log.timestamp);
            });
          }
        } else if (payload.type === 'log' && payload.entry) {
          appendLogLine(payload.entry.message, payload.entry.level.toLowerCase(), payload.entry.timestamp);
        }
      } catch {
        // Ignore parse error
      }
    };
  } catch (err) {
    console.warn('Could not connect to SSE log stream:', err);
  }
}

function disconnectLogStream() {
  if (logEventSource) {
    logEventSource.close();
    logEventSource = null;
  }
}

function appendLogLine(message, level = 'info', timestamp = null) {
  const drawerBody = document.getElementById('drawerBody');
  if (!drawerBody) return;
  const div = document.createElement('div');
  div.className = 'terminal-line';

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  div.innerHTML = `
    <span class="terminal-time">[${timeStr}]</span>
    <span class="terminal-${level}">${message}</span>
  `;
  drawerBody.appendChild(div);
  drawerBody.scrollTop = drawerBody.scrollHeight;
}

function logToTerminal(message, level = 'info') {
  appendLogLine(message, level);
}

function handleExecutionResult(json) {
  if (json.success) {
    const resData = json.data;
    logToTerminal('Execution completed successfully!', 'success');
    logToTerminal(`Created: ${resData.totalCreatedCount} work item(s)`, 'success');
    logToTerminal(`Duplicates Skipped: ${resData.totalDuplicateCount}`, 'info');

    // Display created work items with clickable links
    if (resData.personResults && Array.isArray(resData.personResults)) {
      resData.personResults.forEach((pr) => {
        if (pr.createdTasks && pr.createdTasks.length > 0) {
          pr.createdTasks.forEach((ct) => {
            const org = appState.status?.organization || 'BFLDevOpsOrg';
            const proj = appState.status?.project || '3in1_Agile_Projects';
            const url = `https://dev.azure.com/${org}/${proj}/_workitems/edit/${ct.id}`;
            logToTerminal(`[+] Created #${ct.id} - ${ct.title} (${pr.person.name}) &rarr; <a href="${url}" target="_blank" style="color: var(--brand-primary); text-decoration: underline;">Open in Azure DevOps</a>`, 'success');
          });
        }
      });
    }

    loadLiveMatrix(appState.simulationDate);
  } else {
    logToTerminal(`Execution Error: ${json.error}`, 'error');
  }
}

async function executeTasks() {
  closeConfirmModal();
  openDrawer();
  logToTerminal('Initializing Azure DevOps Task Creation Plan...', 'info');

  try {
    const res = await fetch('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asOf: appState.simulationDate,
        dryRun: false,
      }),
    });

    const json = await res.json();
    handleExecutionResult(json);
  } catch (err) {
    logToTerminal(`Execution network error: ${err.message}`, 'error');
  }
}

async function runRepair() {
  if (!confirm('Repair task relationships? This will fix incomplete parent-child links from previous executions.')) return;
  openDrawer();
  logToTerminal('Starting relationship repair process...', 'info');

  try {
    const res = await fetch('/api/journal/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    
    const json = await res.json();
    if (json.success) {
      logToTerminal(`✅ Repair completed: ${json.data.message || 'Relationships repaired successfully'}`, 'success');
    } else {
      logToTerminal(`❌ Repair failed: ${json.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    logToTerminal(`Repair error: ${err.message}`, 'error');
  }
}

window.runForMember = async function (personKey) {
  if (!confirm(`Create planned Azure DevOps tasks for ${personKey}?`)) return;
  openDrawer();
  logToTerminal(`Starting task creation for member: ${personKey}...`, 'info');
  try {
    const res = await fetch('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKeys: [personKey],
        asOf: appState.simulationDate,
        dryRun: false,
      }),
    });
    const json = await res.json();
    handleExecutionResult(json);
  } catch (err) {
    logToTerminal(`Execution failed: ${err.message}`, 'error');
  }
};

window.runForCell = async function (personKey, isoDate) {
  if (!confirm(`Create Azure DevOps task for ${personKey} on date ${isoDate}?`)) return;
  openDrawer();
  logToTerminal(`Starting task creation for ${personKey} on date ${isoDate}...`, 'info');
  try {
    const res = await fetch('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKeys: [personKey],
        asOf: isoDate,
        dryRun: false,
      }),
    });
    const json = await res.json();
    handleExecutionResult(json);
  } catch (err) {
    logToTerminal(`Execution failed: ${err.message}`, 'error');
  }
};

// Daily Burndown Matrix
let burndownState = {
  entries: [],
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  search: ''
};


async function loadScheduler() {
  try {
    const res = await fetch('/api/scheduler');
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (json.success && json.data) {
      appState.scheduler = json.data;
      renderScheduler(json.data);
    }
  } catch (err) {
    console.error('Failed to load scheduler status:', err);
  }
}

function renderScheduler(status) {
  const statusEl = document.getElementById('kpiSchedulerStatus');
  const subtextEl = document.getElementById('kpiSchedulerSubtext');
  const btn = document.getElementById('btnToggleScheduler');
  if (!statusEl || !btn) return;

  if (status.enabled) {
    statusEl.textContent = 'Active';
    statusEl.style.color = 'var(--success)';
    btn.textContent = 'Disable';
    btn.className = 'btn btn-secondary btn-sm';
    subtextEl.textContent = `Daily @ ${status.targetTime} (${status.timezone})`;
  } else {
    statusEl.textContent = 'Disabled';
    statusEl.style.color = 'var(--text-muted)';
    btn.textContent = 'Enable';
    btn.className = 'btn btn-primary btn-sm';
    subtextEl.textContent = `${status.targetTime} IST • Weekdays Mon-Fri`;
  }
}

async function toggleScheduler() {
  const current = appState.scheduler?.enabled || false;
  const previousState = { ...appState.scheduler };
  
  // Optimistic UI update
  appState.scheduler = { ...appState.scheduler, enabled: !current };
  renderScheduler(appState.scheduler);
  logToTerminal(`Optimistically ${!current ? 'enabling' : 'disabling'} scheduler...`, 'info');

  try {
    const res = await fetch('/api/scheduler/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !current }),
    });
    const json = await res.json();
    if (json.success) {
      appState.scheduler = json.data;
      renderScheduler(json.data);
      logToTerminal(`Daily scheduler confirmed ${!current ? 'ENABLED' : 'DISABLED'}. Target time: ${json.data.targetTime} (${json.data.timezone}).`, !current ? 'success' : 'info');
    } else {
      throw new Error(json.error || 'Server rejected toggle');
    }
  } catch (err) {
    // Rollback
    appState.scheduler = previousState;
    renderScheduler(appState.scheduler);
    logToTerminal(`Failed to toggle scheduler: ${err.message}. Rolled back to previous state.`, 'error');
  }
}

// In-App PAT Management
async function savePat() {
  const patInput = document.getElementById('settingPat');
  const pat = patInput.value.trim();
  if (!pat) {
    alert('Please enter a valid Azure DevOps Personal Access Token.');
    return;
  }

  try {
    const res = await fetch('/api/config/pat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pat }),
    });
    const json = await res.json();
    if (json.success) {
      patInput.value = '';
      alert('Personal Access Token saved and verified successfully!');
      await loadStatus();
      await loadLiveMatrix();
    } else {
      alert('Error updating PAT: ' + json.error);
    }
  } catch (err) {
    alert('Failed to update PAT: ' + err.message);
  }
}

// ==========================================
// INTELLIGENT DATE-RANGE TASK EXPLORER LOGIC
// ==========================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTodayIsoBrowser() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateShort(iso) {
  if (!iso) return '';
  const parts = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = months[parseInt(parts[1], 10) - 1];
  return `${parseInt(parts[2], 10)} ${m}`;
}

function addDaysBrowser(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  const ry = date.getUTCFullYear();
  const rm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const rd = String(date.getUTCDate()).padStart(2, '0');
  return `${ry}-${rm}-${rd}`;
}

function getNextThursdayBrowser(todayIso, mode = 'CURRENT') {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dow = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat

  let daysUntilThu = (4 - dow + 7) % 7;
  if (dow === 4) {
    if (mode === 'FOLLOWING') {
      daysUntilThu = 7;
    } else {
      daysUntilThu = 0;
    }
  }
  return addDaysBrowser(todayIso, daysUntilThu);
}

function calculatePresetRange(preset, todayIso) {
  const [y, m, d] = todayIso.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dow = dateObj.getUTCDay();

  switch (preset) {
    case 'today':
      return { startDate: todayIso, endDate: todayIso };

    case 'yesterday': {
      const yest = addDaysBrowser(todayIso, -1);
      return { startDate: yest, endDate: yest };
    }

    case 'this_week': {
      const diffToMon = dow === 0 ? -6 : 1 - dow;
      const monday = addDaysBrowser(todayIso, diffToMon);
      const friday = addDaysBrowser(monday, 4);
      return { startDate: monday, endDate: friday };
    }

    case 'last_week': {
      const diffToMon = dow === 0 ? -6 : 1 - dow;
      const lastMonday = addDaysBrowser(todayIso, diffToMon - 7);
      const lastFriday = addDaysBrowser(lastMonday, 4);
      return { startDate: lastMonday, endDate: lastFriday };
    }

    case 'current_month': {
      const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
      const lastDayObj = new Date(Date.UTC(y, m, 0));
      const lastDay = `${y}-${String(m).padStart(2, '0')}-${String(lastDayObj.getUTCDate()).padStart(2, '0')}`;
      return { startDate: firstDay, endDate: lastDay };
    }

    case 'previous_month': {
      const prevMonthDate = new Date(Date.UTC(y, m - 2, 1));
      const py = prevMonthDate.getUTCFullYear();
      const pm = prevMonthDate.getUTCMonth() + 1;
      const pFirst = `${py}-${String(pm).padStart(2, '0')}-01`;
      const pLastDayObj = new Date(Date.UTC(py, pm, 0));
      const pLast = `${py}-${String(pm).padStart(2, '0')}-${String(pLastDayObj.getUTCDate()).padStart(2, '0')}`;
      return { startDate: pFirst, endDate: pLast };
    }

    case 'last_7_days':
      return { startDate: addDaysBrowser(todayIso, -6), endDate: todayIso };

    case 'last_30_days':
      return { startDate: addDaysBrowser(todayIso, -29), endDate: todayIso };

    case 'today_to_next_thursday':
    default: {
      const thu = getNextThursdayBrowser(todayIso, appState.config?.thursdayMode || 'CURRENT');
      return { startDate: todayIso, endDate: thu };
    }
  }
}

function setupExplorerEventListeners() {
  const presetSelect = document.getElementById('explorerPresetSelect');
  const startDateInput = document.getElementById('explorerStartDate');
  const endDateInput = document.getElementById('explorerEndDate');

  const todayIso = getTodayIsoBrowser();
  if (startDateInput) startDateInput.min = todayIso;
  if (endDateInput) endDateInput.min = todayIso;

  if (presetSelect) {
    presetSelect.addEventListener('change', handlePresetChange);
  }

  const btnApply = document.getElementById('btnApplyExplorerFilters');
  if (btnApply) btnApply.addEventListener('click', loadExplorer);

  const btnReset = document.getElementById('btnResetExplorerFilters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (presetSelect) presetSelect.value = 'today_to_next_thursday';
      handlePresetChange();
      // Select all users
      if (appState.config && appState.config.people) {
        appState.explorerSelectedUsers = appState.config.people
          .filter((p) => p.enabled !== false)
          .map((p) => p.assignedTo.toLowerCase().trim());
        renderUserPills();
      }
      loadExplorer();
    });
  }

  const btnRefresh = document.getElementById('btnRefreshExplorer');
  if (btnRefresh) btnRefresh.addEventListener('click', loadExplorer);

  // User Filter Search & Buttons
  const userSearch = document.getElementById('explorerUserSearch');
  if (userSearch) {
    userSearch.addEventListener('input', renderUserPills);
  }

  const btnSelectAll = document.getElementById('btnSelectAllUsers');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      if (!appState.config?.people) return;
      appState.explorerSelectedUsers = appState.config.people
        .filter((p) => p.enabled !== false)
        .map((p) => p.assignedTo.toLowerCase().trim());
      renderUserPills();
    });
  }

  const btnDeselectAll = document.getElementById('btnDeselectAllUsers');
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      appState.explorerSelectedUsers = [];
      renderUserPills();
    });
  }

  // View Mode Buttons
  const btnMatrix = document.getElementById('btnViewMatrix');
  const btnList = document.getElementById('btnViewList');
  if (btnMatrix && btnList) {
    btnMatrix.addEventListener('click', () => {
      appState.explorerViewMode = 'matrix';
      btnMatrix.classList.add('active');
      btnList.classList.remove('active');
      document.getElementById('explorerMatrixView').style.display = 'block';
      document.getElementById('explorerListView').style.display = 'none';
    });

    btnList.addEventListener('click', () => {
      appState.explorerViewMode = 'list';
      btnList.classList.add('active');
      btnMatrix.classList.remove('active');
      document.getElementById('explorerMatrixView').style.display = 'none';
      document.getElementById('explorerListView').style.display = 'block';
      if (appState.explorerData) renderExplorerList(appState.explorerData);
    });
  }

  // Filter Selects
  const stateFilter = document.getElementById('explorerStateFilter');
  if (stateFilter) {
    stateFilter.addEventListener('change', () => {
      appState.explorerStateFilter = stateFilter.value;
      if (appState.explorerData) {
        renderExplorerMatrix(appState.explorerData);
        renderExplorerList(appState.explorerData);
      }
    });
  }

  const statusFilter = document.getElementById('explorerStatusFilter');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      appState.explorerStatusFilter = statusFilter.value;
      if (appState.explorerData) {
        renderExplorerMatrix(appState.explorerData);
        renderExplorerList(appState.explorerData);
      }
    });
  }

  // List Search & Sort
  const listSearch = document.getElementById('explorerListSearch');
  if (listSearch) {
    listSearch.addEventListener('input', () => {
      appState.explorerSearchQuery = listSearch.value.trim().toLowerCase();
      if (appState.explorerData) renderExplorerList(appState.explorerData);
    });
  }

  const listHeaders = document.querySelectorAll('#explorerListTable th[data-sort]');
  listHeaders.forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (appState.explorerSort.col === col) {
        appState.explorerSort.asc = !appState.explorerSort.asc;
      } else {
        appState.explorerSort.col = col;
        appState.explorerSort.asc = true;
      }
      if (appState.explorerData) renderExplorerList(appState.explorerData);
    });
  });

  // Create Missing Tasks button
  const btnCreateMissing = document.getElementById('btnCreateMissingInRange');
  if (btnCreateMissing) {
    btnCreateMissing.addEventListener('click', createMissingInRange);
  }
}

function initExplorerUsers() {
  if (!appState.config?.people) return;

  const people = appState.config.people.filter((p) => p.enabled !== false);
  appState.explorerSelectedUsers = people.map((p) => p.assignedTo.toLowerCase().trim());

  renderUserPills();

  // Set default preset dates
  const today = getTodayIsoBrowser();
  const range = calculatePresetRange('today_to_next_thursday', today);
  const startEl = document.getElementById('explorerStartDate');
  const endEl = document.getElementById('explorerEndDate');
  if (startEl && !startEl.value) startEl.value = range.startDate;
  if (endEl && !endEl.value) endEl.value = range.endDate;
}

function renderUserPills() {
  const container = document.getElementById('explorerUserPills');
  if (!container || !appState.config?.people) return;

  const search = (document.getElementById('explorerUserSearch')?.value || '').toLowerCase().trim();
  const people = appState.config.people.filter((p) => p.enabled !== false);

  container.innerHTML = '';

  people.forEach((p) => {
    const key = p.assignedTo.toLowerCase().trim();
    const isSelected = appState.explorerSelectedUsers.includes(key);
    const matchesSearch =
      !search || p.name.toLowerCase().includes(search) || p.assignedTo.toLowerCase().includes(search);

    if (!matchesSearch) return;

    const pill = document.createElement('label');
    pill.className = `user-filter-pill ${isSelected ? 'selected' : ''}`;
    pill.innerHTML = `
      <input type="checkbox" value="${escapeHtml(p.assignedTo)}" ${isSelected ? 'checked' : ''}>
      <span>${escapeHtml(p.name)}</span>
      <span style="font-size: 0.72rem; color: var(--text-muted);">(${escapeHtml(p.assignedTo)})</span>
    `;

    const checkbox = pill.querySelector('input');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        if (!appState.explorerSelectedUsers.includes(key)) {
          appState.explorerSelectedUsers.push(key);
        }
        pill.classList.add('selected');
      } else {
        appState.explorerSelectedUsers = appState.explorerSelectedUsers.filter((u) => u !== key);
        pill.classList.remove('selected');
      }
      updateSelectedUsersTag();
    });

    container.appendChild(pill);
  });

  updateSelectedUsersTag();
}

function updateSelectedUsersTag() {
  const tag = document.getElementById('selectedUsersCountTag');
  if (!tag || !appState.config?.people) return;

  const total = appState.config.people.filter((p) => p.enabled !== false).length;
  const selected = appState.explorerSelectedUsers.length;

  if (selected === total) {
    tag.textContent = `All selected (${total})`;
    tag.className = 'badge-pill badge-info';
  } else if (selected === 0) {
    tag.textContent = `None selected (0/${total})`;
    tag.className = 'badge-pill badge-disconnected';
  } else {
    tag.textContent = `${selected} of ${total} selected`;
    tag.className = 'badge-pill badge-connected';
  }
}

function handlePresetChange() {
  const select = document.getElementById('explorerPresetSelect');
  if (!select) return;
  const preset = select.value;
  if (preset === 'custom') return;

  const today = getTodayIsoBrowser();
  const range = calculatePresetRange(preset, today);
  if (range) {
    document.getElementById('explorerStartDate').value = range.startDate;
    document.getElementById('explorerEndDate').value = range.endDate;
  }
}




window.inspectCell = function(personName, dateIso) {
  if (!appState.explorerData) return;
  const row = appState.explorerData.matrix.find(r => r.person.name === personName);
  if (!row) return;
  const cell = row.cells[dateIso];
  if (!cell) return;
  
  const modalTitle = document.getElementById('dateInspectTitle');
  const summary = document.getElementById('dateInspectSummary');
  const createdList = document.getElementById('dateInspectCreatedList');
  const missingList = document.getElementById('dateInspectMissingList');
  
  if (modalTitle) modalTitle.textContent = `${personName} - ${cell.formattedDate}`;
  
  let htmlCreated = '';
  if (cell.tasks && cell.tasks.length > 0) {
    htmlCreated = cell.tasks.map(t => `
      <div style="background: var(--bg-muted); padding: 0.75rem; border-radius: var(--radius-sm); margin-bottom: 0.5rem;">
        <div style="font-weight: 600;"><a href="${t.url}" target="_blank" style="color: var(--brand-primary); text-decoration: none;">${t.title}</a></div>
        <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.25rem;">
          State: <span class="badge-pill">${t.state}</span> | 
          Completed: ${t.completedWork || 0}h | Remaining: ${t.remainingWork || 0}h
        </div>
      </div>
    `).join('');
  } else {
    htmlCreated = '<div style="color: var(--text-muted); font-size: 0.85rem;">No tasks found for this date.</div>';
  }
  if (createdList) createdList.innerHTML = htmlCreated;
  if (missingList) missingList.innerHTML = '';
  if (summary) summary.innerHTML = `<div class="badge-pill badge-connected">${cell.status}</div>`;
  
  const modal = document.getElementById('dateInspectModal');
  if (modal) modal.style.display = 'flex';
};


function generateInsights(data) {
  const container = document.getElementById('insightsContainer');
  if (!container) return;
  
  let insights = [];
  data.matrix.forEach(row => {
    // Check missing tasks
    if (row.stats.missingCount > 0) {
      insights.push(`<li><span style="color: var(--warning);">⚠️ Missing Tasks:</span> <strong>${row.person.name}</strong> has ${row.stats.missingCount} missing daily tasks in this period.</li>`);
    }
    // Check overdue/active beyond expected
    if (row.stats.stateCounts['Active'] > 3) {
      insights.push(`<li><span style="color: var(--brand-primary);">ℹ️ High WIP:</span> <strong>${row.person.name}</strong> has ${row.stats.stateCounts['Active']} active tasks. Consider closing completed work.</li>`);
    }
  });
  
  if (insights.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); padding: 1rem;">No critical insights for this period. Excellent work!</div>`;
  } else {
    container.innerHTML = `<ul style="list-style: none; padding: 0; margin: 0; line-height: 1.6; font-size: 0.875rem;">${insights.slice(0, 5).join('')}</ul>`;
  }
}

async function loadBurndown(selectedMonth) {
  const container = document.getElementById('burndownMatrixContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align: center; padding: 3rem;">
      <div style="color: var(--text-muted); margin-bottom: 1rem;">🔄 Streaming Work Intelligence Matrix...</div>
      <div style="width: 200px; height: 4px; background: var(--border-color); border-radius: 2px; margin: 0 auto; overflow: hidden;">
        <div id="burndownProgressBar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s ease;"></div>
      </div>
      <div id="burndownProgressText" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Starting...</div>
    </div>
  `;

  try {
    let y, m;
    if (selectedMonth) {
      [y, m] = selectedMonth.split('-');
    } else {
      const now = new Date();
      y = now.getFullYear();
      m = String(now.getMonth() + 1).padStart(2, '0');
      const selector = document.getElementById('burndownMonthSelector');
      if (selector) selector.value = `${y}-${m}`;
    }
    
    const start = `${y}-${m}-01`;
    const end = `${y}-${m}-31`;

    // Use streaming endpoint
    const streamUrl = `/api/explorer/stream?startDate=${start}&endDate=${end}`;
    const eventSource = new EventSource(streamUrl);
    let lastUpdateTime = Date.now();

    eventSource.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        const now = Date.now();
        const shouldUpdate = now - lastUpdateTime > 100;

        if (msg.type === 'started') {
          document.getElementById('burndownProgressBar').style.width = '5%';
          document.getElementById('burndownProgressText').textContent = '📊 Initializing...';
          lastUpdateTime = now;
        } else if (msg.type === 'progress') {
          if (shouldUpdate || msg.progress >= 90) {
            const progressBar = document.getElementById('burndownProgressBar');
            if (progressBar) {
              progressBar.style.width = (msg.progress || 50) + '%';
            }
            const progressText = document.getElementById('burndownProgressText');
            if (progressText) {
              progressText.textContent = `${msg.message} (${msg.progress || 50}%)`;
            }
            lastUpdateTime = now;
          }
        } else if (msg.type === 'complete') {
          eventSource.close();
          appState.explorerData = msg.data;
          
          // Animate to 100%
          const progressBar = document.getElementById('burndownProgressBar');
          if (progressBar) progressBar.style.width = '100%';

          setTimeout(() => {
            renderBurndownMatrix(msg.data);
            renderOverviewCharts(msg.data);
            generateInsights(msg.data);
            renderMyWork(msg.data);
          }, 200);
        } else if (msg.type === 'error') {
          eventSource.close();
          container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">❌ Error: ${msg.error || 'Unknown error'}</div>`;
        }
      } catch (e) {
        console.error('Failed to parse stream message:', e);
      }
    });

    eventSource.addEventListener('error', (e) => {
      eventSource.close();
      container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">❌ Stream connection lost</div>`;
    });
  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">❌ Failed to load burndown: ${err.message}</div>`;
  }
}

function renderBurndownMatrix(data) {
  const container = document.getElementById('burndownMatrixContainer');
  const { dates, matrix } = data;

  let html = `<div class="matrix-container"><table class="matrix-table">
    <thead>
      <tr>
        <th class="sticky-col">Team Member</th>
        <th>Total Work</th>
        <th>Task Count</th>`;

  // Render date columns
  dates.forEach(d => {
    html += `<th><div>${d.formattedDate}</div><div style="font-size: 0.725rem; font-weight: normal; color: var(--text-muted);">${d.dayOfWeek.slice(0, 3)}</div></th>`;
  });
  html += `</tr></thead><tbody>`;

  matrix.forEach(row => {
    html += `<tr>
      <td class="sticky-col">
        <div style="font-weight: 600;">${row.person.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${row.person.pod || 'Unassigned'} - ${row.person.role || 'Member'}</div>
      </td>
      <td style="font-weight: bold;">${row.stats.totalCompletedWork}h</td>
      <td>${row.stats.createdCount}</td>`;

    dates.forEach(d => {
      const cell = row.cells[d.dateIso];
      if (cell.isWeekend) {
        html += `<td class="cell-status cell-weekend">WO</td>`;
      } else if (cell.status === 'MISSING') {
        html += `<td class="cell-status" style="cursor:pointer;" onclick="inspectCell('${row.person.name}', '${d.dateIso}')">0</td>`;
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
        html += `<td class="cell-status cell-completed" style="cursor:pointer;" onclick="inspectCell('${row.person.name}', '${d.dateIso}')">${completed > 0 ? completed : cell.tasks.length}</td>`;
      } else {
        html += `<td></td>`;
      }
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function renderOverviewCharts(data) {
  if (typeof Chart === 'undefined') return;
  
  // 1. Render state distribution chart
  const statusCanvas = document.getElementById('statusDistributionChart');
  if (statusCanvas) {
    const s = data.summary.stateCounts;
    const labels = ['New', 'Active', 'Closed', 'Resolved', 'Other'];
    const values = [s.New || 0, s.Active || 0, s.Closed || 0, s.Resolved || 0, s.Other || 0];

    if (statusCanvas._chartInstance) statusCanvas._chartInstance.destroy();

    statusCanvas._chartInstance = new Chart(statusCanvas, {
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
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 12 } } },
        },
      },
    });
  }

  // 2. Render daily effort trend
  const effortCanvas = document.getElementById('effortTrendChart');
  if (effortCanvas) {
    const labels = [];
    const values = [];
    
    // Aggregate completed work per date
    data.dates.forEach(d => {
      if (!d.isWeekend) {
        labels.push(d.formattedDate);
        let dailyTotal = 0;
        data.matrix.forEach(row => {
          const cell = row.cells[d.dateIso];
          if (cell && cell.tasks) {
            dailyTotal += cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
          }
        });
        values.push(dailyTotal);
      }
    });

    if (effortCanvas._chartInstance) effortCanvas._chartInstance.destroy();

    effortCanvas._chartInstance = new Chart(effortCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Completed Work (h)',
          data: values,
          backgroundColor: '#3b82f6',
          borderRadius: 4
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      },
    });
  }
}

function renderMyWork(data) {
  // Render the "My Work" summary table (tasks assigned to logged-in user or first person in config)
  const container = document.getElementById('myWorkContainer');
  if (!container) return;

  const myPerson = appState.config?.people?.[0];
  if (!myPerson) {
    container.innerHTML = '<div style="color: var(--text-muted);">No team members configured.</div>';
    return;
  }

  const myRow = data.matrix.find(r =>
    r.person.assignedTo.toLowerCase() === myPerson.assignedTo.toLowerCase()
  );

  if (!myRow) {
    container.innerHTML = `<div style="color: var(--text-muted);">No data found for ${escapeHtml(myPerson.name)}.</div>`;
    return;
  }

  const tasks = data.detailedTasks.filter(t =>
    t.person.assignedTo.toLowerCase() === myPerson.assignedTo.toLowerCase() &&
    t.status !== 'MISSING'
  );

  if (tasks.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted);">No tasks found for ${escapeHtml(myPerson.name)} in this period.</div>`;
    return;
  }

  container.innerHTML = `
    <table class="matrix-table" style="font-size: 0.85rem;">
      <thead><tr>
        <th>Date</th><th>Task ID</th><th>Title</th><th>State</th>
      </tr></thead>
      <tbody>
        ${tasks.map(t => `
          <tr>
            <td><strong>${escapeHtml(t.formattedDate)}</strong></td>
            <td>${t.taskId ? `<a href="${escapeHtml(t.url || '')}" target="_blank" style="color: var(--brand-primary);">#${t.taskId}</a>` : '-'}</td>
            <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(t.title || '-')}</td>
            <td><span class="state-tag state-${(t.state || 'new').toLowerCase()}">${escapeHtml(t.state || 'New')}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadExplorer() {
  const startDate = document.getElementById('explorerStartDate').value;
  const endDate = document.getElementById('explorerEndDate').value;
  const preset = document.getElementById('explorerPresetSelect').value;
  const usersParam = appState.explorerSelectedUsers.join(',');

  const matrixBody = document.getElementById('explorerMatrixBody');
  matrixBody.innerHTML = `
    <tr>
      <td colspan="12" style="text-align: center; padding: 3rem;">
        <div style="color: var(--text-muted); margin-bottom: 1rem;">🔄 Streaming real-time Azure DevOps task coverage...</div>
        <div style="width: 200px; height: 4px; background: var(--border-color); border-radius: 2px; margin: 0 auto; overflow: hidden;">
          <div id="loadProgressBar" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.3s ease;"></div>
        </div>
        <div id="loadProgressText" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Starting...</div>
      </td>
    </tr>
  `;

  const params = new URLSearchParams();
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (preset && preset !== 'custom') params.append('preset', preset);
  if (usersParam) params.append('users', usersParam);

  try {
    const streamUrl = `/api/explorer/stream?${params.toString()}`;
    const eventSource = new EventSource(streamUrl);
    let lastUpdateTime = Date.now();

    eventSource.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        const now = Date.now();
        const shouldUpdate = now - lastUpdateTime > 100; // Update UI at most every 100ms

        if (msg.type === 'started') {
          document.getElementById('loadProgressBar').style.width = '5%';
          document.getElementById('loadProgressText').textContent = '📊 Initializing...';
          lastUpdateTime = now;
        } else if (msg.type === 'progress') {
          if (shouldUpdate || msg.progress >= 90) {
            const progressBar = document.getElementById('loadProgressBar');
            if (progressBar) {
              progressBar.style.width = (msg.progress || 50) + '%';
            }
            const progressText = document.getElementById('loadProgressText');
            if (progressText) {
              progressText.textContent = `${msg.message} (${msg.progress || 50}%)`;
            }
            lastUpdateTime = now;
          }
        } else if (msg.type === 'complete') {
          eventSource.close();
          appState.explorerData = msg.data;

          // Animate to 100%
          const progressBar = document.getElementById('loadProgressBar');
          if (progressBar) progressBar.style.width = '100%';

          // Short delay to show completion, then render
          setTimeout(() => {
            if (msg.data.dateRange) {
              document.getElementById('explorerStartDate').value = msg.data.dateRange.startDate;
              document.getElementById('explorerEndDate').value = msg.data.dateRange.endDate;
            }

            document.getElementById('explorerLastRefresh').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;

            renderExplorerSummary(msg.data.summary, msg.data.dateRange);
            renderExplorerMatrix(msg.data);
            renderExplorerList(msg.data);
          }, 200);
        } else if (msg.type === 'error') {
          eventSource.close();
          matrixBody.innerHTML = `
            <tr>
              <td colspan="12" style="text-align: center; padding: 2.5rem; color: var(--danger);">
                ⚠️ Failed to load Task Explorer: ${escapeHtml(msg.error || 'Unknown error')}
              </td>
            </tr>
          `;
        }
      } catch (e) {
        console.error('Failed to parse stream message:', e);
      }
    });

    eventSource.addEventListener('error', (e) => {
      eventSource.close();
      matrixBody.innerHTML = `
        <tr>
          <td colspan="12" style="text-align: center; padding: 2.5rem; color: var(--danger);">
            ⚠️ Stream connection lost: Check server connection
          </td>
        </tr>
      `;
    });
  } catch (err) {
    matrixBody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; padding: 2.5rem; color: var(--danger);">
          ⚠️ Error connecting to server: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

function renderExplorerSummary(summary, dateRange) {
  document.getElementById('kpiExpUsers').textContent = summary.totalSelectedUsers;
  document.getElementById('kpiExpWorkingDays').textContent = summary.totalWorkingDates;
  document.getElementById('kpiExpWorkingDaysSubtext').textContent = `${dateRange.totalDays} calendar days (excl. weekends)`;
  document.getElementById('kpiExpExpected').textContent = summary.expectedCombinations;
  document.getElementById('kpiExpCreated').textContent = summary.existingCombinations;
  document.getElementById('kpiExpCoveragePct').textContent = `${summary.overallCoveragePercent}% overall coverage`;
  document.getElementById('kpiExpMissing').textContent = summary.missingCombinations;
  document.getElementById('kpiExpMissingSubtext').textContent =
    summary.missingCombinations > 0 ? `${summary.missingCombinations} working day gaps` : 'All tasks exist!';
  document.getElementById('kpiExpDuplicates').textContent = summary.duplicateCombinations;

  const stateBadges = document.getElementById('kpiExpStateBadges');
  stateBadges.innerHTML = `
    <span class="badge-pill state-new" style="font-size: 0.72rem; padding: 0.2rem 0.4rem;">New: ${summary.stateCounts.New}</span>
    <span class="badge-pill state-active" style="font-size: 0.72rem; padding: 0.2rem 0.4rem;">Active: ${summary.stateCounts.Active}</span>
    <span class="badge-pill state-closed" style="font-size: 0.72rem; padding: 0.2rem 0.4rem;">Closed: ${summary.stateCounts.Closed}</span>
    ${summary.stateCounts.Resolved ? `<span class="badge-pill state-resolved" style="font-size: 0.72rem; padding: 0.2rem 0.4rem;">Resolved: ${summary.stateCounts.Resolved}</span>` : ''}
  `;
}

function renderExplorerMatrix(data) {
  const headerRow = document.getElementById('explorerMatrixHeaderRow');
  const body = document.getElementById('explorerMatrixBody');
  const footer = document.getElementById('explorerMatrixFooter');

  headerRow.innerHTML = `
    <th style="min-width: 180px; position: sticky; left: 0; z-index: 3; background: var(--bg-surface);">Team Member</th>
  `;

  data.dates.forEach((d) => {
    const th = document.createElement('th');
    th.className = d.isWeekend ? '' : 'clickable-cell-header';
    th.title = d.isWeekend ? 'Weekend' : `Click to inspect tasks for ${d.formattedDate}`;
    th.innerHTML = `
      <div>${escapeHtml(d.formattedDate)}</div>
      <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">${d.dayOfWeek.slice(0, 3)}</div>
    `;
    if (!d.isWeekend) {
      th.addEventListener('click', () => openDateInspectModal(d.dateIso));
    }
    headerRow.appendChild(th);
  });

  body.innerHTML = '';

  const stateFilter = appState.explorerStateFilter;
  const statusFilter = appState.explorerStatusFilter;

  data.matrix.forEach((row) => {
    // If status filter is active, check if row qualifies
    if (statusFilter === 'CREATED' && row.stats.createdCount === 0) return;
    if (statusFilter === 'MISSING' && row.stats.missingCount === 0) return;
    if (statusFilter === 'DUPLICATE' && row.stats.duplicateCount === 0) return;

    const tr = document.createElement('tr');

    // Sticky Member Name Cell
    const userTd = document.createElement('td');
    userTd.style.position = 'sticky';
    userTd.style.left = '0';
    userTd.style.zIndex = '2';
    userTd.style.background = 'var(--bg-surface)';
    userTd.innerHTML = `
      <span class="clickable-user-name" title="Click to view detailed task breakdown for ${escapeHtml(row.person.name)}">
        ${escapeHtml(row.person.name)}
      </span>
      <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.15rem;">
        ${row.stats.createdCount}/${row.stats.totalWorkingDays} (${row.stats.coveragePercent}%)
      </div>
    `;
    userTd.querySelector('.clickable-user-name').addEventListener('click', () => {
      openUserInspectModal(row.person.assignedTo);
    });
    tr.appendChild(userTd);

    data.dates.forEach((d) => {
      const cell = row.cells[d.dateIso];
      const td = document.createElement('td');
      td.style.verticalAlign = 'top';

      if (cell.status === 'NOT_APPLICABLE') {
        td.className = 'status-weekend';
        td.innerHTML = '<span style="color: #64748b;">Weekend</span>';
      } else if (cell.status === 'CREATED') {
        const task = cell.primaryTask;
        const matchesState = stateFilter === 'all' || (task && task.state === stateFilter);
        const opacityStyle = matchesState ? '' : 'opacity: 0.35;';

        td.innerHTML = `
          <div class="cell-badge status-created" style="${opacityStyle}" title="${escapeHtml(task?.title || '')} (Created: ${task?.createdDate || '-'})">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.35rem;">
              <a href="${task?.url}" target="_blank" style="color: inherit; font-weight: 600; text-decoration: underline;">
                #${task?.id}
              </a>
              <span class="state-tag state-${(task?.state || 'new').toLowerCase()}">${task?.state || 'New'}</span>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 130px;">
              ${escapeHtml(task?.title?.split('|')[0] || '')}
            </div>
          </div>
        `;
      } else if (cell.status === 'DUPLICATE') {
        td.innerHTML = `
          <div class="cell-badge status-duplicate" title="Multiple work items found on this date!">
            <div style="font-weight: 600; font-size: 0.75rem;">⚠️ ${cell.tasks.length} Duplicates</div>
            <div style="font-size: 0.72rem;">
              ${cell.tasks.map((t) => `<a href="${t.url}" target="_blank" style="color: inherit; text-decoration: underline;">#${t.id}</a>`).join(', ')}
            </div>
          </div>
        `;
      } else if (cell.status === 'MISSING') {
        if (cell.isEligibleForCreation) {
          td.innerHTML = `
            <div class="cell-badge status-missing">
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.35rem;">
                <span style="font-weight: 500;">Missing</span>
                <button class="btn btn-primary btn-sm btn-cell-create" style="padding: 0.15rem 0.45rem; font-size: 0.68rem;">
                  + Create
                </button>
              </div>
            </div>
          `;
          const btn = td.querySelector('.btn-cell-create');
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            createSingleCellTask(row.person.assignedTo, d.dateIso);
          });
        } else {
          td.innerHTML = `
            <div class="cell-badge status-past" title="Historical date or out of window: cannot be auto-created">
              <span style="font-style: italic;">Missing (Past)</span>
            </div>
          `;
        }
      }

      tr.appendChild(td);
    });

    body.appendChild(tr);
  });

  // Footer summary row
  footer.innerHTML = '';
  const footerTr = document.createElement('tr');
  const footerLabel = document.createElement('td');
  footerLabel.style.position = 'sticky';
  footerLabel.style.left = '0';
  footerLabel.style.zIndex = '2';
  footerLabel.style.background = 'var(--bg-surface)';
  footerLabel.textContent = 'Date Coverage';
  footerTr.appendChild(footerLabel);

  data.dates.forEach((d) => {
    const td = document.createElement('td');
    td.style.textAlign = 'center';
    td.style.fontSize = '0.78rem';

    if (d.isWeekend) {
      td.textContent = '-';
      td.style.color = 'var(--text-muted)';
    } else {
      const ds = data.dateSummaries[d.dateIso];
      const pct = ds ? ds.coveragePercent : 0;
      td.style.color = pct >= 100 ? 'var(--success)' : 'var(--warning)';
      td.textContent = `${ds?.createdUsers || 0}/${ds?.expectedUsers || 0} (${pct}%)`;
    }
    footerTr.appendChild(td);
  });
  footer.appendChild(footerTr);
}

function renderExplorerList(data) {
  const body = document.getElementById('explorerListBody');
  const countTag = document.getElementById('explorerListCountTag');
  body.innerHTML = '';

  let tasks = [...data.detailedTasks];

  // Search Filter
  if (appState.explorerSearchQuery) {
    const q = appState.explorerSearchQuery;
    tasks = tasks.filter(
      (t) =>
        t.person.name.toLowerCase().includes(q) ||
        t.person.assignedTo.toLowerCase().includes(q) ||
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.taskId && String(t.taskId).includes(q)) ||
        t.dateIso.includes(q)
    );
  }

  // State Filter
  if (appState.explorerStateFilter !== 'all') {
    tasks = tasks.filter((t) => t.state === appState.explorerStateFilter);
  }

  // Status Filter
  if (appState.explorerStatusFilter !== 'all') {
    tasks = tasks.filter((t) => t.status === appState.explorerStatusFilter);
  }

  // Sorting
  const { col, asc } = appState.explorerSort;
  tasks.sort((a, b) => {
    let valA = '';
    let valB = '';
    if (col === 'date') {
      valA = a.dateIso;
      valB = b.dateIso;
    } else if (col === 'user') {
      valA = a.person.name;
      valB = b.person.name;
    } else if (col === 'id') {
      valA = a.taskId || 0;
      valB = b.taskId || 0;
    } else if (col === 'state') {
      valA = a.state || '';
      valB = b.state || '';
    } else if (col === 'created') {
      valA = a.createdDate || '';
      valB = b.createdDate || '';
    }
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  countTag.textContent = `Showing ${tasks.length} item${tasks.length === 1 ? '' : 's'}`;

  if (tasks.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          No work items matching the active filters.
        </td>
      </tr>
    `;
    return;
  }

  tasks.forEach((t) => {
    const tr = document.createElement('tr');

    const statusBadgeHtml =
      t.status === 'CREATED'
        ? '<span class="badge-pill badge-connected">Created</span>'
        : t.status === 'DUPLICATE'
        ? '<span class="badge-pill badge-disconnected">Duplicate</span>'
        : t.isEligibleForCreation
        ? '<span class="badge-pill badge-info">Missing</span>'
        : '<span class="badge-pill" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;">Missing (Past)</span>';

    const stateBadgeHtml = t.state
      ? `<span class="state-tag state-${t.state.toLowerCase()}">${t.state}</span>`
      : '<span style="color: var(--text-muted);">-</span>';

    tr.innerHTML = `
      <td style="white-space: nowrap;">
        <strong>${escapeHtml(t.formattedDate)}</strong>
        <span style="font-size: 0.75rem; color: var(--text-muted);">(${t.dayOfWeek.slice(0, 3)})</span>
      </td>
      <td>
        <div>${escapeHtml(t.person.name)}</div>
        <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(t.person.assignedTo)}</div>
      </td>
      <td>
        ${
          t.taskId
            ? `<a href="${t.url}" target="_blank" style="color: var(--brand-primary); font-weight: 600;">#${t.taskId}</a>`
            : '<span style="color: var(--text-muted);">-</span>'
        }
      </td>
      <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(t.title || '-')}
      </td>
      <td>${stateBadgeHtml}</td>
      <td style="font-size: 0.78rem; color: var(--text-muted); white-space: nowrap;">
        ${t.createdDate ? new Date(t.createdDate).toLocaleDateString() : '-'}
      </td>
      <td>${statusBadgeHtml}</td>
      <td style="text-align: right; white-space: nowrap;">
        ${
          t.taskId
            ? `<a href="${t.url}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none; padding: 0.2rem 0.5rem; font-size: 0.75rem;">
                View ADO ↗
               </a>`
            : t.isEligibleForCreation
            ? `<button class="btn btn-primary btn-sm btn-list-create" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
                + Create Task
               </button>`
            : '<span style="color: var(--text-muted); font-size: 0.75rem;">Protected</span>'
        }
      </td>
    `;

    const createBtn = tr.querySelector('.btn-list-create');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        createSingleCellTask(t.person.assignedTo, t.dateIso);
      });
    }

    body.appendChild(tr);
  });
}

// Modal Inspect Handlers
function openDateInspectModal(dateIso) {
  const modal = document.getElementById('dateInspectModal');
  const ds = appState.explorerData?.dateSummaries?.[dateIso];
  if (!modal || !ds) return;

  document.getElementById('dateInspectTitle').textContent = `Task Coverage for ${ds.formattedDate} (${ds.dayOfWeek})`;

  const summary = document.getElementById('dateInspectSummary');
  summary.innerHTML = `
    <span class="badge-pill badge-info">Expected Users: ${ds.expectedUsers}</span>
    <span class="badge-pill badge-connected">Created Tasks: ${ds.createdUsers}</span>
    <span class="badge-pill ${ds.missingUsers > 0 ? 'badge-disconnected' : 'badge-connected'}">
      Missing: ${ds.missingUsers}
    </span>
    <span class="badge-pill badge-info">Coverage: ${ds.coveragePercent}%</span>
  `;

  const createdList = document.getElementById('dateInspectCreatedList');
  if (ds.createdList.length === 0) {
    createdList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">No tasks created for this date.</div>';
  } else {
    createdList.innerHTML = `
      <ul style="padding-left: 1.25rem; font-size: 0.875rem; line-height: 1.8;">
        ${ds.createdList
          .map(
            (item) => `
          <li>
            <strong>${escapeHtml(item.person.name)}</strong> &rarr;
            <a href="${item.task.url}" target="_blank" style="color: var(--brand-primary); font-weight: 600;">
              #${item.task.id}
            </a>
            <span class="state-tag state-${item.task.state.toLowerCase()}" style="margin-left: 0.35rem;">
              ${item.task.state}
            </span>
            <span style="color: var(--text-muted); font-size: 0.78rem; margin-left: 0.5rem;">
              ${escapeHtml(item.task.title)}
            </span>
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  const missingList = document.getElementById('dateInspectMissingList');
  if (ds.missingList.length === 0) {
    missingList.innerHTML = '<div style="color: var(--success); font-size: 0.85rem;">✅ All configured users have tasks on this date!</div>';
  } else {
    missingList.innerHTML = `
      <ul style="padding-left: 1.25rem; font-size: 0.875rem; line-height: 1.8;">
        ${ds.missingList
          .map(
            (item) => `
          <li>
            <span>${escapeHtml(item.person.name)} (${escapeHtml(item.person.assignedTo)})</span>
            ${
              item.isEligible
                ? `<span class="badge-pill badge-info" style="font-size: 0.68rem; margin-left: 0.5rem;">Eligible for Creation</span>`
                : `<span class="badge-pill" style="font-size: 0.68rem; margin-left: 0.5rem; background: rgba(148, 163, 184, 0.2); color: #94a3b8;">Historical (Past)</span>`
            }
          </li>
        `
          )
          .join('')}
      </ul>
    `;
  }

  modal.classList.add('active');
}

function openUserInspectModal(userKey) {
  const modal = document.getElementById('userInspectModal');
  const userRow = appState.explorerData?.matrix?.find(
    (r) => r.person.assignedTo.toLowerCase().trim() === userKey.toLowerCase().trim()
  );
  if (!modal || !userRow) return;

  document.getElementById('userInspectTitle').textContent = `Task Breakdown for ${userRow.person.name}`;

  const summary = document.getElementById('userInspectSummary');
  summary.innerHTML = `
    <span class="badge-pill badge-info">Working Days: ${userRow.stats.totalWorkingDays}</span>
    <span class="badge-pill badge-connected">Tasks Created: ${userRow.stats.createdCount}</span>
    <span class="badge-pill ${userRow.stats.missingCount > 0 ? 'badge-disconnected' : 'badge-connected'}">
      Missing: ${userRow.stats.missingCount}
    </span>
    <span class="badge-pill badge-info">Coverage: ${userRow.stats.coveragePercent}%</span>
  `;

  const timeline = document.getElementById('userInspectTimeline');
  const dateEntries = Object.values(userRow.cells);

  timeline.innerHTML = `
    <table class="matrix-table" style="font-size: 0.85rem;">
      <thead>
        <tr>
          <th>Date</th>
          <th>Day</th>
          <th>Status</th>
          <th>Work Item</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        ${dateEntries
          .map((c) => {
            const task = c.primaryTask;
            return `
            <tr>
              <td><strong>${escapeHtml(c.formattedDate)}</strong></td>
              <td>${c.dayOfWeek.slice(0, 3)}</td>
              <td>
                ${
                  c.status === 'CREATED'
                    ? '<span class="badge-pill badge-connected">Created</span>'
                    : c.status === 'DUPLICATE'
                    ? '<span class="badge-pill badge-disconnected">Duplicate</span>'
                    : c.status === 'NOT_APPLICABLE'
                    ? '<span style="color: #64748b;">Weekend</span>'
                    : c.isEligibleForCreation
                    ? '<span class="badge-pill badge-info">Missing</span>'
                    : '<span class="badge-pill" style="background: rgba(148, 163, 184, 0.2); color: #94a3b8;">Missing (Past)</span>'
                }
              </td>
              <td>
                ${
                  task
                    ? `<a href="${task.url}" target="_blank" style="color: var(--brand-primary); font-weight: 600;">#${task.id}</a>`
                    : '-'
                }
              </td>
              <td>
                ${task ? `<span class="state-tag state-${task.state.toLowerCase()}">${task.state}</span>` : '-'}
              </td>
            </tr>
          `;
          })
          .join('')}
      </tbody>
    </table>
  `;

  modal.classList.add('active');
}

// Single Cell & Batch Missing Task Creation
async function createSingleCellTask(personKey, dateIso) {
  const person = appState.config?.people?.find(
    (p) => p.assignedTo.toLowerCase().trim() === personKey.toLowerCase().trim()
  );
  const personName = person ? person.name : personKey;

  const confirmed = confirm(`Create 3in1 Task for ${personName} on ${dateIso} in Azure DevOps?`);
  if (!confirmed) return;

  openDrawer();
  logToTerminal(`Initiating targeted task creation for ${personName} on ${dateIso}...`, 'info');

  try {
    const res = await fetch('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKeys: [personKey],
        asOf: dateIso,
      }),
    });
    const json = await res.json();
    if (json.success) {
      logToTerminal(`Successfully processed task creation for ${personName}!`, 'success');
      await loadExplorer();
      await loadLiveMatrix();
    } else {
      logToTerminal(`Failed to create task: ${json.error}`, 'error');
    }
  } catch (err) {
    logToTerminal(`Error executing task creation: ${err.message}`, 'error');
  }
}

async function createMissingInRange() {
  if (!appState.explorerData) return;

  const matrix = appState.explorerData.matrix;
  let eligibleCount = 0;
  let pastMissingCount = 0;
  const eligiblePeopleKeys = new Set();

  matrix.forEach((row) => {
    Object.values(row.cells).forEach((cell) => {
      if (cell.status === 'MISSING') {
        if (cell.isEligibleForCreation) {
          eligibleCount++;
          eligiblePeopleKeys.add(row.person.assignedTo);
        } else {
          pastMissingCount++;
        }
      }
    });
  });

  if (eligibleCount === 0) {
    let msg = 'No eligible missing tasks found in the active rolling window.';
    if (pastMissingCount > 0) {
      msg += `\n\n(${pastMissingCount} missing tasks are in historical/past dates and cannot be automatically created per enterprise policy).`;
    }
    alert(msg);
    return;
  }

  let promptMsg = `Found ${eligibleCount} eligible missing tasks within the rolling window across ${eligiblePeopleKeys.size} team member(s).\n\nDo you want to proceed and create these missing work items in Azure DevOps?`;
  if (pastMissingCount > 0) {
    promptMsg += `\n\nNote: ${pastMissingCount} historical missing tasks will be skipped (historical creation prohibited).`;
  }

  const confirmed = confirm(promptMsg);
  if (!confirmed) return;

  openDrawer();
  logToTerminal(`Executing missing tasks creation for ${eligiblePeopleKeys.size} team member(s)...`, 'info');

  try {
    const res = await fetch('/api/explorer/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKeys: Array.from(eligiblePeopleKeys),
      }),
    });
    const json = await res.json();
    if (json.success) {
      logToTerminal(
        `Batch task creation completed: ${json.data.createdCount} created, ${json.data.skippedCount} skipped.`,
        'success'
      );
      await loadExplorer();
      await loadLiveMatrix();
    } else {
      logToTerminal(`Batch creation failed: ${json.error}`, 'error');
    }
  } catch (err) {
    logToTerminal(`Error creating missing tasks: ${err.message}`, 'error');
  }
}


async function handleSettingsSubmit(e) {
  e.preventDefault();
  
  const payload = {
    organization: document.getElementById('settingOrg').value,
    project: document.getElementById('settingProject').value,
    timezone: document.getElementById('settingTimezone').value,
    thursdayMode: document.getElementById('settingThursdayMode').value,
    startTime: document.getElementById('settingStartTime').value
  };

  try {
    const res = await fetch('/api/config/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const json = await res.json();
    if (json.success) {
      alert('Settings saved successfully!');
      loadAll();
    } else {
      alert('Error saving settings: ' + json.error);
    }
  } catch (err) {
    alert('Failed to save settings: ' + err.message);
  }
}

async function testConnection() {
  const btn = document.getElementById('btnTestConn');
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Testing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/status');
    const json = await res.json();
    if (json.success && json.data.connected && json.data.projectValid && json.data.workItemTypeValid) {
      alert('Connection successful! ADO Project is valid.');
    } else {
      alert('Connection issues found. Check API Status:\n' + JSON.stringify(json.data, null, 2));
    }
  } catch (err) {
    alert('Test Connection Failed: ' + err.message);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}
