import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

// Asana tools return plain text; structured details are not used today but the
// union is left open so future tools can attach metadata without touching every
// caller.
export type AsanaDetails = undefined;

export function toToolResult(
  text: string,
  details?: AsanaDetails,
): AgentToolResult<AsanaDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

// Single error formatter shared across every tool. All Asana errors (auth,
// network, HTTP, JSON parse) are caught at the tool boundary and converted to
// readable text rather than thrown - the agent sees a single, actionable
// message instead of a stack trace.
export function errorText(err: unknown): string {
  if (err instanceof Error) {
    return `Asana error: ${err.message}`;
  }
  return "Asana error: unknown failure.";
}
