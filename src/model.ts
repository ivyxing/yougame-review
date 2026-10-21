// Shared by the browser app and the server functions.

export type Severity = "critical" | "high" | "medium" | "low";
export type Kind = "bug" | "bug_group" | "idea" | "proposal" | "improvement";

export interface Evidence {
  screenshots?: string[];
  notes?: string[];
  console?: string[];
}

export interface Bug {
  id: string;
  title: string;
  severity: Severity;
  area?: string;
  url?: string;
  /** The tester's own state: whether evidence is captured, or the bug was already fixed live. */
  status?: "needs_screenshot" | "verified" | "fixed";
  summary?: string;
  steps?: string[] | string;
  expected?: string;
  actual?: string;
  evidence?: Evidence;
  agent_prompt?: string;
}

export interface Idea {
  id: string;
  title: string;
  area?: string;
  priority?: "high" | "medium" | "low";
  page_url?: string;
  problem?: string;
  why_it_matters?: string;
  recommendation?: string;
  before_screenshot?: string | null;
  after_image?: string | null;
  figma_url?: string | null;
  agent_prompt?: string;
}

/** Bugs similar enough to fix together, shown as one card. */
export interface BugGroup {
  id: string;
  title: string;
  area?: string;
  summary?: string;
  /** Ids of the bugs in this group. */
  bugs: string[];
  agent_prompt?: string;
}

/** A redesign that answers several ideas at once, shown with its mock. */
export interface Proposal {
  id: string;
  title: string;
  area?: string;
  page_url?: string;
  /** Each change in the redesign and the reason for it, one short line each. */
  why?: string[];
  summary?: string;
  before_screenshot?: string | null;
  after_image?: string | null;
  figma_url?: string | null;
  /** Ids of the ideas this redesign covers. */
  ideas: string[];
  agent_prompt?: string;
}

/** A product idea beyond bugs and design fixes: a feature, engagement or growth change. */
export interface Improvement extends Idea {
  effort?: "small" | "medium" | "large";
  /** Ids of bugs, design ideas or other improvements it builds on. */
  related?: string[];
}

export const BUG_STATUSES = ["open", "fixing", "fixed", "dismissed"] as const;
export const IDEA_STATUSES = ["open", "planned", "later", "done", "dismissed"] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type Status = BugStatus | IdeaStatus;

export const STATUS_LABEL: Record<Kind, Record<string, string>> = {
  bug: { open: "Open", fixing: "Fixing", fixed: "Fixed", dismissed: "Dismissed" },
  bug_group: { open: "Open", fixing: "Fixing", fixed: "Fixed", dismissed: "Dismissed" },
  idea: { open: "Needs your take", planned: "Will do", later: "Maybe later", done: "Done", dismissed: "Dismissed" },
  proposal: { open: "Needs your take", planned: "Will do", later: "Maybe later", done: "Done", dismissed: "Dismissed" },
  improvement: { open: "Needs your take", planned: "Will do", later: "Maybe later", done: "Done", dismissed: "Dismissed" },
};

export const DISMISS_REASONS = [
  ["edge_case", "Too edge case"],
  ["dont_do", "Don't do"],
  ["not_a_problem", "Not a real problem"],
  ["duplicate", "Duplicate"],
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number][0];
export const REASON_LABEL: Record<string, string> = Object.fromEntries(DISMISS_REASONS);

export interface Decision {
  id: string;
  kind: Kind;
  status: Status;
  reason?: DismissReason;
  note?: string;
  /** GitHub login of the person who saved it. */
  by: string;
  at: string;
}
export type Decisions = Record<string, Decision>;

export type DecisionInput = Pick<Decision, "id" | "kind" | "status" | "reason" | "note">;

export const NOTE_LIMIT = 2000;

/** Checks a decision sent by the browser. Throws an Error whose message is safe to show. */
export function validateDecision(input: unknown, known: Map<string, Kind>): DecisionInput {
  if (!input || typeof input !== "object") throw new Error("Send a decision.");
  const { id, kind, status, reason, note } = input as Record<string, unknown>;
  if (typeof id !== "string" || known.get(id) === undefined) throw new Error("Unknown item.");
  if (kind !== known.get(id)) throw new Error("Item kind does not match.");
  const allowed: readonly string[] = isBugKind(kind as Kind) ? BUG_STATUSES : IDEA_STATUSES;
  if (typeof status !== "string" || !allowed.includes(status)) throw new Error("Unknown status.");
  let cleanReason: DismissReason | undefined;
  if (status === "dismissed") {
    if (typeof reason !== "string" || !REASON_LABEL[reason]) throw new Error("Pick why it's dismissed.");
    cleanReason = reason as DismissReason;
  }
  if (note !== undefined && typeof note !== "string") throw new Error("Note must be text.");
  const cleanNote = (note ?? "").trim();
  if (cleanNote.length > NOTE_LIMIT) throw new Error(`Keep the note under ${NOTE_LIMIT} characters.`);
  return { id, kind: kind as Kind, status: status as Status, ...(cleanReason ? { reason: cleanReason } : {}), ...(cleanNote ? { note: cleanNote } : {}) };
}

