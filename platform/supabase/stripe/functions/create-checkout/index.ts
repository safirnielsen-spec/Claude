// Supabase Edge Function: create-checkout
// Starter abonnement for en organisation: kort via Stripe Checkout, faktura via Stripe Billing (send_invoice).
// Hemmeligheder (Edge Functions → Secrets): STRIPE_SECRET_KEY, SITE_URL (fx https://www.corepartners.dk), evt. STRIPE_AUTOMATIC_TAX=1
const STRIPE = 'https://api.stripe.com/v1';
const SB_URL = Deno.env.get('SUPABASE_URL');
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SK = Deno.env.get('STRIPE_SECRET_KEY');
const SITE = Deno.env.get('SITE_URL') || 'https://www.corepartners.dk';
const cors = { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Vary': 'Origin' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function form(obj) {
  const p = new URLSearchParams();
  const add = (k, v) => {
    if (v && typeof v === 'object') Object.entries(v).forEach(([a, b]) => add(`${k}[${a}]`, b));
    else if (v !== undefined && v !== null && v !== '') p.append(k, String(v));
  };
  Object.entries(obj).forEach(([k, v]) => add(k, v));
  return p;
}
async function stripe(path, method = 'GET', body) {
  const r = await fetch(STRIPE + path + (method === 'GET' && body ? '?' + form(body) : ''), {
    method, headers: { Authorization: 'Bearer ' + SK, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? form(body) : undefined
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Stripe-fejl');
  return j;
}
const sb = (path, init = {}) => fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // 1. Hvem kalder?
    const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: req.headers.get('Authorization') || '' } });
    if (!u.ok) return json({ error: 'Ikke logget ind' }, 401);
    const user = await u.json();
    const { org_id, interval, method } = await req.json();
    if (!['month', 'year'].includes(interval) || !['card', 'invoice'].includes(method)) return json({ error: 'Ugyldigt valg' }, 400);

    // 2. Må brugeren styre abonnementet? (ejer af organisationen eller Core Partners-administrator)
    const [mem, prof] = await Promise.all([
      sb(`memberships?org_id=eq.${org_id}&user_id=eq.${user.id}&select=role`).then(r => r.json()),
      sb(`profiles?id=eq.${user.id}&select=is_cp_admin`).then(r => r.json())
    ]);
    const isAdmin = !!(prof[0] && prof[0].is_cp_admin);
    if (!isAdmin && !(mem[0] && mem[0].role === 'owner')) return json({ error: 'Kun ejere kan vælge abonnement' }, 403);

    // 3. Organisation og trin (trinnet beregnes på serveren ud fra antal aktive aftaler)
    const org = (await sb(`organizations?id=eq.${org_id}&select=*`).then(r => r.json()))[0];
    if (!org) return json({ error: 'Organisation findes ikke' }, 404);
    const cnt = await sb(`agreements?org_id=eq.${org_id}&status=not.in.(terminated,expired)&select=id`, { headers: { Prefer: 'count=exact', Range: '0-0' } });
    const n = Number((cnt.headers.get('content-range') || '0-0/0').split('/')[1]) || 0;
    const plan = n <= 10 ? 'start' : n <= 50 ? 'vaekst' : 'portefolje';
    const prices = await stripe('/prices', 'GET', { 'lookup_keys[0]': `platform_${plan}_${interval}`, active: 'true' });
    const price = prices.data[0];
    if (!price) return json({ error: `Prisen platform_${plan}_${interval} findes ikke i Stripe. Opret prisen med denne lookup key.` }, 500);

    // 4. Resterende prøveperiode (30 dage fra oprettelse)
    const trialEnd = new Date(org.created_at).getTime() + 30 * 86400000;
    const trialDays = Math.ceil((trialEnd - Date.now()) / 86400000);
    const email = org.billing_email || user.email;
    const tax = Deno.env.get('STRIPE_AUTOMATIC_TAX') === '1' ? { 'automatic_tax[enabled]': 'true' } : {};

    if (method === 'card') {
      const session = await stripe('/checkout/sessions', 'POST', {
        // Fastsat i Checkout Studio
        ui_mode: 'hosted_page', billing_address_collection: 'auto', phone_number_collection: { enabled: false },
        automatic_tax: { enabled: false }, allow_promotion_codes: false, payment_method_collection: 'always', submit_type: 'auto',
        integration_identifier: 'hosted_web_0001', origin_context: 'web',
        // Egen logik: abonnement, kobling til organisationen og prøveperiode
        mode: 'subscription', client_reference_id: org_id, customer_email: email,
        line_items: { 0: { price: price.id, quantity: 1 } },
        subscription_data: { metadata: { org_id }, ...(trialDays > 0 ? { trial_period_days: Math.max(1, trialDays) } : {}) },
        metadata: { org_id }, locale: 'da',
        success_url: `${SITE}/platform/#/indstillinger`, cancel_url: `${SITE}/platform/#/indstillinger`
      });
      return json({ url: session.url });
    }

    // Faktura: kunde + abonnement, som Stripe fakturerer på mail (forfald 14 dage)
    let customer = org.stripe_customer_id;
    if (!customer) {
      const c = await stripe('/customers', 'POST', {
        name: org.billing_name || org.name, email, metadata: { org_id, cvr: org.cvr || '', ean: org.billing_ean || '' },
        address: { line1: org.billing_address || '', country: 'DK' }
      });
      customer = c.id;
      await sb(`organizations?id=eq.${org_id}`, { method: 'PATCH', body: JSON.stringify({ stripe_customer_id: customer }) });
    }
    const sub = await stripe('/subscriptions', 'POST', {
      customer, items: { 0: { price: price.id } }, collection_method: 'send_invoice', days_until_due: 14,
      metadata: { org_id }, ...(trialDays > 0 ? { trial_end: Math.floor(trialEnd / 1000) } : {}), ...tax
    });
    await sb(`organizations?id=eq.${org_id}`, { method: 'PATCH', body: JSON.stringify({ stripe_subscription_id: sub.id }) });
    return json({ ok: true, message: trialDays > 0 ? 'Tak! Første faktura sendes, når prøveperioden udløber.' : 'Tak! Fakturaen sendes på mail.' });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
});
