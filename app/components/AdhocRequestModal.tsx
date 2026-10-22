"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { todayETString } from "@/lib/utils/dates";
import {
  ROLE_NAMES,
  SERVICE_LABELS,
  TASK_OWNERS,
  recommendedOwner,
  type StaffRole,
} from "@/lib/terms";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AdhocTarget = {
  id: string;
  household_id: string;
  service_type: string;
  note: string | null;
  requested_date: string | null;
  households: { name: string; is_vip: boolean } | null;
};

type Pet = { id: string; name: string; breed: string | null };

const NOTES_PLACEHOLDER =
  "Anything the team should know before this one: handling, sensitivities, coat condition, or what the owner asked for.";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdhocRequestModal({
  request,
  onClose,
  onApplied,
}: {
  request: AdhocTarget;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const supabase = useRef(createClient()).current;

  const [pets, setPets] = useState<Pet[]>([]);
  const [petId, setPetId] = useState("");
  const [ownerName, setOwnerName] = useState(recommendedOwner(request.service_type).name);
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"engage" | "optimize">("engage");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const recommended = recommendedOwner(request.service_type);
  const householdName = request.households?.name ?? "Unknown";
  const serviceLabel = SERVICE_LABELS[request.service_type] ?? request.service_type;
  const owner = TASK_OWNERS.find((o) => o.name === ownerName) ?? recommended;
  const overridden = owner.role !== recommended.role;

  useEffect(() => {
    supabase
      .from("pets")
      .select("id, name, breed")
      .eq("household_id", request.household_id)
      .order("created_at")
      .then(({ data }) => {
        const rows = (data as Pet[]) ?? [];
        setPets(rows);
        const first = rows[0];
        if (first) setPetId(first.id);
      });
  }, [supabase, request.household_id]);

  async function handleApply() {
    setSubmitting(true);
    setError("");
    const today = todayETString();
    const { error: err } = await supabase
      .from("adhoc_requests")
      .update({
        status: "confirmed",
        outreach_date: today,
        engaged_pet_id: petId || null,
        task_owner: owner.name,
        task_role: owner.role as StaffRole,
        task_notes: notes.trim() || null,
        task_created_date: today,
      })
      .eq("id", request.id);

    setSubmitting(false);
    if (err) { setError(err.message); return; }

    const pet = pets.find((p) => p.id === petId);
    onApplied(
      `Task created for ${owner.name} (${owner.role}) — ${householdName}${pet ? ` · ${pet.name}` : ""}`
    );
  }

  const INPUT =
    "w-full px-3 py-2 text-sm border border-border rounded bg-white text-ink focus:outline-none focus:ring-1 focus:ring-terra/40 focus:border-terra/60 transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => !submitting && onClose()} />

      <div className="relative bg-white rounded-xl border border-border shadow-2xl w-full max-w-xl flex flex-col">
        {/* ── Header ── */}
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="text-ink tracking-tight leading-tight"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "18px" }}
            >
              Ad Hoc Request · {householdName}
            </h2>
            <p className="text-[13px] text-ink-2 mt-1">
              <span className="font-bold">Requested:</span> {serviceLabel}
            </p>
            {request.note && (
              <p className="text-[12px] text-ink-3 italic mt-1 leading-snug">{request.note}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {request.households?.is_vip && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-pale text-amber border border-amber/30">
                ◆ VIP
              </span>
            )}
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-1 rounded text-ink-3 hover:text-ink hover:bg-cream transition-colors"
              aria-label="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="px-5 pt-3 border-b border-border flex items-end gap-1">
          <button
            onClick={() => setTab("engage")}
            className={`px-4 py-2 text-[12px] font-bold tracking-wide rounded-t border border-b-0 transition-colors ${
              tab === "engage" ? "bg-white border-border text-ink -mb-px" : "bg-cream border-transparent text-ink-3"
            }`}
          >
            Take it
          </button>
          <button
            disabled
            title="Coming in a later phase"
            className="px-4 py-2 text-[12px] font-bold tracking-wide rounded-t text-ink-3/50 bg-cream/60 cursor-not-allowed"
          >
            Optimize
          </button>
          <span className="ml-auto pb-2 text-[10px] font-semibold tracking-widest text-ink-3 uppercase">
            Handled in person
          </span>
        </div>

        {/* ── Take it tab ── */}
        <div className="px-5 py-5 space-y-4">
          <Field label="Which dog">
            <select
              value={petId}
              onChange={(e) => setPetId(e.target.value)}
              className={INPUT}
            >
              {pets.length === 0 && <option value="">No pets on file</option>}
              {pets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.breed ? ` (${m.breed})` : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-baseline gap-3">
            <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase w-44 shrink-0">
              Suggested
            </span>
            <span className="text-sm text-ink font-medium">
              {ROLE_NAMES[recommended.role]} ({recommended.role})
            </span>
          </div>

          <Field label="Handled by">
            <select
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className={INPUT}
            >
              {TASK_OWNERS.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.name} ({o.role})
                </option>
              ))}
            </select>
            {overridden && (
              <p className="text-[11px] text-amber mt-1">
                Overriding the suggested {ROLE_NAMES[recommended.role]}.
              </p>
            )}
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={NOTES_PLACEHOLDER}
              rows={3}
              className={`${INPUT} resize-none placeholder-ink-3/60 text-[13px] leading-snug`}
            />
          </Field>

          {error && (
            <div className="px-3 py-2 rounded bg-terra-pale border border-terra/30 text-sm text-terra">{error}</div>
          )}

          <p className="text-[12px] text-ink-3 leading-snug bg-cream rounded px-3 py-2.5">
            Ad hoc requests come in between regular services. Some need a call back, others just need to be slotted
            in next time the dog is here — you decide. Taking one creates a task for today so it doesn&apos;t get lost
            on the way to the appointment book.
          </p>
        </div>

        {/* ── Footer ── */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-2">
          <span className="text-[11px] text-ink-3">
            Task dated today · {new Date(todayETString() + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-ink-2 border border-border rounded-lg hover:bg-cream transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={submitting || !petId}
              className="px-5 py-2 text-sm font-semibold bg-sage text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</label>
      {children}
    </div>
  );
}
