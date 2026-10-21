-- Mail til Core Partners ved ny henvendelse ("Bed om gennemgang").
-- Kør hele scriptet i Supabase → SQL Editor. Husk først at udfylde Resend-nøglen i trin 2.

-- 1. Aktivér HTTP-udvidelsen (sender mailen asynkront, så kunden ikke venter)
create extension if not exists pg_net with schema extensions;

-- 2. Gem Resend-API-nøglen krypteret i Vault (erstat re_XXXX med din nøgle, og kør kun denne linje én gang)
-- select vault.create_secret('re_XXXX', 'resend_api_key');

-- 3. Funktion og trigger
create or replace function public.notify_review_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  api_key   text;
  org_name  text;
  ag_title  text;
  who       text;
begin
  select decrypted_secret into api_key
    from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  if api_key is null then return new; end if;

  select name  into org_name from public.organizations where id = new.org_id;
  select title into ag_title from public.agreements    where id = new.agreement_id;
  select email into who      from public.profiles      where id = new.created_by;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || api_key,
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object(
                 'from',    'Core Partners <kontakt@corepartners.dk>',
                 'to',      jsonb_build_array('kontakt@corepartners.dk'),
                 'subject', 'Ny henvendelse fra ' || coalesce(org_name, 'en kunde'),
                 'text',    'Kunde: ' || coalesce(org_name, '-') || E'\n' ||
                            'Fra: '   || coalesce(who, '-') || E'\n' ||
                            'Aftale: ' || coalesce(ag_title, 'Generel gennemgang af porteføljen') || E'\n\n' ||
                            'Besked:' || E'\n' || coalesce(new.message, '(ingen besked)') || E'\n\n' ||
                            'Åbn i portalen: https://www.corepartners.dk/platform/#/admin')
  );
  return new;
exception when others then
  -- En fejl i mailen må aldrig blokere, at henvendelsen gemmes.
  return new;
end;
$$;

revoke all on function public.notify_review_request() from public, anon, authenticated;

drop trigger if exists trg_notify_review_request on public.review_requests;
create trigger trg_notify_review_request
  after insert on public.review_requests
  for each row execute function public.notify_review_request();
