# Takeoff – Flight Simulator · Build Instructions

A step-by-step specification for building, verifying and deploying **Takeoff – Flight Simulator**:
a browser flight simulator with twelve true-to-scale Boeing, Airbus and fighter aircraft, a
six-degree-of-freedom flight model, real terrain and real airports of the US Southwest, and
radio-accurate ATC.

Follow the phases in order. Every phase ends with a check that must pass before the next begins.

---

## 0. Ground rules

| Topic | Decision |
|---|---|
| Product name | **Takeoff – Flight Simulator** (page title, menu, manifest) |
| Platform | Static single-page web app, desktop browsers with WebGL2 |
| Stack | Vite (build) · three.js (rendering) · plain ES modules, no UI framework |
| Hosting | Firebase Hosting, project `takeoff-flight-sim` → `https://takeoff-flight-sim.web.app` |
| Units | SI internally (m, kg, s, N, rad). Aviation units (ft, kt, fpm, nm, inHg) only at the UI/ATC boundary |
| World frame | Right-handed, `+X` east, `+Y` up, `+Z` south. 1 unit = 1 metre. Never scale an aircraft |
| Body frame | `-Z` forward, `+X` right wing, `+Y` up (three.js convention) |
| Claude API | Optional at run time, **never called while building or testing**. Key is supplied by the player in Settings and stored only in that browser's `localStorage`. No key is ever committed |
| Secrets | The Firebase web config is public by design and may be committed. Deploy credentials and API keys may not |
| Data licences | Elevation: Mapzen/AWS Terrain Tiles (public open data, attribution). Land colour: Natural Earth (public domain). Airports: OurAirports (public domain) |
| Honesty | The simulator is for entertainment. State "not for real-world navigation" in the UI |

---

## 1. Repository layout

```
INSTRUCTIONS.md            this file
README.md                  short overview + quick start
package.json               scripts: dev, build, preview, test, bake, deploy
vite.config.js
firebase.json  .firebaserc Firebase Hosting config
.github/workflows/deploy.yml   CI deploy to Firebase Hosting
index.html                 single page shell
public/data/
  terrain.png              baked elevation (16-bit in R,G) + water flags (B)
  landcover.jpg            baked land colour
  airports.json            baked airports, runways, frequencies, navaids
src/
  main.js                  boot, game loop, state machine
  firebase.js              initializeApp with the project config
  core/      units.js  math.js  settings.js  input.js
  physics/   atmosphere.js  aero.js  engine.js  gear.js  flightModel.js
  systems/   fbw.js  autopilot.js  warnings.js
  aircraft/  specs.js  loft.js  airliner.js  fighter.js  model.js
  world/     projection.js  heightfield.js  terrain.js  terrainWorker.js
             airports.js  airportScenery.js  sky.js  water.js  clouds.js  traffic.js
  atc/       phraseology.js  atc.js  radio.js  voice.js  claude.js
  ui/        menu.js  hud.js  pfd.js  nd.js  eicas.js  fighterHud.js  panels.js  styles.css
  audio/     sound.js
tools/
  bake_terrain.py          builds terrain.png + landcover.jpg
  bake_airports.py         builds airports.json
  test-physics.mjs         headless flight-model acceptance tests
  test-browser.mjs         headless Chromium smoke test + screenshots
```

**Check 1:** `npm install` succeeds and `npm run dev` serves an empty page titled
"Takeoff – Flight Simulator".

---

## 2. World and data pipeline

The world is a real 1,229 km × 1,056 km slice of California, Nevada and western Arizona.

### 2.1 Projection (`src/world/projection.js`)
1. Use a spherical **stereographic** projection centred on 36.1° N, 117.2° W, Earth radius
   6,371,008.8 m. It is conformal, so runway headings stay true; scale error is < 0.3 % at the edges.
