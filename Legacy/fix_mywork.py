import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

mywork_func = """
function renderMyWork(data) {
  const container = document.getElementById('tab-mywork');
  if (!container || !data || !data.matrix || data.matrix.length === 0) return;

  const me = data.matrix[0]; // Just picking the first configured user for now as 'Me'
  
  let html = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">
          <span>👨‍💻 My Work: ${me.person.name}</span>
        </div>
      </div>
      <div class="panel-body">
        <div class="kpi-grid" style="margin-bottom: 1.5rem;">
          <div class="kpi-card">
            <div class="kpi-title">Completed Work</div>
            <div class="kpi-value" style="color: var(--success);">${me.stats.totalCompletedWork}h</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Remaining Work</div>
            <div class="kpi-value" style="color: var(--warning);">${me.stats.totalRemainingWork}h</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Active Tasks</div>
            <div class="kpi-value" style="color: var(--brand-primary);">${me.stats.stateCounts['Active'] || 0}</div>
          </div>
        </div>
        
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th>Date</th>
              <th>Task</th>
              <th>State</th>
              <th>Completed (h)</th>
            </tr>
          </thead>
          <tbody>
  `;
  
  data.dates.forEach(d => {
    const cell = me.cells[d.dateIso];
    if (cell && cell.tasks && cell.tasks.length > 0) {
      cell.tasks.forEach(t => {
        html += `<tr>
          <td>${d.formattedDate}</td>
          <td><a href="${t.url}" target="_blank" style="color: var(--brand-primary); text-decoration: none;">${t.title}</a></td>
          <td><span class="badge-pill">${t.state}</span></td>
          <td>${t.completedWork || 0}h</td>
        </tr>`;
      });
    }
  });
  
  html += `</tbody></table></div></div>`;
  container.innerHTML = html;
}
"""

content = content.replace('function renderBurndownMatrix(data) {', mywork_func + '\nfunction renderBurndownMatrix(data) {')
content = content.replace('renderOverviewCharts(json.data);', 'renderOverviewCharts(json.data);\n      renderMyWork(json.data);')

with open('src/ui/app.js', 'w') as f:
    f.write(content)

