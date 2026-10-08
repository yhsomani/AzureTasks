import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

old_missing = "html += `<td class=\"cell-status\">0</td>`;"
new_missing = "html += `<td class=\"cell-status\" style=\"cursor:pointer;\" onclick=\"inspectCell('${row.person.name}', '${d.dateIso}')\">0</td>`;"
content = content.replace(old_missing, new_missing)

old_completed = "html += `<td class=\"cell-status cell-completed\">${completed > 0 ? completed : cell.tasks.length}</td>`;"
new_completed = "html += `<td class=\"cell-status cell-completed\" style=\"cursor:pointer;\" onclick=\"inspectCell('${row.person.name}', '${d.dateIso}')\">${completed > 0 ? completed : cell.tasks.length}</td>`;"
content = content.replace(old_completed, new_completed)

with open('src/ui/app.js', 'w') as f:
    f.write(content)
