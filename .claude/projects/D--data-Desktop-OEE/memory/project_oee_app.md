---
name: OEE Analyse App DW08
description: Complete OEE web application built for machine DW08 at Metsä Board NL Winschoten
type: project
---

Complete OEE analysis web application built and running on port 3131.

**Stack:** Node.js + Express backend, Vanilla HTML/CSS/JS frontend, Anthropic claude-sonnet-4-5-20251001, dotenv

**Structure:**
- `server.js` — Express server port 3131, POST /api/analyze endpoint
- `public/index.html` — Full single-page app with 3 file upload zones and 6-tab dashboard
- `.env` — ANTHROPIC_API_KEY placeholder
- `package.json` — dependencies: express, @anthropic-ai/sdk, dotenv

**File inputs:**
1. Default_template.xlsx — PROMs events (XLSX.js parsed, Excel time fractions → min)
2. values.csv — speed/alarm data per 15 sec (semicolon-separated, comma decimals)
3. LoadList .xls — orders and tonnage (XLSX.js, finds header row with 'Order')

**Why:** Production shift analysis tool for paper/board cutting machine DW08.
**How to apply:** When user asks to extend or modify the app, read current files first.
