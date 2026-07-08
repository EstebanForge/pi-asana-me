# Changelog

## 1.1.0 — 2026-07-08

### Added
- `asana_get_task_description` — full, untruncated task notes/description
  for a single GID. `asana_get_task` caps `notes` at ~2000 chars to keep its
  default payload cheap, which hides the acceptance criteria, background,
  and implementation detail an agent needs to actually perform the task.
  When the cap fires, `asana_get_task` now prints a
  `[truncated; call asana_get_task_description for the full text]` marker;
  the agent reaches for this tool to recover the whole body. Asks only for
  `name,notes`, no other projection.

### Changed
- `asana_get_task` no longer silently slices `notes` at 400 chars. It now caps
  at 2000 chars (most real task specs render inline; only very long bodies
  trip the marker) and prints an explicit marker pointing at
  `asana_get_task_description` when the body overflows. Notes at or under the
  cap render inline, unchanged. Also fixed: empty-string `notes` previously
  dropped the line entirely (falsy guard); now renders as an empty line via a
  type-based guard.

## 1.0.0 — 2026-07-06

Initial release.

Pi-native Asana Work Graph tools. Calls the Asana REST API directly over plain
HTTP, with no MCP server install required — mirrors the official Asana MCP tool
surface without the OAuth MCP-app dance.

### Added
- `asana_search_objects` — keyword search via the Asana typeahead endpoint,
  one resource type per call (single enum: task / project / user / tag).
  Defaults to `task`. First step when a GID is unknown.
- `asana_get_my_tasks` — tasks assigned to the authenticated user, scoped to
  a workspace. Asana requires `(assignee AND workspace)` together; the tool
  enforces that by making `workspace` a required parameter.
- `asana_get_tasks` — filtered task list (project, section, tag, assignee,
  workspace). Validates filter combinations at the tool boundary before any
  network round-trip.
- `asana_get_task` — full detail on a single task: name, notes, assignment,
  due / start dates, parent task, project and section memberships, tags,
  custom fields, subtasks, dependencies, dependents, and followers. Comments
  are NOT included (Asana exposes them via a separate stories endpoint);
  see `asana_add_comment` for posting.
- `asana_get_project` — full detail on a single project.
- `asana_get_projects` — list projects in a workspace or team.
- `asana_get_status_overview` — aggregated status report across one or more
  projects via the latest project statuses endpoint.
- `asana_get_me` — identity and workspace membership for the authenticated
  user.
- `asana_create_tasks` — create up to 50 tasks in a single call. Rejects
  the dual-spec case (`projects` array AND `project` singular set on the
  same task) rather than overwriting one with the other.
- `asana_update_tasks` — update up to 50 tasks in a single call.
- `asana_add_comment` — add a text or HTML comment to a task.
- `asana_get_task_comments` — most-recent human comments on a task. Added
  on-demand (not baked into `asana_get_task`) because comment threads are
  conversational context and often return long payloads; the
  default task fetch stays cheap. Default limit 5, max 50. Reverse
  chronological. Filters out system events (status changes, etc.) by
  `resource_subtype=comment`.
- `/asana <verb> [args]` slash command (`me`, `my`, `show`, `project`,
  `search`, `status`, `comments`, `create`). Registered programmatically via
  `registerCommand`. Prefills the editor with an explicit ask.
- Compact tool guidance injected via `before_agent_start` (~80 tokens, no
  skill file).
- Inline REST client (`lib/api.ts`) handling auth headers, JSON `data`
  envelope for write bodies, timeouts, and friendly status errors
  (401 / 404 / 429 / 5xx).
- `lib/auth.ts` — reads `ASANA_ACCESS_TOKEN` from the environment. Strictly
  env-only: no file fallback, no config file, no other env vars.

### Notes for integrators

Notable findings from build-time review and live testing, all resolved in this
release:

- `asana_search_objects` was originally wired against the typeahead endpoint
  with `resource_types` (plural) and `limit`; the endpoint actually takes
  `resource_type` (singular) and `count`, and accepts only one type per call.
  Tool now defaults to `task` and accepts an override.
- `asana_get_task` originally requested no `subtasks` in its default
  `opt_fields`, so a closed parent task with N closed subtasks rendered as
  "no subtasks". Default projection now requests `subtasks.name`,
  `subtasks.completed`, `subtasks.completed_at`, and `subtasks.assignee.name`;
  the renderer surfaces them as a counted list.
- Write tools (`asana_create_tasks`, `asana_update_tasks`, `asana_add_comment`)
  originally sent raw bodies; Asana REST requires every POST/PUT body wrapped
  under `{"data": {...}}`. The wrapper lives once in `lib/api.ts`, symmetric
  with the response-side `{data}` unwrap.
- `asana_get_tasks` originally accepted `assignee`-only or `workspace`-only
  filters, which Asana rejects with 400. Rejected at the tool boundary with
  an actionable error before the network round-trip.

### Credits

Based on the [Asana REST API](https://developers.asana.com/reference) and
the [Asana MCP V2 tool reference](https://developers.asana.com/docs/mcp-tools-reference).
