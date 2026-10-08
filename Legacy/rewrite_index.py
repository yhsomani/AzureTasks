import re

with open('src/ui/index.html', 'r') as f:
    content = f.read()

# I will replace the contents of <main class="main-content"> ... </main>
# But wait, there are a lot of existing components inside the main tags.
# Instead of doing it blindly, I'll extract everything and put it back in modified.

