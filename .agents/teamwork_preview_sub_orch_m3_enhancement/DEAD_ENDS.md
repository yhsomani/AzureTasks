# Dead Ends — Milestone 3

| Iteration | Approach Tried | Why It Failed | Files Touched |
|---|---|---|---|
| 1 | Moving `this.lockPath` to `${this.lockPath}.${pid}.${uuid}.stale` before unlinking in stale lock reclamation | Moving the lock file temporarily vacates `this.lockPath` on the filesystem. A concurrent process calling `acquire()` succeeds at `writeExclusive()` (flag 'wx') during this window, while the contending process renames the original lock back, causing multiple processes to acquire exclusive lock simultaneously (violating mutual exclusion in multi-process OS harness). | `src/infrastructure/lock/file-lock-repo.ts` |
