/**
 * Translates a single Filter object into a Supabase PostgREST query modifier.
 *
 * Shared between the test harness (run-tests.ts) and the API route
 * (app/api/filter/route.ts). Keep this file free of Node-only or
 * browser-only imports so it runs in both environments.
 *
 * The query `q` is typed as `any` because the Supabase query builder uses
 * a deeply nested generic chain that varies per call-site. The runtime
 * behavior is what matters here.
 */

import { Filter } from "./filter-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilter(q: any, f: Filter): any {
  const [table, col] = f.field.split(".");

  // Map filter field namespaces to the PostgREST column path used in
  // nested selects: household → bare column, pet → pets.col,
  // service → service_clocks.col, appointment → appointments.col
  let key: string;
  switch (table) {
    case "household":
      key = col;
      break;
    case "pet":
      key = `pets.${col}`;
      break;
    case "service":
      key = `service_clocks.${col}`;
      break;
    case "appointment":
      key = `appointments.${col}`;
      break;
    default:
      return q;
  }

  switch (f.op) {
    case "equals":
      return q.eq(key, f.value);
    case "contains":
      // medical_flags is a text array — use array contains, not ilike
      if (f.field === "pet.medical_flags") {
        return q.contains(key, [f.value as string]);
      }
      return q.ilike(key, `%${f.value}%`);
    case "contains_any":
      return q.overlaps(key, f.value as string[]);
    case "contains_all":
      return q.contains(key, f.value as string[]);
    case "greater_than":
      return q.gt(key, f.value);
    case "less_than":
      return q.lt(key, f.value);
    case "before":
      return q.lt(key, f.value);
    case "after":
      return q.gt(key, f.value);
    case "between": {
      const [a, b] = f.value as [unknown, unknown];
      return q.gte(key, a).lte(key, b);
    }
    case "in_list":
      return q.in(key, f.value as string[]);
    default:
      return q;
  }
}