2. Export `llToWorld(lat, lon) → {x, z}` and `worldToLl(x, z) → {lat, lon}`.
3. Grid north is treated as true north. Magnetic variation is a linear function of `x`
   (≈ 13.5° E at the coast, ≈ 10° E in Arizona); every heading shown to the pilot or spoken by ATC
   is **magnetic**, so runway numbers match the compass.

### 2.2 Elevation (`tools/bake_terrain.py` → `public/data/terrain.png`)
1. Download zoom-8 Terrarium tiles covering the region from
   `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`; decode
   `h = R·256 + G + B/256 − 32768`.
2. Resample into a 2048 × 1760 grid, 600 m per cell, in the world projection (bilinear).
3. Flood-fill from the Pacific over cells with `h ≤ 0.5 m` to find the **ocean**. Land below sea
   level (Death Valley, the Salton basin) is not ocean and keeps its real elevation.
4. Detect **lakes** as connected, exactly-flat regions above a minimum size.
5. Give ocean cells a synthetic sea bed that deepens with distance from the coast so the shoreline
   falls on the real coast after interpolation.
6. Encode: `R,G` = big-endian `uint16(h + 500)`, `B` bit 0 = ocean, bit 1 = lake. Save as RGB PNG.

### 2.3 Land colour (`tools/bake_terrain.py` → `public/data/landcover.jpg`)
1. Crop Natural Earth II (10 m land cover, no relief shading) to the region and reproject to a
   1024 × 880 grid (1,200 m per cell). Save as high-quality JPEG.

### 2.4 Airports (`tools/bake_airports.py` → `public/data/airports.json`)
1. Read OurAirports `airports.csv`, `runways.csv`, `airport-frequencies.csv`, `navaids.csv`.
2. Keep these fields: **civil** KSFO KOAK KSJC KSMF KRNO KFAT KMRY KSBA KBUR KLAX KLGB KSNA KONT KPSP
   KSAN KLAS KPHX · **military** KEDW KLSV KNKX KNLC KNFL KSUU KLUF KNID KNTD.
3. Per runway keep both threshold positions (projected to world metres), true heading, length,
   width, surface, displaced thresholds and threshold elevations. Drop closed runways, helipads and
   runways shorter than 1,500 m.
4. Per airport keep ATIS, clearance, ground, tower, departure and approach frequencies. Military
   UHF entries stored as tens of MHz are rescaled. Missing roles fall back to tower.
5. Add an ILS for every hard runway end ≥ 2,000 m: real frequencies where known (KSFO, KLAX),
   otherwise a deterministic channel between 108.10 and 111.95 MHz, flagged `synthetic`.
6. Keep VOR/VORTAC navaids inside the region for the navigation display.

### 2.5 Height field (`src/world/heightfield.js`)
One pure function, shared by the main thread and the terrain workers so physics and graphics agree:
1. Bicubic (Catmull-Rom) interpolation of the baked grid.
2. Fractal detail noise whose amplitude scales with local relief, so valleys stay flat and
   mountains gain ridges below the 600 m data resolution.
3. Airport flattening: inside the union of padded runway/apron rectangles the ground is exactly
   field elevation, blending to natural terrain over 600 m.
4. `heightAt(x, z)`, `normalAt(x, z)`, `isWater(x, z)`.

**Check 2:** baked files exist; KSFO sits at the bay shore near sea level, KRNO near 1,345 m,
Mt Whitney above 4,000 m, Death Valley below sea level and dry.

---

## 3. Rendering the world

1. **Renderer** – `WebGLRenderer` with logarithmic depth buffer (near 0.5 m, far 600 km), ACES tone
   mapping, sRGB output, PCF soft shadows from one sun light whose shadow frustum follows the player.
2. **Terrain** (`terrain.js`, `terrainWorker.js`) – quadtree of square tiles, 153.6 km roots down to
   600 m leaves (9 levels), 48 × 48 quads each with skirts. A tile splits when the camera is closer
   than 2.2 × its size. Geometry (positions, normals, colours) is generated in Web Workers and
   transferred; at most a few tiles are swapped per frame. Parents stay visible until all four
   children are ready, so there are never holes.
