// Concrete Asana response shapes, one per resource type. Shared across all
// tool files so we stop hand-rolling inline types per tool and stop casting
// every `task.foo as { ... }` site (the #1 unsafe-as pattern + #2 unknown
// without narrowing from the TS + React rubric).
//
// Convention: `gid` and `name` are always string per Asana's contract (even
// on compact resources); only fields Asana genuinely omits for some opt_fields
// projections are marked optional.
export interface AsanaRef {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaUserCompact {
  gid: string;
  name?: string;
}

export interface AsanaTaskCompact {
  gid: string;
  name?: string;
  completed?: boolean;
  completed_at?: string | null;
  due_on?: string | null;
  due_at?: string | null;
  start_on?: string | null;
  created_at?: string;
  modified_at?: string;
  notes?: string;
  assignee?: AsanaUserCompact | null;
  projects?: AsanaRef[];
  tags?: AsanaRef[];
  followers?: AsanaUserCompact[];
  custom_fields?: Array<{
    gid?: string;
    name?: string;
    display_value?: string | null;
  }>;
  memberships?: Array<{
    project?: AsanaRef;
    section?: { gid: string; name?: string };
  }>;
  subtasks?: Array<{
    gid: string;
    name?: string;
    completed?: boolean;
    completed_at?: string | null;
    assignee?: AsanaUserCompact | null;
  }>;
  parent?: AsanaRef | null;
  dependencies?: AsanaRef[];
  dependents?: AsanaRef[];
  permalink_url?: string;
}

export interface AsanaProjectStatus {
  gid: string;
  title?: string;
  text?: string;
  color?: string;
  author?: AsanaUserCompact;
  created_at?: string;
}

export interface AsanaProjectCompact {
  gid: string;
  name?: string;
  notes?: string;
  archived?: boolean;
  layout?: string;
  default_view?: string;
  owner?: AsanaUserCompact | null;
  members?: AsanaUserCompact[];
  current_status?: {
    gid: string;
    title?: string;
    color?: string;
  } | null;
  sections?: AsanaRef[];
  task_counts?: {
    completed?: number;
    incomplete?: number;
  };
}

export interface AsanaUser {
  gid: string;
  name?: string;
  email?: string;
  resource_type?: string;
  workspaces?: AsanaRef[];
}

export interface AsanaStory {
  gid: string;
  created_at?: string;
  // `type` is the human-vs-system discriminator for stories: "comment" for
  // user comments, "system" for status changes / assignment logs / etc.
  // `resource_subtype` describes the action (e.g. "comment_added",
  // "assigned", "description_changed") and is NOT a reliable discriminator.
  // Caught during live testing: a filter on resource_subtype === "comment"
  // returned 0/50 stories on a task that the user knew had comments.
  type?: "comment" | "system" | string;
  resource_subtype?: string;
  text?: string;
  html_text?: string;
  created_by?: AsanaUserCompact | null;
}
