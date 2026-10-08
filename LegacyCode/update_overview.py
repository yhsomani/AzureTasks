import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

insights_html = """
        <div class="panel" style="margin-bottom: 1.5rem;">
          <div class="panel-header">
            <div class="panel-title"><span>💡 Smart Insights</span></div>
          </div>
          <div class="panel-body" id="insightsContainer">
            <div style="color: var(--text-muted); padding: 1rem;">Loading insights...</div>
          </div>
        </div>
"""

# Find where to inject in tab-overview. I'll put it right after the KPI grid.
kpi_end = content.find('</div><!-- End KPI Grid -->')
if kpi_end != -1:
    content = content[:kpi_end+27] + '\n' + insights_html + content[kpi_end+27:]
else:
    # Just put it after <section id="tab-overview" class="tab-pane active">
    start = content.find('<section id="tab-overview" class="tab-pane active">')
    if start != -1:
        insert_idx = content.find('>', start) + 1
        content = content[:insert_idx] + '\n' + insights_html + content[insert_idx:]

with open('src/ui/index.html', 'w') as f:
    f.write(content)
