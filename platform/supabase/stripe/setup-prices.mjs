// Opretter produktet og de seks priser i Stripe (tre trin x måned/år, DKK, ekskl. moms).
// Kør lokalt:  STRIPE_SECRET_KEY=sk_test_... node setup-prices.mjs
// Brug en test-nøgle først. Nøglen må ikke gemmes i filer eller deles.
const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('Sæt STRIPE_SECRET_KEY'); process.exit(1); }

const api = async (path, params) => {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ': ' + (j.error && j.error.message));
  return j;
};

const PLANS = [
  { key: 'start', name: 'Core Partners platform – Start (op til 10 aftaler)', month: 295 },
  { key: 'vaekst', name: 'Core Partners platform – Vækst (op til 50 aftaler)', month: 695 },
  { key: 'portefolje', name: 'Core Partners platform – Portefølje (over 50 aftaler)', month: 1295 }
];

for (const p of PLANS) {
  const prod = await api('/products', { name: p.name });
  for (const interval of ['month', 'year']) {
    const amount = (interval === 'year' ? p.month * 10 : p.month) * 100; // årlig = 10 måneder
    const price = await api('/prices', {
      product: prod.id, currency: 'dkk', unit_amount: String(amount), tax_behavior: 'exclusive',
      'recurring[interval]': interval, lookup_key: `platform_${p.key}_${interval}`, transfer_lookup_key: 'true'
    });
    console.log(price.lookup_key, price.id, amount / 100, 'kr.');
  }
}
