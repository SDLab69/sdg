"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NewClientModal from "./NewClientModal";
import { BRAND } from "@/lib/terms";

const NAV_ITEMS = [
  { label: "CALENDAR", href: "/" },
  { label: "CLIENTS", href: "/clients" },
  { label: "AD HOC", href: "/adhoc" },
];

export default function NavBar() {
  const pathname = usePathname();
  const supabase = useRef(createClient()).current;

  const [menuOpen, setMenuOpen] = useState(false);
  const [totalClients, setTotalClients] = useState<number | null>(null);
  const [pendingAdhoc, setPendingAdhoc] = useState(0);
  const [showNewClientModal, setShowNewClientModal] = useState(false);

  async function fetchClientCount() {
    const { count } = await supabase
      .from("households")
      .select("*", { count: "exact", head: true });
    setTotalClients(count ?? 0);
  }

  useEffect(() => {
    Promise.all([
      supabase.from("households").select("*", { count: "exact", head: true }),
      supabase
        .from("adhoc_requests")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending"),
    ]).then(([{ count: hCount }, { count: aCount }]) => {
      setTotalClients(hCount ?? 0);
      setPendingAdhoc(aCount ?? 0);
    });

    const channel = supabase
      .channel("navbar-adhoc-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adhoc_requests" },
        () => {
          supabase
            .from("adhoc_requests")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
            .then(({ count }) => setPendingAdhoc(count ?? 0));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-border shrink-0">

        {/* Row 1: hamburger | brand | client actions */}
        <div className="px-4 h-11 flex items-center relative">

          {/* Hamburger — left */}
          <button
            onClick={() => setMenuOpen(true)}
            className="p-1.5 rounded text-ink hover:bg-cream transition-colors shrink-0"
            aria-label="Open navigation menu"
          >
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden>
              <rect y="0"  width="18" height="2" rx="1" fill="currentColor" />
              <rect y="6"  width="18" height="2" rx="1" fill="currentColor" />
              <rect y="12" width="18" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>

          {/* Brand — centered absolutely */}
          <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none select-none flex items-baseline">
            <span
              className="text-ink tracking-tight"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "28px" }}
            >
              {BRAND}
            </span>
          </div>

          {/* Client actions — right */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {totalClients !== null && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-cream-2 text-ink-3 border border-border whitespace-nowrap">
                {totalClients.toLocaleString()} clients
              </span>
            )}
            <button
              onClick={() => setShowNewClientModal(true)}
              className="px-3 py-1.5 text-[11px] font-bold tracking-wide bg-terra text-white rounded hover:opacity-90 transition-opacity whitespace-nowrap"
            >
              + New Client
            </button>
          </div>
        </div>

        {/* Row 2: nav pills — centered */}
        <div className="flex justify-center gap-1 pb-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`relative px-3 py-1 text-[11px] font-bold tracking-widest rounded transition-colors ${
                isActive(item.href)
                  ? "bg-cream-2 text-ink"
                  : "text-ink-3 hover:text-ink hover:bg-cream"
              }`}
            >
              {item.label}
              {item.href === "/adhoc" && pendingAdhoc > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-terra text-white text-[9px] font-bold leading-none">
                  {pendingAdhoc > 99 ? "99+" : pendingAdhoc}
                </span>
              )}
            </Link>
          ))}
        </div>
      </header>

      {/* ── Drawer overlay ──────────────────────────────────────────────────── */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[2px]"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ── Slide-out drawer ────────────────────────────────────────────────── */}
      <div
        className={`fixed left-0 top-0 h-full w-52 z-50 bg-white border-r border-border shadow-xl flex flex-col transition-transform duration-200 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Drawer header */}
        <div className="px-4 py-3.5 border-b border-border flex items-center justify-between shrink-0">
          <span
            className="text-ink tracking-tight"
            style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "17px" }}
          >
            {BRAND}
          </span>
          <button
            onClick={() => setMenuOpen(false)}
            className="p-1 rounded text-ink-3 hover:text-ink hover:bg-cream transition-colors"
            aria-label="Close menu"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Drawer nav */}
        <nav className="px-3 py-3 space-y-0.5 flex-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className={`flex items-center justify-between px-3 py-2.5 rounded text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? "bg-cream-2 text-ink"
                  : "text-ink-2 hover:bg-cream hover:text-ink"
              }`}
            >
              <span>{item.label.charAt(0) + item.label.slice(1).toLowerCase()}</span>
              {item.href === "/adhoc" && pendingAdhoc > 0 && (
                <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-terra text-white text-[10px] font-bold leading-none">
                  {pendingAdhoc > 99 ? "99+" : pendingAdhoc}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {/* Drawer footer */}
        {totalClients !== null && (
          <div className="px-6 py-4 border-t border-border shrink-0">
            <span className="text-xs text-ink-3">
              {totalClients.toLocaleString()} clients on file
            </span>
          </div>
        )}
      </div>

      {/* ── New Client Modal ─────────────────────────────────────────────────── */}
      {showNewClientModal && (
        <NewClientModal
          onClose={() => setShowNewClientModal(false)}
          onSuccess={fetchClientCount}
        />
      )}
    </>
  );
}
