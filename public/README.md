# Handoff: JMAnalyzeTool UI Redesign

## Overview
Dit is een volledige UI redesign van de JMAnalyzeTool productie-analyse applicatie (repo: `jm88666/OEE-`). Het huidige design is vervangen door een moderne dark glassmorphism look met Space Grotesk + Syne fonts, groene glow accenten, 3D visualisaties en een consistent design systeem over alle pagina's.

## About the Design Files
De bestanden in `redesign/` zijn **kant-en-klare productiebestanden** — geen prototypes. Ze bevatten alle bestaande JavaScript logica van de originele bestanden, omgeven door het nieuwe CSS/HTML design. Je kunt ze **direct droppen** in de `public/` map van de repo.

Fidelity: **High-fidelity** — pixel-perfecte implementatie met exacte kleuren, typografie, spacing en interacties.

---

## Wat er veranderd is

### Van → Naar
- `public/login.html` → `redesign/login.html`
- `public/jm-report.html` → `redesign/jm-report.html`  
- `public/reports.html` → `redesign/reports.html`
- `public/admin.html` → `redesign/admin.html`

**Niet aangeraakt (geen wijzigingen nodig):**
- `public/auth-client.js`
- `public/analysis-layer.js`
- `public/demo-scenarios.js`
- `public/oee-fixes.js`
- `public/report-storage.js`
- `public/jm-branding.js`
- `server.js`

---

## Design Tokens

### Kleuren
```css
--bg:      #060709   /* pagina achtergrond */
--g:       #00e5a0   /* primair groen accent */
--g2:      #00b87a   /* groen donker (gradiënt) */
--amber:   #f59e0b   /* waarschuwing / performance */
--red:     #ff4757   /* fout / stilstand / reject */
--blue:    #60a5fa   /* info / orders / optioneel */
--purple:  #a78bfa   /* alarm / audit / admin */
--text:    #f0f2fa   /* primaire tekst */
--muted:   #4a5070   /* secundaire tekst */
--dim:     #252838   /* subtiele elementen */
--border:  rgba(255,255,255,.06)   /* kaart randen */
--border2: rgba(255,255,255,.10)   /* interactieve randen */
--glass:   rgba(255,255,255,.03)   /* glassmorphism achtergrond */
--glass2:  rgba(255,255,255,.06)   /* glassmorphism hover */
```

### Typografie
```
Headers:  'Syne', sans-serif — weight 800 — letter-spacing: -.04em
Body:     'Space Grotesk', system-ui — weight 400/500/600/700
Mono:     'Space Mono', monospace — voor cijfers, tijden, codes
```
Google Fonts import:
```html
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### Glassmorphism kaart
```css
background: rgba(255,255,255,.03);
backdrop-filter: blur(20px);
-webkit-backdrop-filter: blur(20px);
border: 1px solid rgba(255,255,255,.06);
border-radius: 14px;
```

### Groene glow button
```css
background: #00e5a0;
color: #020c07;
box-shadow: 0 0 24px rgba(0,229,160,.35), 0 4px 12px rgba(0,0,0,.4);
border-radius: 10px;
font-weight: 700;
```

### Mesh gradient achtergrond (elke pagina)
```css
/* Groen blob linksboven */
position: absolute; top: -20%; left: -10%; width: 60%; height: 60%;
background: radial-gradient(ellipse, rgba(0,229,160,.14) 0%, transparent 70%);
filter: blur(60px);

