import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DISMISS_REASONS,
  PRIORITIES,
  REASON_LABEL,
  SEVERITIES,
  STATUS_LABEL,
  bugStatus,
  bugThumbnail,
  groupIdeas,
  ideaStatus,
  screenshotLabel,
  stepsList,
  type Bug,
  type Decision,
  type DecisionInput,
  type Decisions,
  type DismissReason,
  type Idea,
  type Kind,
  type Proposal,
  type Status,
} from "./model.ts";
import { Bug as BugIcon, Close, Copy, Examine, External, Info, Layout, Learn } from "./icons.tsx";

interface Review {
  viewer: { login: string; canWrite: boolean };
  bugs: Bug[];
  ideas: Idea[];
  proposals?: Proposal[];
  decisions: Decisions;
}
type Page = "bugs" | "ideas" | "feedback";
type Item = { kind: "bug"; item: Bug } | { kind: "idea"; item: Idea } | { kind: "proposal"; item: Proposal };
type Grouped = ReturnType<typeof groupIdeas>;

const img = (path: string) => `/api/image?path=${encodeURIComponent(path)}`;
const cap = (t?: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
const PAGES: Page[] = ["bugs", "ideas", "feedback"];

function pageFromHash(): { page: Page; open?: string } {
  const h = decodeURIComponent(location.hash.slice(1));
  if (PAGES.includes(h as Page)) return { page: h as Page };
  if (/^BUG-/i.test(h)) return { page: "bugs", open: h };
  if (/^(UX|RD)-/i.test(h)) return { page: "ideas", open: h };
  return { page: "bugs" };
}

export function App() {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const initial = useMemo(pageFromHash, []);
  const [page, setPage] = useState<Page>(initial.page);
  const [openId, setOpenId] = useState<string | undefined>(initial.open);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/review", { credentials: "same-origin" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError({ status: r.status, message: body.error ?? "Couldn't load the review." });
        return;
      }
      setError(null);
      setReview(body as Review);
    } catch {
      setError({ status: 0, message: "Couldn't reach the site. Check your connection and reload." });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const hash = openId ?? page;
    if (location.hash.slice(1) !== hash) history.replaceState(null, "", `#${hash}`);
  }, [page, openId]);

  const say = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? "" : t)), 2600);
  }, []);

  if (!review) return error ? <SignedOut error={error} /> : <div className="loading" role="status">Loading the review…</div>;

  const decisions = review.decisions;
  const grouped = groupIdeas(review.ideas, review.proposals ?? []);
  const openItem: Item | undefined = openId
    ? (() => {
        const b = review.bugs.find((x) => x.id === openId);
        if (b) return { kind: "bug", item: b } as Item;
        const i = review.ideas.find((x) => x.id === openId);
        if (i) return { kind: "idea", item: i } as Item;
        const p = grouped.proposals.find((x) => x.id === openId);
        return p ? ({ kind: "proposal", item: p } as Item) : undefined;
      })()
    : undefined;

  const counts = {
    bugs: review.bugs.filter((b) => ["open", "fixing"].includes(bugStatus(b, decisions[b.id]))).length,
    ideas: grouped.proposals.filter((p) => !decisions[p.id] || decisions[p.id].status === "open").length + grouped.standalone.filter((i) => ideaStatus(i, decisions[i.id]) === "open").length,
    feedback: Object.values(decisions).filter((d) => d.status === "dismissed" || d.note).length,
  };

  async function save(input: DecisionInput): Promise<boolean> {
    const r = await fetch("/api/decision", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    const body = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) {
      say(body.error ?? "Couldn't save. Check your connection and try again.");
      return false;
    }
    setReview((prev) => (prev ? { ...prev, decisions: body.decisions } : prev));
    say("Saved");
    return true;
  }

  return (
    <div className="shell">
      <aside className="nav">
        <div className="brand">YouGame review</div>
        <nav aria-label="Pages">
          <NavItem icon={<BugIcon />} label="Bugs" count={counts.bugs} countLabel="open" active={page === "bugs"} onClick={() => { setPage("bugs"); setOpenId(undefined); }} />
          <NavItem icon={<Layout />} label="Design ideas" count={counts.ideas} countLabel="need your take" active={page === "ideas"} onClick={() => { setPage("ideas"); setOpenId(undefined); }} />
          <NavItem icon={<Learn />} label="Scan feedback" count={counts.feedback} countLabel="items" active={page === "feedback"} onClick={() => { setPage("feedback"); setOpenId(undefined); }} />
        </nav>
        <div className="me">
          <span className="login">@{review.viewer.login}</span>
          <button className="link" type="button" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); location.reload(); }}>Sign out</button>
        </div>
      </aside>

      <main className="main">
        {page === "bugs" && <BugsPage bugs={review.bugs} decisions={decisions} onOpen={setOpenId} say={say} />}
        {page === "ideas" && <IdeasPage ideas={review.ideas} grouped={grouped} decisions={decisions} onOpen={setOpenId} say={say} />}
        {page === "feedback" && <FeedbackPage review={review} proposals={grouped.proposals} onOpen={(id) => { setPage(/^(UX|RD)/.test(id) ? "ideas" : "bugs"); setOpenId(id); }} />}
      </main>

      {openItem && (
        <Drawer key={openItem.item.id} entry={openItem} decisions={decisions} review={review} grouped={grouped} canWrite={review.viewer.canWrite} onOpen={setOpenId} onClose={() => setOpenId(undefined)} onSave={save} say={say} />
      )}
      <div className="toast" role="status" aria-live="polite">{toast && <span>{toast}</span>}</div>
    </div>
  );
}