3. **Terrain colour** – land-cover map sample, modified per vertex: rock on steep slopes, snow above
   the seasonal snow line, sand at the shore, farmland patchwork on flat fertile ground. A tiling
   detail texture breaks up colour up close.
4. **Water** (`water.js`) – one camera-following plane at sea level with Fresnel sky reflection,
   animated normals and sun glint, masked by the baked ocean flag so below-sea-level deserts stay
   dry. Lakes are flat, water-shaded terrain.
5. **Sky** (`sky.js`) – physical sky dome, sun position from time of day, stars at night, fog/aerial
   perspective tied to visibility and altitude.
6. **Clouds** (`clouds.js`) – two procedural layers (coverage, base and tops from the weather
   preset) with white-out when flying through.
7. **Airports** (`airportScenery.js`) – built lazily within 60 km:
   - Runways with painted textures: threshold bars, designator numbers, centreline, touchdown-zone
     and aiming-point markings, edge lines, displaced-threshold arrows.
   - A parallel taxiway and connectors for each runway, an apron with numbered stands, terminal,
     control tower and hangars.
   - Lighting: white runway edge lights, green threshold / red end lights, approach light bars,
     blue taxiway edge lights, and four-light **PAPI** units whose red/white split is computed
     from the viewer's real glide angle (3.0°).
8. **Cities** – instanced building blocks at the real positions of the major cities for scale cues.

**Check 3:** flying camera test shows continuous terrain from ground level to 40,000 ft with no
holes, runway numbers are readable from short final, and the frame rate stays interactive.

---

## 4. Aircraft

### 4.1 Specifications (`src/aircraft/specs.js`)
Every number below is the published real-world value and is used directly by the model builder
and the flight model. Lengths in metres, masses in kg, thrust in kN per engine.

| # | Aircraft | Length | Span | Height | Wing area | OEW | MTOW | Fuel | Engines | Thrust | MMO | Ceiling |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Boeing 737-800 | 39.47 | 35.79 | 12.55 | 124.6 | 41,413 | 79,016 | 20,894 | 2 × CFM56-7B26 | 117 | 0.82 | 41,000 |
| 2 | Boeing 747-8I | 76.25 | 68.45 | 19.35 | 554 | 220,128 | 447,696 | 193,280 | 4 × GEnx-2B67 | 296 | 0.90 | 43,100 |
| 3 | Boeing 777-300ER | 73.86 | 64.80 | 18.50 | 436.8 | 167,829 | 351,533 | 145,538 | 2 × GE90-115B | 513 | 0.89 | 43,100 |
| 4 | Boeing 787-9 | 62.81 | 60.12 | 17.02 | 360.5 | 128,850 | 254,011 | 101,456 | 2 × GEnx-1B74 | 320 | 0.90 | 43,100 |
| 5 | Airbus A320neo | 37.57 | 35.80 | 11.76 | 122.6 | 44,300 | 79,000 | 18,990 | 2 × LEAP-1A26 | 120.6 | 0.82 | 39,800 |
| 6 | Airbus A330-300 | 63.66 | 60.30 | 16.79 | 361.6 | 129,400 | 242,000 | 109,186 | 2 × Trent 772B | 316 | 0.86 | 41,450 |
| 7 | Airbus A350-900 | 66.80 | 64.75 | 17.05 | 442 | 142,400 | 280,000 | 110,523 | 2 × Trent XWB-84 | 374.5 | 0.89 | 43,100 |
| 8 | Airbus A380-800 | 72.72 | 79.75 | 24.09 | 845 | 277,000 | 575,000 | 253,983 | 4 × Trent 970 | 332 | 0.89 | 43,000 |
| 9 | F-16C Fighting Falcon | 15.06 | 9.96 | 4.88 | 27.87 | 8,573 | 19,187 | 3,175 | 1 × F110-GE-129 | 76.3 / 131 AB | 2.05 | 50,000 |
| 10 | F/A-18E Super Hornet | 18.31 | 13.62 | 4.88 | 46.5 | 14,552 | 29,937 | 6,780 | 2 × F414-GE-400 | 58 / 98 AB | 1.8 | 50,000 |
| 11 | F-22A Raptor | 18.92 | 13.56 | 5.08 | 78.04 | 19,700 | 38,000 | 8,200 | 2 × F119-PW-100 | 116 / 156 AB | 2.25 | 65,000 |
| 12 | F-35A Lightning II | 15.67 | 10.70 | 4.38 | 42.7 | 13,290 | 31,751 | 8,278 | 1 × F135-PW-100 | 125 / 191 AB | 1.6 | 50,000 |

