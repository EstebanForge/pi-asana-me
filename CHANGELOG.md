# Changelog

## 1.4.1 — 2026-07-29

### Changed
- `asana_add_comment` success summary now appends the task **permalink URL**
  (`URL: https://app.asana.com/0/…/…`) after the story gid, so the agent's
  recap carries a clickable link to where the comment landed. The confirm
  dialog already resolved the task for its title; the tool now reuses that
  resolved ref and falls back to one `GET /tasks/{gid}` in the headless /
  gate-off fast path. A resolve miss (deleted task, no access) omits the URL
  rather than failing the post. No trailing punctuation on the URL so it
  survives copy-paste.
- New `tests/comment-add.test.ts` locks the URL-present and URL-omitted
  contracts.

## 1.4.0 — 2026-07-21

### Changed
- The write-review confirm dialogs now show the task **name and permalink
  URL** instead of a bare GID, so a human can see exactly where a write will
  land before approving it:
  - `asana_add_comment` title reads `Post comment to 'Fix login'
    (https://app.asana.com/0/…/…)?` instead of `… task 1234567890123456?`.
  - `asana_update_tasks` renders each task (and its `parent`) as
    `'Name' (url)` in the yes/no summary.
  - `asana_create_tasks` resolves a subtask's `parent` the same way (new
    tasks have no URL of their own yet; the parent is where they land).
  - Any GID that fails to resolve (deleted task, no access, transient error)
  falls back to `gid: <gid>`, so a resolve miss never blocks a write.
  Backed by a new `lib/resolve.ts` (`resolveTasks` + `fmtTask`).
- Resolution runs **only when a prompt will actually be shown** — the new
  `willPromptForWrite(ctx)` helper gates the extra `GET /tasks/{gid}` calls,
  so the headless (`hasUI:false`) and gate-off fast paths are unchanged and
  pay nothing. `confirmWrite` itself stays pure (no Asana I/O).

## 1.3.0 — 2026-07-20

### Added
- `asana_get_comment` &mdash; fetch the full, untruncated body of a single
  comment (story) by its gid. `asana_get_task_comments` caps each comment at
  700 chars and prints the story gid in the truncation footer; this tool
  recovers the whole body on demand. Mirrors the
  `asana_get_task` / `asana_get_task_description` pairing, now for comments.
  Backed by `GET /stories/{story_gid}`.
- `/asana comment <story gid>` slash command for direct single-comment fetch.

### Changed
- `asana_get_task_comments` truncation footer now names the recovery tool and
  parameter (`call asana_get_comment with story_gid=...`) instead of the
  generic `fetch story gid ... for full text`, so the agent has an actionable
  next step instead of a dead end.
- Comment truncation cap lowered from 800 to 700 chars (named const
  `COMMENT_LIMIT` in `lib/tools/comment-list.ts`, mirroring `NOTES_LIMIT`
  in `lib/tools/task.ts`).
- `asana_get_task` notes cap docstring/guidance corrected: the CODE has
  capped at 2000 chars since 1.1.0, but stale "~400 chars" lingered in the
  TOOL_GUIDANCE system-prompt appendix, the README reach-for list, and the
  `asana_get_task_description` docstring. Code wins; docs corrected to 2000.
- Tool surface: 13 &rarr; 14 tools.
- Renamed `lib/tools/comment.ts` &rarr; `comment-add.ts` and
  `lib/tools/task-comments.ts` &rarr; `comment-list.ts` so the three comment
  tools (`comment-add`, `comment-get`, `comment-list`) sort together.
  Symbols and tool names unchanged; imports updated in `extensions/index.ts`
  and the tests.
- `asana_get_comment` now indents the comment body 2 spaces, matching the
  list view in `asana_get_task_comments` so concatenated output reads
  consistently.

## 1.2.1 — 2026-07-09

### Changed
- The three write tools are now flat `export const` objects, uniform with
  the read tools. `confirmWrite` takes no `pi` arg: it never read `pi.getFlag`
  (flags are in-memory only with no setter, so the gate is file-backed), making
  the prior `createXxxTool(pi)` factory's `pi` arg vestigial. Tool behavior and
  parameters are unchanged.
- Removed the orphaned `makePi()` test helper. Fixed a stale `me.test` comment
  that attributed gate-bypass to the flag value when it is actually the headless
  ctx (`hasUI:false`).

## 1.2.0 — 2026-07-09

### Added
- Review-before-post gate on the three write tools (`asana_add_comment`,
  `asana_create_tasks`, `asana_update_tasks`). When enabled (default), each
  write prompts the user before hitting the Asana API:
  - `asana_add_comment` opens the drafted comment in an editable preview —
    trim the model's prose, then accept (Enter) or cancel (Esc). The posted
    text is whatever you leave in the editor.
  - `asana_create_tasks` / `asana_update_tasks` show a readable summary of
    the batch and ask yes/no.
  - In headless sessions (no interactive UI) the gate is skipped so
    unsupervised runs are never deadlocked.
- `/asana config` — settings modal (TUI) to toggle the review gate, or a
  status line in non-interactive modes.
- `/asana confirm on|off` — one-shot shorthand for the toggle.

### Changed
- Write tools stay as flat `export const` tool objects, uniform with the read
  tools. The confirm gate takes no `pi`: it never read `pi.getFlag` anyway
  (flags are in-memory only with no setter), so an earlier factory form's `pi`
  arg was vestigial. The gate reads file-backed state directly. Tool behavior
  and parameters are otherwise unchanged.
- The `/asana` tool guidance injected via `before_agent_start` now tells the
  agent the review prompt is handled by the extension, so the agent should
  call write tools directly rather than asking the user itself.

### Fixed
- Removed dead code in `asana_update_tasks` (an unused type alias and an
  unreachable try/catch around the final result formatting).

### Notes for integrators

The gate value is persisted in `<piDir>/pi-asana.json` (`{ "confirmWrite":
bool }`), where `<piDir>` is `process.env.PI_CODING_AGENT_DIR || ~/.pi/agent`.
Pi's extension flags (`pi.registerFlag`) are in-memory only with no persistence
path, so this extension owns its own tiny settings file rather than relying on
`pi config set` (which does not touch flags). The `asana-confirm-write` flag is
still registered for `/settings` visibility and the `--asana-confirm-write` CLI
override, but the gate reads the JSON file.

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
