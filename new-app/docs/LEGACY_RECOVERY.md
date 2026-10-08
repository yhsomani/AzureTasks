# Legacy recovery & preservation

The original application was preserved before the greenfield rebuild. Nothing in
the legacy tree was modified to make the new app work; the new app has **zero
runtime dependency** on `../Legacy`.

## History

| Commit | Meaning |
|---|---|
| `5eeed8e` | `chore: save state before legacy move` |
| `f819fa8` | `chore: preserve legacy project state before greenfield rebuild` |

The legacy project now lives at `../Legacy` (moved from the repository root).
`Legacy/node_modules` and `Legacy/dist` were left in place rather than deleted or
relocated, so the legacy app remains immediately runnable.

## Run the legacy app independently

```bash
cd Legacy
npm install            # dependencies are unchanged from the original
npm run typecheck      # tsc --noEmit
npm test               # vitest (original legacy tests)
npm start              # tsx src/index.ts  (CLI)
npm run ui             # tsx src/index.ts --ui  (web UI)
npm run daemon         # scheduler
npm run dry-run        # dry run
npm run build && npm run start:prod   # compiled
```

The legacy app still expects its own `Legacy/.env` (containing
`AZURE_DEVOPS_PAT`) and `Legacy/people.json`.

## Recovering / restoring the legacy state

Everything needed is in git:

```bash
# View the exact preserved snapshot
git show --stat f819fa8

# Extract just the legacy tree at that commit into a temp dir
git archive f819fa8 Legacy | (cd /tmp && tar xf -)

# Or restore the pre-move layout at the repository root (destructive)
git checkout f819fa8 -- .
```

> Do **not** run `git checkout f819fa8 -- .` on a working branch while you have
> uncommitted `new-app/` work — it will overwrite tracked files. Prefer
> `git archive` into a temporary directory.

## Files intentionally **not** carried forward

| Legacy artifact | Reason |
|---|---|
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | Disables TLS verification — insecure; install the corporate CA instead |
| Monolithic `src/ui/app.js`, `index.html` rewrites | Replaced by a small module SPA |
| One-off `fix_*.py`, `rewrite_*.py`, `update_*.py`, `inject_*.py` scripts | Historical migration scripts; kept for archaeology, not used |
| `plaintext .env` PAT handling | New app still writes `.env` but restricts permissions and scrubs logs |

Those scripts (`Legacy/*.py`, `get_prompt.*`, `full_prompt.txt`, etc.) are
retained verbatim for reference only.
