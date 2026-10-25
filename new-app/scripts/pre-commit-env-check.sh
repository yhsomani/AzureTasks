#!/bin/bash
# Pre-commit hook to prevent accidental .env file commits
# Install by: cp scripts/pre-commit-env-check.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

# Exit on error
set -e

# Check if .env file is staged for commit
if git diff --cached --name-only | grep -q '^\.env$'; then
    echo "ERROR: .env file is staged for commit!"
    echo ""
    echo "The .env file contains sensitive credentials and must NEVER be committed to git."
    echo ""
    echo "To fix this:"
    echo "  1. Run: git reset HEAD .env"
    echo "  2. Verify .env is in .gitignore: echo '.env' >> .gitignore"
    echo "  3. Stage .gitignore: git add .gitignore"
    echo "  4. Commit: git commit -m 'Add .env to .gitignore'"
    echo ""
    echo "If .env was already committed (in history):"
    echo "  1. Revoke all tokens in .env immediately"
    echo "  2. Run: git rm --cached .env && git commit -m 'Remove .env from tracking'"
    echo "  3. Force push if necessary (carefully!)"
    echo ""
    exit 1
fi

# Check if any tracked files contain environment variables that look like real secrets
# This is a basic check - for production, use more sophisticated secret scanning
SENSITIVE_FILES=$(git diff --cached --name-only | grep -E '\.(js|ts|json|yaml|yml)$' || true)

for file in $SENSITIVE_FILES; do
    if [ -f "$file" ]; then
        # Check for common secret patterns
        if grep -E '(ghp_|github_pat_|[A-Za-z0-9]{40,})' "$file" | grep -v 'your-\|xxx\|EXAMPLE\|example' > /dev/null 2>&1; then
            echo "WARNING: Potential secret found in $file"
            echo "Review the changes before committing."
        fi
    fi
done

exit 0
