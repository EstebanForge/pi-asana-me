import { Type, type Static } from "typebox";
import type {
  AgentToolResult,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { callAsana, AsanaError } from "../api";
import { confirmWrite, willPromptForWrite } from "../confirm";
import { resolveTasks, fmtTask, type ResolvedRef } from "../resolve";
import { toToolResult, errorText, postedContentBlock, type AsanaDetails } from "../result";
import type { AsanaStory } from "../types";
import {
  ADD_COMMENT_TITLE,
  ADD_COMMENT_DESCRIPTION,
  ADD_COMMENT_TASK_DESCRIPTION,
  ADD_COMMENT_TEXT_DESCRIPTION,
  ADD_COMMENT_HTML_DESCRIPTION,
} from "../prompts";

// Add a comment to a task. Asana calls comments "stories" of type `comment`.
// POST `/tasks/{gid}/stories` with `text` (and `html_text` when markup was
// supplied by the agent).
const Params = Type.Object({
  task_gid: Type.String({ description: ADD_COMMENT_TASK_DESCRIPTION }),
  text: Type.String({ description: ADD_COMMENT_TEXT_DESCRIPTION, minLength: 1 }),
  html: Type.Optional(
    Type.Boolean({ description: ADD_COMMENT_HTML_DESCRIPTION }),
  ),
});

// Asana story html_text rules: https://developers.asana.com/docs/rich-text
// Asana does NOT reject malformed html_text. It silently stores the ENTIRE
// comment as literal plain text (tags visible) and still returns HTTP 201, so
// the only place to catch the footgun is here, before the request. See
// https://forum.asana.com/t/adding-richtext-story-results-in-comment-with-html-code-still-in-it-if-paragraph-tags-are-used/60593
const ALLOWED_HTML_TAGS = new Set([
  "body",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "ol",
  "ul",
  "li",
  "a",
  "blockquote",
  "pre",
]);

// Validate html_text before it reaches Asana. Returns a list of human-readable
// problems (empty = valid). Deliberately conservative: it only enforces the
// hard rules Asana documents (body wrapper + allowed tag set). It cannot catch
// an unresolvable mention GID or multi-line quirks without a live call, so the
// prompt guidance carries those as soft rules.
function validateHtmlText(text: string): string[] {
  const problems: string[] = [];

  const trimmed = text.trim();
  if (!/<body[\s>]/i.test(trimmed) || !/<\/body>\s*$/i.test(trimmed)) {
    problems.push(
      "html_text must be wrapped in a single <body>...</body> element.",
    );
  }

  // Pull every opening/closing tag name. Self-closing forms (<a .../>) and
  // attribute-bearing tags are handled: the regex captures the tag name right
  // after < or </, ignoring attributes and the trailing />.
  const tagRe = /<\/?\s*([a-zA-Z][a-zA-Z0-9]*)/g;
  const bad = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) bad.add(tag);
  }
  if (bad.size > 0) {
    const list = [...bad].map((t) => `<${t}>`).join(", ");
    problems.push(
      `Unsupported tag(s): ${list}. Asana would silently render the ENTIRE comment as literal text. ` +
        `Allowed in comments: body, strong/b, em/i, u, s, code, ol, ul, li, a, blockquote, pre. ` +
        `NOT allowed: <br>, <p>, <div>, <span>, <h1>-<h6>, <hr>. For multi-paragraph prose, drop the html flag and send plain text with real newlines.`,
    );
  }

  return problems;
}

export const addCommentTool: ToolDefinition<typeof Params, AsanaDetails> = {
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
    // Fail fast on malformed html_text BEFORE the review prompt and before
    // any task lookup. Asana's silent literal-text fallback gives no HTTP
    // signal, so refusing here is the only way to keep broken HTML out of the
    // workspace. Plain-text mode (html falsy) is never validated: a literal
    // "<" in prose is the caller's intent.
    if (params.html) {
      const problems = validateHtmlText(params.text);
      if (problems.length > 0) {
        return toToolResult(
          `Asana: refused to post html_text (task ${params.task_gid}). Fix and retry, or drop the html flag to post as plain text:\n- ${problems.join("\n- ")}`,
        );
      }
    }

    // Review-before-post gate. The editable path lets the user trim the
    // model's prose; Esc cancels the whole write. We also resolve the task
    // once up front so the confirm title AND the success summary can show a
    // clickable task URL. resolveTasks only fires when a prompt will actually
    // be shown (gate on + interactive UI); the headless / gate-off fast path
    // defers the lookup to after a successful post.
    let resolved: Map<string, ResolvedRef> | undefined;
    let title = `Post comment to task ${params.task_gid}?`;
    if (willPromptForWrite(ctx)) {
      resolved = await resolveTasks([params.task_gid]);
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
      // Best-effort task permalink so the agent can cite a clickable URL in
      // its recap. Reuse the pre-prompt resolve when present; otherwise fetch
      // once. resolveTasks swallows per-GID failures, so a miss just omits the
      // URL rather than failing an otherwise-successful post.
      let permalink = resolved?.get(params.task_gid)?.permalink_url;
      if (!permalink) {
        permalink = (await resolveTasks([params.task_gid])).get(
          params.task_gid,
        )?.permalink_url;
      }
      const urlPart = permalink ? ` URL: ${permalink}` : "";
      const edited = decision.edited ?? false;
      return toToolResult(
        `Asana: comment added to task ${params.task_gid} (story gid: ${story.gid}, at ${
          story.created_at ?? "(no timestamp)"
        }).${urlPart}${postedContentBlock(text, edited)}`,
        { postedContent: text, edited },
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
