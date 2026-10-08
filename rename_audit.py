with open('src/ui/index.html', 'r') as f:
    content = f.read()

content = content.replace('📊 Execution Journal', '📜 Activity & Audit')
content = content.replace('Auto-Generated Execution Logs', 'Comprehensive Operational History & Automation Logs')
content = content.replace('Search logs...', 'Search activities, operations, users, or errors...')

with open('src/ui/index.html', 'w') as f:
    f.write(content)