Each spec also carries: fuselage width/height, wing sweep, taper, dihedral and root position, tail
spans and heights, engine fan diameter, nacelle length and station, landing-gear wheelbase, track
and wheel layout, flap detents, lift and drag coefficients, g limits and the control-law type.

### 4.2 Model builder (`loft.js`, `airliner.js`, `fighter.js`, `model.js`)
Models are generated from the specs, in metres, so they are to scale by construction.
1. `loft.js` – helpers that skin a list of cross-sections into smooth, hard-edged geometry.
2. **Airliners**: fuselage lofted from circular/ovoid sections with nose and upswept tail cones
   (747 upper-deck hump, A380 double-deck ovoid); wings from aerofoil sections with root, kink and
   tip, real sweep/dihedral and the correct tip device (blended winglet, sharklet, raked tip,
   fence); nacelles with intake lip, fan face and spinning fan, on pylons; fin and tailplane;
   wheel bogies with the real wheel counts.
3. **Fighters**: fuselage lofted from hand-placed super-elliptical stations (chines, intakes,
   spine), bubble canopy, thin swept wings with leading-edge extensions, all-moving stabilators,
   single or twin canted fins, round or two-dimensional nozzles with an afterburner plume.
4. Fuselage livery, cabin windows, cockpit glazing and doors are painted on a canvas texture.
5. **Animated parts**, all driven by the simulation state: ailerons, elevators/stabilators,
   rudder(s), flaps (Fowler motion), spoilers/speed brake, landing gear retraction, wheel spin,
   fan rotation, afterburner, nav/beacon/strobe/landing lights.
6. After building, measure the bounding box and assert length, span and height are within 1 % of
   the spec. This runs in the test suite.

**Check 4:** the menu hangar shows all twelve aircraft; the scale test passes for each.

---

## 5. Flight model

Fixed-step rigid-body integration at 120 Hz (`flightModel.js`), independent of frame rate.

1. **State**: position, velocity (world), orientation quaternion, body angular rates, fuel mass,
   per-engine spool state, gear/flap/spoiler positions.
2. **Atmosphere** (`atmosphere.js`): ISA to 20 km with temperature offset and QNH; density,
   pressure, speed of sound; CAS from Mach and static pressure; wind that veers and strengthens
   with height; Dryden-style turbulence.
3. **Aerodynamics** (`aero.js`), all from wing area, span, sweep and aspect ratio:
   - Lift-curve slope from the Helmbold/DATCOM formula with Prandtl-Glauert compressibility.
   - `CL = CL0 + ΔCL_flap + CLα·α`, blended into a flat-plate model past the stall angle; slats
     raise the stall angle, flaps add lift and drag per detent.
   - `CD = CD0 + ΔCD(flaps, gear, spoilers) + k·CL² + wave drag` (drag divergence above critical
     Mach; supersonic wave drag for fighters).
   - Side force and the full set of stability/control derivatives for pitch, roll and yaw
     (`Cmα, Cmq, Cmδe, Clβ, Clp, Clr, Clδa, Cnβ, Cnr, Cnδr, …`), ground effect near the runway.
