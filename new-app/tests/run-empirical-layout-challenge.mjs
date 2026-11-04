// Empirical Layout & Collision Challenge Test Harness
// Challenger 1 (Responsive Layout Challenger) for Milestone M1

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = 4123;
const PUBLIC_DIR = path.resolve(new URL('../src/presentation/web/public', import.meta.url).pathname);
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const extremeMember = {
  key: 'extreme_dev',
  name: 'Alexander_Bartholomew_Montgomery_Cunningham_III_Of_Northshire_Extremely_Long_Name_With_Zero_Whitespace_At_All',
  assignedTo: 'extremely.long.enterprise.cloud.architecture.specialist.identity.string@deep.nested.subdomain.organization.azurewebsites.net',
  role: 'Senior Principal Staff Cloud Software Solutions Architect & Engineering Lead',
  pod: 'Enterprise Architecture & Platform Resilience Engineering Team',
  titlePrefix: 'Enterprise Architecture Platform Lead Core Specialist',
  githubUsername: 'alexander-montgomery-cunningham-enterprise-specialist',
  githubRepositories: ['org/very-long-repository-name-one', 'org/very-long-repository-name-two'],
  githubBranches: ['release/2026-q4-enterprise-hardening', 'hotfix/patch-29384-critical-fix'],
  sourceTaskWorkItemId: 123456,
  autoCloseEnabled: true,
};

// 1. Lightweight Mock Server
function createServer() {
  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, reqPath);

    if (reqPath === '/app.js') {
      const originalJs = fs.readFileSync(filePath, 'utf8');
      // Inject test hook exposure at the very end of app.js (served dynamically in memory only)
      const testJs = originalJs + `\n
window.__TEST_HOOKS__ = {
  renderPlanMatrix,
  renderBurndownTable,
  renderPeople,
  openAddExceptionModal,
  state,
  calendarState,
  switchView,
  formatDateShort
};
`;
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(testJs);
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeMap = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
      };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else if (reqPath.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      let data = {};
      if (reqPath === '/api/status') {
        data = { connected: true, organization: 'AzureOrg', project: 'AzureProj' };
      } else if (reqPath === '/api/config') {
        data = {
          organization: 'AzureOrg',
          project: 'AzureProj',
          timezone: 'Asia/Kolkata',
          thursdayMode: 'CURRENT',
          people: [extremeMember],
        };
      } else if (reqPath === '/api/scheduler') {
        data = { running: false, autoCloseEnabled: false, autoStart: false, timezone: 'Asia/Kolkata', startTime: '09:30' };
      } else if (reqPath === '/api/calendar') {
        data = { exceptions: [] };
      } else if (reqPath === '/api/journal') {
        data = { entries: [], totalEntries: 0, incompleteEntriesCount: 0 };
      } else if (reqPath === '/api/tasks/daily-prs') {
        data = [];
      } else {
        data = {};
      }
      res.end(JSON.stringify({ success: true, data }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// 2. CDP Client helper
class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.msgId = 1;
    this.pending = new Map();

    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          reject(new Error(msg.error.message));
        } else {
          resolve(msg.result);
        }
      }
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 600,
    });
  }
}

