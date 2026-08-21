# Publicera på GitHub Pages

Sidan är statisk och hämtar väderdata direkt i webbläsaren, så GitHub Pages
räcker – ingen server, ingen Cloudflare, inget att installera.

## Slå på Pages

1. Gå till repots **Settings → Pages**.
2. Under *Build and deployment*: Source = **Deploy from a branch**.
3. Branch = **main**, mapp = **/ (root)**. Klicka **Save**.
4. Vänta en minut. Adressen visas överst på samma sida, i formen
   `https://<användarnamn>.github.io/vaderdashboard/`.

Filerna ligger i repots rot, så mappvalet ska vara `/ (root)` – inte `/docs`.

## Kontrollera att det fungerar

Öppna adressen och kolla att:

- temperaturen och de tre källorna fylls i inom ett par sekunder,
- felraden under enighetsmätaren är tom,
- **Min position** frågar efter platsåtkomst och byter ort när du tillåter.

Blir sidan tom eller står kvar på "Hämtar…": öppna utvecklarverktygen med F12
och titta i fliken Console.

| Symptom | Trolig orsak |
|---|---|
| 404 på adressen | Pages är inte påslaget, eller pekar på fel mapp |
| Sidan syns men inga siffror | Någon källa svarar inte – felraden under enighetsmätaren säger vilken |
| Gamla versionen visas | Pages cachar; ladda om med Ctrl+F5 |
| Min position gör inget | Platsåtkomst nekad i webbläsaren, eller sidan öppnad som lokal fil i stället för via `https` |

## Uppdatera sidan senare

Ladda upp den ändrade filen i GitHub (**Add file → Upload files**, samma
filnamn skriver över) eller committa via GitHub Desktop. Pages bygger om
automatiskt inom en minut.
