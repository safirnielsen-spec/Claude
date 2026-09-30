# Plan: automatisk BBR-opslag i Energimærke Feltbog

Status: afventer adgang til Datafordeleren fra udviklingsmiljøet, så API'et kan testes.

## Løsning (valgt: mulighed 1)
- Værktøjet (`energimaerke/index.html`) hostes på GitHub Pages fra branchen
  `claude/stoic-davinci-bj8yot` → `https://safirnielsen-spec.github.io/Claude/energimaerke/`.
- Brugeren indtaster sin Datafordeler API-nøgle under **Mere** i værktøjet. Den gemmes kun
  i brugerens browser (localStorage) – aldrig i koden, da repoet er offentligt.
- Adresse → adressens id (Datafordeler DAR / Adressevælgeren; DAWA lukker 1/10-2026)
  → BBR-bygninger på adressen → udfyld bygningsdata og guidens svar.
- Hvis Datafordeleren ikke tillader kald direkte fra browseren (CORS), tilføjes en lille
  proxy (fx Cloudflare Worker), hvor nøglen ligger som secret.

## Felter der skal hentes (BBR-bygning) – verificér navne og kodelister mod API'et
| BBR | Værktøj |
|---|---|
| byg021BygningensAnvendelse | bygning.anvendelse |
| byg026Opførelsesår | bygning.opfoert |
| byg027OmTilbygningsår | bygning.ombygget |
| byg039BygningensSamledeBoligAreal | bygning.areal |
| byg054AntalEtager (+ udnyttet tagetage) | guide.etager |
| byg032YdervæggensMateriale | guide.vaeg (1 mursten→tegl, 2 letbeton, 4 bindingsværk, 5 træ, 6 beton) |
| byg056Varmeinstallation + byg057Opvarmningsmiddel | guide.varmeKilde (1 fjernvarme; 2/6 + naturgas→gas, olie→olie; 5 varmepumpe; 7 el) |
| byg058SupplerendeVarme | guide.braende / varme.suppl |
| Etage/kælder-oplysninger | guide.under, bygning.arealKaelder |

Oplysninger fra BBR markeres som hentet fra BBR, så brugeren kan kontrollere dem på stedet.

## Test
Kræver miljøvariablen `DATAFORDELER_API_KEY` og netværksadgang til `datafordeler.dk`
(inkl. underdomæner) i udviklingsmiljøet.
