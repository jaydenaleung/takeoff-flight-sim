# Takeoff – Flight Simulator · Build Instructions

A step-by-step specification for building, verifying and deploying **Takeoff – Flight Simulator**:
a browser flight simulator with twelve true-to-scale Boeing, Airbus and fighter aircraft, a
six-degree-of-freedom flight model, real terrain and real airports of the US Southwest, and
radio-accurate ATC.

Follow the phases in order. Every phase ends with a check that must pass before the next begins.
The repository in which this file lives is the result of following it.

---

## 0. Ground rules

| Topic | Decision |
|---|---|
| Product name | **Takeoff – Flight Simulator** (page title, menu, loading screen) |
| Platform | Static single-page web app for desktop browsers with WebGL 2 |
| Stack | Vite (build) · three.js (rendering) · plain ES modules, no UI framework |
| Hosting | Firebase Hosting, project `takeoff-flight-sim` → `https://takeoff-flight-sim.web.app` |
| Units | SI internally (m, kg, s, N, rad). Aviation units (ft, kt, fpm, nm, inHg) only at the UI/ATC boundary |
| World frame | Right-handed, `+X` east, `+Y` up, `+Z` south. 1 unit = 1 metre. Never scale an aircraft |
| Body frame | `-Z` forward, `+X` right wing, `+Y` up (three.js convention) |
| Claude API | Optional at run time. The key is supplied by the player in Settings and stored only in that browser's `localStorage`. No key is ever committed or bundled |
| Secrets | The Firebase web config is public by design and may be committed. Deploy credentials and API keys may not |
| Data licences | Elevation: Mapzen/AWS Terrain Tiles (open data, attribution). Land colour: Natural Earth (public domain). Airports: OurAirports (public domain) |
| Honesty | The simulator is for entertainment. State "not for real-world navigation" in the UI |

---

## 1. Repository layout

```
INSTRUCTIONS.md            this file
README.md                  overview, quick start, controls, deployment, session footprint
CLAUDE.md                  standing rules for AI coding sessions
package.json               scripts: dev, build, preview, test, test:browser, bake, deploy
vite.config.js
firebase.json  .firebaserc Firebase Hosting config
.github/workflows/deploy.yml   CI: test, build, deploy to Firebase Hosting
index.html                 single page shell
public/data/
  terrain.png              baked elevation (16-bit in R,G) + water flags (B)
  landcover.jpg            baked land colour
  airports.json            baked airports, runways, frequencies, navaids
src/
  main.js                  boot, main loop, menu <-> flight state
  flight.js                one flight session: aircraft, systems, fixed-step loop, landing report
  firebase.js              initializeApp with the project config
  core/      units.js  settings.js  input.js  views.js
  physics/   atmosphere.js  aero.js  engine.js  flightModel.js
  systems/   fbw.js  autopilot.js  warnings.js
  aircraft/  specs.js  loft.js  airliner.js  fighter.js  model.js
  world/     projection.js  heightfield.js  terrain.js  terrainWorker.js  water.js  sky.js
             airports.js  airportScenery.js  traffic.js  world.js
  atc/       phraseology.js  atc.js  voice.js  claude.js
  ui/        ui.js  menu.js  hud.js  pfd.js  nd.js  eicas.js  fighterHud.js  threeView.js
             styles.css
  audio/     sound.js
tools/
  bake_terrain.py          builds terrain.png + landcover.jpg
  bake_airports.py         builds airports.json
  test-physics.mjs         flight-model acceptance tests (all 12 aircraft)
  test-airports.mjs        airport layout and taxi-routing checks (all 26 airports)
  test-atc.mjs             robot pilot flies a complete gate-to-gate ATC flight
  test-browser.mjs         headless Chromium test of the real UI
  hangar.html  shot.mjs    development viewer and screenshot helper
```

**Check 1:** `npm install` succeeds and `npm run dev` serves a page titled
"Takeoff – Flight Simulator".

---

## 2. World and data pipeline

The world is a real 1,229 km × 1,056 km slice of California, Nevada and western Arizona.

### 2.1 Projection (`src/world/projection.js`)
1. Use a spherical **stereographic** projection centred on 36.1° N, 117.2° W, Earth radius
   6,371,008.8 m. It is conformal, so runway headings stay true; scale error is < 0.3 % at the edges.
