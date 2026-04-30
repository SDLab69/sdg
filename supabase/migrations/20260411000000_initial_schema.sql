-- Sam's Dog Grooming — Initial Schema
-- Safe to run against an existing Supabase project.
-- Does NOT touch any tables outside this migration.

-- ─── Enums ─────────────────────────────────────────────────────────────────────

create type sdg_service_type as enum (
  'full_groom',
  'brush_nail',
  'brush',
  'bath',
  'nail_trim',
  'ear_cleaning',
  'teeth_brushing',
  'deshed_treatment',
  'skunk_treatment',
  'paw_pad_trim',
  'sanitary_trim'
);
create type sdg_request_status as enum ('pending', 'confirmed', 'denied');

-- ─── Households ────────────────────────────────────────────────────────────────
-- One row per client family / owner

create table households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text,
  address    text,
  is_vip     boolean not null default false,
  created_at timestamptz not null default now()
);

-- ─── Pets ──────────────────────────────────────────────────────────────────────
-- One or more pets per household

create table pets (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  name            text not null,
  breed           text,
  age             numeric,           -- years
  weight          numeric,           -- lbs
  grooming_notes  text,
  created_at      timestamptz not null default now()
);

-- ─── Service Clocks ────────────────────────────────────────────────────────────
-- Tracks service history and computed due dates per household.
-- One row per household (upsert on update).
-- Business rules:
--   • Brush & nail every 6 months → next_brush_due = last_visit + 6 months
--   • Full groom every 12 months  → next_full_groom_due = last_full_groom + 12 months
--   • A full groom resets both clocks

create table service_clocks (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null unique references households(id) on delete cascade,
  last_visit          date,
  last_full_groom     date,
  next_brush_due      date,
  next_full_groom_due date,
  updated_at          timestamptz not null default now()
);

-- ─── Appointments ──────────────────────────────────────────────────────────────
-- Scheduled appointments (Mon–Fri only, enforced in app logic)

create table appointments (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  date         date not null,
  time         time not null,
  duration     int,                  -- minutes
  service_type sdg_service_type not null,
  notes        text,
  is_adhoc     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ─── Ad-hoc Requests ───────────────────────────────────────────────────────────
-- Client-initiated requests outside the regular schedule

create table adhoc_requests (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  service_type   sdg_service_type not null,
  requested_date date,
  note           text,
  status         sdg_request_status not null default 'pending',
  created_at     timestamptz not null default now()
);

-- ─── Outreach Log ──────────────────────────────────────────────────────────────
-- Written automatically when a due-date alert passes end-of-day without action.
-- Backend/admin visibility only — no client-facing UI.

create table outreach_log (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  service_type   sdg_service_type not null,
  triggered_date date not null,
  created_at     timestamptz not null default now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────────

create index idx_pets_household_id              on pets(household_id);
create index idx_service_clocks_household_id    on service_clocks(household_id);
create index idx_service_clocks_brush_due       on service_clocks(next_brush_due);
create index idx_service_clocks_full_groom_due  on service_clocks(next_full_groom_due);
create index idx_appointments_date              on appointments(date);
create index idx_appointments_household_id      on appointments(household_id);
create index idx_adhoc_requests_status          on adhoc_requests(status);
create index idx_adhoc_requests_household_id    on adhoc_requests(household_id);
create index idx_outreach_log_household_id      on outreach_log(household_id);

-- ─── Row Level Security ────────────────────────────────────────────────────────
-- Permissive for now (single-user app).
-- Swap `using (true)` for `using (auth.uid() = owner_id)` when auth is added.

alter table households    enable row level security;
alter table pets          enable row level security;
alter table service_clocks enable row level security;
alter table appointments  enable row level security;
alter table adhoc_requests enable row level security;
alter table outreach_log  enable row level security;

create policy "Allow all on households"     on households     for all using (true) with check (true);
create policy "Allow all on pets"           on pets           for all using (true) with check (true);
create policy "Allow all on service_clocks" on service_clocks for all using (true) with check (true);
create policy "Allow all on appointments"   on appointments   for all using (true) with check (true);
create policy "Allow all on adhoc_requests" on adhoc_requests for all using (true) with check (true);
create policy "Allow all on outreach_log"   on outreach_log   for all using (true) with check (true);
