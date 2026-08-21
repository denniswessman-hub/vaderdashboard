# Väderdashboard – troligaste prognos

Samlar SMHI, Yr (MET Norway) och ECMWF på en sida och räknar fram en sammanvägd
**troligaste prognos** med lika vikt mellan källorna.

Sidan är helt statisk: den hämtar alla tre källorna direkt från webbläsaren och
behöver ingen server. Det gör att den kan ligga på GitHub Pages.

## Innehåll

| Fil | Roll |
|---|---|
| `index.html`, `styles.css` | Sidan och dess utseende |
| `sources.js` | Hämtar och normaliserar SMHI, Yr och ECMWF |
| `app.js` | Sammanvägning, diagram och rendering |
| `manifest.json`, `icon-*.png` | Gör att sidan kan läggas till på hemskärmen som en app |
| `serve.mjs` | Liten statisk server för lokal körning (Node 18+) |
| `test-ui.mjs` | Renderingstest i headless Chromium mot stubbade API-svar |
| `PUBLICERA.md` | Steg för steg: publicera på GitHub Pages |

## Köra lokalt

```bash
node serve.mjs   # http://localhost:8788
```

Positionering kräver `https` eller `localhost`, så öppna via servern i stället
för att dubbelklicka på `index.html`.

## På mobilen

Sidan är byggd mobilen först: träffytor på minst 44 px, säkra zoner för lurar
med hack, och 16 px i sökfältet så att iOS inte zoomar in vid fokus. I
48-timmarsdiagrammet visas värdena med ett tryck i stället för hovring, och
uppdateringsknappen i topplisten hämtar färska siffror förbi cachen. Kommer du
tillbaka till en flik som legat i bakgrunden mer än ett kvart hämtas nya
prognoser automatiskt.

Lägg till den på hemskärmen – **Dela → Lägg till på hemskärmen** i Safari,
**⋮ → Lägg till på startskärmen** i Chrome – så startar den utan adressfält och
med egen ikon.

## Källorna

| Källa | API | Villkor |
|---|---|---|
| SMHI | `opendata-download-metfcst.smhi.se` – **SNOW1g v1** | Fri, CC BY 4.0. Ersatte PMP3g v2 den 31 mars 2026. |
| Yr | `api.met.no/weatherapi/locationforecast/2.0` | Fri, NLOD/CC BY 4.0. |
| ECMWF | `api.open-meteo.com` – modell `ecmwf_ifs025` | Fri för icke-kommersiellt bruk, CC BY 4.0. |

Platssökning sker mot Open-Meteos geokodning, omvänd geokodning mot
BigDataCloud. Alla svar cachas 15 minuter per plats i webbläsaren så att
källorna inte belastas i onödan.

### Om Klart.se

Klart.se har inget publikt API och tillåter inte anrop från andra webbplatser,
så deras data går inte att hämta från en statisk sida. ECMWF fyller den tredje
platsen i stället – en oberoende modell, vilket är själva poängen med
sammanvägningen. Vill du ha med Klart krävs en serverdel som hämtar åt sidan,
till exempel en Cloudflare Worker.

## Så räknas "troligaste prognos" fram

Alla källor interpoleras till ett gemensamt timrutnät. Per timme gäller:

- **Temperatur, vind, luftfuktighet, molnighet** – medelvärde. Spridningen
  mellan högsta och lägsta källa ritas som ett band i diagrammet.
- **Vindriktning** – cirkulärt medelvärde, så att 350° och 10° blir 0° och
  inte 180°.
- **Nederbörd** – medelvärde av intensiteten. Regnrisken är medelvärdet av
  källornas egna sannolikheter, och faller tillbaka på hur många av dem som
  tror på nederbörd alls om sannolikheter saknas.
- **Vädersymbol** – majoritetsval. Är alla tre oense väljs medianen på en
  allvarlighetsskala, alltså mellanalternativet snarare än ytterligheterna.
- **Enighet** – 40 % symbolsamstämmighet, 35 % temperaturspridning, 25 %
  nederbörd ja/nej. Låg siffra betyder att prognosen är osäker, inte fel.

Dygnsvärdena i 10-dygnslistan aggregeras per källa först och vägs samman sedan,
så att en källa som slutar tidigare inte drar med sig hela dygnet.

## Detaljer som är lätta att missa

- SMHI och Open-Meteo anger nederbörd för tiden **före** varje tidsstämpel,
  Yr för tiden **efter**. `sources.js` flyttar de två förstnämnda ett steg så
  att alla tre pekar framåt.
- SMHI anger molnighet i oktas (0–8), inte procent.
- Prognoserna glesnar med tiden: SMHI går från en till tre timmar efter ett
  dygn, Yr till sex timmar efter två. Varje punkt bär därför hur många timmar
  den täcker, annars blir dygnssummorna för nederbörd fel.
