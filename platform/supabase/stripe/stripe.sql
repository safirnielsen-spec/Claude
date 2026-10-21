-- Stripe-forbindelse: kolonner til kunde- og abonnements-id fra Stripe.
-- Kør i Supabase → SQL Editor efter subscription.sql.

alter table public.organizations
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id text;

-- Kunder må hverken sætte abonnementsstatus eller Stripe-id'er. Kun Core Partners-administratorer, SQL Editor og Edge Functions.
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
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_plan_status() from public, anon, authenticated;
