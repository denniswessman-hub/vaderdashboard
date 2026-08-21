# Publicera utan kommandorad

Två steg: koden till GitHub, sidan till Cloudflare Pages. Inget behöver
installeras utöver GitHub Desktop, som du redan har.

Mappen det gäller är `Documents\Wether\vaderdashboard`.

---

## Steg 1 – Lägg upp koden på GitHub

### Med GitHub Desktop

1. **File → Add local repository…** och peka på `Documents\Wether\vaderdashboard`.
2. GitHub Desktop säger att mappen inte är ett git-repo och erbjuder
   **"create a repository"** – klicka på den länken.
3. I dialogen: Name `vaderdashboard`, Description valfri.
   **Bocka INTE i** "Initialize this repository with a README" – det finns redan
   en. Git ignore: `None`. License: `None` (LICENSE-filen finns redan).
   Klicka **Create repository**.
4. Skriv en summary, t.ex. `Första versionen`, och klicka **Commit to main**.
5. Klicka **Publish repository** uppe till höger. Välj om den ska vara publik
   eller privat. Cloudflare kan läsa båda.

### Eller direkt i webbläsaren

1. Gå till <https://github.com/new>, namn `vaderdashboard`, skapa utan README.
2. På den tomma repo-sidan: **uploading an existing file**.
3. Dra in **innehållet** i `vaderdashboard`-mappen (inte mappen själv).
   Viktigt: `dist`-mappen måste följa med som mapp.
4. Commit changes.

> Filen `vaderdashboard.zip` i mappen behöver inte upp på GitHub – den är bara
> till för direktuppladdning till Cloudflare. Ta bort den eller strunta i den.

---

## Steg 2 – Publicera sidan på Cloudflare Pages

Sidan behöver `_worker.js` för att kunna hämta från SMHI, Yr och Klart.
GitHub Pages kan inte köra den – därför Cloudflare, som är gratis för det här.

1. Skapa konto eller logga in på <https://dash.cloudflare.com>.
2. **Compute (Workers & Pages) → Create → Pages → Connect to Git**.
3. Auktorisera Cloudflare mot GitHub och välj `vaderdashboard`.
4. Byggkonfiguration:
   - Framework preset: **None**
   - Build command: **lämna tomt**
   - Build output directory: **`dist`**
5. **Save and Deploy**.

Efter en halv minut ligger sidan på `https://vaderdashboard.pages.dev` (eller
`https://vaderdashboard-xyz.pages.dev` om namnet är taget). Varje gång du
pushar till `main` bygger Cloudflare om automatiskt.

### Om du hellre slipper GitHub-kopplingen

**Create → Pages → Upload assets**, ladda upp innehållet i `dist`. Samma
resultat, men då får du ladda upp manuellt vid varje ändring.

---

## Steg 3 – Kontrollera att källorna svarar

Öppna på den publicerade adressen:

- `/` – dashboarden. Kolla att SMHI och Yr visar temperaturer och att
  felraden under enighetsmätaren är tom för de två.
- `/api/klart-debug?q=Stockholm` – visar vad Klart.se svarade på fem
  tänkbara adresser. Skicka utfallet till mig så skriver jag klart adaptern.

Identifieringen mot MET Norway sätts automatiskt till sidans egen adress, så
när sidan väl ligger på `pages.dev` skickas den i stället för en mejladress.
Inget behöver ändras i koden.

---

## Om något strular

| Symptom | Trolig orsak |
|---|---|
| Sidan laddar men alla källor fallerar | Build output directory är inte satt till `dist`, så `_worker.js` kom aldrig med |
| `/api/...` ger 404 | Samma sak – `_worker.js` måste ligga i roten av det som publiceras |
| Yr fallerar med 403 | MET Norway blockerar oidentifierade anrop. Kontrollera att sidan nås via sin `pages.dev`-adress och inte via en förhandsvisning utan värdnamn |
| GPS-knappen gör inget | Positionering kräver `https` – fungerar på `pages.dev`, inte på en lokal fil |