function NavItem({ icon, label, count, countLabel, active, onClick }: { icon: ReactNode; label: string; count: number; countLabel: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="nav-item" aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="nav-count" aria-label={`${count} ${countLabel}`}>{count}</span>
    </button>
  );
}

function SignedOut({ error }: { error: { status: number; message: string } }) {
  const params = new URLSearchParams(location.search);
  const signinError = params.get("signin_error");
  const notSetUp = error.status === 503 && /set up/.test(error.message);
  return (
    <div className="signed-out">
      <div className="signin-card">
        <h1>YouGame review</h1>
        {error.status === 401 && !signinError && <p>Bugs and design ideas from the YouGame beta. Sign in with the GitHub account that has access to the review repository.</p>}
        {(signinError || error.status !== 401) && <p className="error">{signinError ?? error.message}</p>}
        {!notSetUp && (
          <a className="btn primary" href="/api/auth/login">Sign in with GitHub</a>
        )}
      </div>
    </div>
  );
}

// ---------- shared bits ----------

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  return (
    <span className="infotip" ref={ref}>
      <button ref={btn} type="button" className="icon-btn small" aria-label={`About ${label}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Info />
      </button>
      {open && <span className="tip" role="note">{children}</span>}
    </span>
  );
}

function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="out" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <External />
    </a>
  );
}

async function copyText(text: string, say: (m: string) => void, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    say(done);
  } catch {
    say("Copying was blocked. Select the text and copy it by hand.");
  }
}

function statusText(kind: Kind, status: Status, decision?: Decision): string {
  if (status === "dismissed" && decision?.reason) return `Dismissed: ${REASON_LABEL[decision.reason]}`;
  return STATUS_LABEL[kind][status];
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} className="chip" onClick={() => onChange(o.key)}>
          {o.label}
          {o.count !== undefined && <span className="chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- boards ----------

type BugFilter = "active" | "fixed" | "dismissed" | "all";

function BugsPage({ bugs, decisions, onOpen, say }: { bugs: Bug[]; decisions: Decisions; onOpen: (id: string) => void; say: (m: string) => void }) {
  const [filter, setFilter] = useState<BugFilter>("active");
  const st = (b: Bug) => bugStatus(b, decisions[b.id]);
  const groups: Record<BugFilter, Bug[]> = {
    active: bugs.filter((b) => ["open", "fixing"].includes(st(b))),
    fixed: bugs.filter((b) => st(b) === "fixed"),
    dismissed: bugs.filter((b) => st(b) === "dismissed"),
    all: bugs,
  };
  const shown = groups[filter];
  const prompts = groups.active.filter((b) => b.agent_prompt);
  return (
    <>
      <header className="page-head">
        <h1>Bugs</h1>
        {prompts.length > 0 && <button type="button" className="btn agent" onClick={() => copyText(promptBundle("Fix these YouGame bugs one at a time, most severe first. Each section is self-contained.", prompts), say, `Copied ${prompts.length} prompts for your coding agent`)}>
          <Copy /> Copy prompts for open bugs
        </button>}
      </header>
      <Chips<BugFilter>
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { key: "active", label: "Open", count: groups.active.length },
          { key: "fixed", label: "Fixed", count: groups.fixed.length },
          { key: "dismissed", label: "Dismissed", count: groups.dismissed.length },
          { key: "all", label: "All", count: bugs.length },
        ]}
      />
      <div className="board" style={{ ["--cols" as string]: SEVERITIES.length }}>
        {SEVERITIES.map((sev) => {
          const items = shown.filter((b) => b.severity === sev);
          return (
            <section key={sev} className="column" aria-label={`${cap(sev)} severity`}>
              <h2 className="column-title">
                <span className={`sev-mark sev-${sev}`} aria-hidden="true" />
                {cap(sev)} <span className="count">· {items.length}</span>
              </h2>
              {items.length === 0 ? <p className="none">None</p> : items.map((b) => (
                <Card key={b.id} id={b.id} title={b.title} meta={b.area} status={st(b) === "open" ? undefined : statusText("bug", st(b), decisions[b.id])} thumbs={[bugThumbnail(b)].filter(Boolean) as string[]} onOpen={onOpen} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

type IdeaFilter = "open" | "answered" | "dismissed" | "all";

function IdeasPage({ ideas, grouped, decisions, onOpen, say }: { ideas: Idea[]; grouped: Grouped; decisions: Decisions; onOpen: (id: string) => void; say: (m: string) => void }) {
  const [filter, setFilter] = useState<IdeaFilter>("open");
  const st = (i: Idea) => ideaStatus(i, decisions[i.id]);
  const pst = (p: Proposal) => ideaStatus(p as unknown as Idea, decisions[p.id]);
  const match = (status: string): Record<IdeaFilter, boolean> => ({ open: status === "open", answered: !["open", "dismissed"].includes(status), dismissed: status === "dismissed", all: true });
  const shownProposals = grouped.proposals.filter((p) => match(pst(p))[filter]);
  const shown = grouped.standalone.filter((i) => match(st(i))[filter]);
  const count = (f: IdeaFilter) => grouped.proposals.filter((p) => match(pst(p))[f]).length + grouped.standalone.filter((i) => match(st(i))[f]).length;
  const planned = [
    ...grouped.proposals.filter((p) => pst(p) === "planned").map((p) => ({ id: p.id, title: p.title, agent_prompt: proposalPrompt(p, ideas) })),
    ...ideas.filter((i) => i.agent_prompt && ideaStatus(i, decisions[i.id], decisions[grouped.parentOf.get(i.id)?.id ?? ""]) === "planned" && !(grouped.parentOf.has(i.id) && pst(grouped.parentOf.get(i.id)!) === "planned")),
  ].filter((x) => x.agent_prompt);
  return (
    <>
      <header className="page-head">
        <h1>Design ideas</h1>
        {planned.length > 0 && <button type="button" className="btn agent" onClick={() => copyText(promptBundle("Implement these YouGame design changes one at a time. Each section is self-contained.", planned), say, `Copied ${planned.length} prompts for your coding agent`)}>
          <Copy /> Copy prompts for “Will do”
        </button>}
      </header>
      <Chips<IdeaFilter>
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { key: "open", label: "Needs your take", count: count("open") },
          { key: "answered", label: "Answered", count: count("answered") },
          { key: "dismissed", label: "Dismissed", count: count("dismissed") },
          { key: "all", label: "All", count: count("all") },
        ]}
      />
      {shownProposals.length > 0 && (
        <section className="group" aria-labelledby="redesigns-title">
          <h2 id="redesigns-title" className="group-title">
            Redesigns <span className="count">· {shownProposals.length}</span>
            <InfoTip label="redesigns">One mock that answers several ideas at once. Decide on the whole redesign here; open an idea inside it to decide on that part alone.</InfoTip>
          </h2>
          <div className="proposals">
            {shownProposals.map((p) => {
              const answered = p.ideas.filter((id) => decisions[id]).length;
              return (
                <Card key={p.id} id={p.id} wide title={p.title} meta={`${p.ideas.length} ideas${answered ? ` · ${answered} answered on their own` : ""}`} status={pst(p) === "open" ? undefined : statusText("proposal", pst(p), decisions[p.id])} thumbs={[p.before_screenshot, p.after_image].filter(Boolean) as string[]} onOpen={onOpen} />
              );
            })}
          </div>
        </section>
      )}
      <section className="group" aria-labelledby="other-ideas-title">
        {grouped.proposals.length > 0 && <h2 id="other-ideas-title" className="group-title">Other ideas <span className="count">· {shown.length}</span></h2>}
        <div className="board" style={{ ["--cols" as string]: PRIORITIES.length }}>
          {PRIORITIES.map((p) => {
            const items = shown.filter((i) => (i.priority ?? "low") === p);
            return (
              <section key={p} className="column" aria-label={`${cap(p)} priority`}>
                <h3 className="column-title">
                  <span className={`sev-mark pri-${p}`} aria-hidden="true" />
                  {cap(p)} priority <span className="count">· {items.length}</span>
                </h3>
                {items.length === 0 ? <p className="none">None</p> : items.map((i) => (
                  <Card key={i.id} id={i.id} title={i.title} meta={i.area} status={st(i) === "open" ? undefined : statusText("idea", st(i), decisions[i.id])} thumbs={[i.before_screenshot, i.after_image].filter(Boolean) as string[]} onOpen={onOpen} />
                ))}
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}

/** The redesign's own prompt, or its ideas' prompts in order. */
function proposalPrompt(p: Proposal, ideas: Idea[]): string | undefined {
  if (p.agent_prompt) return p.agent_prompt;
  const parts = p.ideas.map((id) => ideas.find((i) => i.id === id)).filter((i): i is Idea => !!i?.agent_prompt);
  if (!parts.length) return undefined;
  return `Implement the "${p.title}" redesign${p.figma_url ? ` (mock: ${p.figma_url})` : ""}. It is made of these changes; do them together so the page stays consistent.\n\n${parts.map((i) => `## ${i.id}: ${i.title}\n\n${i.agent_prompt}`).join("\n\n---\n\n")}`;
}

function promptBundle(head: string, items: { id: string; title: string; agent_prompt?: string }[]): string {
  return `${head}\n\n${items.map((i) => `## ${i.id}: ${i.title}\n\n${i.agent_prompt}`).join("\n\n---\n\n")}`;
}

function Card({ id, title, meta, status, thumbs, wide, onOpen }: { id: string; title: string; meta?: string; status?: string; thumbs: string[]; wide?: boolean; onOpen: (id: string) => void }) {
  return (
    <div className={`card-shell${wide ? " wide" : ""}`}>
    <button type="button" className="card" onClick={() => onOpen(id)} aria-label={`${id}: ${title}${status ? `, ${status}` : ""}. Open details`}>
      <span className={`thumb${thumbs.length > 1 ? " split" : ""}`}>
        {thumbs.length ? thumbs.slice(0, 2).map((t) => <img key={t} src={img(t)} alt="" loading="lazy" />) : <span className="no-shot">No screenshot</span>}
      </span>
      <span className="card-body">
        <span className="card-id">{id}</span>
        <span className="card-title">{title}</span>
        <span className="card-meta">
          {meta}
          {status && <span className="card-status">{status}</span>}
        </span>
      </span>
      <span className="examine" aria-hidden="true"><Examine /></span>
    </button>
    </div>
  );
}

// ---------- detail drawer ----------

function Drawer({ entry, decisions, review, grouped, canWrite, onOpen, onClose, onSave, say }: { entry: Item; decisions: Decisions; review: Review; grouped: Grouped; canWrite: boolean; onOpen: (id: string) => void; onClose: () => void; onSave: (d: DecisionInput) => Promise<boolean>; say: (m: string) => void }) {
  const { kind, item } = entry;
  const decision = decisions[item.id];
  const parent = kind === "idea" ? grouped.parentOf.get(item.id) : undefined;
  const current: Status = kind === "bug" ? bugStatus(item, decision) : ideaStatus(item as Idea, decision, parent && decisions[parent.id]);
  const prompt = kind === "proposal" ? proposalPrompt(item, review.ideas) : item.agent_prompt;
  const [status, setStatus] = useState<Status>(current);
  const [reason, setReason] = useState<DismissReason | undefined>(decision?.reason);
  const [note, setNote] = useState(decision?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dirty = status !== current || (status === "dismissed" && reason !== decision?.reason) || note.trim() !== (decision?.note ?? "");

  const requestClose = useCallback(() => {
    if (dirty) setConfirmClose(true);
    else onClose();
  }, [dirty, onClose]);
  const go = (id: string) => {
    if (dirty) setConfirmClose(true);
    else onOpen(id);
  };

  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !zoom) requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose, zoom]);

  async function submit() {
    if (status === "dismissed" && !reason) {
      say("Pick why it's dismissed.");
      return;
    }
    setSaving(true);
    const ok = await onSave({ id: item.id, kind, status, ...(status === "dismissed" ? { reason } : {}), note });
    setSaving(false);
    if (ok) setConfirmClose(false);
    return ok;
  }

  const options = (kind === "bug" ? ["open", "fixing", "fixed", "dismissed"] : ["open", "planned", "later", "done", "dismissed"]) as Status[];
  const inherited = parent && !decision && decisions[parent.id];

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabIndex={-1} ref={panel}>
        <div className="drawer-head">
          <span className="drawer-meta">
            <span className="mono">{item.id}</span>
            {kind === "bug" ? <span>{cap((item as Bug).severity)} severity</span> : kind === "idea" ? <span>{cap((item as Idea).priority)} priority</span> : <span>Redesign</span>}
            {item.area && <span>{item.area}</span>}
          </span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={requestClose}><Close /></button>
        </div>
        <h2 id="drawer-title" className="drawer-title">{item.title}</h2>

        {kind === "bug" && <BugBody bug={item as Bug} onZoom={setZoom} />}
        {kind === "idea" && <IdeaBody idea={item as Idea} parent={parent} onOpen={go} onZoom={setZoom} />}
        {kind === "proposal" && <ProposalBody proposal={item as Proposal} ideas={review.ideas} decisions={decisions} onOpen={go} onZoom={setZoom} />}

        {prompt && (
          <section className="agent-panel" aria-label="Prompt for your coding agent">
            <div className="agent-head">
              <span className="agent-label">
                For your coding agent
                <InfoTip label="agent prompts">Written for an AI coding agent such as Claude Code, not for you to read. Copy it and paste it into the agent working in YouGame's code.</InfoTip>
              </span>
              <button type="button" className="btn agent small" onClick={() => copyText(prompt, say, kind === "bug" ? "Fix prompt copied" : "Design prompt copied")}><Copy /> Copy {kind === "bug" ? "fix" : "design"} prompt</button>
            </div>
            <pre>{prompt}</pre>
          </section>
        )}

        <section className="decide" aria-labelledby="decide-title">
          <h3 id="decide-title">
            Your decision
            <InfoTip label="decisions">Saved to the review repository for everyone with access. Dismissals and notes are read by future YouGame scans, so they stop reporting things like this.{kind === "proposal" ? " Ideas in this redesign follow this decision unless you decide on one of them separately." : parent && !decision ? ` Until you decide here, this idea follows the ${parent.title} decision.` : ""}</InfoTip>
          </h3>
          {canWrite ? (
            <>
              <Chips<Status> label="Status" value={status} onChange={setStatus} options={options.map((o) => ({ key: o, label: o === "dismissed" ? "Dismiss" : STATUS_LABEL[kind][o] }))} />
              {status === "dismissed" && (
                <div className="reason">
                  <span className="field-label" id="reason-label">Why</span>
                  <Chips<DismissReason> label="Why it's dismissed" value={reason as DismissReason} onChange={setReason} options={DISMISS_REASONS.map(([k, l]) => ({ key: k, label: l }))} />
                </div>
              )}
              <label className="field-label" htmlFor="note">Note</label>
              <textarea id="note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder={status === "dismissed" ? "What should future scans know? For example, when this kind of finding matters and when it doesn't." : "Anything to add for the team or future scans?"} />
              <div className="decide-actions">
                <button type="button" className="btn primary" disabled={!dirty || saving} onClick={() => void submit()}>{saving ? "Saving…" : "Save decision"}</button>
                {decision && <span className="receipt">Saved by @{decision.by}, {new Date(decision.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>}
                {inherited && <span className="receipt">From the {parent.title} decision</span>}
              </div>
            </>
          ) : (
            <p className="readonly">
              {statusText(kind, current, decision)}
              {decision?.note && <> · “{decision.note}”</>}
              <br />
              <span className="receipt">Your GitHub account can view this review but not change it.</span>
            </p>
          )}
        </section>

        {confirmClose && (
          <div className="unsaved" role="alertdialog" aria-label="Unsaved decision">
            <span>Your decision isn't saved.</span>
            <button type="button" className="btn" onClick={onClose}>Discard</button>
            <button type="button" className="btn primary" disabled={saving} onClick={async () => { if (await submit()) onClose(); }}>Save</button>
          </div>
        )}
      </div>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

function Shot({ src, label, onZoom }: { src: string; label: string; onZoom: (s: string) => void }) {
  return (
    <button type="button" className="shot" onClick={() => onZoom(src)} aria-label={`${label}, view full size`}>
      <img src={img(src)} alt="" loading="lazy" />
      <span className="shot-label">{label}<Examine /></span>
    </button>
  );
}

function BugBody({ bug, onZoom }: { bug: Bug; onZoom: (s: string) => void }) {
  const rank = (s: string) => (/detail/i.test(s) ? 0 : /fullpage/i.test(s) ? 2 : 1);
  const shots = [...(bug.evidence?.screenshots ?? [])].sort((a, b) => rank(a) - rank(b));
  const steps = stepsList(bug.steps);
  return (
    <>
      {shots.length > 0 && (
        <div className={`shots n${Math.min(shots.length, 3)}`}>
          {shots.map((s) => <Shot key={s} src={s} label={screenshotLabel(s)} onZoom={onZoom} />)}
        </div>
      )}
      {bug.status === "fixed" && <p className="flag">The tester found this already fixed on the live site.</p>}
      {bug.url && <OutLink href={bug.url}>Open the page on YouGame</OutLink>}
      {bug.summary && <Block title="What's wrong"><p>{bug.summary}</p></Block>}
      {steps.length > 0 && (
        <Block title="How to see it">
          <ol className="steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </Block>
      )}
      {(bug.expected || bug.actual) && (
        <div className="pair">
          <div><h3>Should happen</h3><p>{bug.expected}</p></div>
          <div><h3>Actually happens</h3><p>{bug.actual}</p></div>
        </div>
      )}
      {((bug.evidence?.notes?.length ?? 0) > 0 || (bug.evidence?.console?.length ?? 0) > 0) && (
        <Block title="Evidence">
          <ul className="evidence">
            {bug.evidence?.notes?.map((n, i) => <li key={`n${i}`}>{n}</li>)}
            {bug.evidence?.console?.map((c, i) => <li key={`c${i}`}><code>{c}</code></li>)}
          </ul>
        </Block>
      )}
    </>
  );
}

function IdeaBody({ idea, parent, onOpen, onZoom }: { idea: Idea; parent?: Proposal; onOpen: (id: string) => void; onZoom: (s: string) => void }) {
  return (
    <>
      {parent && (
        <button type="button" className="parent-link" onClick={() => onOpen(parent.id)}>
          <span>Part of <strong>{parent.title}</strong></span>
          <Examine />
        </button>
      )}
      {(idea.before_screenshot || idea.after_image) && (
        <div className={`shots compare${idea.before_screenshot && idea.after_image ? " n2" : " n1"}`}>
          {idea.before_screenshot && <Shot src={idea.before_screenshot} label="Today" onZoom={onZoom} />}
          {idea.after_image && <Shot src={idea.after_image} label="Proposed" onZoom={onZoom} />}
        </div>
      )}
      <div className="links">
        {idea.page_url && <OutLink href={idea.page_url}>See it on YouGame</OutLink>}
        {idea.figma_url && <OutLink href={idea.figma_url}>Open the mock in Figma</OutLink>}
      </div>
      {idea.problem && <Block title="What we noticed"><p>{idea.problem}</p></Block>}
      {idea.why_it_matters && <Block title="Why it matters"><p>{idea.why_it_matters}</p></Block>}
      {idea.recommendation && <Block title="Suggestion"><p>{idea.recommendation}</p></Block>}
    </>
  );
}

function ProposalBody({ proposal, ideas, decisions, onOpen, onZoom }: { proposal: Proposal; ideas: Idea[]; decisions: Decisions; onOpen: (id: string) => void; onZoom: (s: string) => void }) {
  const members = proposal.ideas.map((id) => ideas.find((i) => i.id === id)).filter((i): i is Idea => !!i);
  return (
    <>
      {(proposal.before_screenshot || proposal.after_image) && (
        <div className={`shots compare${proposal.before_screenshot && proposal.after_image ? " n2" : " n1"}`}>
          {proposal.before_screenshot && <Shot src={proposal.before_screenshot} label="Today" onZoom={onZoom} />}
          {proposal.after_image && <Shot src={proposal.after_image} label="Proposed" onZoom={onZoom} />}
        </div>
      )}
      <div className="links">
        {proposal.page_url && <OutLink href={proposal.page_url}>See it on YouGame</OutLink>}
        {proposal.figma_url && <OutLink href={proposal.figma_url}>Open the mock in Figma</OutLink>}
      </div>
      {proposal.summary && <Block title="What it changes"><p>{proposal.summary}</p></Block>}
      <Block title={`Ideas it answers · ${members.length}`}>
        <ul className="member-list">
          {members.map((i) => {
            const d = decisions[i.id];
            return (
              <li key={i.id}>
                <button type="button" className="member" onClick={() => onOpen(i.id)} aria-label={`${i.id}: ${i.title}. Open details`}>
                  <span className="mono">{i.id}</span>
                  <span className="member-title">{i.title}</span>
                  {d && <span className="card-status">{statusText("idea", d.status, d)}</span>}
                  <Examine />
                </button>
              </li>
            );
          })}
        </ul>
      </Block>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={screenshotLabel(src)} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <button ref={ref} type="button" className="icon-btn lightbox-close" aria-label="Close full size image" onClick={onClose}><Close /></button>
      <img src={img(src)} alt={screenshotLabel(src)} />
    </div>
  );
}

// ---------- what scans learn ----------

function FeedbackPage({ review, proposals, onOpen }: { review: Review; proposals: Proposal[]; onOpen: (id: string) => void }) {
  const titles = new Map<string, string>([...review.bugs, ...review.ideas, ...proposals].map((x) => [x.id, x.title]));
  const all = Object.values(review.decisions).filter((d) => titles.has(d.id));
  const dismissed = all.filter((d) => d.status === "dismissed");
  const notes = all.filter((d) => d.status !== "dismissed" && d.note);
  return (
    <>
      <header className="page-head">
        <h1>
          Scan feedback
          <InfoTip label="scan feedback">Every decision is saved in feedback/decisions.json in the review repository. Before the next beta test or design review, the scans read it and skip findings like the ones dismissed here.</InfoTip>
        </h1>
      </header>
      {all.length === 0 ? (
        <p className="empty">Nothing yet. Dismiss a bug or design idea, or leave a note on one, and it shows up here for future scans.</p>
      ) : (
        <div className="board" style={{ ["--cols" as string]: DISMISS_REASONS.length + 1 }}>
          {DISMISS_REASONS.map(([key, label]) => {
            const items = dismissed.filter((d) => d.reason === key);
            return (
              <section key={key} className="column" aria-label={label}>
                <h2 className="column-title">{label} <span className="count">· {items.length}</span></h2>
                {items.length === 0 ? <p className="none">None</p> : items.map((d) => <FeedbackCard key={d.id} d={d} title={titles.get(d.id)!} onOpen={onOpen} />)}
              </section>
            );
          })}
          <section className="column" aria-label="Notes on other items">
            <h2 className="column-title">Notes on kept items <span className="count">· {notes.length}</span></h2>
            {notes.length === 0 ? <p className="none">None</p> : notes.map((d) => <FeedbackCard key={d.id} d={d} title={titles.get(d.id)!} onOpen={onOpen} />)}
          </section>
        </div>
      )}
    </>
  );
}

function FeedbackCard({ d, title, onOpen }: { d: Decision; title: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="card text-card" onClick={() => onOpen(d.id)} aria-label={`${d.id}: ${title}. Open details`}>
      <span className="card-body">
        <span className="card-id">{d.id} · {d.kind === "bug" ? "Bug" : d.kind === "proposal" ? "Redesign" : "Design idea"}</span>
        <span className="card-title">{title}</span>
        {d.note && <span className="card-note">“{d.note}”</span>}
        <span className="card-meta">@{d.by}</span>
      </span>
      <span className="examine" aria-hidden="true"><Examine /></span>
    </button>
  );
}
