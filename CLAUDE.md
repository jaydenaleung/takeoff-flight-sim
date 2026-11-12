# Takeoff – Flight Simulator

Browser flight simulator (Vite + three.js, static site on Firebase Hosting).
`INSTRUCTIONS.md` is the specification; keep it and `README.md` in step with the code.

## Standing rules

- **Update the session footprint at the end of every session.** Before the last commit, read
  this session's usage (the `get_session` tool with no session id → `external_metadata.usage`:
  `output_tokens`, `input_tokens`, `cache_write_tokens`, `cache_read_tokens`, `cost_usd`) and
  update "Footprint of the AI sessions" in `README.md`:
  - same session as the last row of the session log → update that row and its token table;
    a new session → add a row, and a column or table for its tokens;
  - recompute the totals row and the energy and water estimates with the rates already stated
    there (Wh per 1,000 tokens: output 0.3 – 3, cache writes 0.03 – 0.3, cache reads
    0.003 – 0.03; water 1.1 mL per Wh; quote the geometric middle of the range);
  - tokens and cost are measured, energy and water are estimates – keep them labelled so.
- **Never commit keys or tokens.** The Claude API key for AI ATC is entered by the player in
  Settings and lives only in their browser. The Firebase web config in `src/firebase.js` is
  public by design.
- Do not name the AI model that wrote the code in any file in the repository.
- Do not open a pull request unless asked. The owner deploys (`npm run deploy`).

## Commands

- `npm run dev` – dev server · `npm run build` – production build to `dist/`
- `npm test` – flight model (12 aircraft), airport layouts (26), one robot-pilot ATC flight
- `npm run preview` then `node tools/test-browser.mjs http://localhost:4173/` – headless UI test
- `node tools/shot.mjs <url> <out.png> [w] [h] [waitMs]` – screenshot; look at the result
  before calling any visual change done

## Design language

The interface imitates aviation objects, not app chrome: anodised avionics panels with amber
seven-segment windows and Korry-style buttons in flight; paper documents (boarding pass,
flight release, logbook, printer tape) for menus and reports; a yellow holding-position sign
for the primary action. Fonts: Barlow Condensed, Barlow, B612 Mono, DSEG7 (bundled). Tokens are
at the top of `src/ui/styles.css`; see `INSTRUCTIONS.md` §9.1 before adding UI.
