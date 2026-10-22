"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NavBar from "./NavBar";
import { SERVICE_LABELS } from "@/lib/terms";
import AdhocRequestModal from "./AdhocRequestModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType =
  | "brush"
  | "bath"
  | "nail_trim"
  | "ear_cleaning"
  | "teeth_brushing"
  | "deshed_treatment"
  | "skunk_treatment"
  | "paw_pad_trim"
  | "sanitary_trim";

type AdhocRequest = {
  id: string;
  household_id: string;
  service_type: ServiceType;
  requested_date: string | null;
  outreach_date: string | null;
  note: string | null;
  created_at: string;
  households: { name: string; is_vip: boolean } | null;
};

type Toast = { message: string; variant: "success" | "error" };

// ─── Config ───────────────────────────────────────────────────────────────────


type ServiceAccent = {
  headerBg: string;  // header background
  iconBg: string;    // small icon dot color
  badgeBg: string;   // count badge background
  badgeText: string; // count badge text
};

const SERVICE_ACCENTS: Record<ServiceType, ServiceAccent> = {
  brush:            { headerBg: "#FAE8C8", iconBg: "#B87A28", badgeBg: "#FAE8C8", badgeText: "#8A5A10" },
  bath:             { headerBg: "#D6EAD8", iconBg: "#2D5E32", badgeBg: "#D6EAD8", badgeText: "#1E4224" },
  nail_trim:        { headerBg: "#EDE5D8", iconBg: "#6B5D52", badgeBg: "#EDE5D8", badgeText: "#3A2E26" },
  ear_cleaning:     { headerBg: "#E4EAF8", iconBg: "#3A5CB8", badgeBg: "#E4EAF8", badgeText: "#2A4494" },
  teeth_brushing:   { headerBg: "#EDE8F5", iconBg: "#6850A8", badgeBg: "#EDE8F5", badgeText: "#4E3880" },
  deshed_treatment: { headerBg: "#F5DDD8", iconBg: "#8B3220", badgeBg: "#F5DDD8", badgeText: "#6A2218" },
  skunk_treatment:  { headerBg: "#F5F0D0", iconBg: "#7A7010", badgeBg: "#F5F0D0", badgeText: "#5A520A" },
  paw_pad_trim:     { headerBg: "#D8EDF5", iconBg: "#1A6080", badgeBg: "#D8EDF5", badgeText: "#124860" },
  sanitary_trim:    { headerBg: "#F5E8D8", iconBg: "#8B5020", badgeBg: "#F5E8D8", badgeText: "#6A3A14" },
};

