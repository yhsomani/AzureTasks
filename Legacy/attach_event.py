import re

with open('src/ui/app.js', 'r') as f:
    content = f.read()

event_listener = """
  const btnLoadBurndown = document.getElementById('btnLoadBurndown');
  if (btnLoadBurndown) {
    btnLoadBurndown.addEventListener('click', () => {
      const val = document.getElementById('burndownMonthSelector').value;
      if (val) loadBurndown(val);
    });
  }
"""

# Insert into initialize function
init_idx = content.find('function initializeEventListeners() {')
next_bracket = content.find('{', init_idx) + 1

if init_idx != -1:
    content = content[:next_bracket] + '\n' + event_listener + content[next_bracket:]
    with open('src/ui/app.js', 'w') as f:
        f.write(content)

