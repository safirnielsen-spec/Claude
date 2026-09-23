-- Rettelse: "Database error saving new user" ved første login.
-- Kør hele filen én gang i Supabase SQL Editor. Kan køres igen uden skade.

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

