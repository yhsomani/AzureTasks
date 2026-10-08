import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

charts_func = """
let effortTrendChartInstance = null;
let statusDistributionChartInstance = null;

function renderOverviewCharts(data) {
  const { dates, matrix } = data;

  // Render Status Distribution Chart
  const stateCounts = { New: 0, Active: 0, Closed: 0, Resolved: 0, Other: 0 };
  matrix.forEach(row => {
    Object.keys(row.stats.stateCounts).forEach(state => {
      if (stateCounts[state] !== undefined) {
        stateCounts[state] += row.stats.stateCounts[state];
      } else {
        stateCounts.Other += row.stats.stateCounts[state];
      }
    });
  });

  const ctxStatus = document.getElementById('statusDistributionChart');
  if (ctxStatus) {
    if (statusDistributionChartInstance) {
      statusDistributionChartInstance.destroy();
    }
    statusDistributionChartInstance = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: ['New', 'Active', 'Resolved', 'Closed', 'Other'],
        datasets: [{
          data: [stateCounts.New, stateCounts.Active, stateCounts.Resolved, stateCounts.Closed, stateCounts.Other],
          backgroundColor: [
            '#94a3b8', // New (grey)
            '#2563eb', // Active (blue)
            '#f59e0b', // Resolved (amber)
            '#10b981', // Closed (green)
            '#cbd5e1'  // Other
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { position: 'right' }
        }
      }
    });
  }

  // Render Effort Trend Chart
  const dateLabels = dates.map(d => d.formattedDate.substring(0, 6)); // e.g., Oct 01
  const effortData = new Array(dates.length).fill(0);

  matrix.forEach(row => {
    dates.forEach((d, i) => {
      const cell = row.cells[d.dateIso];
      if (cell && cell.tasks) {
        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
        effortData[i] += completed;
      }
    });
  });

  const ctxEffort = document.getElementById('effortTrendChart');
  if (ctxEffort) {
    if (effortTrendChartInstance) {
      effortTrendChartInstance.destroy();
    }
    effortTrendChartInstance = new Chart(ctxEffort, {
      type: 'line',
      data: {
        labels: dateLabels,
        datasets: [{
          label: 'Total Completed Work (h)',
          data: effortData,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }
}
"""

content = content.replace('function renderBurndownMatrix(data) {', charts_func + '\nfunction renderBurndownMatrix(data) {')
content = content.replace('renderBurndownMatrix(json.data);', 'renderBurndownMatrix(json.data);\n      renderOverviewCharts(json.data);')

with open('src/ui/app.js', 'w') as f:
    f.write(content)