4. **Engines** (`engine.js`): thrust lapse with density and Mach (separate high-bypass and
   afterburning low-bypass laws), spool-up/down lag, N1/N2, EGT and fuel flow from TSFC, reverse
   thrust for airliners, afterburner for fighters, thrust applied at each engine's real position.
5. **Landing gear** (`gear.js`): spring-damper struts at the real wheelbase and track, rolling
   resistance, braking with anti-skid limits, tyre side force, nose-wheel steering that narrows
   with speed, parking brake, ground spoilers and autobrake.
6. **Mass**: empty + payload + fuel, inertia from radii of gyration; fuel burns off.
7. **Failure and damage**: stall, overspeed, over-g, tail strike, hard landing, gear-up landing,
   wing/pod strike, terrain and water impact. Each produces a specific crash report.

### 5.1 Flight control laws (`fbw.js`)
- **Airbus and 777/787/fighters – fly-by-wire**: side-stick commands load factor/pitch rate and roll
  rate; neutral stick holds attitude; auto-trim; turn coordination and yaw damping. Airbus normal
  law protections: alpha floor/alpha max, ±67° bank, +30°/−15° pitch, load-factor limits.
  Fighters: g and angle-of-attack limiters.
- **737 and 747 – conventional**: stability augmentation and yaw damper but no envelope
  protection; the aircraft can be stalled and over-banked.
- **Direct law** toggle for all types: stick moves the surfaces directly; manual pitch trim.

### 5.2 Autopilot and autothrottle (`autopilot.js`)
MCP-style modes: `A/T SPD` (IAS or Mach), `HDG SEL`, `NAV` (direct-to), `ALT HOLD` with altitude
capture, `V/S`, `LOC`, `G/S` (`APP`), and autoland `FLARE`/`ROLLOUT`.

**Check 5:** `npm test` runs `tools/test-physics.mjs`. For every aircraft: it accelerates to
rotation speed and lifts off within the runway length, climbs, holds cruise altitude and Mach with
thrust in hand, and flies a coupled ILS approach to touchdown within limits.

---

## 6. Controls

Controls are deliberately complete; the in-game help (`H`) lists them all.

| Function | Keys |
|---|---|
| Pitch / roll | `↑ ↓ ← →` (or mouse-yoke with `M`) |
| Rudder / nose-wheel steering | `Q` `E` |
| Throttle | `PageUp` / `PageDown` or `W` / `S`; `Home` full, `End` idle |
| Afterburner (fighters) | last 15 % of throttle travel |
| Reverse thrust | `R` (hold, on ground) |
| Wheel brakes / parking brake | `B` (hold) / `P` |
| Landing gear | `G` |
| Flaps up / down one detent | `[` / `]` |
| Speed brake / arm ground spoilers | `/` / `Shift`+`/` |
| Pitch trim (direct law) | `,` / `.` |
| Autopilot master / autothrottle | `Z` / `X` |
| Fly-by-wire ↔ direct law | `Y` |
| Engines start / shut down | `I` |
| Lights | `L` |
| Views: next / cockpit / chase | `C` / `1` / `2`; drag to orbit, wheel to zoom |
| Radio: transmit menu item | `F1`–`F8` (or click) |
| Radio: swap COM active/standby | `Tab` |
| Radio: free-text / push-to-talk | `Enter` / hold `Space` |
| Pause · help · map | `Esc` · `H` · `N` |
| Time acceleration | `-` / `=` |

Also supported: gamepads through the Gamepad API (sticks, triggers, standard buttons).
All axes are rate-smoothed so the keyboard flies like a centred stick.

**Check 6:** every control above changes the corresponding state and the external model.

---

## 7. Cockpit displays and HUD

1. **PFD**: attitude with pitch ladder, bank scale and slip indicator; speed tape with trend
   arrow, V-speed bugs, stall and overspeed bars, Mach; altitude tape with selected altitude and
   QNH; vertical speed; heading tape with bug; flight mode annunciator; ILS localiser/glideslope
   scales; radio altitude.
