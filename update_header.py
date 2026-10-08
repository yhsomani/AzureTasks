with open('src/ui/index.html', 'r') as f:
    content = f.read()

# Update header title
content = content.replace('Azure DevOps 3in1 Studio', 'Work Intelligence')
content = content.replace('Auto-Task Replication Engine &bull; Multi-Person Stream Isolation', 'Track daily contributions, monitor team workloads, analyze task progress, and understand delivery performance in one unified workspace.')

with open('src/ui/index.html', 'w') as f:
    f.write(content)
