/**
 * Sam's Dog Grooming — shared vocabulary.
 *
 * Service labels for the whole UI, plus the small staff roster used when an
 * ad hoc request is assigned to someone.
 */

export const BRAND = "Sam's Dog Grooming";

export const SERVICE_LABELS: Record<string, string> = {
  full_groom: "Full Groom",
  brush_nail: "Brush & Nail",
  brush: "Brush",
  bath: "Bath",
  nail_trim: "Nail Trim",
  ear_cleaning: "Ear Cleaning",
  teeth_brushing: "Teeth Brushing",
  deshed_treatment: "De-shed",
  skunk_treatment: "Skunk Treatment",
  paw_pad_trim: "Paw & Pad Trim",
  sanitary_trim: "Sanitary Trim",
};

/** Long forms for the two recurring services. */
export const FULL_GROOM_LONG = "Full Groom";
export const BRUSH_NAIL_LONG = "Brush & Nail Trim";

export function serviceLabel(value: string): string {
  return SERVICE_LABELS[value] ?? value;
}

// ─── Ad hoc request assignment ────────────────────────────────────────────────
// Ad hoc requests are handled in person, not by email. Taking one creates a
// same-day task for whoever on the team should pick it up.

export type StaffRole = "GR" | "BA" | "FD";

export const ROLE_NAMES: Record<StaffRole, string> = {
  GR: "Groomer",
  BA: "Bather",
  FD: "Front Desk",
};

export const TASK_OWNERS: { name: string; role: StaffRole }[] = [
  { name: "Sam Dean", role: "GR" },
  { name: "Maya Ortiz", role: "BA" },
  { name: "Jess Lin", role: "FD" },
];

/**
 * Who the app suggests for each ad hoc service. The groomer can override it —
 * front desk often takes a task when the shop is busy.
 */
export const RECOMMENDED_ROLE: Record<string, StaffRole> = {
  brush:            "GR",
  bath:             "BA",
  nail_trim:        "GR",
  ear_cleaning:     "BA",
  teeth_brushing:   "BA",
  deshed_treatment: "BA",
  skunk_treatment:  "BA",
  paw_pad_trim:     "GR",
  sanitary_trim:    "GR",
};

export function recommendedOwner(serviceType: string): { name: string; role: StaffRole } {
  const role = RECOMMENDED_ROLE[serviceType] ?? "GR";
  return TASK_OWNERS.find((o) => o.role === role) ?? TASK_OWNERS[0];
}
