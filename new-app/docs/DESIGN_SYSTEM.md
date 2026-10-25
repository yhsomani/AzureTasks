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
4. **Responsive.** Collapsible sidebar at 860 px; workspaces collapse at
   1000 px. Dense data scrolls inside its own region, never across the page.

## Mission-control visual language

The interface uses navy instrument panels, cyan action accents, fine borders,
monospaced telemetry labels, and restrained static orbital graphics. It avoids
simulated live data, decorative animation, and ambiguous science-fiction jargon.
Light mode uses the same hierarchy with white panels and a darker teal accent.

The dashboard is an operational briefing, not an equal-weight card wall:
connection and roster metrics lead into exceptions and the next reviewed plan;
effort charts and pull-request activity are supporting intelligence. Explorer
and Planner separate configuration from results. Scheduler separates task
creation from end-of-day closure. Action docks remain in normal document flow
so they cannot cover mobile tables or confirmation controls.

The redesign was developed through a visual-architecture and interaction-agent
exchange, challenging write safety, narrow-screen table density, truthful state
labels, and focus restoration. Existing destinations and mutation safeguards
remain the navigation and behavior contract.

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
| `--on-accent` `--on-danger` | Readable text on filled action buttons |
| `--violet` `--info` `--muted` | Supporting data and canvas chart palette |
| `--focus-ring` `--grid-line` | Keyboard focus and quiet workspace grid |

Light and dark themes are swapped via `[data-theme]`; the choice persists in
`localStorage`. Dark is the default.

Canvas charts resolve the active CSS tokens and repaint from the already loaded
data when the theme changes. Chart animation respects reduced-motion settings.
Status text, pressed states, and borders communicate meaning in addition to color.

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
| Operational briefing | `.mission-briefing`, `.briefing-copy` | Dashboard |
| Priority columns | `.dashboard-layout`, `.dashboard-primary`, `.dashboard-secondary` | Dashboard |
| Configuration workspace | `.workspace-layout`, `.workspace-controls`, `.workspace-content` | My Work, Explorer, Planner, Team, Settings |
| Stacked scope fields | `.scope-fields` | Explorer, Planner |
| Operation bay | `.automation-grid`, `.operation-panel` | Scheduler |
| In-flow actions | `.action-dock` | Forms and reviewed operations |
| Instrument label | `.section-kicker`, `.panel-index` | Workspace hierarchy |
| Empty state | `.empty-state` | Generated plans, history and PR activity |

## Status → colour mapping

| Status | Colour |
|---|---|
| `CREATED`, `SUCCESS` | green (`.ok`) |
| `PLANNED`, `READY` | accent cyan (teal in light mode) |
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

The mobile sidebar exposes `aria-expanded`, a dismissible backdrop, Escape dismissal, and page-heading focus on navigation. Closed mobile navigation and console drawers are visually hidden and excluded from keyboard focus. `.nav-group`, `.journey-guide`, `.workflow-note`, and `.matrix-cell-action` are the shared styles. Dialogs trap Tab/Shift+Tab focus; the initiator regains focus on close. The console drawer also restores its opening control's focus. Mutation entry points must not skip a scoped preview.

See [UX redesign audit and acceptance matrix](UX_REDESIGN.md) for the complete navigation map, severity ranking, and verification limits.
