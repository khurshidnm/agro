# CLAUDE.md — Yuksalish Agro (interactive business plan)

## What this project is

A single-page, interactive **business plan** (biznes-reja) for **Yuksalish Agro** (working name chosen by the owner),
a dairy + beef cattle farm on irrigated land near Burgut qishlog'i, Bukhara region (Buxoro viloyati), Uzbekistan. The owner will show it to a bank
to get a preferential loan (imtiyozli kredit) under Cabinet of Ministers Resolution No. 435 (06.08.2026).

The page is one self-contained `index.html` (HTML + CSS + vanilla JS, no build step, no libraries).
Every economic input is editable in the page; the whole plan recalculates live (monthly simulation,
10 years, 2027–2036). Open `index.html` directly in a browser to use it.

**All user-facing text is Uzbek (Latin script).** Code comments and this file may be English.

## Files

```
index.html                 the whole app (markup, styles, model, rendering)
yer-xaritasi.jpg           satellite map of the land with plots 1–6 (used by the interactive map)
ferma-rejasi.jpg           farm layout reference (site plan, barn interior, 100-stall barn section)
tech-iot.jpg               picture for the herd-monitoring card (section 7)
silos-1.jpg, silos-2.jpg   hermetic silage covering photos (section 6, infrastructure)
assets/plots.json          polygon coordinates of each plot in the map image's pixel space (1468×1108)
assets/original/*          original images and the Fitcows demo video supplied by the owner
tools/model-check.mjs      prints the model's key results in the terminal: `node tools/model-check.mjs`
package.json               `npm start` runs server/server.mjs, `npm run check` runs the model check
server/server.mjs          save server for self-hosting (Node 18+, no deps): static files + GET/POST /api/versions
server/README.md           how to deploy on a VPS (nginx + systemd), env vars (PORT, HOST, DATA_DIR, SAVE_KEY)
server/yuksalish-agro.service   systemd unit template
server/data/versions/*.json     saved versions when self-hosted (created by the server; never served as static)
```

Published artifact (claude.ai, shared save works only there): https://claude.ai/artifact/AWRvaQBN8JjyFnMJnsrAqr
(republish `index.html` to that `url`; the 5 jpg files are already published alongside it).

## Business decisions stated by the owner (treat as fixed unless the owner changes them)

