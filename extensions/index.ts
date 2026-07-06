/**
 * pi-asana - Asana Work Graph tools for pi.
 *
 * Adds 12 LLM-callable tools that talk to the Asana REST API
 * (https://app.asana.com/api/1.0) over plain HTTP+JSON. No MCP server install
 * is required: this extension issues standard REST calls with a personal
 * access token (PAT) read from the ASANA_ACCESS_TOKEN environment variable.
 *
 * The tool surface mirrors a curated subset of the official Asana MCP server
 * (https://developers.asana.com/docs/mcp-tools-reference). The 12 tools cover
 * the read-then-write flows an LLM agent actually needs; noisy duplicates and
 * Claude/ChatGPT-only confirmation-UI tools are intentionally omitted.
 *
 * Tool awareness is injected as a compact system-prompt appendix via
 * before_agent_start (no skill file, to keep token cost minimal).
 *
 * Based on: Asana REST API - https://developers.asana.com/reference
 *           Asana MCP V2 server - https://developers.asana.com/docs/mcp-tools-reference
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { searchObjectsTool } from "../lib/tools/search";
import { getMeTool } from "../lib/tools/me";
import { getMyTasksTool } from "../lib/tools/my-tasks";
import { getTaskTool } from "../lib/tools/task";
import { getTasksTool } from "../lib/tools/tasks";
import { getProjectTool, getProjectsTool } from "../lib/tools/project";
import { statusOverviewTool } from "../lib/tools/status";
import { createTasksTool } from "../lib/tools/create-tasks";
import { updateTasksTool } from "../lib/tools/update-tasks";
import { addCommentTool } from "../lib/tools/comment";
import { getTaskCommentsTool } from "../lib/tools/task-comments";

// Compact tool guidance appended to the system prompt. Intentionally small:
// the tool descriptions themselves carry the detail; this just tells the
// agent when to reach for Asana. Mirrors the pi-deepwiki TOOL_GUIDANCE pattern.
const TOOL_GUIDANCE = [
  "Asana tools (asana_*) are available when ASANA_ACCESS_TOKEN is set in the environment.",
  'Use asana_search_objects FIRST when you do not know a GID; pass a workspace from asana_get_me as "workspace".',
  "Use asana_get_my_tasks as the shortcut for the authenticated user\u2019s task list.",
  "Use asana_get_tasks with one of project/section/tag/assignee for bulk reads; asana_get_task for full detail on one task.",
  "Use asana_get_status_overview for cross-project rollups; do not chain a search before it.",
  "Comments live on the stories endpoint, not the task; use asana_get_task_comments to read recent comment threads on demand (default: last 5).",
  "Write tools (asana_create_tasks, asana_update_tasks, asana_add_comment) change data immediately; confirm with the user before invoking on a workspace.",
].join(" ");

function asana(pi: ExtensionAPI): void {
  pi.registerTool(getMeTool);
  pi.registerTool(searchObjectsTool);
  pi.registerTool(getMyTasksTool);
  pi.registerTool(getTaskTool);
  pi.registerTool(getTasksTool);
  pi.registerTool(getProjectTool);
  pi.registerTool(getProjectsTool);
  pi.registerTool(statusOverviewTool);
  pi.registerTool(createTasksTool);
  pi.registerTool(updateTasksTool);
  pi.registerTool(addCommentTool);
  pi.registerTool(getTaskCommentsTool);

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: [event.systemPrompt, TOOL_GUIDANCE]
        .filter(Boolean)
        .join("\n\n"),
    };
  });

  // /asana <verb> [args] - prefix the editor with an explicit
  // instruction so the agent reaches for the right tool deterministically.
  //
  //   /asana me                       -> asana_get_me
  //   /asana my                       -> asana_get_my_tasks
  //   /asana my incomplete            -> asana_get_my_tasks (completed=incomplete)
  //   /asana show <gid>               -> asana_get_task
  //   /asana project <gid>            -> asana_get_project
  //   /asana search <workspace> <query>
  //                                  -> asana_search_objects
  //   /asana status <gids>            -> asana_get_status_overview
  //   /asana comments <gid> [N]       -> asana_get_task_comments
  //   /asana create <text>            -> hint with asana_create_tasks
  //
  // Bare /asana prints a usage reminder. Command handlers cannot directly
  // dispatch a tool call (pi.sendUserMessage is session-scoped), so we use
  // the same prefill-the-editor pattern as pi-deepwiki. The user hits Enter
  // to run; the agent picks the right tool from the prefill.
  pi.registerCommand("asana", {
    description:
      'Asana tools. Usage: /asana me | /asana my [incomplete|completed] | /asana show <gid> | /asana project <gid> | /asana search <workspace> <query> | /asana status <gid> [<gid>...] | /asana comments <gid> [N] | /asana create <free-form description>.',
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        ctx.ui.notify(
          'Usage: /asana me | /asana my | /asana show <gid> | /asana project <gid> | /asana search <workspace> <query> | /asana status <gid>... | /asana comments <gid> [N] | /asana create <text>',
          "info",
        );
        return;
      }

      const firstSpace = trimmed.indexOf(" ");
      const verb = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

      let prompt: string | null = null;

      switch (verb) {
        case "me":
          prompt = `Call the asana_get_me tool to identify the authenticated Asana user and list their workspaces.`;
          break;
        case "my":
        case "tasks":
          if (!rest) {
            prompt = `Call the asana_get_my_tasks tool to list every task currently assigned to the authenticated user.`;
          } else if (rest === "incomplete" || rest === "completed") {
            prompt = `Call the asana_get_my_tasks tool with completed="${rest}" to list ${rest} tasks assigned to the authenticated user.`;
          } else {
            prompt = `Call the asana_get_my_tasks tool with these arguments as appropriate: ${rest}. If a filter is needed, set completed to "incomplete" by default.`;
          }
          break;
        case "show":
          if (!/^\d+$/.test(rest)) {
            ctx.ui.notify(
              'Usage: /asana show <task gid>\nExample: /asana show 1234567890123456',
              "warning",
            );
            return;
          }
          prompt = `Call the asana_get_task tool with gid="${rest}" to retrieve full details for that task.`;
          break;
        case "project":
          if (!/^\d+$/.test(rest)) {
            ctx.ui.notify(
              'Usage: /asana project <project gid>\nExample: /asana project 1234567890123456',
              "warning",
            );
            return;
          }
          prompt = `Call the asana_get_project tool with gid="${rest}" and include_sections=true to retrieve the project and its section list.`;
          break;
        case "search": {
          // /asana search <workspace> <query>  (workspace is a GID; query can
          // contain spaces but not equal-signs).
          const firstSep = rest.indexOf(" ");
          if (firstSep === -1 || !/^\d+$/.test(rest.slice(0, firstSep))) {
            ctx.ui.notify(
              "Usage: /asana search <workspace gid> <query>\nExample: /asana search 1234567890123456 'Wicket'",
              "warning",
            );
            return;
          }
          const workspace = rest.slice(0, firstSep);
          const query = rest.slice(firstSep + 1).trim();
          prompt = `Call the asana_search_objects tool with workspace="${workspace}" and query="${query}" (resource_type defaults to task; override to project / user / tag when relevant).`;
          break;
        }
        case "status": {
          const gids = rest.split(/\s+/).filter((s) => /^\d+$/.test(s));
          if (gids.length === 0) {
            ctx.ui.notify(
              "Usage: /asana status <project gid> [<project gid>...]\nExample: /asana status 1234567890123456 2345678901234567",
              "warning",
            );
            return;
          }
          prompt = `Call the asana_get_status_overview tool with project_gids=${JSON.stringify(gids)} to retrieve the latest status updates for those projects.`;
          break;
        }
        case "comments": {
          // /asana comments <gid> [limit]
          const parts = rest.split(/\s+/).filter(Boolean);
          const gid = parts[0] ?? "";
          const lim = parts[1];
          if (!/^\d+$/.test(gid)) {
            ctx.ui.notify(
              "Usage: /asana comments <task gid> [limit]\nExample: /asana comments 1234567890123456   or   /asana comments 1234567890123456 2",
              "warning",
            );
            return;
          }
          const limitNote = lim && /^\d+$/.test(lim) ? ` with limit=${lim}` : "";
          prompt = `Call the asana_get_task_comments tool with task_gid="${gid}"${limitNote} to fetch the most-recent comments on that task.`;
          break;
        }
        case "create":
          prompt = `Help me create an Asana task. Read the user's request carefully, resolve any project / assignee names to GIDs via asana_search_objects first, then call asana_create_tasks with the resolved fields. Request: ${rest}`;
          break;
        default:
          prompt = `The user typed "/asana ${trimmed}" with an unknown verb. Show the available verbs (me, my, show, project, search, status, comments, create) and ask what they want.`;
          break;
      }

      if (prompt) ctx.ui.setEditorText(prompt);
    },
  });
}

export default asana;
