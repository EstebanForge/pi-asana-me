// Human-in-the-loop gate for Asana write tools.
//
// The agent drafts the Asana payload; this gate lets a human SEE it (and, for
// comments, EDIT it) before any POST/PUT reaches the Asana REST API. Driven by
// a persisted boolean (default on) and gated on `ctx.hasUI`:
//
//   review disabled       -> no gate, proceed
//   no interactive UI      -> cannot prompt; proceed (never block headless writes)
//   editableText set       -> ctx.ui.editor(): review + edit + accept/cancel
//   otherwise              -> ctx.ui.confirm(): yes/no on a readable summary
//
// Comments use the editable path (prose is where models over-explain). Task
// batches use the confirm path (structured payloads are not safe to hand-edit
// in a generic text box).
//
// PERSISTENCE: pi's extension flags (pi.registerFlag) are in-memory only, seeded
// from `default` and CLI `--flag-name` args at process start. There is no
// setFlag on ExtensionAPI and `pi config set <flag>` does NOT touch flags. So we
// own a tiny settings file at <piDir>/pi-asana.json ({ confirmWrite: bool }),
// hydrate module-level state from it at load, and write through on toggle. This
// keeps the value live across the session without a reload, and durable across
// restarts. `piDir` = process.env.PI_CODING_AGENT_DIR || ~/.pi/agent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Name of the persisted boolean flag that toggles the whole gate. */
export const CONFIRM_WRITE_FLAG = "asana-confirm-write";

export const CONFIRM_WRITE_FLAG_DESCRIPTION =
  "When on (default), asana_add_comment / asana_create_tasks / asana_update_tasks prompt for review before posting to Asana. Comments open an editable preview; task batches ask yes/no. Turn off to post without confirmation. Toggle via /asana config or /asana confirm on|off.";

const SETTINGS_FILENAME = "pi-asana.json";
const DEFAULT_CONFIRM_WRITE = true;

// Resolve the agent config dir the same way pi does (dist/config.js getAgentDir):
// env override wins, else ~/.pi/agent. Exported so tests can point it elsewhere.
export function getPiDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR;
  if (envDir) return envDir;
  return join(homedir(), ".pi", "agent");
}

export function getSettingsPath(): string {
  return join(getPiDir(), SETTINGS_FILENAME);
}

interface SettingsFile {
  confirmWrite?: unknown;
}

// The settings file is tiny and reads happen only on the write-tool path
// (rare, user-gated), so we read from disk each call rather than cache. This
// avoids stale-cache bugs across toggle/reload and makes tests deterministic
// without a reset hook. setConfirmWriteEnabled writes through and the next
// read reflects it immediately.

function loadFromDisk(): boolean {
  try {
    const path = getSettingsPath();
    if (!existsSync(path)) return DEFAULT_CONFIRM_WRITE;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SettingsFile;
    // Only an explicit literal false disables the gate; anything else (true,
    // missing, wrong type) falls back to the safe default (ON).
    return parsed.confirmWrite === false ? false : DEFAULT_CONFIRM_WRITE;
  } catch {
    // Corrupt / unreadable file -> fall back to the safe default (gate ON).
    return DEFAULT_CONFIRM_WRITE;
  }
}

/** Current live value of the gate (read from disk each call). */
export function getConfirmWriteEnabled(): boolean {
  return loadFromDisk();
}

/**
 * Persist + apply a new gate value. Writes through to <piDir>/pi-asana.json and
 * updates live state synchronously, so the next write-tool call sees the new
 * value immediately (no reload required). Returns true on success.
 */
export function setConfirmWriteEnabled(value: boolean): boolean {
  const dir = getPiDir();
  const path = join(dir, SETTINGS_FILENAME);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ confirmWrite: value }, null, 2) + "\n", "utf8");
    return true;
  } catch {
    // Disk write failed (permissions, read-only fs). The next read still
    // reflects whatever is on disk, so the session keeps working.
    return false;
  }
}

// Structural slice of ExtensionContext that confirmWrite touches. Keeping it
// minimal decouples the helper from the full context type and makes it trivial
// to mock in tests.
export interface ConfirmContext {
  hasUI: boolean;
  ui: {
    confirm(title: string, message: string): Promise<boolean>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
  };
}

export interface ConfirmWriteOptions {
  /** Title for the review dialog. */
  title: string;
  /**
   * Optional editable text. When set, an editor() opens (review + edit +
   * accept/cancel) and the returned text may differ from the input. When
   * omitted, a yes/no confirm() on `summary` is shown instead.
   */
  editableText?: string;
  /** Readable payload preview, shown by confirm() in the non-editable path. */
  summary: string;
}