- **Land:** total **49.4 ga** = plots 1–6 (32.4 ga) + **plot 7 (7-kontur, 17 ga)**. The owner decided (06.10.2026)
  that plot 7 is a fixed part of the plan: no switch, no comparison table (`params.land7` is forced to 1 on load;
  the plot keeps `extra:true` only for map styling). Plot 7 rotates wheat → silage corn like the others.
  - Plot 1 = 7.1 ga: **3.4 ga farm** (ferma inshootlari) + **1.1-dala 3.7 ga** (wheat → silage corn rotation).
  - Plot 2 = 4.3 ga, Plot 4 = 6.7 ga, Plot 5 = 2.2 ga, Plot 6 = 7.0 ga: rotation (kuzgi bug'doy, then silos makka; repeats yearly).
  - Plot 3 = 5.1 ga: wheat in the first year (2026/27), then permanent alfalfa (beda), 5 cuts/year.
  - The grey area on the map (originally red, labelled "Molxona") is **not** the owner's land. The barn
    and all buildings are built **inside** the 3.4 ga farm zone. The farm-zone polygon is my estimate
    (teal area + northern strip of plot 1); the owner may ask to redraw it.
- **Crop calendar:** wheat sown early Nov 2026 on all crop land, harvested June 2027. Silage corn
  (3-month hybrid) after wheat, harvested ~September, then wheat again in November.
  **Silage is bought only until the first own harvest: silage corn is sown after wheat in July 2027 and ensiled in
  September 2027 (`silStart = 2027`); 2027 purchase fixed at 270 mln so'm (`y1Sil`). Own silage costs 300 so'm/kg** (owner's figures;
  params `silPrice = 600`, `silOwnCost = 300` applied to ready silage, cost key `silOwn`).
  Any shortfall in later years is still bought at `silPrice`. Section 5 has a year-by-year silage table.
  Planned silage yield: **60 t/ga** green mass (owner's target; I flagged that 35–45 t/ga is typical
  for a 90–100-day second crop after wheat).
- **Herd:** 100 pregnant (bug'oz) breeding cows imported from **China**, arriving ~April 2027
  (Simmental-type was discussed earlier). Keep all female calves (grow herd up to `maxCows`),
  fatten male calves ~16 months and sell live weight.
- **Prices:** milk 6 000 so'm/l, live weight bulls 70 000 so'm/kg.
- **Financing:** **5 mlrd so'm loan**, everything else from own funds (`loanAmt = 5e9`).
  Loan terms used: 10%/yr, 10 years, 4-year grace (interest only), then equal principal.
- Jobs: permanent + seasonal workers must be shown (they are, in section 8).
- **Modern technologies (section 7)**: each one is a card with a checkbox (param flag = 1/0) and is costed
  in the investment table as one "Zamonaviy texnologiyalar" line. The owner said silage covering and
  rooftop solar are **not** modern technologies, so:
  - Hermetic silage covering (film + net + sand bags) is part of **infrastructure** (section 6, photos
    `silos-1.jpg`, `silos-2.jpg`), always on (`techFilm = 1`), inputs live in the "Yer va ekinlar" panel group.
  - The rooftop solar plant was removed from the plan (`effParams()` forces `techSolar = 0`; code kept).
  Current technology cards (`TECHS` array, flags in `DEF.params`):
  1. `techIot` digital herd monitoring like **Fitcows** (https://www.fitcows.com/cattle-management-software/):
     smart collar + pedometer, gateway, web/mobile app; collars also bought for herd growth; yearly subscription.
  2. `techMM` milk meters + cow ID in the parlour + herd-management software.
  3. `techFeed` precision feeding: mixer scales, ration software, feed analysis (cuts concentrate).
  4. `techClim` barn microclimate control: T/RH sensors driving fans and sprinklers (heat stress).
  5. `techScr` automatic manure scrapers (saves `scrWorkers` handlers).
  6. `techCalf` automatic calf feeder (calf survival up, saves `calfWorkers`).
  Effects (milk %, calving pts, vet %, culling pts, concentrate %, workers saved) are my estimates from
  international practice, not vendor data. `effParams()` applies them to a copy of params before `run()`;
  saved workers reduce labour cost and the permanent-jobs count. Each card's impact = re-run with that flag flipped.

## Architecture of index.html

`<script>` is organised in marked blocks (search for the comment banners):

1. `/* Default data */` — `DEF = { plots[], params{}, invest[], staff[], seasonal[] }`.
   All money is stored in **so'm** (not millions). `plots[].use` ∈ `rot | alf | wheat | ferma`.
2. `GROUPS` — schema of the left input panel: `[key, label, unit, scale, step]`.
   `scale` converts display units (e.g. `1e6` = shown in mln so'm). A plain string = sub-heading.
3. `/* State */` — `S` (working copy of DEF), persisted per browser in `localStorage`
   key `yuksalish-agro-v5` (wrapped in try/catch; missing new params fall back to DEF via Object.assign).
   **If you add or rename a param, old saved state keeps old values for existing keys** — tell the
   owner to press "Asl qiymatlar" or bump the storage key.
4. `/* Model */` — `run(S)` returns everything the page shows. **Monthly simulation**, t = 0..119
   (Jan 2027 … Dec 2036):
   - Land areas come from `S.plots` (farmHa, rotHa, alfHa, wOnly). Year-0 wheat area = all crop land;
     later wheat area = rotHa + wOnly; silage area = rotHa (from `silStart`); hay from alfHa.
   - Herd: pending pregnant cows (arrive `arrMonth`, calve after `calveLag`) → cows. Calving schedule
     array `cal[]`: each calving schedules the next one after CI = round(12 / calvRate) months,
     decayed by culling. Heifers enter the herd at `ageFirst` months (capped by `maxCows`, surplus sold
     at `heiferPrice`). Bulls sold at `fatMonths`. Culling `cullRate`/yr after 12 months in herd.
   - Feed: monthly need from daily rations × head counts; own stocks (silage from Sept harvest, hay from
     alfalfa cuts May–Sep, straw + share of wheat grain from June harvest) are used first, deficit is
     bought. Leftover silage is sold in September; hay/straw above 5/6 months' need sold in December.
   - Costs: crops per ha, labour (livestock staff start at cow arrival; +`extraPer50` staff per 50 cows
     above 100), vet, AI, energy, fuel, insurance, land tax, other; seasonal labour once a year.
   - Finance: depreciation (buildings `lifeBld`, machinery `lifeMach`, purchased cows `lifeCow`,
     barn expansions), loan schedule, profit tax `taxPct` (default 0% — to be confirmed by accountant),
     cash flow, DSCR, owner payback, project IRR (10 years + terminal herd and residual asset value).
5. `/* Formatting */` — `loc` (ru-RU grouping, comma decimals, no "-0"), `mln`, `mlrd`, `t`.
6. `/* Panel */`, `/* Editable tables */` — input panel, investment / staff / seasonal tables.
7. `/* Charts */` — hand-rolled SVG: `revChart` (stacked revenue + cost line + net profit),
   `lineChart` (herd, cash), `gantt` (crop calendar), `tornado` (±10% sensitivity, reruns `run()`).
   `renderTech()` draws the technology cards (section 7). `renderFunding()` draws, inside section 6, the
   funding-source table (loan goes first to cows, then barns; the rest is own funds) and the 4-period
   investment calendar Oct 2026 – Dec 2027 (split rules are in the code).
8. `render()` — fills KPIs, alerts, all 14 sections.
10. `/* Versions */` — `VC` (declared with `var` because `save()` calls it before it is defined).
   **Shared save with author**: the "Saqlash" button opens a dialog asking first name + surname (+ optional note),
   computes a readable diff against the version the draft started from (`diff()`: params via GROUPS labels,
   technologies via TECHS titles, plots, investment rows by id, staff/seasonal by position) and writes one doc to
   the artifact database collection `versions` {ts, at, first, last, author, uid, note, changes[], nChanges, state, kpi}.
   Section 14 "O'zgarishlar tarixi" lists versions (who, when, what changed) and can open any of them.
   On load the newest version is applied unless the local draft has unsaved edits (then a notice asks).
   Versions go through a small store interface (`store.save(id, doc)`, `store.subscribe(next, error)`) with two
   implementations chosen at load: `claudeStore` (inside claude.ai: artifact database, `claude.use("db")` +
   `claude.use("user")`, published with capabilities `{db:{}, user:{}}`, default db rules: anyone admitted reads,
   `interact` and above write) and `apiStore` (anywhere else: `GET/POST api/versions` relative to the page, served by
   `server/server.mjs`; polled every 30 s with ETag; optional `SAVE_KEY` makes the dialog ask for a "Kalit so'z").
   The owner hosts the page on their own VPS subdomain (decided 06.10.2026), so `apiStore` is the production path.
   **Who can save is decided by the claude.ai share settings, not by the page**: the owner, and people the owner
   invites by email as Editor/Contributor (invited outsiders lose write access while a public link is also on).
   Signed-in viewers with view-only access can read and open versions but not save; signed-out visitors and
   anyone who opens the local file get no shared data at all (local draft only). The page detects this and sets
   `VC` mode `nohost | signedout | readonly | ready | error` (`setMode()`), each with its own Uzbek status text
   (`MSG`); a write refused with `invalid_argument` switches the visit to `readonly`. Self-hosted, everyone who can
   open the page can save (or everyone with the key when `SAVE_KEY` is set); `nohost` then only means "no server".
9. `/* Interactive map */` — `POLY`/`CEN` (from `assets/plots.json`), `USES`, `plotEcon()`,
   `renderMap()`; clicking a plot shows its data and lets the user change area/use.

## Conventions — follow these

- **Uzbek copy:** write natively in Uzbek, never word-for-word translation. **Do not use a dash to
  insert an explanation inside an Uzbek sentence.** A dash is fine only in list/definition position
  or once before a short clarifying clause at the end of a sentence. Plain, short sentences.
- Numbers: `loc()` (space thousands, comma decimals). Tables in **mln so'm**, headline figures in
  **mlrd so'm**. Prices exclude VAT, 2026 price level, no inflation.
- Colours only via CSS tokens in `:root` (light + two dark blocks). Chart series: `--s1` milk/farm,
  `--s2` meat, `--s3` heifers/silage corn, `--s4` crops/wheat, `--s6` alfalfa; `--pos/--neg` in tornado.
- No external JS libraries; only Google Fonts. Keep everything in one HTML file.
- Any new input: add to `DEF.params` (in so'm/base units) **and** to `GROUPS`, then use it in `run()`.
- After changing the model, run `node tools/model-check.mjs` and compare with the baseline below.

## Baseline results (defaults, for regression checking)

**Plan horizon is 10 years (2027–2036)** (owner, 06.10.2026): `params.horizon` = 10 (5 can still be chosen in the panel);
the global `HZ` is set from it at the start of `render()`. Loan: 10%, 10 years, 4-year grace.
Owner's expense sheet values (column H, 06.10.2026) are in the defaults: barns from own funds, loan 3.8 mlrd for cows only;
2027 purchases silage 270, hay 50, straw 0 mln so'm; staff without zootechnician, 1 tractor driver, 3 irrigators, 1 guard.
Working capital raised from 1.5 to 1.7 mlrd because plot 7 adds 17 ga of wheat sowing in Nov 2026 (without it cash
went to −0.17 mlrd in 2027).
Results (49.4 ga, 10 years): investment 7.83 mlrd (own 4.03, loan 3.80); net profit 2027 −2.49, 2028 +0.55, 2029 +0.45,
2030 +0.15, 2031 +0.42, 2032 +1.88, 2033 +5.12, 2034 +5.87, 2035 +5.20, 2036 +5.67 mlrd; average 2029–2036 ≈ 3.10 mlrd;
lowest cash ≈ +0.03 mlrd; owner payback 2032; IRR ≈ 24.7%; DSCR min 1.62; herd 248 cows from 2033; 19 permanent + 43 seasonal jobs.
Open decision: feed self-sufficiency. With current rations even 49.4 ga does not feed the grown herd (~250 cows);
options: lower-hay ration, alfalfa on more plots, cap `maxCows` near 100–120.

## Open questions / next steps

- Total land 33 vs 32.4 ga; exact farm-zone boundary inside plot 1.
- Real quotes: Chinese cow price + transport + veterinary import permit, construction estimate,
  feed prices in Bukhara, milk buyer contract.
- Profit-tax regime for the farm (default 0%), land-tax rate per ga.
- Cash shortfall in 2031–2032 (loan principal starts while herd still grows): options are more working
  capital, a smaller `maxCows`, or selling surplus heifers earlier.
- Real quotes for collars/gateway (Fitcows or similar), milk meters, mixer scales, climate control, scrapers, calf feeder.
- Possible additions the owner may want: PDF/print layout for the bank, Russian version,
  scenario save/compare, own milk processing (qatiq/suzma) module.
