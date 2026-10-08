import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

# Update loadBurndown to take an optional month string YYYY-MM
replacement_func = """
async function loadBurndown(selectedMonth) {
  const container = document.getElementById('burndownMatrixContainer');
  if (!container) return;

  container.innerHTML = `<div style="text-align: center; padding: 3rem; color: var(--text-muted);">Loading Work Intelligence Matrix...</div>`;

  try {
    let y, m;
    if (selectedMonth) {
      [y, m] = selectedMonth.split('-');
    } else {
      const now = new Date();
      y = now.getFullYear();
      m = String(now.getMonth() + 1).padStart(2, '0');
      const selector = document.getElementById('burndownMonthSelector');
      if (selector) selector.value = `${y}-${m}`;
    }
    
    const start = `${y}-${m}-01`;
    const end = `${y}-${m}-31`;

    const res = await fetch(`/api/explorer?startDate=${start}&endDate=${end}`);
    const json = await res.json();

    if (json.success) {
      renderBurndownMatrix(json.data);
      renderOverviewCharts(json.data);
      renderMyWork(json.data);
    } else {
      container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Error: ${json.error}</div>`;
    }
  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger); padding: 2rem;">Failed to load burndown: ${err.message}</div>`;
  }
}
"""

start_idx = content.find('async function loadBurndown()')
end_idx = content.find('function renderBurndownMatrix', start_idx)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + replacement_func + '\n' + content[end_idx:]
    with open('src/ui/app.js', 'w') as f:
        f.write(content)

