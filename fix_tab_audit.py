import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

# Replace tab-audit content entirely
audit_html = """
    <!-- TAB: ACTIVITY & AUDIT -->
    <section id="tab-audit" class="tab-pane">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span>📜 Activity &amp; Audit Timeline</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <a href="/api/journal/export?format=csv" download="task-journal.csv" class="btn btn-secondary btn-sm" style="text-decoration: none;">
              📥 Export CSV
            </a>
            <a href="/api/journal/export?format=json" download="task-journal.json" class="btn btn-secondary btn-sm" style="text-decoration: none;">
              📥 Export JSON
            </a>
          </div>
        </div>
        <div class="panel-body">
           <div class="table-container">
             <table class="data-table">
               <thead>
                 <tr>
                   <th>Timestamp</th>
                   <th>Operation</th>
                   <th>Status</th>
                   <th>User</th>
                   <th>Work Item ID</th>
                   <th>Details</th>
                 </tr>
               </thead>
               <tbody id="auditListBody">
                 <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading audit logs...</td></tr>
               </tbody>
             </table>
           </div>
        </div>
      </div>
    </section>
"""

# We need to find the start and end of tab-audit
start_tag = '<section id="tab-audit" class="tab-pane">'
end_tag = '</section>'

start_idx = content.find(start_tag)
# Find the next section tag or closing main
next_section_idx = content.find('<section id="tab-settings"', start_idx)

if start_idx != -1 and next_section_idx != -1:
    content = content[:start_idx] + audit_html + '\n' + content[next_section_idx:]
    with open('src/ui/index.html', 'w') as f:
        f.write(content)
        print("Replaced tab-audit in index.html")
else:
    print("Could not find tab-audit bounds")