2. Export `llToWorld(lat, lon) → {x, z}` and `worldToLl(x, z) → {lat, lon}`.
3. Grid north is treated as true north. A fitted declination `D(x, z)` (baked into
   `airports.json`) converts grid headings to **magnetic**, so that every runway reads its real
   magnetic heading and runway numbers match the compass. Everything shown to the pilot or spoken
   by ATC is magnetic.

### 2.2 Elevation (`tools/bake_terrain.py` → `public/data/terrain.png`)
1. Download zoom-8 Terrarium tiles covering the region from
   `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`; decode
   `h = R·256 + G + B/256 − 32768`.
2. Resample into a 2048 × 1760 grid, 600 m per cell, in the world projection (bilinear).
3. Flood-fill from the map borders over cells with `h ≤ 0.5 m` to find the **ocean**. Land below
   sea level (Death Valley, the Salton basin) is not ocean and keeps its real elevation.
4. Detect **lakes** as connected, exactly-flat regions of at least 14 cells.
5. Give ocean cells a synthetic sea bed that deepens with distance from the coast so the shoreline
   falls on the real coast after interpolation.
6. Encode: `R,G` = big-endian `uint16((h + 500) · 4)`; `B` = 255 ocean, 128 lake, 0 land. RGB PNG.

### 2.3 Land colour (`tools/bake_terrain.py` → `public/data/landcover.jpg`)
1. Crop Natural Earth II (10 m land cover, no relief shading, `NE2_HR_LC.tif`) to the region and
   reproject to a 1024 × 880 grid (1,200 m per cell). Save as high-quality JPEG.

### 2.4 Airports (`tools/bake_airports.py` → `public/data/airports.json`)
1. Read OurAirports `airports.csv`, `runways.csv`, `airport-frequencies.csv`, `navaids.csv`.
2. Keep these fields: **civil** KSFO KOAK KSJC KSMF KRNO KFAT KMRY KSBA KBUR KLAX KLGB KSNA KONT KPSP
   KSAN KLAS KPHX · **military** KEDW KLSV KNKX KNLC KNFL KSUU KLUF KNID KNTD.
3. Per runway keep both pavement ends (projected to world metres), grid heading, length, width,
   surface and displaced thresholds. Drop closed runways, unpaved runways and runways shorter than
   1,500 m.
4. Per airport keep ATIS, clearance, ground, tower, departure and approach frequencies. Military
   UHF entries stored as tens of MHz are rescaled. Missing roles fall back to a sensible neighbour.
5. Add an ILS for every hard runway end ≥ 2,000 m: published frequencies where known (KSFO, KLAX),
   otherwise a deterministic channel between 108.10 and 111.95 MHz, flagged `synthetic`.
6. Keep VOR/VORTAC navaids inside the region for the navigation display.
7. Fit and store the declination plane used in 2.1.

### 2.5 Height field (`src/world/heightfield.js`)
One pure class, shared by the main thread and the terrain workers so physics and graphics agree:
1. Bicubic (Catmull-Rom) interpolation of the baked grid.
2. Fractal detail noise whose amplitude scales with local relief, so valleys stay flat and
   mountains gain ridges below the 600 m data resolution.
3. Airport flattening: inside the union of padded runway/taxiway/apron rectangles the ground is
   exactly field elevation, blending to natural terrain over 650 m.
4. `heightAt(x, z)`, `water(x, z)`, `surfaceAt(x, z)`.

### 2.6 Airport ground layout (`src/world/airports.js`)
Generated deterministically from the real runways: an apron on the side of the main runway
farthest from other runways, a parallel taxiway and connectors per runway, numbered stands, a
graph of nodes and edges for taxi routing (Dijkstra, runway crossings and back-taxi detected),
holding points, terminal and tower positions.

**Check 2:** baked files exist; KSFO sits at the bay shore near sea level, KRNO near 1,345 m,
Mt Whitney above 4,000 m, Death Valley below sea level and dry; `node tools/test-airports.mjs`
reports a taxi route to every runway end of every airport.

---

## 3. Rendering the world

1. **Renderer** – `WebGLRenderer` with logarithmic depth buffer (near 0.35–1.2 m, far 2,400 km),
   ACES tone mapping, sRGB output, a shadow-mapped sun whose shadow frustum follows the player.
2. **Terrain** (`terrain.js`, `terrainWorker.js`) – quadtree of square tiles, 153.6 km roots down to
   600 m leaves (9 levels), 24–56 quads per side by quality setting, with skirts. A tile splits
   when the camera is closer than about 2.3 × its size. Geometry (positions, normals, colours) is
   generated in Web Workers and transferred. Parents stay visible until all four children are
   ready, so there are never holes; unused tiles are garbage-collected.
