import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

# Add loadBurndown function before loadExplorer
burndown_func = """
async function loadBurndown() {
  const container = document.getElementById('burndownMatrixContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading Work Intelligence Matrix...</div>`;

  try {
    // Determine current month range
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const start = `${y}-${m}-01`;
    const end = `${y}-${m}-31`; // The backend logic handles end of month correctly if we pass 31 or it just stops at the month end.

    const res = await fetch(`/api/explorer?startDate=${start}&endDate=${end}`);
    const json = await res.json();

    if (json.success) {
      renderBurndownMatrix(json.data);
    } else {
      container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Error: ${json.error}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Failed to load burndown: ${err.message}</div>`;
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
        html += `<td class="cell-status">0</td>`;
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
        html += `<td class="cell-status cell-completed">${completed > 0 ? completed : cell.tasks.length}</td>`;
      } else {
        html += `<td></td>`;
      }
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}
"""

content = content.replace('async function loadExplorer()', burndown_func + '\nasync function loadExplorer()')

# Call loadBurndown in setupTabs for the new tab 'burndown'
content = content.replace("// TODO: Add load logic for burndown and mywork", "if (target === 'burndown') loadBurndown();")

with open('src/ui/app.js', 'w') as f:
    f.write(content)

