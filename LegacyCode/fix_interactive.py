import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

# Add a global to store the current matrix data so we can click cells
add_global = "let currentDashboardData = null;\n"
if "let currentDashboardData = null;" not in content:
    content = content.replace("let effortTrendChartInstance = null;", add_global + "let effortTrendChartInstance = null;")

content = content.replace("renderBurndownMatrix(json.data);", "currentDashboardData = json.data;\n      renderBurndownMatrix(json.data);")

# Update renderBurndownMatrix to make cells clickable
# Look for the cell injection loop in renderBurndownMatrix
# The loop looks like: if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
#        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
#        html += `<td class="cell-status cell-completed">${completed > 0 ? completed : cell.tasks.length}</td>`;

replacement_cell = """
      if (cell.isWeekend) {
        html += `<td class="cell-status cell-weekend">WO</td>`;
      } else if (cell.status === 'MISSING') {
        html += `<td class="cell-status" style="cursor:pointer;" onclick="inspectCell('${row.person.name}', '${d.dateIso}')">0</td>`;
      } else if (cell.status === 'CREATED' || cell.status === 'DUPLICATE') {
        const completed = cell.tasks.reduce((sum, t) => sum + (t.completedWork || 0), 0);
        html += `<td class="cell-status cell-completed" style="cursor:pointer;" onclick="inspectCell('${row.person.name}', '${d.dateIso}')">${completed > 0 ? completed : cell.tasks.length}</td>`;
      } else {
        html += `<td></td>`;
      }
"""

# I need to be careful with replace. I'll just rewrite the whole renderBurndownMatrix function safely.
