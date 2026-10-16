# Design system

The UI is a dependency-free SPA: `index.html` (structure), `styles.css` (design
tokens + components), `app.js` (state, API calls, rendering). No framework, no
build step.

## Principles

1. **Every control performs a real action.** No placeholder buttons. Each nav
   item loads real data; every save persists; every execute writes to Azure and
   the audit log.
2. **Progressive disclosure.** Overview (Dashboard) → operation (Planner,
   Explorer) → configuration (Team, Settings) → evidence (Audit Log, Logs).
3. **Accessible by default.** Skip link, semantic landmarks, `aria-live` for
   toasts/logs, visible focus rings, keyboard-operable controls, and a
   `prefers-reduced-motion` path.
4. **Responsive.** Collapsible sidebar ≤ 860 px; fluid grids.

## Tokens (CSS custom properties)

| Token | Purpose |
|---|---|
| `--accent` `--accent-hover` `--accent-soft` | Primary action + focus |
| `--ok` `--warn` `--danger` | Semantic status |
| `--bg` `--bg-elev` `--bg-elev-2` `--surface` | Surfaces |
| `--text` `--text-muted` | Text hierarchy |
| `--border` `--border-strong` | Dividers + inputs |
| `--radius` `--radius-sm` `--shadow` | Shape + depth |
| `--font` `--mono` `--transition` | Typography + motion |

Light and dark themes are swapped via `[data-theme]`; the choice persists in
`localStorage`. Dark is the default.

## Components

| Component | Class | Used by |
|---|---|---|
| App shell | `.app`, `.sidebar`, `.main` | All views |
| Nav item | `.nav-item` (+`.active`) | Sidebar |
| Card | `.card`, `.card-head` | All views |
| KPI | `.card.kpi`, `.kpi-value` | Dashboard |
| Button | `.btn.primary/.ghost/.danger/.small` | Everywhere |
| Icon button | `.icon-btn` | Theme, menu |
| Field | `.field`, `input`, `select` | Forms |
| Switch | `.switch`, `.slider` | Scheduler toggle |
| Pill | `.pill.ok/.warn/.bad` | Status chips |
| Badge | `.badge.<STATUS>` | Plan/execute results, journal |
| Person chip | `.person-chip` (+`.on`) | Planner picker |
| Table | `.table-wrap`, `.table` | Audit log |
| Stat chip | `.stat-chip` | Journal/summary |
| Timeline | `.tl-item` | Dashboard activity |
| Explorer grid | `.explorer-grid`, `.cell.has/.missing/.skip` | Explorer |
| Logs | `.logs`, `.l-<level>` | Logs |
| Toast | `.toast-stack`, `.toast.ok/.err/.warn` | Notifications |
| Spinner | `.spinner` | In-flight actions |

## Status → colour mapping

| Status | Colour |
|---|---|
| `CREATED`, `SUCCESS` | green (`.ok`) |
| `PLANNED`, `READY` | accent blue |
| `WEEKEND_SKIP`, `DUPLICATE_*`, `NO_TASKS_NEEDED` | muted |
| `FUTURE_TASK_WARN`, `MULTIPLE_EXISTING_TASKS` | amber |
| `FAILED`, `PARTIAL` | red |

## Views

| View | Purpose | Data source |
|---|---|---|
| Dashboard | Health + today's plan + recent activity | `/status`, `/config`, `/scheduler`, `/tasks/plan`, `/journal` |
| Planner | Select people, preview, execute | `/tasks/plan`, `/tasks/execute` |
| Explorer | Per-person × date coverage; create missing | `/tasks/plan`, `/tasks/execute` |
| Team | Edit roster | `/config`, `/config/people` |
| Audit Log | Journal table + export | `/journal`, `/journal/export` |
| Scheduler | Toggle + status | `/scheduler`, `/scheduler/toggle` |
| Logs | Live structured output | `/logs/recent`, `/logs/stream` |
| Settings | Connection + PAT | `/config/settings`, `/config/pat` |


## Journey-first UI shell (October 2026)

The maintained navigation groups are **Overview**, **Explore work**, **Create & automate**, **Manage**, and **Monitor**. Active navigation must expose `aria-current="page"` and the current breadcrumb; use `switchView(view)` for internal navigation instead of directly manipulating classes. Buttons that jump between destinations use `data-view-link`.

The mobile sidebar exposes `aria-expanded`, a dismissible backdrop, Escape dismissal, and page-heading focus on navigation. `.nav-group`, `.journey-guide`, `.workflow-note`, and `.matrix-cell-action` are the shared styles. Dialogs trap Tab/Shift+Tab focus; the initiator regains focus on close. Mutation entry points must not skip a scoped preview.

See [UX redesign audit and acceptance matrix](UX_REDESIGN.md) for the complete navigation map, severity ranking, and verification limits.
