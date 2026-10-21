-- Abonnement: 30 dages prøveperiode, månedlig eller årlig betaling (kort eller faktura), automatisk fornyelse.
-- Kør hele scriptet i Supabase → SQL Editor.

-- 1. Kolonner på organisationen
alter table public.organizations
  add column if not exists billing_interval  text not null default 'month',   -- 'month' | 'year'
  add column if not exists payment_method    text not null default 'invoice', -- 'card' | 'invoice'
  add column if not exists plan_status       text not null default 'trial',    -- 'trial' | 'active' | 'past_due' | 'cancelled' | 'exempt'
  add column if not exists plan_requested_at timestamptz,
  add column if not exists subscribed_at     timestamptz,
  add column if not exists billing_name      text,
  add column if not exists billing_email     text,
  add column if not exists billing_address   text,
  add column if not exists billing_ean       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_plan_check') then
    alter table public.organizations add constraint organizations_plan_check check (
      billing_interval in ('month', 'year') and payment_method in ('card', 'invoice')
      and plan_status in ('trial', 'active', 'past_due', 'cancelled', 'exempt'));
  end if;
end $$;

-- 2. Kunder må ikke selv sætte abonnementsstatus. Kun Core Partners-administratorer (eller SQL Editor) kan.
create or replace function public.guard_plan_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not coalesce((select is_cp_admin from public.profiles where id = auth.uid()), false) then
    new.plan_status := old.plan_status;
    new.subscribed_at := old.subscribed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_plan_status on public.organizations;
create trigger trg_guard_plan_status
  before update on public.organizations
  for each row execute function public.guard_plan_status();

-- 3. Mail til Core Partners, når en kunde vælger eller ændrer abonnement
--    (kræver Resend-nøglen i Vault, som i notify_review_request.sql)
create or replace function public.notify_plan_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  api_key text;
  n int;
begin
  if new.plan_requested_at is null or new.plan_requested_at is not distinct from old.plan_requested_at then
    return new;
  end if;
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if api_key is null then return new; end if;
  select count(*) into n from public.agreements
    where org_id = new.id and status not in ('terminated', 'expired');

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
      'from',    'Core Partners <kontakt@corepartners.dk>',
      'to',      jsonb_build_array('kontakt@corepartners.dk'),
      'subject', 'Abonnement valgt: ' || coalesce(new.name, 'kunde'),
      'text',    'Kunde: ' || coalesce(new.name, '-') || ' (CVR ' || coalesce(new.cvr, '-') || E')\n' ||
                 'Aktive aftaler: ' || n || E'\n' ||
                 'Betaling: ' || case new.billing_interval when 'year' then 'årlig' else 'månedlig' end || ', ' ||
                                 case new.payment_method when 'card' then 'kreditkort' else 'faktura' end || E'\n\n' ||
                 'Faktureringsoplysninger:' || E'\n' ||
                 coalesce(new.billing_name, '-') || E'\n' || coalesce(new.billing_email, '-') || E'\n' ||
                 coalesce(new.billing_address, '-') || E'\nEAN: ' || coalesce(new.billing_ean, '-') || E'\n\n' ||
                 'Åbn i portalen: https://www.corepartners.dk/platform/#/admin')
  );
  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.notify_plan_request() from public, anon, authenticated;
revoke all on function public.guard_plan_status() from public, anon, authenticated;

drop trigger if exists trg_notify_plan_request on public.organizations;
create trigger trg_notify_plan_request
  after update on public.organizations
  for each row execute function public.notify_plan_request();
