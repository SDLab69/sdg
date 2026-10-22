"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DRAFT_COLUMNS,
  DRAFT_LEAD_DAYS,
  REVIEW_STATE_LABEL,
  draftReadyDate,
  serviceKindLabel,
  reviewState,
  standardEmail,
  type ServiceKind,
  type OutreachDraft,
  type ReviewState,
} from "@/lib/engagement";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PanelOutreach = {
  householdId: string;
  householdName: string;
  isVip: boolean;
  source: ServiceKind;
  sourceId: string;
  outreachDate: string;
  dueDate: string;
  staffName?: string | null;
  staffRole?: string | null;
};

type Pet = { name: string; breed: string | null };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function longDate(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

function shortDate(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function timestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export const STATE_STYLE: Record<ReviewState, { bg: string; fg: string }> = {
  scheduled:     { bg: "#EDE5D8", fg: "#6B5D52" },
  drafting:      { bg: "#EDE5D8", fg: "#6B5D52" },
  needs_review:  { bg: "#FAE8C8", fg: "#8A5A10" },
  approved:      { bg: "#D6EAD8", fg: "#1E4224" },
  skipped:       { bg: "#EDE5D8", fg: "#6B5D52" },
  sent_ai:       { bg: "#D6EAD8", fg: "#1E4224" },
  sent_template: { bg: "#EDE5D8", fg: "#3A2E26" },
  skipped_past:  { bg: "#EDE5D8", fg: "#6B5D52" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OutreachPanel({
  outreach,
  draft,
  today,
  onDraftChange,
  onOutreachDateChange,
  onClose,
  onViewProfile,
}: {
  outreach: PanelOutreach;
  draft: OutreachDraft | null;
  today: string;
  onDraftChange: (draft: OutreachDraft) => void;
  onOutreachDateChange: (sourceId: string, source: ServiceKind, ymd: string) => void;
  onClose: () => void;
  onViewProfile: () => void;
}) {
  const supabase = useRef(createClient()).current;
  const e = outreach;

  const [email, setEmail] = useState<string | null>(null);
  const [pets, setPets] = useState<Pet[]>([]);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<null | "approve" | "save" | "skip" | "undo" | "generate">(null);
  const [error, setError] = useState("");
  const [showTemplate, setShowTemplate] = useState(false);
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState(e.outreachDate);
  const [dateError, setDateError] = useState("");
  const [savingDate, setSavingDate] = useState(false);

  useEffect(() => {
    setEditing(false);
    setShowTemplate(false);
    setEditingDate(false);
    setError("");
    Promise.all([
      supabase.from("households").select("email").eq("id", e.householdId).single(),
      supabase.from("pets").select("name, breed").eq("household_id", e.householdId).order("created_at"),
    ]).then(([{ data: hh }, { data: mm }]) => {
      setEmail(hh?.email ?? null);
      setPets((mm as Pet[]) ?? []);
    });
  }, [supabase, e.householdId, e.source, e.sourceId]);

  const state = reviewState({ outreachDate: e.outreachDate, today, draft });
  const style = STATE_STYLE[state];
  const readyDate = draftReadyDate(e.outreachDate);
  const petNames = pets.map((p) => p.name);
  const template = standardEmail(e.source, petNames);
  const isPast = e.outreachDate < today;

  // ── Actions ────────────────────────────────────────────────────────────────

  async function update(patch: Partial<OutreachDraft>, kind: NonNullable<typeof busy>) {
    if (!draft) return;
    setBusy(kind);
    setError("");
    const { data, error: err } = await supabase
      .from("outreach_drafts")
      .update(patch)
      .eq("id", draft.id)
      .select(DRAFT_COLUMNS)
      .single();
    setBusy(null);
    if (err || !data) { setError(err?.message ?? "Failed to save"); return; }
    onDraftChange(data as OutreachDraft);
    setEditing(false);
  }

  const approve = () => update({ status: "approved", reviewed_at: new Date().toISOString() }, "approve");
  const skip = () => update({ status: "skipped", reviewed_at: new Date().toISOString() }, "skip");
  const undo = () => update({ status: "needs_review", reviewed_at: null }, "undo");
  const saveEdits = () =>
    update({
      subject: subject.trim(),
      body: body.trim(),
      edited: true,
      status: "approved",
      reviewed_at: new Date().toISOString(),
    }, "save");

  function startEdit() {
    if (!draft) return;
    setSubject(draft.subject);
    setBody(draft.body);
    setEditing(true);
  }

  async function generate() {
    setBusy("generate");
    setError("");
    const res = await fetch("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: e.source, sourceId: e.sourceId }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) { setError(json.error ?? "Failed to generate draft"); return; }
    onDraftChange(json.draft as OutreachDraft);
    setEditing(false);
  }

  async function saveDate() {
    if (!dateInput) { setDateError("Pick a date"); return; }
    if (dateInput < today) { setDateError("Outreach date can't be in the past"); return; }
    const dow = new Date(dateInput + "T00:00:00").getDay();
    if (dow === 0 || dow === 6) { setDateError("Weekdays only (Mon–Fri)"); return; }
    if (dateInput > e.dueDate) { setDateError("Outreach must come before the service is due"); return; }

    setSavingDate(true);
    setDateError("");
    const field = e.source === "full_groom" ? "full_groom_outreach_trigger" : "brush_outreach_trigger";
    const { error: err } = await supabase
      .from("service_clocks")
      .update({ [field]: dateInput })
      .eq("id", e.sourceId);
    setSavingDate(false);
    if (err) { setDateError(err.message); return; }
    onOutreachDateChange(e.sourceId, e.source, dateInput);
    setEditingDate(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />

      <aside className="relative w-full max-w-[560px] h-full bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-widest text-ink-3 uppercase">
                  {serviceKindLabel(e.source)}
                </span>
                {e.isVip && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-pale text-amber border border-amber/30">
                    ◆ VIP
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold text-ink leading-tight">{e.householdName}</h2>
            </div>
            <button onClick={onClose} className="text-ink-3 hover:text-ink text-2xl leading-none" aria-label="Close">×</button>
          </div>

          {/* Key dates */}
          <div className="grid grid-cols-[1.4fr_1fr_1.1fr_0.7fr] gap-3 mt-4">
            <div>
              <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-0.5 whitespace-nowrap">
                Outreach date
              </p>
              {editingDate ? (
                <div className="space-y-1">
                  <input
                    type="date"
                    value={dateInput}
                    min={today}
                    max={e.dueDate}
                    onChange={(ev) => { setDateInput(ev.target.value); setDateError(""); }}
                    className="w-full px-2 py-1 text-[12px] border border-border rounded focus:outline-none focus:ring-1 focus:ring-terra/40"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={saveDate} disabled={savingDate}
                      className="px-2 py-0.5 text-[11px] font-bold bg-terra text-white rounded hover:opacity-90 disabled:opacity-60">
                      {savingDate ? "Saving…" : "Save"}
                    </button>
                    <button onClick={() => setEditingDate(false)} disabled={savingDate}
                      className="text-[11px] text-ink-3 hover:text-ink">Cancel</button>
                  </div>
                  {dateError && <p className="text-[10px] text-terra leading-snug">{dateError}</p>}
                </div>
              ) : (
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-[13px] font-semibold text-ink">{longDate(e.outreachDate)}</p>
                  {!isPast && (
                    <button
                      onClick={() => { setDateInput(e.outreachDate); setDateError(""); setEditingDate(true); }}
                      className="px-1.5 py-0.5 text-[10px] font-bold text-terra border border-terra/40 rounded hover:bg-terra-pale transition-colors"
                    >
                      Change
                    </button>
                  )}
                </div>
              )}
            </div>
            <Fact label="Service due" value={longDate(e.dueDate)} />
            <Fact label="Staff" value={e.staffName ? `${e.staffName} (${e.staffRole})` : "—"} />
            <Fact label="Channel" value="Email" />
          </div>
          {editingDate && state === "approved" && (
            <p className="text-[11px] text-amber mt-2 leading-snug">
              Moving an approved outreach keeps the approval. Regenerate the draft if it mentions timing that no longer fits.
            </p>
          )}
        </div>

        {/* Timeline */}
        <Timeline
          state={state}
          readyDate={readyDate}
          outreachDate={e.outreachDate}
        />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Status banner */}
          <div className="flex items-start gap-3 px-4 py-3 rounded-lg" style={{ backgroundColor: style.bg, color: style.fg }}>
            <span className="text-[11px] font-bold uppercase tracking-wide shrink-0 mt-px">
              {REVIEW_STATE_LABEL[state]}
            </span>
            <span className="text-[13px] leading-snug">
              <StatusMessage state={state} draft={draft} outreachDate={e.outreachDate} readyDate={readyDate} />
            </span>
          </div>

          {error && (
            <div className="px-3 py-2 rounded bg-terra-pale border border-terra/30 text-sm text-terra">{error}</div>
          )}


          {/* Email draft */}
          {draft && state !== "sent_template" && (
            <MessageCard
              label={draft.edited ? "AI draft · edited by Sam" : "AI draft"}
              to={email}
              meta={`Generated ${timestamp(draft.generated_at)}`}
            >
              {editing ? (
                <div className="space-y-2">
                  <input
                    value={subject}
                    onChange={(ev) => setSubject(ev.target.value)}
                    className="w-full px-3 py-2 text-sm font-semibold border border-border rounded focus:outline-none focus:ring-1 focus:ring-terra/40"
                  />
                  <textarea
                    value={body}
                    onChange={(ev) => setBody(ev.target.value)}
                    rows={14}
                    className="w-full px-3 py-2 text-[13px] leading-relaxed border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-terra/40"
                  />
                </div>
              ) : (
                <>
                  <p className="text-sm font-semibold text-ink mb-3">{draft.subject}</p>
                  <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{draft.body}</p>
                </>
              )}
            </MessageCard>
          )}

          {/* Sent as template — show what actually went out */}
          {state === "sent_template" && (
            <MessageCard label="Standard template · sent" to={email}>
              <p className="text-sm font-semibold text-ink mb-3">{template.subject}</p>
              <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{template.body}</p>
            </MessageCard>
          )}

          {/* Fallback template preview */}
          {state !== "sent_template" && state !== "sent_ai" && state !== "skipped_past" && (
            <div className="border border-border rounded-lg">
              <button
                onClick={() => setShowTemplate((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-[12px] font-semibold text-ink-2 hover:bg-cream rounded-lg"
              >
                <span>Fallback: standard template (pre-approved)</span>
                <span className="text-ink-3">{showTemplate ? "Hide" : "Show"}</span>
              </button>
              {showTemplate && (
                <div className="px-4 pb-4 border-t border-border pt-3">
                  <p className="text-sm font-semibold text-ink mb-2">{template.subject}</p>
                  <p className="text-[13px] text-ink-3 leading-relaxed whitespace-pre-wrap">{template.body}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center gap-2">
          <button onClick={onViewProfile}
            className="px-3 py-2 text-sm text-ink-2 border border-border rounded-lg hover:bg-cream transition-colors">
            View profile
          </button>
          <div className="ml-auto flex items-center gap-2">
            {!isPast && state === "needs_review" && !editing && (
              <>
                <button onClick={skip} disabled={!!busy}
                  className="px-3 py-2 text-sm text-ink-3 hover:text-ink transition-colors disabled:opacity-50">
                  {busy === "skip" ? "Skipping…" : "Skip this cycle"}
                </button>
                <button onClick={generate} disabled={!!busy}
                  className="px-3 py-2 text-sm text-ink-2 border border-border rounded-lg hover:bg-cream transition-colors disabled:opacity-50">
                  {busy === "generate" ? "Regenerating…" : "Regenerate"}
                </button>
                <button onClick={startEdit} disabled={!!busy}
                  className="px-3 py-2 text-sm text-ink border border-border rounded-lg hover:bg-cream transition-colors disabled:opacity-50">
                  Edit
                </button>
                <button onClick={approve} disabled={!!busy}
                  className="px-4 py-2 text-sm font-semibold bg-sage text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
              </>
            )}
            {editing && (
              <>
                <button onClick={() => setEditing(false)} disabled={!!busy}
                  className="px-3 py-2 text-sm text-ink-2 border border-border rounded-lg hover:bg-cream transition-colors">
                  Cancel
                </button>
                <button onClick={saveEdits} disabled={!!busy || !subject.trim() || !body.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-sage text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
                  {busy === "save" ? "Saving…" : "Save & approve"}
                </button>
              </>
            )}
            {!isPast && (state === "approved" || state === "skipped") && (
              <button onClick={undo} disabled={!!busy}
                className="px-3 py-2 text-sm text-ink-2 border border-border rounded-lg hover:bg-cream transition-colors disabled:opacity-50">
                {busy === "undo" ? "Undoing…" : state === "approved" ? "Undo approval" : "Undo skip"}
              </button>
            )}
            {(state === "scheduled" || state === "drafting") && (
              <button onClick={generate} disabled={!!busy}
                className="px-4 py-2 text-sm font-semibold bg-terra text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy === "generate" ? "Drafting…" : "Draft now"}
              </button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-widest text-ink-3 uppercase mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-ink">{value}</p>
    </div>
  );
}

function MessageCard({
  label, to, meta, children,
}: {
  label: string; to: string | null; meta?: string; children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-cream border-b border-border flex items-center justify-between gap-3">
        <span className="text-[10px] font-bold tracking-widest text-ink-3 uppercase">{label}</span>
        {meta && <span className="text-[11px] text-ink-3">{meta}</span>}
      </div>
      {to && (
        <div className="px-4 py-2 border-b border-border text-[12px] text-ink-3">
          To: <span className="text-ink-2">{to}</span>
        </div>
      )}
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

function StatusMessage({
  state, draft, outreachDate, readyDate,
}: {
  state: ReviewState; draft: OutreachDraft | null; outreachDate: string; readyDate: string;
}) {
  switch (state) {
    case "scheduled":
      return <>The AI draft will be ready {shortDate(readyDate)}, {DRAFT_LEAD_DAYS} days before the outreach goes out. Nothing to do until then.</>;
    case "drafting":
      return <>The AI draft is being prepared. If it isn&apos;t reviewed by {shortDate(outreachDate)}, the standard template sends.</>;
    case "needs_review":
      return <>Review this draft before {shortDate(outreachDate)}. If it isn&apos;t approved by then, the standard template sends instead.</>;
    case "approved":
      return <>Approved{draft?.reviewed_at ? ` ${timestamp(draft.reviewed_at)}` : ""}{draft?.edited ? " with edits" : ""}. This email sends {shortDate(outreachDate)}.</>;
    case "skipped":
      return <>Skipped for this cycle. Nothing will send on {shortDate(outreachDate)}.</>;
    case "sent_ai":
      return <>Sent {shortDate(outreachDate)}. Sam approved the AI draft{draft?.edited ? " with edits" : ""}.</>;
    case "sent_template":
      return <>Sent {shortDate(outreachDate)}. The AI draft wasn&apos;t approved in time, so the standard template went out.</>;
    case "skipped_past":
      return <>Skipped. Nothing was sent for this one.</>;
  }
}

function Timeline({
  state, readyDate, outreachDate,
}: {
  state: ReviewState; readyDate: string; outreachDate: string;
}) {
  const steps = [
    { label: "Scheduled", date: null },
    { label: "AI draft ready", date: readyDate },
    { label: "Your review", date: null },
    { label: "Email sends", date: outreachDate },
  ];

  const current =
    state === "scheduled" ? 0
      : state === "drafting" ? 1
      : state === "needs_review" ? 2
      : state === "approved" || state === "skipped" ? 3
      : 4;

  return (
    <div className="px-6 py-3 border-b border-border bg-cream/60 shrink-0">
      <ol className="flex items-center">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={s.label} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    done ? "bg-sage text-white" : active ? "bg-terra text-white" : "bg-white border border-border text-ink-3"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <div className="leading-tight">
                  <p className={`text-[11px] font-semibold ${active ? "text-ink" : "text-ink-3"}`}>{s.label}</p>
                  {s.date && <p className="text-[10px] text-ink-3">{shortDate(s.date)}</p>}
                </div>
              </div>
              {i < steps.length - 1 && <span className={`flex-1 h-px mx-2 ${done ? "bg-sage" : "bg-border"}`} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
