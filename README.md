# Takeoff – Flight Simulator

A realistic flight simulator that runs in the browser: twelve true-to-scale Boeing, Airbus and
fighter aircraft, a six-degree-of-freedom flight model, real terrain and real airports of the
US Southwest, and full air traffic control on the real frequencies.

**Live site (once deployed):** https://takeoff-flight-sim.web.app

## What is in it

- **Aircraft, to scale** – Boeing 737-800, 747-8, 777-300ER, 787-9 · Airbus A320neo, A330-300,
  A350-900, A380-800 · F-16C, F/A-18E, F-22A, F-35A. Models are generated from published
  dimensions (measured length, span and height are within 0.3 % of the real aircraft) with
  working flaps, spoilers, control surfaces, landing gear, fans and afterburners.
- **Flight model** – 120 Hz rigid-body simulation: lift and drag from each wing's real area,
  span and sweep, stall, Mach drag rise, ground effect, turbofan thrust lapse and spool-up,
  afterburners, reverse thrust, fuel burn, spring-damper landing gear with braking and steering,
  wind, gusts and turbulence, damage and crash detection.
- **Flight controls** – Airbus-style fly-by-wire with envelope protection, conventional
  augmentation for the 737/747, g-command for the fighters, and a direct law for all of them.
  Autopilot and autothrottle with heading, direct-to, altitude, vertical speed, ILS approach and
  autoland.
- **Glass cockpit** – primary flight display, navigation display with airport diagrams and taxi
  guidance, engine and systems display, mode control panel, and a conformal HUD in the fighters.
  GPWS call-outs, stall and overspeed warnings, landing reports.
- **Real world** – 1,229 × 1,056 km of California, Nevada and Arizona from real elevation data,
  with 26 real airports (17 civil, 9 military), their real runways and radio frequencies, 119
  navaids, city skylines, time of day, weather presets and airport lighting including PAPI.
- **ATC** – ATIS, clearance delivery, ground, tower, departure, centre and approach, with FAA
  phraseology, read-backs, taxi routes, vectors to the ILS, traffic sequencing, compliance
  monitoring, go-arounds and emergencies, spoken with speech synthesis. AI traffic shares the
  runway and the frequency.
- **Look and feel** – the menu is a dispatch desk over the live airport: a departures-board
  fleet list, a type sheet with a to-scale three-view drawing, and a boarding-pass flight
  release. In flight the radio is a hardware panel with amber LCD frequency windows and a
  printer-tape log. Airline tail artwork, glazed terminals and apron floodlights at night.
- **Optional AI ATC** – with your own Anthropic API key (Settings → AI ATC), Claude understands
  free-form typed or spoken radio calls. The key stays in your browser's local storage and is
  sent only to the Anthropic API. Without a key the built-in controller handles everything.

## Run it

```bash
npm install
```
```bash
npm run dev
```

Open the address Vite prints. A desktop browser with WebGL 2 is required; Chrome or Edge give
the best speech support.

## Fly it

Pick an aircraft, a departure and a destination, then **FLY**. Press `H` in flight for the full
control list and a first-flight guide. The essentials:

| | |
|---|---|
| Pitch / roll | arrow keys (`↓` pulls up) |
| Rudder / steering | `Q` `E` |
| Throttle | `W` `S` · `Home` full · `End` idle |
| Brakes · parking brake · reverse | `B` · `P` · `R` |
| Gear · flaps · speed brake | `G` · `[` `]` · `/` |
| Autopilot · autothrottle · arm ILS approach | `Z` · `X` · `V` |
| Radio: call · swap frequency · free text · talk | `F1`–`F8` · `Tab` · `Enter` · hold `Space` |
| Views · map · pause | `C` or `1`–`5` · `N` · `Esc` |

A URL can start a flight directly, for example
`/?fly&ac=a359&dep=KLAX&dest=KSFO&start=final&hour=21&wx=clear`.

## Test it

```bash
npm test
```

runs the flight-model acceptance tests for all twelve aircraft (ground handling, take-off,
manoeuvring, cruise, calm and crosswind autoland), the airport layout checks for all 26
airports, and a robot pilot that completes a gate-to-gate IFR flight using only the radio and
the autopilot.

```bash
npm run build
```
```bash
npm run preview
```
```bash
node tools/test-browser.mjs http://localhost:4173/
```

drives the production build in headless Chromium with real key presses.

## Deploy it (Firebase Hosting)

The project is configured for the Firebase project `takeoff-flight-sim`.