3. **Terrain colour** – land-cover sample, modified per vertex: rock on steep slopes, snow above
   the snow line, sand at the shore, farmland patchwork on flat fertile ground, grey built-up
   areas around the real city centres. A tiling detail texture breaks up colour up close.
4. **Water** (`water.js`) – one plane at sea level with Fresnel sky reflection, animated ripples
   and sun glint, masked by the baked ocean flag so below-sea-level deserts stay dry. Lakes are
   flat, glossy terrain.
5. **Sky** (`sky.js`) – physical sky dome, sun position from time of day, stars at night,
   visibility-driven haze that thins with altitude, two procedural cloud layers with white-out
   inside the layer, and a sky environment map for reflections on the aircraft.
6. **Airports** (`airportScenery.js`) – built lazily within 70 km:
   - Runways with painted textures: threshold bars, designator numbers and letters, centreline,
     touchdown-zone and aiming-point markings, edge lines, displaced-threshold arrows, tyre marks.
   - Taxiways with centrelines, an apron with stand lead-in lines, a glazed terminal (curtain-wall
     texture with a matching night map so the concourse glows after dark) with piers, control
     tower, military hangars.
   - Apron floodlight masts between every second pair of stands. Three real point lights hop
     between the masts nearest the aircraft and fade out with distance, so a parked aircraft
     sits in a pool of warm light at night without lighting the whole scene.
   - Lighting: runway edge lights (white, yellow for the last 600 m), green threshold / red end
     lights, approach light bars, centreline lights, blue taxiway edge lights, and four-light
     **PAPI** units whose red/white split is computed in the shader from the viewer's real glide
     angle.
7. **Cities** – instanced building blocks at the real positions of the major cities.

**Check 3:** screenshots from the ground, on approach over water and at cruise show continuous
terrain with no holes, readable runway numbers and working lights.

---

## 4. Aircraft

### 4.1 Specifications (`src/aircraft/specs.js`)
Every number below is the published real-world value and is used directly by the model builder
and the flight model. Lengths in metres, masses in kg, thrust in kN per engine.

| # | Aircraft | Length | Span | Height | Wing area | OEW | MTOW | Fuel | Engines | Thrust | MMO | Ceiling |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Boeing 737-800 | 39.47 | 35.79 | 12.55 | 124.6 | 41,413 | 79,016 | 20,894 | 2 × CFM56-7B26 | 117 | 0.82 | 41,000 |
| 2 | Boeing 747-8 | 76.25 | 68.45 | 19.35 | 554 | 220,128 | 447,696 | 193,280 | 4 × GEnx-2B67 | 296 | 0.90 | 43,100 |
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

Each spec also carries: fuselage width/height and length, wing sweep, taper, dihedral and tip
device, tail spans and areas, engine fan diameter, nacelle size and span station, landing-gear
nose position, wheelbase, track and wheel layout, flap detents, lift and drag coefficients,
speed and g limits, the control-law type and the pilot eye position.

`deriveGeometry(spec)` turns a spec into the shared geometry (centre of gravity, wing planform,
engine mounts, gear contact points, crash probes) used by **both** the model builder and the
flight model, so the visible aircraft and the simulated one are the same shape.

### 4.2 Model builder (`loft.js`, `airliner.js`, `fighter.js`, `model.js`)
Models are generated from the specs, in metres, so they are to scale by construction.
1. `loft.js` – helpers that skin lists of cross-sections into smooth, hard-edged geometry, build
   aerofoil surfaces and hinged control surfaces with their pivots.
2. **Airliners**: fuselage lofted from circular/ovoid sections with nose and upswept tail cones
   (747 upper-deck hump, A380 double-deck ovoid); wings from aerofoil sections with root, kink and
   tip, real sweep/dihedral and the correct tip device (blended winglet, sharklet, curved winglet,
   raked tip, fence); nacelles with intake lip, fan face and spinning fan, on pylons; fin and
   tailplane; wheel bogies with the real wheel counts; wing-to-body fairing.
3. **Fighters**: fuselage lofted from hand-placed super-elliptical stations (chines, intakes,
   spine), tinted bubble canopy, thin swept wings with leading-edge extensions, all-moving
   stabilators, single or twin canted fins, round or two-dimensional nozzles with an afterburner
   plume, wing-tip missiles on the F-16 and F/A-18E.