export interface ConfirmOutcome {
  proceed: boolean;
  /** Final text to send. Equals the (possibly edited) text in the editable path. */
  text?: string;
}

/**
 * Resolve whether a write should proceed, prompting the user when the gate is
 * active and an interactive UI is present. Pure orchestration: no Asana I/O.
 *
 * The gate takes no ExtensionAPI on purpose: it never calls pi.getFlag (flags
 * are in-memory only), so closing over `pi` would be dead weight. It reads its
 * own file-backed module state instead. The asana-confirm-write flag is still
 * registered for /settings visibility and CLI `--asana-confirm-write` override.
 */
export async function confirmWrite(
  ctx: ConfirmContext,
  opts: ConfirmWriteOptions,
): Promise<ConfirmOutcome> {
  if (!getConfirmWriteEnabled()) {
    return { proceed: true, text: opts.editableText };
  }
  // No interactive UI (headless / RPC without dialogs) -> cannot prompt;
  // proceed rather than deadlocking an unsupervised run.
  if (!ctx.hasUI) {
    return { proceed: true, text: opts.editableText };
  }

  if (opts.editableText !== undefined) {
    const edited = await ctx.ui.editor(opts.title, opts.editableText);
    if (edited === undefined) return { proceed: false };
    return { proceed: true, text: edited };
  }

  const ok = await ctx.ui.confirm(opts.title, opts.summary);
  return { proceed: ok };
}

// Readable summaries for the confirm() path. Capped so a 50-item batch does
// not overflow the dialog.

const PREVIEW_CAP = 10;

function firstProject(t: { project?: string; projects?: string[] }): string | undefined {
  if (t.project !== undefined) return t.project;
  if (Array.isArray(t.projects) && t.projects.length > 0) return t.projects[0];
  return undefined;
}

export function summarizeCreateTasks(
  workspace: string | undefined,
  tasks: Array<{
    name?: string;
    notes?: string;
    assignee?: string;
    due_on?: string;
    project?: string;
    projects?: string[];
    section?: string;
    parent?: string;
  }>,
): string {
  const lines: string[] = [];
  if (workspace) lines.push(`workspace: ${workspace}`);
  lines.push(`tasks (${tasks.length}):`);
  const shown = tasks.slice(0, PREVIEW_CAP);
  shown.forEach((t, i) => {
    const parts: string[] = [t.name ?? "(untitled)"];
    const project = firstProject(t);
    if (project !== undefined) parts.push(`project=${project}`);
    if (t.section !== undefined) parts.push(`section=${t.section}`);
    if (t.parent !== undefined) parts.push(`parent=${t.parent}`);
    if (t.assignee !== undefined) parts.push(`assignee=${t.assignee}`);
    if (t.due_on !== undefined) parts.push(`due=${t.due_on}`);
    lines.push(`  ${i + 1}. ${parts.join("  |  ")}`);
  });
  if (tasks.length > PREVIEW_CAP) lines.push(`  ...and ${tasks.length - PREVIEW_CAP} more`);
  return lines.join("\n");
}

export function summarizeUpdateTasks(
  tasks: Array<{
    gid: string;
    name?: string;
    notes?: string;
    completed?: boolean;
    assignee?: string;
    due_on?: string;
    section?: string;
    parent?: string;
    projects?: string[];
  }>,
): string {
  const lines: string[] = [`updates (${tasks.length}):`];
  const shown = tasks.slice(0, PREVIEW_CAP);
  shown.forEach((t, i) => {
    const parts: string[] = [`gid=${t.gid}`];
    if (t.name !== undefined) parts.push(`name="${t.name}"`);
    if (t.completed !== undefined) parts.push(t.completed ? "complete" : "reopen");
    if (t.assignee !== undefined) parts.push(`assignee=${t.assignee}`);
    if (t.due_on !== undefined) parts.push(`due=${t.due_on}`);
    if (t.section !== undefined) parts.push(`section=${t.section}`);
    if (t.parent !== undefined) parts.push(`parent=${t.parent}`);
    if (t.projects !== undefined) parts.push(`projects=${t.projects.join(",")}`);
    lines.push(`  ${i + 1}. ${parts.join("  |  ")}`);
  });
  if (tasks.length > PREVIEW_CAP) lines.push(`  ...and ${tasks.length - PREVIEW_CAP} more`);
  return lines.join("\n");
}
