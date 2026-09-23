-- ============================================================================
-- Core Partners · Aftaleoverblik — databaseskema (Supabase / Postgres)
--
-- Kør hele filen i Supabase → SQL Editor på et nyt projekt.
-- Filen er idempotent nok til at kunne køres igen efter ændringer af policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabeller
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text not null,
  full_name   text,
  is_cp_admin boolean not null default false,   -- Core Partners-medarbejder: adgang til alle kunder
  created_at  timestamptz not null default now()
);

create table if not exists public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  cvr                text,
  tender_lead_months int  not null default 6 check (tender_lead_months between 1 and 24),
  created_at         timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id  uuid not null references public.organizations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role    text not null default 'editor' check (role in ('owner','editor','viewer')),
  primary key (org_id, user_id)
);

create table if not exists public.invitations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations on delete cascade,
  email      text not null,
  role       text not null default 'editor' check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table if not exists public.portfolios (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations on delete cascade,
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

create table if not exists public.properties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations on delete cascade,
  portfolio_id  uuid references public.portfolios on delete set null,
  name          text not null,
  address       text,
  postal_code   text,
  city          text,
  region        text,
  property_type text,
  area_m2       numeric,
  units         int,
  notes         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.agreements (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations on delete cascade,
  title               text not null,
  category            text not null default 'other',
  supplier            text,
  supplier_contact    text,
  -- property = ejendomsspecifik, portfolio = porteføljeaftale, framework = regional rammeaftale
  scope               text not null default 'property' check (scope in ('property','portfolio','framework')),
  portfolio_id        uuid references public.portfolios on delete set null,
  parent_agreement_id uuid references public.agreements on delete set null,  -- leveranceaftale under rammeaftale
  region              text,
  annual_cost         numeric not null default 0,
  start_date          date,
  end_date            date,
  binding_until       date,
  notice_months       int not null default 3 check (notice_months >= 0),
  auto_renew          boolean not null default true,
  renewal_months      int not null default 12 check (renewal_months >= 0),
  indexation          text,
  indexation_date     date,
  last_tendered       date,
  savings_potential_pct numeric,   -- tom = brug kategoriens standard
  status              text not null default 'active'
                      check (status in ('active','in_review','in_tender','terminated','expired')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.agreement_properties (
  agreement_id uuid not null references public.agreements on delete cascade,
  property_id  uuid not null references public.properties on delete cascade,
  org_id       uuid not null references public.organizations on delete cascade,
  cost_share   numeric,   -- kr./år for denne ejendom; tom = fordeles efter m²
  primary key (agreement_id, property_id)
);

create table if not exists public.tenders (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations on delete cascade,
  agreement_id     uuid references public.agreements on delete set null,
  title            text not null,
  status           text not null default 'planning'
                   check (status in ('planning','material','out','evaluation','negotiation','awarded','cancelled')),
  planned_start    date,
  bid_deadline     date,
  decision_date    date,
  price_weight     int not null default 60 check (price_weight between 0 and 100),
  checklist        jsonb not null default '{}'::jsonb,
  bids             jsonb not null default '[]'::jsonb,
  baseline_cost    numeric,
  awarded_supplier text,
  new_annual_cost  numeric,
  awarded_at       date,
  notes            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.documents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations on delete cascade,
  agreement_id uuid references public.agreements on delete cascade,
  name         text not null,
  storage_path text not null,
  size         bigint,
  uploaded_by  uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.review_requests (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations on delete cascade,
  agreement_id uuid references public.agreements on delete cascade,
  message      text,
  status       text not null default 'new' check (status in ('new','in_progress','done')),
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);

-- Logger udsendte påmindelser, så samme frist ikke mailes to gange.
create table if not exists public.reminders_sent (
  agreement_id  uuid not null references public.agreements on delete cascade,
  deadline      date not null,
  threshold_days int not null,
  sent_at       timestamptz not null default now(),
  primary key (agreement_id, deadline, threshold_days)
);

create index if not exists properties_org_idx  on public.properties (org_id);
create index if not exists agreements_org_idx  on public.agreements (org_id);
create index if not exists ap_org_idx          on public.agreement_properties (org_id);
create index if not exists tenders_org_idx     on public.tenders (org_id);
create index if not exists documents_org_idx   on public.documents (org_id);
create index if not exists requests_org_idx    on public.review_requests (org_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Opretter profilen, når en bruger oprettes. Fejl må aldrig blokere login:
-- de logges som advarsel, og ensure_profile() opretter profilen ved første login.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.profiles (id, email) values (new.id, lower(coalesce(new.email, '')))
    on conflict (id) do nothing;
  exception when others then
    raise warning 'handle_new_user: %', sqlerrm;
  end;
  return new;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant select, insert on public.profiles to supabase_auth_admin;
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists agreements_touch on public.agreements;
create trigger agreements_touch before update on public.agreements
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Adgangsfunktioner
-- ---------------------------------------------------------------------------

create or replace function public.is_cp_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_cp_admin from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.has_org_access(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_cp_admin()
      or exists (select 1 from public.memberships m where m.org_id = o and m.user_id = auth.uid())
$$;

create or replace function public.can_edit_org(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_cp_admin()
      or exists (select 1 from public.memberships m
                 where m.org_id = o and m.user_id = auth.uid() and m.role in ('owner','editor'))
$$;

create or replace function public.is_org_owner(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_cp_admin()
      or exists (select 1 from public.memberships m
                 where m.org_id = o and m.user_id = auth.uid() and m.role = 'owner')
$$;

-- Sikrer at den indloggede bruger har en profil (backup for handle_new_user).
create or replace function public.ensure_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.profiles (id, email) values (auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')))
  on conflict (id) do nothing;
end $$;

-- Opret organisation og gør den aktuelle bruger til ejer.
create or replace function public.create_organization(p_name text, p_cvr text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform public.ensure_profile();
  insert into public.organizations (name, cvr) values (p_name, p_cvr) returning id into new_id;
  insert into public.memberships (org_id, user_id, role) values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

-- Omdan ventende invitationer til den indloggede brugers e-mail til medlemskaber.
create or replace function public.accept_invitations()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.ensure_profile();
  insert into public.memberships (org_id, user_id, role)
  select i.org_id, auth.uid(), i.role from public.invitations i
  where lower(i.email) = lower(auth.jwt() ->> 'email')
  on conflict (org_id, user_id) do nothing;
  get diagnostics n = row_count;
  delete from public.invitations where lower(email) = lower(auth.jwt() ->> 'email');
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles             enable row level security;
alter table public.organizations        enable row level security;
alter table public.memberships          enable row level security;
alter table public.invitations          enable row level security;
alter table public.portfolios           enable row level security;
alter table public.properties           enable row level security;
alter table public.agreements           enable row level security;
alter table public.agreement_properties enable row level security;
alter table public.tenders              enable row level security;
alter table public.documents            enable row level security;
alter table public.review_requests      enable row level security;
alter table public.reminders_sent       enable row level security;   -- kun service role

-- Profiler: egen profil, kolleger i samme organisation, eller CP-admin.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or public.is_cp_admin()
  or exists (select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
             where a.user_id = auth.uid() and b.user_id = profiles.id)
);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid());
-- Brugere må kun ændre deres navn, aldrig is_cp_admin.
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

drop policy if exists orgs_select on public.organizations;
create policy orgs_select on public.organizations for select using (public.has_org_access(id));
drop policy if exists orgs_update on public.organizations;
create policy orgs_update on public.organizations for update using (public.is_org_owner(id));
drop policy if exists orgs_delete on public.organizations;
create policy orgs_delete on public.organizations for delete using (public.is_org_owner(id));

drop policy if exists members_select on public.memberships;
create policy members_select on public.memberships for select using (public.has_org_access(org_id));
drop policy if exists members_write on public.memberships;
create policy members_write on public.memberships for all
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

drop policy if exists invitations_all on public.invitations;
create policy invitations_all on public.invitations for all
  using (public.is_org_owner(org_id)) with check (public.is_org_owner(org_id));

-- Fælles mønster for alle organisationsdata: læs = medlem, skriv = owner/editor.
do $$
declare t text;
begin
  foreach t in array array['portfolios','properties','agreements','agreement_properties',
                           'tenders','documents','review_requests'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (public.has_org_access(org_id))', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.can_edit_org(org_id)) with check (public.can_edit_org(org_id))', t);
  end loop;
end $$;

-- Læsere (viewer) må stadig bede Core Partners om en vurdering.
drop policy if exists review_requests_insert_viewer on public.review_requests;
create policy review_requests_insert_viewer on public.review_requests for insert
  with check (public.has_org_access(org_id));

-- ---------------------------------------------------------------------------
-- Fillager til kontrakter: sti = {org_id}/{agreement_id}/{filnavn}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects for select using (
  bucket_id = 'documents' and public.has_org_access(((storage.foldername(name))[1])::uuid)
);
drop policy if exists documents_write on storage.objects;
create policy documents_write on storage.objects for insert with check (
  bucket_id = 'documents' and public.can_edit_org(((storage.foldername(name))[1])::uuid)
);
drop policy if exists documents_delete on storage.objects;
create policy documents_delete on storage.objects for delete using (
  bucket_id = 'documents' and public.can_edit_org(((storage.foldername(name))[1])::uuid)
);

-- ---------------------------------------------------------------------------
-- Daglige påmindelser (valgfrit — kræver at edge-funktionen er deployet)
--
-- Aktivér extensions pg_cron og pg_net under Database → Extensions, og kør:
--
-- select cron.schedule('deadline-reminders', '0 6 * * *', $$
--   select net.http_post(
--     url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/deadline-reminders',
--     headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>',
--                                   'Content-Type', 'application/json'),
--     body    := '{}'::jsonb);
-- $$);
--
-- Gør en Core Partners-medarbejder til admin:
--   update public.profiles set is_cp_admin = true where email = 'navn@corepartners.dk';
-- ---------------------------------------------------------------------------
