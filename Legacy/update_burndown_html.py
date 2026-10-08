import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

burndown_tab_new = """
    <!-- TAB: DAILY BURNDOWN -->
    <section id="tab-burndown" class="tab-pane">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span>📅 Daily Work & Burndown Matrix</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input type="month" id="burndownMonthSelector" class="form-control" style="width: auto;">
            <button id="btnLoadBurndown" class="btn btn-primary btn-sm">Load Month</button>
          </div>
        </div>
        <div class="panel-body" id="burndownMatrixContainer" style="padding: 0;">
           <!-- Matrix injected here -->
        </div>
      </div>
    </section>
"""

start_tag = '<section id="tab-burndown"'
end_tag = '</section>'
start_idx = content.find(start_tag)
next_section_idx = content.find('<section id="tab-mywork"', start_idx)

if start_idx != -1 and next_section_idx != -1:
    content = content[:start_idx] + burndown_tab_new + '\n' + content[next_section_idx:]
    with open('src/ui/index.html', 'w') as f:
        f.write(content)

