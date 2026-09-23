# Aftaleoverblik: Core Partners kundeportal

Webplatform hvor kunder holder styr på driftsaftaler på tværs af ejendomme og porteføljer:
opsigelsesfrister, genforhandling, udbud og hvilke aftaler der bedst kan betale sig at se på først.

Platformen ligger på `/platform/` og linkes fra hovedsidens menu ("Kundeportal").

## Funktioner

| Område | Indhold |
|---|---|
| **Overblik** | Årlige driftsudgifter, estimeret besparelsespotentiale, frister de næste 6 mdr., realiserede besparelser, top 5-prioriteter og kommende frister |
| **Aftaler** | Register med kategori, leverandør, pris, datoer, opsigelsesvarsel, automatisk forlængelse, binding, indeksregulering og sidst udbudt. Filtrering, sortering og CSV-eksport |
| **Aftaletyper** | *Ejendomsspecifik*, *porteføljeaftale* (gælder automatisk alle porteføljens ejendomme) og *regional rammeaftale* med leveranceaftaler under sig. Prisen kan fordeles med faste beløb pr. ejendom, ellers efter m² |
| **Frister** | Beregner *sidste opsigelsesdag* (også når aftalen allerede er forlænget automatisk), udløb og *anbefalet udbudsstart* (standard 6 mdr. før fristen, kan ændres pr. organisation) |
| **Prioritering** | Score = pris × kategoriens typiske besparelse × hastegrad (frist) × alder (år siden sidste udbud). Viser estimeret besparelse og Core Partners-honorar |
| **Porteføljer** | Nøgletal pr. portefølje og automatiske forslag til regionale rammeaftaler, når flere aftaler om samme ydelse i samme region kan samles |
| **Ejendomme** | Driftsudgift pr. ejendom og pr. m², og hvilke aftaler der dækker ejendommen (direkte, via portefølje eller via rammeaftale) |
| **Tidslinje** | Frister, udbudsstart, periodeslut og indeksreguleringer måned for måned. Eksport til Outlook/Google Kalender (.ics med påmindelse 14 dage før) |
| **Udbud** | Tjekliste i 4 faser (19 punkter), tilbudsevaluering med vægtning af pris/kvalitet, og tildeling der automatisk opdaterer aftalen og registrerer besparelsen |
| **Import/eksport** | Excel-skabeloner (CSV), import af ejendomme og aftaler, eksport til Excel og fuld JSON-backup |
| **Brugere** | Flere organisationer pr. bruger, roller (ejer/redaktør/læser) og invitation pr. e-mail |
| **Core Partners admin** | Alle kunder samlet: pipeline af frister de næste 9 mdr. med potentiale og honorar, og indbakke med kundernes anmodninger om vurdering |
| **Påmindelser** | Daglig e-mail til kunden 180, 90, 30 og 7 dage før hver frist, og en samlet oversigt til Core Partners |

## Demo-tilstand

Uden opsætning kører platformen i demo-tilstand med eksempeldata, der kun gemmes i browseren.
Når Supabase er sat op, kan demoen stadig åbnes via `platform/?demo`, f.eks. til salgsmøder.
Åbn `platform/index.html` via en webserver, f.eks. `python3 -m http.server`, og gå til `http://localhost:8000/platform/`.

## Idriftsættelse med Supabase

1. **Opret projekt** på [supabase.com](https://supabase.com). Vælg EU-region (f.eks. Frankfurt) af hensyn til GDPR.
2. **Database:** åbn *SQL Editor*, indsæt hele `supabase/schema.sql` og kør den. Den opretter tabeller, adgangsregler (Row Level Security) og fillager til kontrakter.
3. **Login:** under *Authentication → URL Configuration* sættes *Site URL* og *Redirect URLs* til platformens adresse, f.eks. `https://www.corepartners.dk/platform/`.
   Opsæt gerne egen SMTP under *Authentication → Emails*, så login-mails kommer fra jeres domæne.
4. **Forbind appen:** indsæt *Project URL* og *anon public key* fra *Project Settings → API* i `platform/config.js`.
   Anon-nøglen er offentlig og sikker at lægge i koden. Adgangen styres af Row Level Security.
5. **Core Partners-medarbejdere:** log ind én gang, og kør derefter i SQL Editor:
   ```sql
   update public.profiles set is_cp_admin = true where email = 'navn@corepartners.dk';
   ```
6. **E-mailpåmindelser (valgfrit):**
   ```bash
   supabase functions deploy deadline-reminders --no-verify-jwt
   supabase secrets set RESEND_API_KEY=... FROM_EMAIL="Core Partners <frister@corepartners.dk>" \
     APP_URL=https://www.corepartners.dk/platform/ CP_ADMIN_EMAIL=kontakt@corepartners.dk
   ```
   Aktivér derefter `pg_cron` og `pg_net` under *Database → Extensions*, og kør `cron.schedule`-blokken nederst i `schema.sql` med jeres projekt-ref og service role key.

## Sikkerhed

- Alle data er adskilt pr. organisation med Row Level Security i databasen. Klienten kan ikke se andre kunders data.
- Læsere kan se data og bede Core Partners om en vurdering. Redaktører kan også ændre data, og ejere kan desuden administrere brugere.
- Kun Core Partners-admins (`is_cp_admin`) ser på tværs af kunder. Feltet kan ikke ændres af brugerne selv.
- Kontrakter ligger i en privat bucket og hentes via tidsbegrænsede links (5 min.).

## Filer

```
platform/
  index.html   Sideskabelon
  styles.css   Design (Core Partners' farver og typografi)
  config.js    Supabase-nøgler
  core.js      Forretningslogik: frister, prioritering, fordeling, konsolidering, CSV
  store.js     Datalag (demo/localStorage og Supabase)
  app.js       Visninger og handlinger
supabase/
  schema.sql                           Database, adgangsregler, fillager
  functions/deadline-reminders/index.ts  Daglige e-mailpåmindelser
```