/* Blauw blob rechtsonder */
position: absolute; bottom: -20%; right: -10%; width: 55%; height: 55%;
background: radial-gradient(ellipse, rgba(96,165,250,.09) 0%, transparent 70%);
filter: blur(80px);
```

### Noise texture overlay (elke pagina)
```css
body::before {
  content: '';
  position: fixed; inset: 0;
  background-image: url("data:image/svg+xml,..."); /* fractalNoise SVG */
  opacity: .025;
  pointer-events: none;
  z-index: 100;
}
```

---

## Schermen

### 1. Login (`login.html`)
**Doel:** Inloggen of account aanmaken met invite code.

**Layout:**
- Volledig scherm gecentreerd (`display: grid; place-items: center`)
- Grid achtergrond (44px × 44px, 2.5% opaciteit witte lijnen)
- Kaart: `width: min(100%, 420px)`, glassmorphism

**Componenten:**
- Logo icoon: 56×56px, `border-radius: 16px`, gradient groen→blauw, glow shadow
- Titel: Syne 28px, "JMAnalyzeTool" met groen accent op "Analyze"
- Tab switcher: 2 kolommen grid, actieve tab = groen gradient knop
- Input velden: `background: rgba(255,255,255,.04)`, `border: 1px solid rgba(255,255,255,.08)`, focus = groene border
- Submit knop: btn-glow stijl
- Hint tekst: `rgba(255,255,255,.18)`, 12px

**JS logica:** Ongewijzigd — login/register API calls naar `/api/auth/login` en `/api/auth/register`.

---

### 2. Report Builder (`jm-report.html`)

**Nav bar (sticky, 54px hoog):**
- `background: rgba(6,7,9,.85)`, `backdrop-filter: blur(20px)`
- Logo links, nav links midden, avatar + email rechts
- Avatar: 30×30px cirkel, gradient groen→blauw, initialen

**Upload fase:**
- Page title: Syne 26px
- Setup grid: `grid-template-columns: 1.1fr 2fr`, 14px gap
- Context kaart + Route status kaart: beide glassmorphism
- Route chips: `.chip.on` = groene border + groene tekst
- Upload grid: `repeat(3, 1fr)`, 12px gap
- Drop zones: glassmorphism, `border-radius: 13px`
  - Required: `border-color: rgba(245,158,11,.28)` (amber)
  - Geladen: `border-color: rgba(0,229,160,.45)`, groene glow shadow
  - Nummer badge: 20×20px cirkel

**Dashboard tabs:**
- `border-bottom: 2px solid var(--g)` op actieve tab
- `text-shadow: 0 0 12px rgba(0,229,160,.5)` op actieve tab

**KPI kaarten:**
- `grid-template-columns: repeat(5, 1fr)`, glassmorphism
- Waarde: Space Mono 24px, gekleurde glow text-shadow
- Kleur per categorie: groen = performance goed, amber = matig, rood = slecht

**Shift timeline:**
- Hoogte 40px, `background: rgba(255,255,255,.03)`, `border-radius: 8px`
- Segmenten: `.run` groen, `.stop` rood, `.reject` amber, `.format` blauw

**JS logica:** Volledig ongewijzigd — alle parsers (parseSpeed, parseEvents, parsePasaban, parseOrders etc.) en build logica zijn behouden.

**Nieuw toegevoegd:**
- Report bar (sticky onder nav) na build
- Opslaan modal met titel input → POST `/api/reports`

---

### 3. Rapporten bibliotheek (`reports.html`)

**Layout:** `grid-template-columns: 320px 1fr`, 14px gap

**Rapport items (links):**
- Glassmorphism kaarten, `border-radius: 12px`
- Geselecteerd: `border-color: rgba(0,229,160,.4)`, groene glow
- Badge per route: Complete = blauw, Basic = muted

**Viewer (rechts):**
- Glassmorphism kaart, `min-height: 400px`
- Rapport HTML wordt embedded in `<div>`

---

### 4. Admin panel (`admin.html`)

**Stat kaarten:** `grid-template-columns: repeat(4, 1fr)`
- Elke kaart: gekleurde glow op waarde, radial gradient achtergrond per kleur

**Tab knoppen:** `.tab-btn.active` = groene border + groene tekst

**Tabellen:** donkere rijen, `border-bottom: 1px solid rgba(255,255,255,.04)`

**Acties:** Blokkeer = rode mini-knop, Activeer = groene mini-knop

---

## Implementatie instructies

### Stap 1: Fonts toevoegen
Voeg toe aan de `<head>` van elke pagina:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

### Stap 2: Bestanden vervangen
```bash
cp redesign/login.html    public/login.html
cp redesign/jm-report.html public/jm-report.html
cp redesign/reports.html  public/reports.html
cp redesign/admin.html    public/admin.html
```

### Stap 3: Commit & push
```bash
git add public/login.html public/jm-report.html public/reports.html public/admin.html
git commit -m "redesign: dark glassmorphism UI met Space Grotesk + Syne"
git push
```

Railway pakt de push automatisch op en deployt.

---

## Files in dit pakket

```
redesign/
  login.html       — Nieuwe login/register pagina
  jm-report.html   — Report Builder met nieuwe UI + alle bestaande JS
  reports.html     — Rapporten bibliotheek
  admin.html       — Beheer panel

design_handoff_jmanalyzetool_redesign/
  README.md        — Dit bestand

JMAnalyzeTool Design v3.html  — Volledig interactief prototype (referentie)
```

---

## Referentie prototype
Zie `JMAnalyzeTool Design v3.html` voor het volledige interactieve prototype met alle schermen navigeerbaar, inclusief:
- 3D shift timeline
- Radial KPI rings
- 3D bar chart formaatwisselingen
- Speed heatmap
- Reject waterfall chart
- Order speed utilization bars
- Impact/effort matrix
