import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

inspect_code = """
window.inspectCell = function(personName, dateIso) {
  if (!currentDashboardData) return;
  const row = currentDashboardData.matrix.find(r => r.person.name === personName);
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
"""

insights_code = """
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
"""

# Inject before loadBurndown
content = content.replace("async function loadBurndown(selectedMonth)", inspect_code + "\n" + insights_code + "\nasync function loadBurndown(selectedMonth)")

# Call generateInsights in loadBurndown
content = content.replace("renderOverviewCharts(json.data);", "renderOverviewCharts(json.data);\n      generateInsights(json.data);")

with open('src/ui/app.js', 'w') as f:
    f.write(content)