4. Fuselage livery, cabin windows, flight-deck glazing, doors and titles are painted on a canvas
   texture. Each airline also has tail artwork (chevron, sun, bands or wave) painted on a second
   texture; the fin and rudder are lofted with chord-wise UVs so the artwork runs across both.
5. **Animated parts**, all driven by the simulation state: ailerons, elevators/stabilators,
   rudder(s), flaps (Fowler motion), spoilers/speed brake with roll assist, landing gear
   retraction, wheel spin, fan rotation, afterburner, nav/beacon/strobe/landing lights.
6. `AircraftModel.measure()` returns the bounding dimensions so scale can be asserted.

**Check 4:** the menu hangar shows all twelve aircraft; measured length, span and height are
within 1 % of the spec for each (they are within 0.3 %).

---

## 5. Flight model

Fixed-step rigid-body integration at 120 Hz (`flightModel.js`), independent of frame rate.

1. **State**: position, velocity (world), orientation quaternion, body angular rates, fuel mass,
   per-engine spool state, gear/flap/spoiler positions.
2. **Atmosphere** (`atmosphere.js`): ISA to 32 km with temperature offset; density, pressure,
   speed of sound; CAS from Mach and static pressure; wind with a surface boundary layer that
   veers and strengthens with height; filtered random turbulence and gusts; weather presets.
3. **Aerodynamics** (`aero.js`), all from wing area, span, sweep and aspect ratio:
   - Lift-curve slope from the Helmbold/DATCOM formula with Prandtl-Glauert compressibility.
   - `CL = CL0 + ΔCL_flap + CLα·α`, blended into a flat-plate model past the stall angle; slats
     raise the stall angle, flaps add lift and drag per detent; high-speed buffet boundary.
     Flap lift is calibrated so published approach speeds and attitudes come out right.
   - `CD = CD0 + ΔCD(flaps, gear, spoilers) + k·CL² + wave drag` (drag divergence above critical
     Mach; supersonic drag rise for fighters), ground effect near the runway.
   - Side force and stability/control derivatives for pitch, roll and yaw.
4. **Engines** (`engine.js`): thrust lapse with density and Mach (separate high-bypass and
   afterburning low-bypass laws), spool-up/down lag, N1/N2, EGT and fuel flow from TSFC, reverse
   thrust for airliners, afterburner for fighters, thrust applied at each engine's real position,
   start and shut-down, windmilling drag.
5. **Landing gear** (in `flightModel.js`): spring-damper struts at the real wheelbase and track,
   rolling resistance, braking, speed-dependent tyre side force with true static friction,
   nose-wheel steering whose authority narrows with speed, parking brake, ground spoilers.
6. **Mass**: empty + payload + fuel, inertia from radii of gyration; fuel burns off.
7. **Failure and damage**: stall, overspeed, over-g, tail strike, hard landing, gear-up landing,
   wing/pod strike, terrain and water impact. Each produces a specific report.

### 5.1 Flight control laws (`fbw.js`)
- **Airbus, 777/787 – fly-by-wire**: stick commands pitch rate and roll rate; neutral stick holds
  attitude; auto-trim; turn coordination and yaw damping; model-based feed-forward of the static
  pitching moment. Airbus normal-law protections: alpha protection, ±67° bank with return to 33°,
  +30°/−15° pitch, load-factor and high-speed protection.
- **Fighters – fly-by-wire**: g-command pitch (neutral stick = 1 g), roll-rate command, angle-of-
  attack and g limiters.
- **737 and 747 – conventional**: the same stability augmentation and yaw damper but no envelope
  protection; the aircraft can be stalled and over-banked.
- **Ground law**: direct elevator with pitch-rate damping so rotation is smooth.
- **Direct law** toggle for all types: stick moves the surfaces directly; manual pitch trim.

### 5.2 Autopilot and autothrottle (`autopilot.js`)
MCP-style modes: `A/T SPD` (IAS or Mach), `HDG SEL`, `NAV` (direct-to), altitude change and
`ALT HOLD` with speed protection, `V/S` with altitude capture, `LOC`, `G/S` (`APP`), and autoland
`FLARE`/`ROLLOUT` with de-crab, autobrake and ground spoilers.

