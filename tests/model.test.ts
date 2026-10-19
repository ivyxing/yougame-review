import { test } from "node:test";
import assert from "node:assert/strict";
import { bugGroupStatus, bugStatus, bugThumbnail, groupBugs, groupIdeas, groupSeverity, ideaStatus, validateDecision, type Bug, type Decision, type Decisions, type Idea, type Kind } from "../src/model.ts";
import { serializeDecisions, writeDecision } from "../server/github.ts";

const known = new Map<string, Kind>([["BUG-01", "bug"], ["UX-01", "idea"]]);

test("accepts a dismissal with a reason and trims the note", () => {
  assert.deepEqual(validateDecision({ id: "BUG-01", kind: "bug", status: "dismissed", reason: "edge_case", note: "  only on IE  " }, known), {
    id: "BUG-01", kind: "bug", status: "dismissed", reason: "edge_case", note: "only on IE",
  });
});

test("rejects a dismissal without a reason, unknown items and mismatched statuses", () => {
  assert.throws(() => validateDecision({ id: "BUG-01", kind: "bug", status: "dismissed" }, known), /why/);
  assert.throws(() => validateDecision({ id: "BUG-99", kind: "bug", status: "open" }, known), /Unknown item/);
  assert.throws(() => validateDecision({ id: "UX-01", kind: "idea", status: "fixing" }, known), /Unknown status/);
  assert.throws(() => validateDecision({ id: "UX-01", kind: "bug", status: "open" }, known), /kind/);
});

test("drops a reason unless the item is dismissed", () => {
  assert.equal(validateDecision({ id: "UX-01", kind: "idea", status: "planned", reason: "dont_do" }, known).reason, undefined);
});

test("a bug the tester found already fixed starts as fixed until someone decides", () => {
  assert.equal(bugStatus({ id: "B", title: "", severity: "low", status: "fixed" }), "fixed");
  assert.equal(bugStatus({ id: "B", title: "", severity: "low", status: "fixed" }, { id: "B", kind: "bug", status: "open", by: "x", at: "" }), "open");
});

test("picks a close-up screenshot for the card", () => {
  assert.equal(bugThumbnail({ id: "B", title: "", severity: "low", evidence: { screenshots: ["s/bug-01-page.png", "s/bug-01-detail1.png"] } }), "s/bug-01-detail1.png");
});

test("writeDecision retries once when another save landed first", async () => {
  let puts = 0;
  const transport = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      puts++;
      return new Response("{}", { status: puts === 1 ? 409 : 200 });
    }
    const content = Buffer.from(serializeDecisions({})).toString("base64");
    return new Response(JSON.stringify({ content, sha: "abc" }), { status: 200 });
  }) as typeof fetch;
  const result = await writeDecision("t", "dev", { id: "BUG-01", kind: "bug", status: "fixed" }, transport, new Date("2026-10-18T00:00:00Z"));
  assert.equal(puts, 2);
  assert.deepEqual(result["BUG-01"], { id: "BUG-01", kind: "bug", status: "fixed", by: "dev", at: "2026-10-18T00:00:00.000Z" });
});

test("redesigns group their ideas and ideas follow the redesign decision", () => {
  const ideas = [{ id: "UX-01", title: "a" }, { id: "UX-02", title: "b" }, { id: "UX-03", title: "c" }] as Idea[];
  const g = groupIdeas(ideas, [
    { id: "RD-01", title: "Home", ideas: ["UX-01", "UX-02", "UX-99"] },
    { id: "RD-02", title: "Lonely", ideas: ["UX-03"] },
  ]);
  assert.deepEqual(g.proposals.map((p) => [p.id, p.ideas]), [["RD-01", ["UX-01", "UX-02"]]]);
  assert.deepEqual(g.standalone.map((i) => i.id), ["UX-03"]);
  const parent = { id: "RD-01", kind: "proposal", status: "planned", by: "x", at: "t" } as Decision;
  assert.equal(ideaStatus(ideas[0], undefined, parent), "planned");
  assert.equal(ideaStatus(ideas[0], { ...parent, id: "UX-01", kind: "idea", status: "dismissed" }, parent), "dismissed");
  const known = new Map<string, Kind>([["RD-01", "proposal"]]);
  assert.equal(validateDecision({ id: "RD-01", kind: "proposal", status: "later" }, known).status, "later");
  assert.throws(() => validateDecision({ id: "RD-01", kind: "proposal", status: "fixing" }, known));
  const withImprovement = new Map<string, Kind>([["IM-01", "improvement"]]);
  assert.equal(validateDecision({ id: "IM-01", kind: "improvement", status: "planned" }, withImprovement).status, "planned");
  assert.throws(() => validateDecision({ id: "IM-01", kind: "idea", status: "planned" }, withImprovement));
});

test("similar bugs group into one card that their decision flows to", () => {
  const bugs = [
    { id: "BUG-01", title: "a", severity: "low" },
    { id: "BUG-02", title: "b", severity: "medium" },
    { id: "BUG-03", title: "c", severity: "high" },
  ] as Bug[];
  const g = groupBugs(bugs, [
    { id: "BG-01", title: "ab", bugs: ["BUG-01", "BUG-02"] },
    { id: "BG-02", title: "lonely", bugs: ["BUG-03", "BUG-99"] },
  ]);
  assert.deepEqual(g.groups.map((x) => x.id), ["BG-01"]);
  assert.deepEqual(g.standalone.map((b) => b.id), ["BUG-03"]);
  assert.equal(groupSeverity(g.groups[0], bugs), "medium");
  assert.equal(bugGroupStatus(g.groups[0], {}, bugs), "open");
  const fixedBoth = { "BUG-01": { status: "fixed" }, "BUG-02": { status: "fixed" } } as unknown as Decisions;
  assert.equal(bugGroupStatus(g.groups[0], fixedBoth, bugs), "fixed");
  const parent = { id: "BG-01", kind: "bug_group", status: "fixing", by: "x", at: "t" } as Decision;
  assert.equal(bugStatus(bugs[0], undefined, parent), "fixing");
  assert.equal(validateDecision({ id: "BG-01", kind: "bug_group", status: "fixed" }, new Map<string, Kind>([["BG-01", "bug_group"]])).status, "fixed");
});
