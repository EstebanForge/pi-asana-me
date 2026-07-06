# @estebanforge/pi-asana

Asana Work Graph tool for the [pi coding agent](https://pi.dev). Adds 12 LLM-callable tools (asana_*) that query the Asana REST API over plain HTTP, mirroring a curated subset of the official Asana MCP tool set &mdash; **no MCP server install required**.

## Install

```bash
pi install npm:@estebanforge/pi-asana
```

## What it adds

| Tool | Purpose |
| --- | --- |
| `asana_search_objects` | Keyword search across an Asana workspace (one resource type per call: task / project / user / tag) |
| `asana_get_my_tasks` | Tasks assigned to the authenticated user (workspace required) |
| `asana_get_tasks` | Filtered task list (project / section / tag / assignee) |
| `asana_get_task` | Full detail for one task |
| `asana_get_task_comments` | Most-recent human comments on a task (default: last 5, max 50). On-demand. |
| `asana_get_project` | Full detail for one project (sections optional) |
| `asana_get_projects` | List projects in a workspace or team |
| `asana_get_status_overview` | Aggregated status report across projects |
| `asana_get_me` | Who am I in Asana + my workspaces |
| `asana_create_tasks` | Create up to 50 tasks in a single call. Write. |
| `asana_update_tasks` | Update up to 50 tasks in a single call. Write. |
| `asana_add_comment` | Add a text or HTML comment to a task. Write. |

Compact tool guidance is injected via the `before_agent_start` hook (no skill file, to keep token cost minimal). A `/asana <verb> [args]` slash command pins intent for direct invocation.

## How it works

Asana publishes an MCP server (`https://mcp.asana.com/v2/mcp`) for AI clients, but MCP tokens are workspace-scoped and **do not work with the Asana REST API** &mdash; they are only valid against the MCP server. This extension calls the Asana REST API directly (`https://app.asana.com/api/1.0/`) with a personal access token, so the same API surface Asana documents publicly is available inside pi without requiring you to register an MCP app, configure OAuth, or install an MCP adapter.

## Configuration

This extension reads **only** the `ASANA_ACCESS_TOKEN` environment variable. No file fallback, no other env vars, no config file, no keyring integration.

```bash
export ASANA_ACCESS_TOKEN="2/12345/67890:abcdef..."
```

Create a personal access token at <https://app.asana.com/0/my-apps> &rarr; **Create personal access token**. The token grants the same access your Asana user account has &mdash; no extra scopes to set.

If the environment variable is missing, every tool returns a single error message pointing to this section.

## Usage

You do not need to mention Asana. The agent reaches for these tools whenever a request touches Asana data:

```
What tasks do I have assigned this week?
```

```
Find the Wicket project in my workspace and list its incomplete tasks.
```

```
Show me the details of task 1234567890123456.
```

```
Create a task in the Bugs project: "Investigate flaky test",
  due Friday, assign it to me.
```

```
Mark task 1234567890123456 as complete.
```

Slash command (pinned intent): `/asana <verb>` prefills the editor with an explicit ask. Hit Enter to run.

| Invocation | Maps to |
| --- | --- |
| `/asana me` | asana_get_me |
| `/asana my` / `/asana my incomplete` / `/asana my completed` | asana_get_my_tasks |
| `/asana show <gid>` | asana_get_task |
| `/asana project <gid>` | asana_get_project |
| `/asana search <workspace> <query>` | asana_search_objects (defaults to resource_type=task) |
| `/asana status <gid>...` | asana_get_status_overview |
| `/asana comments <gid> [N]` | asana_get_task_comments (last N comments; default 5) |
| `/asana create <text>` | asana_create_tasks |

Bare `/asana` prints a usage reminder.

## Tool selection guidance

Reach for them in this order:

1. `asana_search_objects` &mdash; when you do not know a GID.
2. `asana_get_me` &mdash; identity + workspace membership lookup.
3. `asana_get_my_tasks` &mdash; shortcut for "what is on my plate".
4. `asana_get_tasks` / `asana_get_project(s)` &mdash; bulk read scoped to a project / section / tag / assignee.
5. `asana_get_task` &mdash; full detail on one task.
6. `asana_get_status_overview` &mdash; aggregated status report (do not chain a search before it).
7. `asana_get_task_comments` &mdash; clarifications and reviewer threads live in comments, not in `notes`. Pull on demand when the task context is a conversation, not a record.
8. Write tools (`create_tasks`, `update_tasks`, `add_comment`) &mdash; only after you have the IDs, and confirm with the user first.

## Notes

- These tools make real calls against your Asana workspace. Write tools (`create_tasks`, `update_tasks`, `add_comment`) **change data** in your workspace immediately, without a confirmation step. Asana does not currently expose a confirmation/preview tool on the REST side for these.
- The typeahead endpoint (`asana_search_objects`) accepts only ONE resource type per call (single enum `task` / `project` / `user` / `tag`); it does not accept a CSV. Call the tool once per type to fan out across types.
- The `/tasks` endpoint requires either project/section/tag, OR (assignee AND workspace). `asana_get_my_tasks` enforces this by making `workspace` a required parameter.
- Asana enforces rate limits (~150 req/min per PAT). A 429 response surfaces a clear retry message.
- The 12-tool surface omits several official MCP tools that did not age well in an LLM agent context: interactive `*_preview` tools (Claude/ChatGPT-only confirmation UI), `get_attachments` (binary blobs), `search_tasks` (Premium-only; overlaps `search_objects`), `get_portfolio*` (niche), `get_agent*` (AI Teammates only), and `delete_task` (destructive &mdash; add on request).
- Do not pass secrets or PII in `notes` or `text` arguments to write tools &mdash; they land in your Asana workspace directly.

## License

MIT

Based on the [Asana REST API](https://developers.asana.com/reference) and the [Asana MCP V2 tool reference](https://developers.asana.com/docs/mcp-tools-reference).