**Check 5:** `node tools/test-physics.mjs`. For every aircraft: it holds on the parking brake,
taxis, steers and stops; accelerates, rotates without a tail strike and lifts off within limits;
captures heading, altitude and speed with coordinated turns; holds cruise altitude and Mach with
thrust in hand; and flies coupled ILS approaches to touchdown in calm air and a 15 kt crosswind
within sink-rate, touchdown-zone and centreline limits.

---

## 6. Controls

The in-game help (`H`) lists them all.

| Function | Keys |
|---|---|
| Pitch / roll | `↑ ↓ ← →` (`↓` pulls the nose up), or mouse yoke with `M` |
| Rudder / nose-wheel steering | `Q` `E` |
| Throttle | `W` / `S` or `PageUp` / `PageDown`; `Home` full, `End` idle |
| Afterburner (fighters) | last 13 % of throttle travel |
| Reverse thrust | `R` (hold, on the ground) |
| Wheel brakes / parking brake | `B` (hold) / `P` |
| Landing gear | `G` |
| Flaps up / down one detent | `[` / `]` |
| Speed brake / arm ground spoilers + autobrake | `/` / `Shift`+`/` |
| Pitch trim (direct law) | `,` / `.` |
| Autopilot master / autothrottle | `Z` / `X` |
| Tune nearest ILS / arm approach | `T` / `V` |
| Fly-by-wire ↔ direct law | `Y` |
| Engines start / shut down · landing lights | `I` · `L` |
| Views: next / cockpit / chase / tower / fly-by / wing | `C` / `1` `2` `3` `4` `5`; drag to look, wheel to zoom |
| Radio: transmit numbered call | `F1`–`F8` (or click) |
| Radio: swap COM1 active/standby | `Tab` |
| Radio: free text / push-to-talk | `Enter` / hold `Space` |
| Large map · hide panels | `N` · `K` |
| Time acceleration | `-` / `=` (×1 to ×8) |
| Pause menu · help | `Esc` · `H` |

The MCP knobs (SPD, HDG, ALT, V/S) are adjusted with the mouse wheel or by clicking their left
or right half (`Shift` for large steps). Gamepads are supported through the Gamepad API (sticks,
triggers, standard buttons). All axes are rate-smoothed so the keyboard flies like a centred
stick.

**Check 6:** `node tools/test-browser.mjs` flies a take-off with real key presses and exercises
gear, autopilot, views, map and pause.

---

## 7. Cockpit displays and HUD

1. **PFD** (`pfd.js`): attitude with pitch ladder, bank scale and slip indicator; flight director;
   speed tape with trend arrow, V-speed bugs, stall and overspeed bands, Mach; altitude tape with
   selected altitude, ground band and QNH; vertical speed; heading tape with bug and track;
   flight mode annunciator; ILS localiser/glideslope scales with ident, frequency and DME;
   radio altitude.
2. **ND** (`nd.js`): heading-up moving map with range rings, airports, runways and extended
   centreline, taxiways and apron at close range, the cleared taxi route, navaids, flight-plan
   line, AI traffic with relative altitude, wind arrow, ground speed, TAS, distance and time to
   go. A large version opens with `N`.
3. **Engine/systems display** (`eicas.js`): N1 arcs per engine, EGT, fuel flow, fuel quantity,
   gross weight, air temperature, flap, gear, spoiler, brake and thrust-lever indications,
   reverser and afterburner annunciations.
4. **MCP**: speed, heading, altitude and vertical-speed selectors with mode buttons.
5. **Fighter HUD** (`fighterHud.js`): conformal pitch ladder, flight-path vector, speed/altitude
   boxes, heading tape, g, angle of attack, Mach, ILS steering.
6. **Warnings** (`warnings.js`): stall, overspeed, bank angle, gear and flap limit speeds, fuel,
   take-off configuration, GPWS (SINK RATE, PULL UP, terrain look-ahead, TOO LOW GEAR/FLAPS),
   radio-altitude call-outs 2500…10 and RETARD, autopilot disconnect.
7. A landing report grades every touchdown (rate of descent, speed, distance from the threshold,
   centreline offset, runway remaining), shown as a logbook page with a rubber-stamp grade.
8. **Radio panel** (`hud.js`): styled as a radio management unit – amber seven-segment active and
   standby frequency windows, a transfer key, station keys, the exchange printed on a strip of
   paper tape, numbered line-select replies and a scratchpad with a PTT key.

---

## 8. Air traffic control

