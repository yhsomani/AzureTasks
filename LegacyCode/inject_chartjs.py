with open('src/ui/index.html', 'r') as f:
    content = f.read()

head_insert = '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>\n</head>'
content = content.replace('</head>', head_insert)

# Add charts to tab-overview
charts_html = """
      <!-- DASHBOARD CHARTS -->
      <div class="chart-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem;">
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title"><span>📈 Daily Effort Trend</span></div>
          </div>
          <div class="panel-body">
            <canvas id="effortTrendChart" height="200"></canvas>
          </div>
        </div>
        <div class="panel-body panel">
          <div class="panel-header">
            <div class="panel-title"><span>📊 Task Status Distribution</span></div>
          </div>
          <div class="panel-body">
            <canvas id="statusDistributionChart" height="200"></canvas>
          </div>
        </div>
      </div>
"""

content = content.replace('<!-- Upcoming Plan Details -->', charts_html + '\n      <!-- Upcoming Plan Details -->')

with open('src/ui/index.html', 'w') as f:
    f.write(content)