const SERVICE_TYPE_ORDER: ServiceType[] = [
  "brush",
  "bath",
  "nail_trim",
  "ear_cleaning",
  "teeth_brushing",
  "deshed_treatment",
  "skunk_treatment",
  "paw_pad_trim",
  "sanitary_trim",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ymd: string | null): string {
  if (!ymd) return "No date";
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdhocView() {
  const supabase = useRef(createClient()).current;
  const router = useRouter();

  const [requests, setRequests] = useState<AdhocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [engageTarget, setEngageTarget] = useState<AdhocRequest | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("adhoc_requests")
        .select(
          "id, household_id, service_type, requested_date, note, created_at, households(name, is_vip)"
        )
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      setRequests((data as unknown as AdhocRequest[]) ?? []);
      setLoading(false);
    })();
  }, [supabase]);

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(message: string, variant: Toast["variant"] = "success") {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, variant });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }

  // ── Decline ───────────────────────────────────────────────────────────────

  async function handleDecline(req: AdhocRequest) {
    // Optimistic remove
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    const { error } = await supabase
      .from("adhoc_requests")
      .update({ status: "denied" })
      .eq("id", req.id);
    if (error) {
      // Restore on failure
      setRequests((prev) =>
        [...prev, req].sort((a, b) => a.created_at.localeCompare(b.created_at))
      );
      showToast("Failed to decline request.", "error");
    } else {
      showToast(`Declined request from ${req.households?.name ?? "client"}.`);
    }
  }

  // ── Engage ────────────────────────────────────────────────────────────────

  function handleApplied(message: string) {
    setRequests((prev) => prev.filter((r) => r.id !== engageTarget?.id));
    setEngageTarget(null);
    showToast(message);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const grouped = useMemo(
    () =>
      SERVICE_TYPE_ORDER.map((type) => ({
        type,
        reqs: requests.filter((r) => r.service_type === type),
      })).filter((g) => g.reqs.length > 0),
    [requests]
  );

  const totalPending = requests.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      <NavBar />

      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">

          {/* ── Page header ───────────────────────────────────────────────── */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-ink">Ad Hoc Services</h1>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-sm text-ink-3">Online bookings pending review</p>
                {!loading && totalPending > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-terra text-white">
                    {totalPending}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Loading ───────────────────────────────────────────────────── */}
          {loading && (
            <div className="flex items-center justify-center py-20 text-sm text-ink-3">
              Loading…
            </div>
          )}

          {/* ── Empty state ───────────────────────────────────────────────── */}
          {!loading && grouped.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-3xl mb-3">✓</div>
              <p className="text-lg font-bold text-ink">All clear</p>
              <p className="text-sm text-ink-3 mt-1">No pending requests</p>
            </div>
          )}

          {/* ── Tiles grid ────────────────────────────────────────────────── */}
          {!loading && grouped.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {grouped.map(({ type, reqs }) => (
                <ServiceTile
                  key={type}
                  type={type}
                  requests={reqs}
                  onConfirm={setEngageTarget}
                  onDecline={handleDecline}
                  onNavigate={(id) => router.push(`/clients/${id}?from=adhoc`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Ad hoc request modal ─────────────────────────────────── */}
      {engageTarget && (
        <AdhocRequestModal
          request={engageTarget}
          onClose={() => setEngageTarget(null)}
          onApplied={handleApplied}
        />
      )}

      {/* ── Toast ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.variant === "error"
              ? "bg-terra text-white"
              : "bg-ink text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ─── ServiceTile ──────────────────────────────────────────────────────────────

function ServiceTile({
  type,
  requests,
  onConfirm,
  onDecline,
  onNavigate,
}: {
  type: ServiceType;
  requests: AdhocRequest[];
  onConfirm: (req: AdhocRequest) => void;
  onDecline: (req: AdhocRequest) => void;
  onNavigate: (householdId: string) => void;
}) {
  const accent = SERVICE_ACCENTS[type];

  return (
    <div className="bg-white border border-border rounded-xl flex flex-col h-[260px]">
      {/* Tile header */}
      <div
        className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0 rounded-t-xl"
        style={{ backgroundColor: accent.headerBg }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-sm shrink-0"
            style={{ backgroundColor: accent.iconBg }}
          />
          <span className="font-bold text-sm text-ink">
            {SERVICE_LABELS[type]}
          </span>
        </div>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
          style={{ backgroundColor: accent.badgeBg, color: accent.badgeText, border: `1px solid ${accent.iconBg}33` }}
        >
          {requests.length}
        </span>
      </div>

      {/* Scrollable request list */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {requests.map((req) => (
          <RequestRow
            key={req.id}
            req={req}
            onConfirm={onConfirm}
            onDecline={onDecline}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* Tile footer */}
      <div className="px-4 py-2 border-t border-border shrink-0">
        <span className="text-[11px] text-ink-3">
          {requests.length} pending
        </span>
      </div>
    </div>
  );
}

// ─── RequestRow ───────────────────────────────────────────────────────────────

function RequestRow({
  req,
  onConfirm,
  onDecline,
  onNavigate,
}: {
  req: AdhocRequest;
  onConfirm: (req: AdhocRequest) => void;
  onDecline: (req: AdhocRequest) => void;
  onNavigate: (householdId: string) => void;
}) {
  const name = req.households?.name ?? "Unknown";
  const isVip = req.households?.is_vip ?? false;

  return (
    <div className="px-4 py-2.5 flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        {/* Name + VIP + date */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onNavigate(req.household_id)}
            className="font-bold text-sm text-ink truncate hover:underline cursor-pointer"
          >
            {name}
          </button>
          {isVip && (
            <span
              className="w-2 h-2 rounded-full bg-terra shrink-0 mt-px"
              title="VIP"
            />
          )}
          <span className="text-[11px] text-ink-3 ml-auto shrink-0">
            {formatDate(req.requested_date)}
          </span>
        </div>
        {/* Notes */}
        {req.note && (
          <p className="text-[11px] text-ink-3 italic mt-0.5 leading-snug line-clamp-1">
            {req.note}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        <button
          onClick={() => onConfirm(req)}
          title="Take it"
          className="w-6 h-6 flex items-center justify-center rounded bg-sage-pale text-sage hover:bg-sage hover:text-white transition-colors text-xs font-bold"
        >
          ✓
        </button>
        <button
          onClick={() => onDecline(req)}
          title="Decline"
          className="w-6 h-6 flex items-center justify-center rounded bg-terra-pale text-terra hover:bg-terra hover:text-white transition-colors text-xs font-bold"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
