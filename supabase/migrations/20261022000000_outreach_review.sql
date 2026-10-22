-- Sam's Dog Grooming — AI-drafted reminder emails with groomer review,
-- plus staff assignment for ad hoc requests.
--
-- Scheduling runs on its own: each due service already has an outreach date
-- about six weeks ahead. What's new is the content review — a draft is written
-- 7 days before that date, and if it hasn't been approved by then the
-- pre-approved standard template goes out instead. Ad hoc requests are handled
-- in person, so they never get a draft.

-- ─── Outreach drafts ──────────────────────────────────────────────────────────
-- One active draft per upcoming service (source_id = service_clocks.id):
--   source = 'full_groom'  → the next full groom
--   source = 'brush_nail'  → the next brush & nail trim

create table if not exists outreach_drafts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source       text not null check (source in ('full_groom', 'brush_nail')),
  source_id    uuid not null,
  subject      text not null,
  body         text not null,
  status       text not null default 'needs_review'
               check (status in ('needs_review', 'approved', 'skipped')),
  edited       boolean not null default false,
  reviewed_at  timestamptz,
  generated_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists idx_outreach_drafts_household_id on outreach_drafts(household_id);
create index if not exists idx_outreach_drafts_status on outreach_drafts(status);

alter table outreach_drafts enable row level security;
create policy "Allow all on outreach_drafts" on outreach_drafts for all using (true) with check (true);

-- ─── Ad hoc request assignment ────────────────────────────────────────────────
-- Taking an ad hoc request creates a same-day task: which pet it's for, who on
-- the team picks it up, and any handling notes.

alter table adhoc_requests
  add column if not exists engaged_pet_id uuid references pets(id) on delete set null,
  add column if not exists task_owner text,
  add column if not exists task_role text check (task_role in ('GR', 'BA', 'FD')),
  add column if not exists task_notes text,
  add column if not exists task_created_date date;

create index if not exists idx_adhoc_requests_task_owner on adhoc_requests(task_owner);

-- ─── Assigned staff ───────────────────────────────────────────────────────────
-- "owner" already means the dog's owner, so the staff member a client is
-- assigned to gets its own column.

alter table households
  add column if not exists staff_name text,
  add column if not exists staff_role text check (staff_role in ('GR', 'BA', 'FD'));
