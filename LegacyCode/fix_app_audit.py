import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

audit_js = """
async function loadJournal() {
  const tbody = document.getElementById('auditListBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Loading Daily Burndown data...</td></tr>';

  try {
    const res = await fetch('/api/journal');
    const json = await res.json();
    if (json.success && json.data.entries) {
      renderAuditTable(json.data.entries);
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="color: var(--danger); text-align: center;">Failed to load data: ${err.message}</td></tr>`;
  }
}

function renderAuditTable(entries) {
  const tbody = document.getElementById('auditListBody');
  if (!tbody) return;

  if (entries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No audit records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = entries.map(entry => {
    return `<tr>
      <td>${entry.timestamp || entry.createdDate || '-'}</td>
      <td>${entry.type || entry.operation || 'EXECUTE'}</td>
      <td>
        <span class="badge-pill ${entry.status === 'SUCCESS' ? 'badge-connected' : 'badge-disconnected'}">
          ${entry.status || 'UNKNOWN'}
        </span>
      </td>
      <td>${entry.user || '-'}</td>
      <td>${entry.taskId || entry.workItemId || '-'}</td>
      <td style="font-size: 0.8rem; color: var(--text-muted);">${entry.message || entry.error || ''}</td>
    </tr>`;
  }).join('');
}
"""

# replace the block from async function loadJournal() down to the end of function renderBurndownMatrix() 
start_idx = content.find('async function loadJournal()')
end_idx = content.find('// Update totals', start_idx)
if end_idx == -1:
    end_idx = content.find('async function loadScheduler()', start_idx)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + audit_js + '\n' + content[end_idx:]
    with open('src/ui/app.js', 'w') as f:
        f.write(content)
        print("Updated app.js for audit view")
else:
    print("Could not find bounds in app.js")