2. **ND**: track-up moving map with range rings, airports, runways and extended centrelines,
   navaids, flight-plan line, AI traffic (TCAS symbols), wind arrow, ground speed and TAS.
3. **Engine/systems display**: N1 arcs per engine, EGT, fuel flow, fuel quantity, gross weight,
   flap/slat, gear, spoiler and brake indications, trim.
4. **MCP**: speed, heading, altitude and vertical-speed selectors with mode buttons.
5. **Fighter HUD**: conformal pitch ladder, flight-path vector, speed/altitude boxes, heading
   tape, g, angle of attack, Mach.
6. **Warnings** (`warnings.js`): stick shaker/stall, overspeed clacker, GPWS call-outs
   (2500…10, minimums, SINK RATE, PULL UP, TOO LOW GEAR/FLAPS, BANK ANGLE), configuration warning
   on take-off, autopilot disconnect.
7. A landing report grades every touchdown (rate of descent, g, distance from the aiming point,
   centreline offset).

---

## 8. Air traffic control

### 8.1 Procedural core (`atc.js`, `phraseology.js`, `radio.js`)
The controller is a state machine that knows the real field: ICAO name, runways, frequencies.
1. **Facilities and frequencies** are the real ones from the baked data. COM1 has active and
   standby frequencies; a hand-off pre-loads standby and the pilot swaps. You only hear the
   frequency you are tuned to. Tuning ATIS plays the looped ATIS.
2. **Runway in use** is chosen from the wind; the ATIS letter advances with weather changes.
3. **IFR flow**: ATIS → clearance delivery (route, initial altitude, departure frequency,
   squawk) → read-back → ground (push-back, taxi route to the holding point) → tower (hold short,
   line up and wait, take-off clearance with wind) → departure (radar contact, climbs, direct) →
   centre (cruise, descent) → approach (descents, speed control, vectors to final, approach
   clearance) → tower (landing clearance, wind) → ground (taxi to stand).
4. **VFR circuit work**: closed-traffic clearances, downwind/base calls, touch-and-go, the option.
5. **Phraseology** follows FAA 7110.65 wording and ICAO digit pronunciation ("niner", "tree",
   "fife"), group-form flight numbers, "flight level", "point" for frequencies.
6. **Read-backs** are expected; missing ones are prompted. **Compliance** is monitored: altitude
   and heading deviations, speeding below 10,000 ft, runway incursions and take-off or landing
   without clearance are called out.
7. **Emergencies**: `MAYDAY` gives priority handling and vectors to the nearest suitable runway.
8. **Traffic** (`traffic.js`): AI arrivals and departures use the active runways and airways with
   their own call signs; tower sequences the player around them and issues traffic advisories;
   their transmissions are audible on frequency.

### 8.2 Voice (`voice.js`)
Web Speech synthesis with a distinct voice per controller and for the pilot, radio squelch and
static from Web Audio. Hold `Space` for speech recognition where the browser supports it.

### 8.3 Claude-powered ATC (`claude.js`, optional)
1. The player pastes an Anthropic API key in **Settings → AI ATC**. It is stored in
   `localStorage` only and sent only to `api.anthropic.com`.
2. Use the official `@anthropic-ai/sdk` in the browser (`dangerouslyAllowBrowser: true`),
   lazy-loaded so players without a key never download it.
3. Default model `claude-opus-5-5` at `effort: "low"` with server-side refusal fallback;
   Settings also offers `claude-sonnet-5-5` and `claude-haiku-5-5` for lower cost and latency.
4. Each transmission sends one small request: a cached system prompt (role, phraseology rules,
   output schema) plus a compact JSON situation report and the list of **actions the procedural
   controller can legally take right now**, each with its canonical wording.
