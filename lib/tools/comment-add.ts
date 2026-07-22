import { Type, type Static } from "typebox";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { callAsana, AsanaError } from "../api";
import { confirmWrite, willPromptForWrite } from "../confirm";
import { resolveTasks, fmtTask } from "../resolve";
import { toToolResult, errorText, type AsanaDetails } from "../result";
import type { AsanaStory } from "../types";
import {
  ADD_COMMENT_TITLE,
  ADD_COMMENT_DESCRIPTION,
  ADD_COMMENT_TASK_DESCRIPTION,
  ADD_COMMENT_TEXT_DESCRIPTION,
} from "../prompts";

// Add a comment to a task. Asana calls comments "stories" of type `comment`.
// POST `/tasks/{gid}/stories` with `text` (and `html_text` when markup was
// supplied by the agent).
const Params = Type.Object({
  task_gid: Type.String({ description: ADD_COMMENT_TASK_DESCRIPTION }),
  text: Type.String({ description: ADD_COMMENT_TEXT_DESCRIPTION, minLength: 1 }),
  html: Type.Optional(Type.Boolean()),
});

export const addCommentTool: ToolDefinition<typeof Params, undefined> = {
  name: "asana_add_comment",
  label: ADD_COMMENT_TITLE,
  description: ADD_COMMENT_DESCRIPTION,
  parameters: Params,
  async execute(
    _toolCallId: string,
    params: Static<typeof Params>,
    _signal,
    _onUpdate,
    ctx,
  ): Promise<AgentToolResult<AsanaDetails>> {
    // Review-before-post gate. The editable path lets the user trim the
    // model's prose; Esc cancels the whole write. Resolve the task to a
    // readable label only when a prompt will actually be shown, so the
    // headless / gate-off fast paths skip the extra GET.
    let title = `Post comment to task ${params.task_gid}?`;
    if (willPromptForWrite(ctx)) {
      const resolved = await resolveTasks([params.task_gid]);
      title = `Post comment to ${fmtTask(params.task_gid, resolved.get(params.task_gid))}?`;
    }
    const decision = await confirmWrite(ctx, {
      title,
      editableText: params.text,
      summary: params.text,
    });
    if (!decision.proceed) {
      return toToolResult(
        `Asana: comment cancelled by user (task ${params.task_gid}). Nothing was posted.`,
      );
    }
    const text = decision.text ?? params.text;

    try {
      const body = params.html ? { html_text: text } : { text };
      const story = await callAsana<AsanaStory>(
        "POST",
        `/tasks/${encodeURIComponent(params.task_gid)}/stories`,
        {
          query: { opt_fields: "gid,text,resource_type,created_at" },
          body,
        },
      );
      return toToolResult(
        `Asana: comment added to task ${params.task_gid} (story gid: ${story.gid}, at ${
          story.created_at ?? "(no timestamp)"
        }).`,
      );
    } catch (err) {
      if (err instanceof AsanaError && err.status === 404) {
        return toToolResult(
          `Asana: task ${params.task_gid} not found. Verify the GID with \`asana_search_objects\` (resource_type=task).`,
        );
      }
      return toToolResult(errorText(err));
    }
  },
};
