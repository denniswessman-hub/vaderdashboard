# Väderdashboard – troligaste prognos

Samlar SMHI, Yr (MET Norway) och en tredje modell på en sida och räknar fram en
sammanvägd **troligaste prognos** med lika vikt mellan källorna.

## Innehåll

| Fil | Roll |
|---|---|
| `dist/index.html`, `dist/styles.css`, `dist/app.js` | Själva dashboarden |
| `dist/_worker.js` | Serverdel: hämtar och normaliserar de tre källorna |
| `dev-server.mjs` | Kör allt lokalt (Node 18+) |
| `mock-data.mjs` | Syntetiska data för test utan nätverk |
| `test-ui.mjs` | Renderingstest i headless Chromium |
| `PUBLICERA.md` | Steg för steg: GitHub + Cloudflare Pages, utan kommandorad |

## Köra lokalt

```bash
node dev-server.mjs          # http://localhost:8788
MOCK=1 node dev-server.mjs   # samma sida, syntetiska data
```

Positionering (GPS) kräver `https://` eller `localhost` – därför fungerar den via
dev-servern men inte om du dubbelklickar på `index.html`.

## Publicera på Cloudflare Pages

1. Logga in på Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Ge projektet ett namn och ladda upp **innehållet i `dist/`** (alla fyra filer,
   inklusive `_worker.js`).
3. Deploy. Sidan ligger på `https://<projektnamn>.pages.dev`.

`_worker.js` fångar `/api/*` och skickar övrigt vidare till de statiska filerna,
så inga extra inställningar behövs. Vill du uppdatera senare laddar du bara upp
en ny version av mappen.

Netlify fungerar också, men då måste `_worker.js` skrivas om till en Netlify
Function – Cloudflare är den raka vägen här.

## Källorna

| Källa | API | Villkor |
|---|---|---|
| SMHI | `opendata-download-metfcst.smhi.se` – **SNOW1g v1** | Fri, CC BY 4.0. Ersatte PMP3g v2 den 31 mars 2026. |
| Yr | `api.met.no/weatherapi/locationforecast/2.0` | Fri, NLOD/CC BY 4.0. Kräver identifierande `User-Agent`. Den sätts automatiskt till sidans egen adress, t.ex. `vaderdashboard/1.0 (+https://vaderdashboard.pages.dev)`. |
| Klart | Inget publikt API | Adaptern provar kända mönster; misslyckas den används ECMWF (Open-Meteo) i stället, tydligt märkt i gränssnittet. |

Ingen mejladress ligger i koden. `_worker.js` läser av vilken adress sidan
serveras från och identifierar sig med den mot MET Norway, precis som deras
villkor tillåter. `FALLBACK_SITE` överst i filen används bara vid lokal körning,
där det inte finns någon publik adress att peka på.

### Att koppla in Klart på riktigt

När sidan är publicerad, öppna:

```
https://<projektnamn>.pages.dev/api/klart-debug?q=Stockholm
```

Den provar fem tänkbara adresser hos Klart och visar status och de första
raderna av varje svar. Skicka utfallet till mig så skriver jag klart adaptern.
Alternativt: öppna klart.se i Chrome, fliken Nätverk, filtrera på `Fetch/XHR`
och kopiera adressen till anropet som innehåller prognosdata.

## Så räknas "troligaste prognos" fram

Alla källor interpoleras till ett gemensamt timrutnät. Per timme gäller:

- **Temperatur, vind, luftfuktighet, molnighet** – medelvärde. Spridningen mellan
  högsta och lägsta källa ritas som ett band i diagrammet.
- **Vindriktning** – cirkulärt medelvärde (så att 350° och 10° blir 0°, inte 180°).
- **Nederbörd** – medelvärde av intensiteten, plus andelen källor som tror på
  nederbörd alls ("regnrisk").
- **Vädersymbol** – majoritetsval. Är alla tre oense väljs medianen på en
  allvarlighetsskala, alltså mellanalternativet snarare än ytterligheterna.
- **Enighet** – 40 % symbolsamstämmighet, 35 % temperaturspridning, 25 %
  nederbörd ja/nej. Låg siffra betyder att prognosen är osäker, inte fel.

Dygnsvärdena i 10-dygnslistan aggregeras per källa först och vägs samman sedan,
så att en källa som slutar tidigare inte drar med sig hela dygnet.

## Kända begränsningar

- Klart.se är inte verifierad (se ovan).
- Prognoser glesnar bortom cirka tre dygn; timupplösningen i diagrammet är
  interpolerad efter det.
- SMHI täcker bara Norden – utanför SMHI:s område faller sammanvägningen tillbaka
  på övriga källor.
