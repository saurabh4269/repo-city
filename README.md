# Repo City

**A real code repository rises as a miniature city on your real desk. A failing test is a building on fire.**

Mixed reality for Meta Quest 3/3S in the browser (WebXR, IWSDK 1.1.0). Hands only, seated, 2–4 minutes for the guided journey.

- **Files are buildings.** Footprint grows with lines of code, height with complexity.
- **Folders are districts**, each with its own tint. **Imports are lit routes** that arc between buildings when you open one.
- **Functions are floors.** Lift a roof and the building slides out onto your desk as a stack of lit floors.
- **A failing test is a fire.** Touch the smouldering floor to read the failing check: the assertion, what it expected, what it got.
- **Fix it and run the tests.** A tower crane lifts out the smouldering floor and lowers in the fixed one, a green wave sweeps the city, and every check passes.
- **The town hall** is the package's entry file (from `package.json` exports/main, else `index.*`): a domed civic building the guide shows you first.
- **Scaffolding marks hot spots:** files that changed often in git history *and* are complex, where bugs tend to live. Their facades are worn toward the base.
- **Data flow:** while a building is open, glowing dots run along its routes to the files it uses (fainter ones come in from the files that use it).

The bundled city is **semver 7.7.3** (the version library npm uses; ISC licence) with one realistic one-line bug we introduced. Its **real** test suite was run with and without the bug: 8,827 assertions, 3 failing, then all passing. A second city is **Repo City's own source code**.

Track: Productivity · Division: New Experience · Competition: Meta VR Start Developer Competition 2026.

## How to play (hands only)
1. Sit at a table in Meta Quest Browser and press **Enter XR**. Put your controllers down.
2. **Place the city:** look at your table. A blue frame shows where the city will go. **Pinch** to build it. With no table detected, hold your hand over a surface and pinch, or wait and pinch to use a virtual desk.
3. The city rises. The **guide** (a small lantern by the panel) says what you're looking at and flies over to the burning building.
4. **Pinch the burning roof and lift.** The building slides out beside the city as floors. A quick pinch works too.
5. **Touch the smouldering floor** with your fingertip. The panel shows the failing check.
6. Poke **Show me the fix** on the table plaque, then **Run the tests**.
7. Keep exploring: open any building and touch floors to read their code, or press **Next city**.
- **Two-hand pinch** anywhere above the city to scale and turn it.
- Every step also has a plaque on the table, so you can always continue by touch.

## Run it
```bash
npm ci
npm run setup        # once per machine: IWSDK MCP configs + reference index
npm run dev          # HTTPS dev server + emulator on https://localhost:8083
npm run typecheck && npm run build
```
On a Quest on the same network, open the `https://<your-ip>:8083` address that `npx @iwsdk/cli dev status` prints, and accept the local certificate. Quest Browser needs https.

### Your own repository
```bash
node tools/repo-to-city/index.mjs --root ../my-repo --include src --out public/cities/mine.json
# then open https://localhost:8083/?city=./cities/mine.json
```
`--history git` reads the repo's own git log (2 years, at most 2,000 commits) for scaffolding; `--history h.json` takes a precomputed `{ path: { commits, churn } }`. `--layout affinity` tries to put districts that import each other side by side, and keeps the plain size layout unless that cuts the coupling cost by at least 10% without stretching districts (the scores are in the city JSON's `stats.layout`).

The CLI also bakes the city's light next to the JSON (KTX2 if KTX-Software's `ktx` is installed, else PNG; `--no-light` skips it). Add `--tests <results.json>` (format in `tools/repo-to-city/run-tests.mjs`) to set fires from your own test run. Your code stays on your machine: nothing is uploaded.

## Test
```bash
npm run test:unit    # 50 Node tests: layout (incl. affinity), parser, entry point, git history + hotspot score, city contract, light bake, room placement (incl. Quest 3 downward table normals)
npx @iwsdk/cli dev up --ai-mode agent --allow-browser-automation
npm run test:xr      # the whole hands-only journey in the emulator (18 checks)
npm run test:xr -- --hand left --drag --jitter 5
npm run test:xr:tour # same, with a screenshot at every first-of-its-kind moment (artifacts/)
npm run city         # regenerate both cities (re-runs semver's real test suite, bugged and fixed) and bake their light
node tools/textures/make-textures.mjs   # the KTX2 shadow masks
python3 tools/e2e/stats.py <label>      # draw calls, triangles, texture memory + review shots
bash tools/headset-perf.sh <label>      # on a USB-connected Quest: fps + GPU trace
```
Results and the headset-only checklist: [docs/TESTING.md](docs/TESTING.md).

## Code map
| Path | What |
|---|---|
| `src/director.ts` | The one system: phases `page → placing → rising → city → testing → done`, the guided steps, hands → city interaction, guide, plaques |
| `src/city/city-view.ts` | Plinth, districts, instanced buildings, the opened building's floors and roof, import routes |
| `src/city/building-material.ts` | Procedural windows, floor slabs, contact darkening and fire on `MeshStandardMaterial` |
| `src/fx/fire.ts` | Flames, embers, smoke and steam as point sprites (two draw calls) |
| `src/ui/` | Canvas text cards, the main panel (guide line + city, code, failure, fix, test run, result), table plaques |
| `src/input/hands.ts` | Pinch with hysteresis, tracking-loss grace, controller fallback |
| `src/mr/room-placement.ts` | Choosing the real table among detected planes (pure, unit-tested) |
| `src/city/types.ts` | The city JSON contract |
| `tools/repo-to-city/` | Repo → city JSON: parser, treemap layout, test runner, summaries |
| `tools/repo-to-city/light-bake.mjs` | Bakes each city's ambient occlusion and soft shadows into a KTX2 atlas (layout in `src/city/light-layout.ts`) |
| `src/city/environment.ts`, `src/city/textures.ts` | The city-matched reflection environment; KTX2 loading with the local Basis transcoder |
| `tools/e2e/journey.py` | Emulator end-to-end test |
| `fixtures/semver/` | The vendored semver snapshot (ISC) with the one introduced bug |

Design decisions (physics, engine, offline guide) are in [docs/JUDGING.md](docs/JUDGING.md).

## Credits
- **semver** (ISC), npm/node-semver v7.7.3: the bundled city and its tests. One line changed; see `fixtures/semver/REPO-CITY-NOTE.md`.
- **Fonts:** Inter and JetBrains Mono (SIL Open Font License), loaded from Google Fonts with system fallbacks.
- **Basis Universal transcoder** (Apache-2.0), served from IWSDK's vendored copy; textures encoded at build time with **KTX-Software** (Apache-2.0).
- **Code reused from this kit:** room placement (Hands of a Master), hand input and the audio-synthesis pattern (Chausar). IWSDK and three.js (MIT).
- All geometry, textures, particles and sounds are generated in code. Full list: [public/cities/CREDITS.md](public/cities/CREDITS.md).
