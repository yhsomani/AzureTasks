import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

# Extract Action Bar & Controls which holds the matrix
matrix_regex = re.compile(r'(<!-- Action Bar & Controls -->.*?)(<!-- Upcoming Plan Details -->)', re.DOTALL)
match = matrix_regex.search(content)

if match:
    matrix_html = match.group(1)
    # Remove from overview
    content = content.replace(matrix_html, '')
    # Inject into burndown
    content = content.replace('<!-- We will move the matrix here later -->', matrix_html)

with open('src/ui/index.html', 'w') as f:
    f.write(content)