// 3. Main Test Suite
async function run() {
  console.log('--- Starting Empirical Layout Challenge ---');
  const server = await createServer();
  const serverPort = server.address().port;
  console.log(`[PASS] Mock static server listening on http://127.0.0.1:${serverPort}`);

  const cdpPort = 9100 + Math.floor(Math.random() * 800);
  const tmpProfile = `/tmp/chrome-cdp-challenger-${Date.now()}`;
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tmpProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  let cdp;
  let ws;
  try {
    const targetRes = await fetch(`http://127.0.0.1:${cdpPort}/json/new`, { method: 'PUT' });
    const target = await targetRes.json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    cdp = new CDPClient(ws);

    // Enable Runtime and listen for events
    await cdp.send('Runtime.enable');
    cdp.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('[Browser Console]', msg.params.type, msg.params.args.map((a) => a.value || a.description).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.error('[Browser Exception]', msg.params.exceptionDetails);
      }
    });

    // Navigate to local app
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${serverPort}/` });
    // Wait for hooks to become available
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const hasHooks = await cdp.eval('typeof window.__TEST_HOOKS__ !== "undefined"').catch(() => false);
      if (hasHooks) {
        ready = true;
        break;
      }
    }

    if (!ready) throw new Error('Timeout waiting for window.__TEST_HOOKS__');
    console.log('[PASS] Application and test hooks ready');

    const results = [];

    // =========================================================================
    // TEST 1: Sticky column width constraints under extreme text lengths
    // =========================================================================
    console.log('\n--- Challenge 1: Matrix Sticky Column Width Constraints ---');
    await cdp.setViewport(1366, 768);

    const test1Data = await cdp.eval(`(() => {
      const { switchView, renderPlanMatrix } = window.__TEST_HOOKS__;
      const extremePlan = {
        todayIso: '2026-10-16',
        nextThursdayIso: '2026-10-22',
        personPlans: [{
          person: {
            key: 'extreme_dev',
            name: 'Alexander_Bartholomew_Montgomery_Cunningham_III_Of_Northshire_Extremely_Long_Name_With_Zero_Whitespace_At_All',
            assignedTo: 'extremely.long.enterprise.cloud.architecture.specialist.identity.string@deep.nested.subdomain.organization.azurewebsites.net',
          },
          status: 'READY',
          sourceTask: {
            id: 999999999,
            parsedDate: { formattedTitleDate: '16 Oct Extremely Unbroken Title String For Testing' },
          },
          plannedDates: [{ isoDate: '2026-10-16', formattedTitleDate: '16 Oct', status: 'PLANNED' }],
        }],
      };

      switchView('planner');
      renderPlanMatrix(extremePlan);

      const stickyTh = document.querySelector('.matrix-table th.sticky-col');
      const stickyTd = document.querySelector('.matrix-table td.sticky-col');
      const thRect = stickyTh ? stickyTh.getBoundingClientRect() : null;
      const tdRect = stickyTd ? stickyTd.getBoundingClientRect() : null;

      const nameDiv = stickyTd ? stickyTd.querySelector('div') : null;
      const nameDivStyle = nameDiv ? window.getComputedStyle(nameDiv) : null;
      const tdStyle = stickyTd ? window.getComputedStyle(stickyTd) : null;

      return {
        thWidth: thRect ? thRect.width : 0,
        tdWidth: tdRect ? tdRect.width : 0,
        thMaxWidth: tdStyle ? tdStyle.maxWidth : '',
        tdOverflow: tdStyle ? tdStyle.overflow : '',
        divTextOverflow: nameDivStyle ? nameDivStyle.textOverflow : '',
        divWhiteSpace: nameDivStyle ? nameDivStyle.whiteSpace : '',
        divScrollWidth: nameDiv ? nameDiv.scrollWidth : 0,
        divClientWidth: nameDiv ? nameDiv.clientWidth : 0,
      };
    })()`);

    console.log('Plan Matrix Sticky Column measurements:', test1Data);
    const test1Pass =
      test1Data.tdWidth <= 220 &&
      test1Data.thWidth <= 220 &&
      test1Data.thMaxWidth === '220px' &&
      test1Data.tdOverflow === 'hidden' &&
      test1Data.divTextOverflow === 'ellipsis' &&
      test1Data.divWhiteSpace === 'nowrap' &&
      test1Data.divScrollWidth > test1Data.divClientWidth;

    console.log(`[${test1Pass ? 'PASS' : 'FAIL'}] Plan Matrix Sticky Column <= 220px with ellipsis: width=${test1Data.tdWidth}px, scrollWidth=${test1Data.divScrollWidth}px vs clientWidth=${test1Data.divClientWidth}px`);
    results.push({ name: 'Sticky Column Planner Matrix Constraints (<=220px & Ellipsis)', pass: test1Pass, data: test1Data });

    // Also test Burndown matrix sticky column under extreme name
    const test1Burndown = await cdp.eval(`(() => {
      const { switchView, renderBurndownTable } = window.__TEST_HOOKS__;
      switchView('burndown');
      const extremeBurndown = {
        dates: [
          { dateIso: '2026-10-16', formattedDate: '16 Oct', dayOfWeek: 'Friday' },
          { dateIso: '2026-10-17', formattedDate: '17 Oct', dayOfWeek: 'Saturday' },
        ],
        matrix: [{
          person: {
            name: 'VeryLongUnbrokenStringWithoutWhitespaceThatCouldForceTableExpansion12345678901234567890',
            pod: 'ExtremePod',
            role: 'Lead',
          },
          stats: { createdCount: 5, totalCompletedWork: 40, unrecordedCompletedWorkTasks: 0 },
          cells: {
            '2026-10-16': { isWeekend: false, tasks: [] },
            '2026-10-17': { isWeekend: true, tasks: [] },
          },
        }],
      };
      renderBurndownTable(extremeBurndown);
      const stickyTd = document.querySelector('#burndownMatrixContainer .matrix-table td.sticky-col');
      const rect = stickyTd ? stickyTd.getBoundingClientRect() : null;
      const style = stickyTd ? window.getComputedStyle(stickyTd) : null;
      return {
        tdWidth: rect ? rect.width : 0,
        maxWidth: style ? style.maxWidth : '',
        overflow: style ? style.overflow : '',
      };
    })()`);
    console.log('Burndown Matrix Sticky Column measurements:', test1Burndown);
    const test1BurndownPass = test1Burndown.tdWidth <= 220 && test1Burndown.maxWidth === '220px';
    console.log(`[${test1BurndownPass ? 'PASS' : 'FAIL'}] Burndown Matrix Sticky Column <= 220px: width=${test1Burndown.tdWidth}px`);
    results.push({ name: 'Sticky Column Burndown Matrix Constraints (<=220px)', pass: test1BurndownPass, data: test1Burndown });

    // =========================================================================
    // TEST 2: Team Management .person-row multi-row layout with 11 form controls
    // =========================================================================
    console.log('\n--- Challenge 2: Team Management .person-row Multi-Row Layout ---');
    const viewportsToTest = [1366, 1200, 860, 600, 390, 360];
    let test2AllPass = true;

    for (const vp of viewportsToTest) {
      await cdp.setViewport(vp, 800);
      await new Promise((r) => setTimeout(r, 200));

      const rowLayout = await cdp.eval(`(() => {
        const { switchView, renderPeople, state } = window.__TEST_HOOKS__;
        switchView('people');
        if (!state.people || state.people.length === 0) {
          state.people = [{
            key: 'extreme_dev',
            name: 'Alexander_Bartholomew_Montgomery_Cunningham_III_Of_Northshire',
            assignedTo: 'alexander.b@department.azurewebsites.net',
            role: 'Principal Architect',
            pod: 'Platform Core',
            titlePrefix: 'Core Lead',
            githubUsername: 'alexander-montgomery',
            githubRepositories: ['org/repo-one'],
            githubBranches: ['main'],
            sourceTaskWorkItemId: 123456,
            autoCloseEnabled: true,
          }];
        }
        renderPeople();

        const row = document.querySelector('.person-row');
        if (!row) return null;

        const r1 = row.querySelector('.person-row-identity');
        const r2 = row.querySelector('.person-row-integrations');
        const r3 = row.querySelector('.person-row-actions');

        const r1Fields = r1 ? r1.querySelectorAll('.field').length : 0;
        const r2Fields = r2 ? r2.querySelectorAll('.field').length : 0;

        const autoClose = r3 ? r3.querySelector('.person-autoclose, label') : null;
        const delBtn = r3 ? r3.querySelector('.del') : null;

        const r3Rect = r3 ? r3.getBoundingClientRect() : null;
        const acRect = autoClose ? autoClose.getBoundingClientRect() : null;
        const delRect = delBtn ? delBtn.getBoundingClientRect() : null;

        return {
          r1Fields,
          r2Fields,
          r3HasActions: !!(autoClose && delBtn),
          r3Width: r3Rect ? r3Rect.width : 0,
          acLeft: acRect && r3Rect ? acRect.left - r3Rect.left : 0,
          delRight: delRect && r3Rect ? r3Rect.right - delRect.right : 0,
          acWidth: acRect ? acRect.width : 0,
          delWidth: delRect ? delRect.width : 0,
          overlap: acRect && delRect ? !(acRect.right <= delRect.left || acRect.bottom <= delRect.top || delRect.bottom <= acRect.top) : false,
        };
      })()`);

      const vpPass =
        rowLayout &&
        rowLayout.r1Fields === 5 &&
        rowLayout.r2Fields === 4 &&
        rowLayout.r3HasActions &&
        rowLayout.acLeft <= 25 &&
        rowLayout.delRight <= 25 &&
        !rowLayout.overlap;

      console.log(`Viewport ${vp}px: r1=${rowLayout?.r1Fields}, r2=${rowLayout?.r2Fields}, acLeft=${rowLayout?.acLeft.toFixed(1)}px, delRight=${rowLayout?.delRight.toFixed(1)}px, overlap=${rowLayout?.overlap} -> ${vpPass ? 'PASS' : 'FAIL'}`);
      if (!vpPass) test2AllPass = false;
    }

    results.push({ name: 'Team Management .person-row 11-control Multi-Row Alignment', pass: test2AllPass });

    // =========================================================================
    // TEST 3: Topbar actions layout at breakpoints (1366, 1200, 1000, 600, 390)
    // =========================================================================
    console.log('\n--- Challenge 3: Topbar Actions Layout & Horizontal Overflow ---');
    const topbarBreakpoints = [1366, 1200, 1000, 600, 390];
    let test3AllPass = true;

    for (const vp of topbarBreakpoints) {
      await cdp.setViewport(vp, 800);
      await new Promise((r) => setTimeout(r, 200));

      const topbarMetrics = await cdp.eval(`(() => {
        const topbar = document.querySelector('.topbar');
        const actions = document.querySelector('.topbar-actions');
        const buttons = actions ? Array.from(actions.querySelectorAll('button:not([style*="display: none"])')) : [];

        const docScrollWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const hasHorizontalOverflow = docScrollWidth > winWidth;

        const buttonEscapes = buttons.some(b => {
          const rect = b.getBoundingClientRect();
          return rect.right > winWidth + 1;
        });

        const quickRun = document.querySelector('#quickRunBtn');
        let quickRunFullWidth = true;
        if (winWidth <= 600 && quickRun && actions) {
          const qRect = quickRun.getBoundingClientRect();
          const aRect = actions.getBoundingClientRect();
          quickRunFullWidth = Math.abs(qRect.width - aRect.width) <= 4;
        }

        return {
          winWidth,
          docScrollWidth,
          hasHorizontalOverflow,
          buttonEscapes,
          quickRunFullWidth,
          visibleButtons: buttons.length,
        };
      })()`);

      const vpPass =
        topbarMetrics &&
        !topbarMetrics.hasHorizontalOverflow &&
        !topbarMetrics.buttonEscapes &&
        topbarMetrics.quickRunFullWidth;

      console.log(`Breakpoint ${vp}px: docScroll=${topbarMetrics.docScrollWidth} vs win=${topbarMetrics.winWidth}, hOverflow=${topbarMetrics.hasHorizontalOverflow}, btnEscape=${topbarMetrics.buttonEscapes}, quickRunFullWidth=${topbarMetrics.quickRunFullWidth} -> ${vpPass ? 'PASS' : 'FAIL'}`);
      if (!vpPass) test3AllPass = false;
    }

    results.push({ name: 'Topbar Breakpoint Layout (Zero Overflow & Clipping)', pass: test3AllPass });

    // =========================================================================
    // TEST 4: Planner sidebar buttons row wrapping inside 275px
    // =========================================================================
    console.log('\n--- Challenge 4: Planner Sidebar Buttons Row Wrapping ---');
    await cdp.setViewport(1366, 768);
    await new Promise((r) => setTimeout(r, 200));

    const plannerSidebarData = await cdp.eval(`(() => {
      const { switchView } = window.__TEST_HOOKS__;
      switchView('planner');
      const sidebarControls = document.querySelector('#view-planner .workspace-controls');
      const headRow = sidebarControls ? sidebarControls.querySelector('.card-head .row') : null;
      const buttons = headRow ? Array.from(headRow.querySelectorAll('button')) : [];
      const cRect = sidebarControls ? sidebarControls.getBoundingClientRect() : null;

      const btnRects = buttons.map(b => {
        const r = b.getBoundingClientRect();
        return {
          id: b.id,
          top: r.top - cRect.top,
          left: r.left - cRect.left,
          right: r.right - cRect.left,
          width: r.width,
          escapesRight: r.right > cRect.right + 2,
        };
      });

      const uniqueTops = new Set(btnRects.map(b => Math.round(b.top))).size;

      return {
        sidebarWidth: cRect ? cRect.width : 0,
        buttonCount: buttons.length,
        uniqueVerticalRows: uniqueTops,
        anyEscapesRight: btnRects.some(b => b.escapesRight),
        buttons: btnRects,
      };
    })()`);

    console.log('Planner sidebar button measurements:', plannerSidebarData);
    const test4Pass =
      plannerSidebarData.buttonCount === 5 &&
      plannerSidebarData.uniqueVerticalRows >= 3 &&
      !plannerSidebarData.anyEscapesRight;

    console.log(`[${test4Pass ? 'PASS' : 'FAIL'}] 5 buttons wrapped inside ${plannerSidebarData.sidebarWidth}px across ${plannerSidebarData.uniqueVerticalRows} rows with zero escape into matrix`);
    results.push({ name: 'Planner Sidebar Button Wrapping (275px)', pass: test4Pass, data: plannerSidebarData });

    // =========================================================================
    // TEST 5: Scheduler automation grid
    // =========================================================================
    console.log('\n--- Challenge 5: Scheduler Automation Grid & Input Legibility ---');
    let test5AllPass = true;
    for (const vp of [1366, 1000, 600, 390]) {
      await cdp.setViewport(vp, 800);
      await new Promise((r) => setTimeout(r, 200));

      const schedMetrics = await cdp.eval(`(() => {
        const { switchView } = window.__TEST_HOOKS__;
        switchView('scheduler');
        const inputs = [
          '#schedTimeInput',
          '#schedTzInput',
          '#activeTimeInput',
          '#eodStartTimeInput',
          '#eodEndTimeInput',
        ];

        return inputs.map(sel => {
          const el = document.querySelector(sel);
          if (!el) return { sel, found: false };
          const rect = el.getBoundingClientRect();
          const parent = el.closest('.field');
          const pRect = parent ? parent.getBoundingClientRect() : null;
          return {
            sel,
            found: true,
            width: rect.width,
            parentWidth: pRect ? pRect.width : 0,
            clipped: rect.width < 110,
          };
        });
      })()`);

      const anyClipped = schedMetrics.some(m => !m.found || m.clipped);
      console.log(`Viewport ${vp}px: inputs = ${schedMetrics.map(m => `${m.sel}: ${m.width.toFixed(0)}px`).join(', ')} -> ${!anyClipped ? 'PASS' : 'FAIL'}`);
      if (anyClipped) test5AllPass = false;
    }

    results.push({ name: 'Scheduler Automation Grid Input Legibility (>=110px width)', pass: test5AllPass });

    // =========================================================================
    // TEST 6: Calendar exceptions list table-wrap and add exception modal structure
    // =========================================================================
    console.log('\n--- Challenge 6: Calendar Exceptions List Wrap & Exception Modal ---');
    await cdp.setViewport(1200, 800);
    const calData = await cdp.eval(`(() => {
      const { switchView, openAddExceptionModal } = window.__TEST_HOOKS__;
      switchView('calendar');
      const list = document.querySelector('#calendarExceptionsList');
      const hasTableWrap = list ? list.classList.contains('table-wrap') : false;

      openAddExceptionModal();
      const modal = document.querySelector('#addExceptionModal');
      const card = modal ? modal.querySelector('.modal-card') : null;
      const header = modal ? modal.querySelector('.modal-header') : null;
      const body = modal ? modal.querySelector('.modal-body') : null;
      const footer = modal ? modal.querySelector('.modal-footer') : null;
      const footerBtns = footer ? Array.from(footer.querySelectorAll('button')) : [];

      const modalIsOverlay = modal ? modal.classList.contains('modal-overlay') && modal.classList.contains('open') : false;
      const footerJustify = footer ? window.getComputedStyle(footer).justifyContent : '';

      modal?.remove();

      return {
        hasTableWrap,
        modalExists: !!modal,
        modalIsOverlay,
        hasCard: !!card,
        hasHeader: !!header,
        hasBody: !!body,
        hasFooter: !!footer,
        footerBtnCount: footerBtns.length,
        footerJustify,
      };
    })()`);

    console.log('Calendar and modal measurements:', calData);
    const test6Pass =
      calData.hasTableWrap &&
      calData.modalExists &&
      calData.modalIsOverlay &&
      calData.hasCard &&
      calData.hasHeader &&
      calData.hasBody &&
      calData.hasFooter &&
      calData.footerBtnCount === 2 &&
      calData.footerJustify === 'flex-end';

    console.log(`[${test6Pass ? 'PASS' : 'FAIL'}] Calendar table-wrap=${calData.hasTableWrap}, standard modal structure & themed footer=${calData.footerJustify}`);
    results.push({ name: 'Calendar Table-Wrap & Themed Modal Hierarchy', pass: test6Pass, data: calData });

    // =========================================================================
    // TEST 7: Ad-Hoc modal grid layout with error messages
    // =========================================================================
    console.log('\n--- Challenge 7: Ad-Hoc Modal Grid Layout with Field Errors ---');
    const adHocData = await cdp.eval(`(() => {
      const modal = document.querySelector('#adHocModal');
      modal.classList.add('open');

      const grid2 = modal.querySelector('form .grid.cols-2');
      const gridChildren = grid2 ? Array.from(grid2.children) : [];

      const f1 = gridChildren[0];
      const f2 = gridChildren[1];
      const err1 = f1 ? f1.querySelector('#adHocPersonSelectError') : null;
      const err2 = f2 ? f2.querySelector('#adHocTargetDateError') : null;

      const f1RectBefore = f1 ? f1.getBoundingClientRect() : null;
      const f2RectBefore = f2 ? f2.getBoundingClientRect() : null;

      if (err1) {
        err1.textContent = 'Please select a valid assignee';
        err1.style.display = 'block';
      }
      if (err2) {
        err2.textContent = 'Please select a future target date';
        err2.style.display = 'block';
      }

      const f1RectAfter = f1 ? f1.getBoundingClientRect() : null;
      const f2RectAfter = f2 ? f2.getBoundingClientRect() : null;

      const sideBySideBefore = f1RectBefore && f2RectBefore ? Math.abs(f1RectBefore.top - f2RectBefore.top) < 3 : false;
      const sideBySideAfter = f1RectAfter && f2RectAfter ? Math.abs(f1RectAfter.top - f2RectAfter.top) < 3 : false;

      modal.classList.remove('open');
      if (err1) err1.style.display = 'none';
      if (err2) err2.style.display = 'none';

      return {
        gridChildrenCount: gridChildren.length,
        err1IsInsideField: !!err1,
        err2IsInsideField: !!err2,
        sideBySideBefore,
        sideBySideAfter,
        f1WidthAfter: f1RectAfter ? f1RectAfter.width : 0,
        f2WidthAfter: f2RectAfter ? f2RectAfter.width : 0,
      };
    })()`);

    console.log('Ad-Hoc Modal measurements:', adHocData);
    const test7Pass =
      adHocData.gridChildrenCount === 2 &&
      adHocData.err1IsInsideField &&
      adHocData.err2IsInsideField &&
      adHocData.sideBySideBefore &&
      adHocData.sideBySideAfter &&
      Math.abs(adHocData.f1WidthAfter - adHocData.f2WidthAfter) < 5;

    console.log(`[${test7Pass ? 'PASS' : 'FAIL'}] Ad-Hoc Modal: exactly 2 grid children, errors nested in fields, fields remain side-by-side with error visible`);
    results.push({ name: 'Ad-Hoc Modal Grid Layout & Error Containment', pass: test7Pass, data: adHocData });

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n======================================================');
    console.log('             CHALLENGE SUITE RESULTS                  ');
    console.log('======================================================');
    let overallPass = true;
    for (const r of results) {
      console.log(`  ${r.pass ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
      if (!r.pass) overallPass = false;
    }
    console.log('======================================================');
    console.log(`OVERALL VERDICT: ${overallPass ? 'ALL TESTS PASSED (APPROVE)' : 'TESTS FAILED (FAIL)'}`);
    console.log('======================================================');

    process.exitCode = overallPass ? 0 : 1;
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exitCode = 1;
  } finally {
    if (ws) ws.close();
    chrome.kill();
    server.close();
  }
}

run();
