import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

# I need to update renderOverviewCharts to also render KPIs.
kpi_func = """
  // Compute KPIs
  const totalUsers = matrix.length;
  const totalTasks = matrix.reduce((sum, row) => sum + row.stats.createdCount, 0);
  const totalCompletedWork = matrix.reduce((sum, row) => sum + row.stats.totalCompletedWork, 0);
  const totalRemainingWork = matrix.reduce((sum, row) => sum + row.stats.totalRemainingWork, 0);
  
  const elUsers = document.getElementById('kpiPeopleCount');
  if (elUsers) elUsers.textContent = totalUsers;
  
  const elTasks = document.getElementById('kpiToCreateCount');
  if (elTasks) {
    elTasks.textContent = totalTasks;
    elTasks.previousElementSibling.querySelector('.kpi-title').textContent = 'Total Tasks';
  }
  
  const elCompleted = document.getElementById('kpiExistingCount');
  if (elCompleted) {
    elCompleted.textContent = totalCompletedWork + 'h';
    elCompleted.previousElementSibling.querySelector('.kpi-title').textContent = 'Total Completed Work';
  }
"""

content = content.replace('// Render Status Distribution Chart', kpi_func + '\n  // Render Status Distribution Chart')

with open('src/ui/app.js', 'w') as f:
    f.write(content)
