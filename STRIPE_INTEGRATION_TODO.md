# Stripe Checkout – status og resterende trin

Stripe Checkout (hosted) er koblet på den eksisterende Edge Function
[platform/supabase/stripe/functions/create-checkout/index.ts](platform/supabase/stripe/functions/create-checkout/index.ts).
Der fandtes allerede et kald til `checkout/sessions`, så kun dets parametre er justeret til Checkout Studio.
Ingen nye filer eller ruter er oprettet til selve kaldet.

## Values to Replace

Ingen af værdierne er pladsholdere, men de afhænger af opsætning i Stripe og Supabase:

**Files containing these values:**
- [platform/supabase/stripe/functions/create-checkout/index.ts](platform/supabase/stripe/functions/create-checkout/index.ts)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `subscription` | Uændret. Platformen sælger abonnementer. |
| success_url | `${SITE_URL}/platform/#/indstillinger` | `SITE_URL` er en hemmelighed i Supabase (Edge Functions → Secrets), fx `https://www.corepartners.dk`. |
| cancel_url | `${SITE_URL}/platform/#/indstillinger` | Samme som ovenfor. |
| line_items[].price | Slås op via lookup key `platform_<trin>_<month/year>` | Opret de seks priser i Stripe (Product catalog) med præcis disse lookup keys: `platform_start_month`, `platform_start_year`, `platform_vaekst_month`, `platform_vaekst_year`, `platform_portefolje_month`, `platform_portefolje_year`. |

## Configured Parameters

Disse parametre kommer fra Checkout Studio og er sat i kaldet.

**Files containing these parameters:**
- [platform/supabase/stripe/functions/create-checkout/index.ts](platform/supabase/stripe/functions/create-checkout/index.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | hosted_page |
| billing_address_collection | auto |
| phone_number_collection | enabled: false |
| automatic_tax | enabled: false |
| allow_promotion_codes | false |
| payment_method_collection | always |
| submit_type | auto |
| integration_identifier | hosted_web_0001 |
| origin_context | web |

### Bemærkninger
- **`ui_mode`**: Koden kalder Stripes REST API direkte (ingen SDK), så SDK-versionen kan ikke aflæses. `hosted_page` er valgt som standard. Afviser Stripe værdien med en fejl om ugyldig `ui_mode`, så skift til `hosted`. API-versionen er ikke fastlagt i koden.
- **Parametre uden for Checkout Studio er bevaret**, fordi de er forretningslogik: `client_reference_id`, `metadata.org_id` og `subscription_data` (kobler betalingen til organisationen og styrer 30 dages prøve) samt `customer_email` og `locale: 'da'`. Uden dem kan webhooken ikke opdatere den rigtige organisation.
- **Moms:** `automatic_tax` er slået fra i Checkout, så Stripe lægger ikke moms oveni. Priserne er ekskl. moms. Faktura-sporet (`send_invoice`) bruger stadig `STRIPE_AUTOMATIC_TAX`; lad den stå tom, så kort og faktura opfører sig ens.
- **Kontrolleret syntaks, ikke kørt:** Funktionen er ikke kørt mod Stripe endnu.

## Setup

Hemmeligheder gemmes i Supabase → Edge Functions → Secrets (aldrig i filer eller i chat):

| Navn | Indhold |
|------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_…` (senere `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` fra webhook-endpointet |
| `SITE_URL` | `https://www.corepartners.dk` |

Den offentlige nøgle (`pk_test_…`) ligger i [platform/config.js](platform/config.js) og bruges ikke af Checkout-flowet.

Opsætning i øvrigt: se [platform/supabase/stripe/README.md](platform/supabase/stripe/README.md).

## Project structure

```
platform/
  config.js                          stripeCheckout: true tænder Stripe i portalen
  app.js                             kalder create-checkout og billing-portal
  supabase/
    subscription.sql, stripe/stripe.sql        kolonner og beskyttelse af status
    stripe/functions/create-checkout/          opretter Checkout Session (kort) og faktura-abonnement
    stripe/functions/billing-portal/           sender kunden til Stripes kundeportal
    stripe/functions/stripe-webhook/           opdaterer plan_status ud fra Stripe-events
    stripe/setup-prices.mjs                    valgfrit script til at oprette priserne
```

## How it works

1. Kunden vælger trin og betaling under Indstillinger → Abonnement.
2. Portalen kalder `create-checkout`. Funktionen kontrollerer login og ejerrolle, tæller aktive aftaler og vælger trin.
3. Kort: kunden sendes til Stripes betalingsside og tilbage til portalen. Faktura: Stripe sender fakturaen på mail.
4. `stripe-webhook` modtager events og sætter `plan_status` (Prøveperiode, Aktivt, Betaling mangler, Opsagt).

## Testing

- Sandbox/testtilstand: kort `4242 4242 4242 4242`, vilkårlig fremtidig dato og CVC.
- Afvist kort: `4000 0000 0000 0002`. Krav om 3D Secure: `4000 0025 0000 3155`.
- Tjek bagefter at organisationen i Supabase har `stripe_customer_id`, og at webhook-kald er markeret OK under Developers → Webhooks.

## Next steps

- Gå live: opret priser og webhook i live-tilstand, og skift `STRIPE_SECRET_KEY` og `STRIPE_WEBHOOK_SECRET`.
- Afklar moms (Stripe Tax eller manuel håndtering).
- Opdatér priser: opret nye priser i Stripe med samme lookup key (flyt lookup key til den nye pris).
- Fakturaer med EAN (offentlige kunder) håndteres manuelt, da Stripe ikke understøtter EAN.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