### 8.1 Procedural core (`atc.js`, `phraseology.js`)
The controller is a state machine that knows the real field: name, runways, frequencies.
1. **Facilities and frequencies** are the real ones from the baked data. COM1 has active and
   standby frequencies; a hand-off pre-loads standby and the pilot swaps (or automatically, as a
   setting). You only hear the frequency you are tuned to. Tuning ATIS plays the looped ATIS.
2. **Runway in use** is chosen from the wind.
3. **IFR flow**: ATIS → clearance delivery (route, initial altitude, expected cruise level,
   departure frequency, squawk) → read-back → ground (push-back, taxi route with taxiway names,
   runway crossings and the holding point) → tower (hold short for traffic, line up and wait,
   take-off clearance with wind) → departure (radar contact, climb, heading) → centre (cruise
   climb, direct, hand-off between centres, descent with altimeter) → approach (descents, speed
   control, downwind/base vectors, intercept heading and approach clearance) → tower (landing
   clearance, wind) → ground (taxi to stand).
4. **Local flights**: radar vectors back to the ILS, or VFR closed traffic with downwind calls,
   touch-and-go, the option.
5. **Phraseology** follows FAA wording with ICAO digit pronunciation ("niner", "tree", "fife"),
   group-form flight numbers, "heavy"/"super", "flight level", "point" for frequencies. Every
   fragment carries a written form for the log and a spoken form for speech.
6. **Read-backs** are expected and prompted. **Compliance** is monitored: altitude busts,
   heading deviations, speeding below 10,000 ft, runway incursions, and take-off or landing
   without clearance are called out.
7. **Go-arounds** are recognised and re-vectored. `MAYDAY` gives priority handling to the nearest
   suitable runway.
8. **Traffic** (`world/traffic.js`): AI arrivals, departures and overflights with their own call
   signs; tower sequences the player around them and their transmissions are heard on frequency.
9. Approach vectoring guarantees a localizer intercept at least 10.5 nm out, below the
   glideslope, and holds aircraft that are too high on an extended downwind.

### 8.2 Voice (`voice.js`)
Web Speech synthesis with a distinct voice per controller and for the pilot, radio static and
key clicks from Web Audio. Hold `Space` for speech recognition where the browser supports it;
typed free text is always available.

### 8.3 Claude-powered ATC (`claude.js`, optional)
1. The player pastes an Anthropic API key in **Settings → AI ATC**. It is stored in
   `localStorage` only and sent only to `api.anthropic.com`.
2. Use the official `@anthropic-ai/sdk` in the browser (`dangerouslyAllowBrowser: true`),
   lazy-loaded so players without a key never download it.
3. Default model `claude-opus-5-5` at `effort: "low"` with the server-side refusal fallback;
   Settings also offers `claude-sonnet-5-5` and `claude-haiku-5-5` for lower cost and latency.
4. Each transmission sends one small request: a stable system prompt (role, rules) marked for
   prompt caching, plus a compact JSON situation report and the list of **calls the procedural
   controller can act on right now**.
5. Claude returns structured output `{action, reply}`. The simulator applies the action through
   the same procedural handlers, so the AI can never issue a clearance the simulation does not
   track; anything else gets a short in-character reply ("unable", "say again", an answer).
6. Budget: a few hundred input tokens and well under 100 output tokens per transmission. Any API
   error falls back to the built-in keyword matcher and shows a one-line notice.

**Check 8:** `node tools/test-atc.mjs <aircraft> <DEP> <DEST>` — a robot pilot using only the
options a player has, plus the autopilot, completes a gate-to-gate flight (clearance, push-back,
taxi, take-off, hand-offs, vectors, ILS, landing, taxi-in, parked). It passes for airliners and
fighters, long and short routes, and local flights.

---

## 9. Menu and settings (`menu.js`, `ui.js`, `threeView.js`)

The menu is a dispatch desk laid over the live world, not a separate screen.

1. **Backdrop**: the selected aircraft stands lined up on the departure runway of the selected
   airport, at the selected time and weather, with a slow low camera orbit (30° lens). Changing
   aircraft, airport, time or weather changes the scene behind the paperwork.
2. **Fleet** (left): a departures-board list of the twelve types grouped Boeing / Airbus /
   Fighters, each with its ICAO type code.
3. **Type sheet** (bottom): a data sheet for the selected type with a to-scale **three-view
   drawing** – `threeView.js` renders plan, side and front silhouettes of the real model with an
   orthographic camera and draws span, length and height dimension lines – and the key figures.
