import { test } from "node:test";
import assert from "node:assert/strict";
import { bugStatus, bugThumbnail, groupIdeas, ideaStatus, validateDecision, type Decision, type Idea, type Kind } from "../src/model.ts";
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
});
