-- Organisationstype: ejendomsselskab eller almindelig virksomhed.
-- Kør hele scriptet i Supabase → SQL Editor, før I opretter virksomheder i portalen.

-- 1. Ny kolonne (eksisterende kunder bliver ejendomsselskaber)
alter table public.organizations
  add column if not exists org_type text not null default 'property';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_org_type_check') then
    alter table public.organizations
      add constraint organizations_org_type_check check (org_type in ('property', 'company'));
  end if;
end $$;

-- 2. Fjern evt. fast liste over tilladte kategorier på aftaler, så de nye virksomhedskategorier kan gemmes
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.agreements'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%category%'
  loop
    execute format('alter table public.agreements drop constraint %I', c.conname);
  end loop;
end $$;