4. **Flight release** (right): a boarding-pass card with the route in large IATA-style codes,
   distance, time and runways, start position (gate, runway, 10 nm final, cruise), call sign
   (airline telephony + flight number, or tactical), fuel and payload with gross weight, time of
   day and weather, and a tear-off stub with the yellow **FLY** sign.
5. Settings (paper form): graphics quality, volumes, ATC and pilot voices, realistic damage,
   automatic frequency swap, AI ATC key and model.
6. Pause menu: resume, help, restart, reposition, main menu. Crash and flight-complete screens.

### 9.1 Visual language (`styles.css`)

The interface borrows from real aviation objects instead of generic app chrome:

| Element | Reference | Treatment |
|---|---|---|
| Panels in flight | avionics faceplates | dark anodised grey, corner screws, engraved labels |
| Frequency and MCP windows | seven-segment LCDs | amber DSEG7 digits over ghost segments |
| Mode buttons | Korry switches | light bar that is green when active, cyan when armed |
| Radio log | printer tape | warm paper, monospaced type |
| Menu cards, forms, reports | boarding pass, flight release, logbook | paper `#ece6d8`, ink `#1b1d20` |
| Primary action | runway holding-position sign | black on yellow `#ffc20e` |
| Accent | high-visibility orange `#d9480f` | wordmark bar, dimension lines, sliders |

Type: Barlow Condensed (headings, in the manner of airport signage), Barlow (text), B612 Mono
(data – the typeface designed for Airbus flight decks) and DSEG7 (LCD digits), all bundled from
npm so nothing is fetched from a font CDN. No gradients-on-glass, no rounded pill buttons, no
emoji icons.

---

## 10. Audio (`sound.js`)

All synthesised with Web Audio (no audio files): engine core, exhaust roar and fan whine following
N1, afterburner, airflow by airspeed, ground roll, gear and flap motors, touchdown, warning
horns, radio static and clicks.

---

## 11. Firebase

1. `src/firebase.js` calls `initializeApp` with the project config
   (`projectId: "takeoff-flight-sim"`). Only the `firebase/app` module is imported.
2. `firebase.json`: `"public": "dist"`, immutable caching for hashed assets, one-day caching for
   `/data/**`, no caching for `index.html`.
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

### 11.2 Deploy from GitHub
1. In the Firebase console (Project settings → Service accounts) create a key for a service
   account with the *Firebase Hosting Admin* role, or run
   `npx firebase-tools init hosting:github`, which does this for you.
2. Save the JSON as the repository secret `FIREBASE_SERVICE_ACCOUNT_TAKEOFF_FLIGHT_SIM`.
3. `.github/workflows/deploy.yml` tests, builds and deploys the live channel on every push to
   `main`, and a preview channel for pull requests.

**Check 11:** `npm run build` produces `dist/`; a deploy publishes it; the public URL loads the
menu.

---

## 12. Verification before shipping

1. `npm test` – flight-model tests for all twelve aircraft, airport layout checks for all 26
   airports, and one robot-pilot gate-to-gate ATC flight.
2. `npm run build` – no errors or missing assets.
3. `npm run preview` then `node tools/test-browser.mjs http://localhost:4173/` – headless
   Chromium loads the production build, obtains a clearance by key presses, flies a take-off
   with the keyboard, checks views, map and pause, an ILS approach at night and the fighter HUD,
   and reports zero console errors. Review the screenshots by eye.
4. One live call through `claude.js` with a real key (kept out of the repository) for each code
   path: a free-form request that maps to an action, and one that must be answered "unable".
5. Update `README.md` with features, controls and deployment notes, and update its session
   footprint section (see `CLAUDE.md`).

---

## 13. Build order

1. Scaffold (phase 1) and Firebase config (phase 11 files).
2. Bake data (phase 2).
3. Atmosphere, aerodynamics, engines, gear, flight model, control laws, autopilot – with the
   headless physics tests (phase 5).
4. Aircraft specs and model builders (phase 4).
5. Height field, airports and layouts, terrain, water, sky, airport scenery (phases 2–3).
6. Input, cameras, flight session, displays (phases 6–7).
7. ATC, voice, traffic, Claude integration, with the robot-pilot test (phase 8).
8. Warnings, audio, menu, settings (phases 7, 9, 10).
9. Verification, README, commit, push, deploy (phases 11–12).