5. Claude returns structured output `{action, params, reply, readback_ok}`. The simulator applies
   the action through the same procedural handlers, so the AI can never issue a clearance the
   simulation does not track; free-form questions get free-form, in-character replies.
6. Budget: ≈ 1–2 k input tokens and < 200 output tokens per transmission. Any API error falls back
   to the procedural matcher silently and shows a one-line notice.

**Check 8:** a complete KSFO → KLAX flight can be flown using only the radio menu, with every
hand-off on the correct real frequency, and the same flight works with typed free text when no
API key is present (keyword matcher).

---

## 9. Menu and settings

1. Title screen: **Takeoff – Flight Simulator**.
2. Hangar: aircraft cards with live rotating 3D preview and the spec sheet.
3. Flight setup: departure and destination airports, start position (gate, runway, 10 nm final,
   cruise), call sign (airline telephony + flight number, or military), fuel and payload.
4. Environment: time of day, weather preset (clear, scattered, overcast, low visibility,
   crosswind, storm) with wind direction/speed.
5. Settings: graphics quality, sound and voice volumes, units, realism (damage, FBW default,
   automatic frequency swap), AI ATC key and model.
6. Pause menu: resume, restart, reposition, back to menu.

---

## 10. Audio (`sound.js`)

All synthesised with Web Audio (no audio files): engine core and fan tones following N1,
afterburner roar, airflow by airspeed, gear and flap motors, touchdown chirp, rumble on the
ground, warning horns, radio effects.

---

## 11. Firebase

1. `src/firebase.js` calls `initializeApp` with the project config
   (`projectId: "takeoff-flight-sim"`). Only the `firebase/app` module is imported.
2. `firebase.json`: `"public": "dist"`, immutable caching for hashed assets, short caching for
   `index.html`, one-day caching for `/data/**`.
3. `.firebaserc`: default project `takeoff-flight-sim`.

### 11.1 Deploy from a terminal
```bash
npm install
```
```bash
npm run build
```
```bash
npx firebase-tools login
```
```bash
npx firebase-tools deploy --only hosting --project takeoff-flight-sim
```
The site is then live at `https://takeoff-flight-sim.web.app`.

### 11.2 Deploy from GitHub (recommended)
1. In the Firebase console create a service account key with the *Firebase Hosting Admin* role
   (or run `npx firebase-tools init hosting:github`, which does this for you).
2. Save the JSON as the repository secret `FIREBASE_SERVICE_ACCOUNT_TAKEOFF_FLIGHT_SIM`.
3. `.github/workflows/deploy.yml` builds and deploys the live channel on every push to `main`,
   and a preview channel for pull requests.

**Check 11:** `npm run build` produces `dist/`; `npx firebase-tools hosting:channel:deploy` or the
workflow publishes it; the public URL loads the menu.

---

## 12. Verification before shipping

1. `npm test` – physics acceptance tests and model scale tests pass for all twelve aircraft.
2. `npm run build` – no errors or missing assets.
3. `node tools/test-browser.mjs` – headless Chromium loads the build, starts a flight for at least
   one airliner and one fighter, advances the simulation, and reports zero console errors;
   screenshots are reviewed by eye.
4. Manual checklist: take-off, pattern and landing in a 737-800; supersonic run in an F-22;
   an ILS autoland in an A350; a full ATC flight.
5. Update `README.md` with features, controls and deployment notes.

---

## 13. Build order

1. Scaffold (phase 1) and Firebase config (phase 11 files).
2. Bake data (phase 2).
3. Core maths, atmosphere, aerodynamics, engines, gear, flight model, control laws, autopilot –
   with the headless physics tests (phase 5).
4. Aircraft specs and model builders (phase 4).
5. Terrain, water, sky, clouds, airports (phase 3).
6. Input, cameras, HUD and displays (phases 6–7).
7. ATC, voice, traffic, Claude integration (phase 8).
8. Menu, settings, audio (phases 9–10).
9. Verification, README, commit, push, deploy (phases 11–12).