```bash
npx firebase-tools login
```
```bash
npm run deploy
```

Without the Firebase CLI, `tools/deploy_rest.py` publishes `dist/` through the Hosting REST API
using a Google OAuth access token in `FIREBASE_ACCESS_TOKEN`.

Or let GitHub do it: add a service-account key with the *Firebase Hosting Admin* role as the
repository secret `FIREBASE_SERVICE_ACCOUNT_TAKEOFF_FLIGHT_SIM`; the workflow in
`.github/workflows/deploy.yml` then tests, builds and deploys on every push to `main`.

## Rebuild the world data

`public/data` is baked from public sources and committed. To regenerate it:

```bash
python3 tools/bake_terrain.py /path/to/NE2_HR_LC.tif
```
```bash
python3 tools/bake_airports.py
```

(Python 3 with NumPy and Pillow; the land-cover raster is Natural Earth II 10 m `NE2_HR_LC`.)

## How it was built

[INSTRUCTIONS.md](INSTRUCTIONS.md) is the step-by-step specification this repository follows.

## Footprint of the AI sessions

This repository is produced in AI coding sessions. This section is updated at the end of every
session (the rule is in [CLAUDE.md](CLAUDE.md)); the commit that writes it adds slightly to the
figures. Token counts are measured, energy and water are estimates.

### Session log

| # | Dates | Work | Tokens processed | Cost | Energy (est.) | Water (est.) |
|---|---|---|---:|---:|---:|---:|
| 1 | 10 – 11 Nov 2026 | Initial build; interface redesign and night apron lighting | 50,894,381 | US$78.22 | ≈ 1.3 kWh | ≈ 1.4 L |
| | | **Total** | **50,894,381** | **US$78.22** | **≈ 1.3 kWh** | **≈ 1.4 L** |

### Tokens (measured)

Taken from the session's own usage record.

| Session 1 | Initial build | Redesign | Total |
|---|---:|---:|---:|
| Output (generated) | 539,460 | 75,048 | 614,508 |
| Input, uncached | 145 | 2,166 | 2,311 |
| Input written to the prompt cache | 2,682,036 | 76,105 | 2,758,141 |
| Input re-read from the prompt cache | 35,488,299 | 12,031,122 | 47,519,421 |
| **Total processed** | **38,709,940** | **12,184,441** | **50,894,381** |
| Cost at API list prices | US$71.59 | US$6.63 | US$78.22 |

- Cache reads dominate because every model request re-reads the conversation so far.
- Elapsed time: about 30 hours from start to this commit, including long idle waits.
- Separately, two live test requests to the Claude API for the AI ATC feature used 758 input
  and 66 output tokens in total.

### Energy and water (estimated, not measured)

Neither is reported for a session, and there is no published per-token figure for the model
used, so these are order-of-magnitude estimates from the token counts above.

| All sessions | Tokens | Assumed Wh per 1,000 tokens | Energy |
|---|---:|---:|---:|
| Output | 614,508 | 0.3 – 3 | 0.18 – 1.8 kWh |
| Cache writes | 2,758,141 | 0.03 – 0.3 | 0.08 – 0.8 kWh |
| Cache reads | 47,519,421 | 0.003 – 0.03 | 0.14 – 1.4 kWh |
| **Total** | | | **0.41 – 4.1 kWh (about 1.3 kWh)** |

- **Energy: roughly 1.3 kWh**, plausibly 0.41 – 4.1 kWh. The low end of the output rate comes
  from vendor-published figures of about 0.24 – 0.34 Wh for a typical short chat reply; the
  high end allows for a larger model working with a very long context. The rates for input
  are assumptions. The single figure is the geometric middle of the range.
- **Water: roughly 1.4 litres**, plausibly 0.45 – 4.5 litres, using about 1.1 mL of on-site
  cooling water per Wh (the ratio in Google's published per-prompt figures). Water used to
  generate the electricity is not included and would add to this.
- Not included: the cloud container that ran builds and tests, terrain and airport data
  downloads, and model training.

The true figures could be several times higher or lower than these estimates.

## Data and credits

- Elevation: Mapzen / AWS Terrain Tiles (open data, including USGS 3DEP and SRTM).
- Land colour: Natural Earth (public domain).
- Airports, runways, frequencies, navaids: OurAirports (public domain).
- ILS frequencies are the published ones at KSFO and KLAX and synthetic elsewhere; a few military
  frequencies are approximations.

For entertainment only. **Not for real-world navigation or flight training.** Aircraft names are
used to describe the simulated types; liveries are fictional.
