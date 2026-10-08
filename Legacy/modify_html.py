import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

# Rename tab-dashboard to tab-overview
content = content.replace('<section id="tab-dashboard"', '<section id="tab-overview"')
# The matrix and plan details should probably go to tab-burndown.
# Let's just create new sections and organize.

# For now, I will just add the missing sections so the JS doesn't break, and then I will refine them.
new_sections = """
    <!-- TAB: DAILY BURNDOWN -->
    <section id="tab-burndown" class="tab-pane">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span>📅 Daily Burndown Matrix</span>
          </div>
          <!-- We will move the matrix here later -->
        </div>
        <div class="panel-body" id="burndownMatrixContainer">
        </div>
      </div>
    </section>

    <!-- TAB: MY WORK -->
    <section id="tab-mywork" class="tab-pane">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span>👨‍💻 My Work</span>
          </div>
        </div>
        <div class="panel-body">
           <p>Personalized view coming soon...</p>
        </div>
      </div>
    </section>
"""

content = content.replace('<!-- TAB 2: TASK EXPLORER & TRACKING -->', new_sections + '\n    <!-- TAB 2: TASK EXPLORER & TRACKING -->')

# Rename tab-journal to tab-audit
content = content.replace('<section id="tab-journal"', '<section id="tab-audit"')

with open('src/ui/index.html', 'w') as f:
    f.write(content)

print("Done modifying index.html")
