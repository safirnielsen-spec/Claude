// Supabase Edge Function: billing-portal
// Sender kunden til Stripes kundeportal (skift kort, se fakturaer, opsig). Aktivér portalen i Stripe → Settings → Billing → Customer portal.
const SB_URL = Deno.env.get('SUPABASE_URL');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SK = Deno.env.get('STRIPE_SECRET_KEY');
const SITE = Deno.env.get('SITE_URL') || 'https://www.corepartners.dk';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Vary': 'Origin' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const sb = path => fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } }).then(r => r.json());

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: req.headers.get('Authorization') || '' } });
    if (!u.ok) return json({ error: 'Ikke logget ind' }, 401);
    const user = await u.json();
    const { org_id } = await req.json();
    const [mem, prof, org] = await Promise.all([
      sb(`memberships?org_id=eq.${org_id}&user_id=eq.${user.id}&select=role`),
      sb(`profiles?id=eq.${user.id}&select=is_cp_admin`),
      sb(`organizations?id=eq.${org_id}&select=stripe_customer_id`)
    ]);
    const isAdmin = !!(prof[0] && prof[0].is_cp_admin);
    if (!isAdmin && !(mem[0] && mem[0].role === 'owner')) return json({ error: 'Kun ejere kan administrere abonnementet' }, 403);
    const customer = org[0] && org[0].stripe_customer_id;
    if (!customer) return json({ error: 'Der er endnu intet abonnement at administrere' }, 400);
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + SK, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer, return_url: `${SITE}/platform/#/indstillinger` })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe-fejl');
    return json({ url: j.url });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
});