export const isBugKind = (kind: Kind) => kind === "bug" || kind === "bug_group";

/** A bug without its own decision follows its group's decision. */
export function bugStatus(bug: Bug, decision?: Decision, parent?: Decision): BugStatus {
  if (decision) return decision.status as BugStatus;
  if (parent) return parent.status as BugStatus;
  return bug.status === "fixed" ? "fixed" : "open";
}

/** A group is fixed once every bug in it is, until someone decides on the group itself. */
export function bugGroupStatus(group: BugGroup, decisions: Decisions, bugs: Bug[]): BugStatus {
  const own = decisions[group.id];
  if (own) return own.status as BugStatus;
  const members = bugs.filter((b) => group.bugs.includes(b.id));
  return members.length > 0 && members.every((b) => bugStatus(b, decisions[b.id]) === "fixed") ? "fixed" : "open";
}

/** The most severe severity among a group's bugs. */
export function groupSeverity(group: BugGroup, bugs: Bug[]): Severity {
  const levels = bugs.filter((b) => group.bugs.includes(b.id)).map((b) => SEVERITIES.indexOf(b.severity));
  return SEVERITIES[Math.min(...levels)] ?? "low";
}

/** An idea without its own decision follows the redesign it belongs to. */
export function ideaStatus(_idea: Idea, decision?: Decision, parent?: Decision): IdeaStatus {
  return (decision?.status as IdeaStatus) ?? (parent?.status as IdeaStatus) ?? "open";
}

/** Maps each grouped item to its group; groups with fewer than two known items are dropped. */
function groupItems<T extends { id: string }, G>(items: T[], groups: G[], members: (g: G) => string[], withMembers: (g: G, ids: string[]) => G): { groups: G[]; parentOf: Map<string, G>; standalone: T[] } {
  const known = new Set(items.map((i) => i.id));
  const parentOf = new Map<string, G>();
  const kept: G[] = [];
  for (const g of groups) {
    const ids = members(g).filter((id) => known.has(id) && !parentOf.has(id));
    if (ids.length < 2) continue;
    const group = withMembers(g, ids);
    kept.push(group);
    for (const id of ids) parentOf.set(id, group);
  }
  return { groups: kept, parentOf, standalone: items.filter((i) => !parentOf.has(i.id)) };
}

export function groupIdeas(ideas: Idea[], proposals: Proposal[]): { proposals: Proposal[]; parentOf: Map<string, Proposal>; standalone: Idea[] } {
  const g = groupItems(ideas, proposals, (p) => p.ideas, (p, ids) => ({ ...p, ideas: ids }));
  return { proposals: g.groups, parentOf: g.parentOf, standalone: g.standalone };
}

export function groupBugs(bugs: Bug[], groups: BugGroup[]): { groups: BugGroup[]; parentOf: Map<string, BugGroup>; standalone: Bug[] } {
  return groupItems(bugs, groups, (g) => g.bugs, (g, ids) => ({ ...g, bugs: ids }));
}

export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
export const PRIORITIES = ["high", "medium", "low"] as const;

export function stepsList(steps: Bug["steps"]): string[] {
  if (!steps) return [];
  return Array.isArray(steps) ? steps : [steps];
}

/** Picks the screenshot that best shows a bug at a glance. */
export function bugThumbnail(bug: Bug): string | undefined {
  const shots = bug.evidence?.screenshots ?? [];
  return shots.find((s) => /detail/i.test(s)) ?? shots.find((s) => /-page\./i.test(s)) ?? shots[0];
}

export function screenshotLabel(src: string): string {
  const name = src.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
  if (/fullpage/i.test(name)) return "Full page";
  const close = name.match(/detail(\d*)/i);
  if (close) return close[1] && close[1] !== "1" ? `Close-up ${close[1]}` : "Close-up";
  if (/page$/i.test(name)) return "Page";
  return "Screenshot";
}
