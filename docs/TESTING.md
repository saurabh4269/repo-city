# Testing: Repo City

Three layers: Node unit tests for the pure parts, the hands-only journey in Meta's IWER emulator, and the headset checks only a Quest can prove.

## 1. Unit tests: `npm run test:unit` (Node `node:test`)
33 tests, all passing (18 Nov 2026):
- **Layout** (`tools/test/layout.test.mjs`): no overlapping buildings, everything inside its district and the city square, the smallest building side stays pinchable.
- **Parser** (`parser.test.mjs`): function spans and complexity for declarations, class methods and arrow functions; the shifted code window for the failing floor.
- **City contract** (`cities.test.mjs` + `validate-city.mjs`): every field and length limit of `src/city/types.ts`; exactly one failing function; failures and streets reference real buildings; the fixed run has 0 failures; the bug line falls inside the failing floor's excerpt.
- **Light bake** (`light-bake.test.mjs`): on a one-building city the shadow falls on the side away from the key light and the sun side stays lit; the ground darkens next to the wall and not far away; a wall is darker at its foot; atlas tiles never overlap the ground or each other.
- **Room placement** (`room-placement.test.mjs`), synthetic rooms:
  - an emulator table (normal up) and a **Quest 3 table (normal down)**, both accepted;
  - a 12° slant, a couch and the floor, refused, with the reason counted;
  - no table at all → hand placement, then the virtual desk;
  - a round table, with the footprint slid inside;
  - a small table (used) and a tiny one (refused);
  - a table across the room (too far).

The data itself is tested by running semver's real suite (`npm run city`): **8,827 assertions; 3 fail with the introduced bug, 0 after the fix** (`fixtures/semver-results/*.json`). On the untouched snapshot, all 50 test files pass.

## 2. Emulator end-to-end: `npm run test:xr`
`tools/e2e/journey.py`, built on the kit's `xr_e2e_lib.py`. Needs `npx @iwsdk/cli dev up --ai-mode agent --allow-browser-automation`. The app logs `[city] #page.seq event … layout={json}` in dev builds only, and the test waits on those lines.

The journey, hands only (`xr set-input-mode hand`), seated at the emulated living-room table:
| # | Check |
|---|---|
| 1 | Placement finds the labelled table (preview frame on the plane) |
| 2 | A pinch places the city on the real table, then it rises |
| 3 | The city sits on the table plane (y within 5 cm) |
| 4 | The first prompt offers the burning building |
| 5 | Pinching the burning roof opens that building (tap; or `--drag`: pinch and lift 7 cm) |
| 6 | Touching the smouldering floor with the fingertip selects it (failing = true) |
| 7 | The fire report offers the fix |
| 8 | Poking the "Show me the fix" plaque shows the fix and offers the tests |
| 9 | Poking "Run the tests" starts the run |
| 10 | The fire goes out |
| 11 | All 8,827 checks pass |
| 12 | A two-hand pinch scales the city |
| 13 | "Next city" loads Repo City's own code |

**Results, 18 Nov 2026 (IWSDK 1.1.0, IWER metaQuest3, sunlit_living_room):**
- right hand, 3 mm fingertip jitter, pinch tap: **13/13**;
- left hand, 5 mm jitter, pinch-and-lift drag: **13/13**.
- Presets (`tools/e2e/presets.py`): `fire` and `done` land on their moment: 2/2.
- The run takes ~2 minutes; the journey inside it takes 22–25 s of app time.

Visual review: `npm run test:xr:tour` saves a screenshot at every first-of-its-kind moment (`artifacts/e2e-tour-*.png`); `tools/e2e/closeup.py` shoots the fire and the open building from 30 cm.

**Performance in the emulator:** see "Visual pass: rendering numbers" below.

### Bugs the journey found (all fixed)
| Symptom | Cause | Fix |
|---|---|---|
| Hovering near the fire opened the building | the fire poke radius was 4.6 cm and needed no dwell | the fingertip must be inside the flames for 0.3 s |
| A floor was selected the moment the building opened | the stack grew around the resting fingertip | the fingertip must be seen outside every floor first, and only after the stack settles |
| No flames visible, only a glow | the transparent panel behind was drawn after the flames and painted over them (no depth write) | the panel draws first (`renderOrder = 1`), found with a live probe of the particle buffers (`tools/probe.mjs`) |
| Flames washed out to cream | additive blending over a pale roof | normal-blended teardrop sprites with a hot core; charred roof |
| The opened building covered the panel | the exploded stack rose in place, at the back of the city | the building slides out onto the desk beside the city, on the side of the hand that took it |
| Code too small to read | 16 lines plus a floor list in a 0.38 m panel | 12 lines over the full width, a taller panel, and the bug line highlighted |
| The one-function `diff.js` gave a weak awe moment | single floor | the bug moved to `ranges/subset.js` (4 floors) |

## Visual pass: rendering numbers (18 Nov 2026)
Baked lighting replaced the runtime shadow map. `python3 tools/e2e/stats.py <label>` places the city and reads the dev-only `repoCity.stats()` (renderer info plus an estimate of texture memory from every texture the scene, its environment and the light atlas reach). It also saves the same five shots each time: `artifacts/e2e-<label>-{seated,near,hero,fire,open}.png`.

Emulator: IWER metaQuest3, 800×800 per eye. In IWER every eye is drawn separately (an `XRWebGLLayer`, no multiview), so the Quest's multiview draws about half these calls.

| | before (`4c326ec`) | after (`63e0243`) |
|---|---|---|
| Draw calls, city | 46 | 52 |
| Draw calls, building open | 45 | 48 |
| Triangles, city / open | 29,792 / 30,624 | 29,920 / 27,172 |
| Shader programs | 28 | 23 |
| Estimated texture memory | 25.1 MB | 12.7 MB |
| · shadow map (1024², colour + depth) | 8.0 MB | none |
| · environment (PMREM) | 6.0 MB (256 px, gradient) | 1.5 MB (128 px, desk room) |
| · baked light atlas (512², UASTC → ASTC 4×4, 5 mips) | none | 0.33 MB (90 KB file) |
| · contact + blob shadow masks | 0.34 MB (canvas) | 0.10 MB (KTX2) |
| Extra render passes while anything moves | the whole city again into the shadow map, every frame of the rise, open, drag and sweep | none |

The 6 extra draw calls (3 on Quest) are new: the district plates, which had never rendered (an `InstancedMesh` frustum-culled by bounds computed while its count was 0), and soft shadows under the plaques and the opened building. The canvas UI textures (panel 7.9 MB with mipmaps, labels, plaques) stay as they are: they are redrawn at runtime, so they cannot be pre-compressed.

### Anti-aliasing and foveation
- **The context asks for MSAA.** IWSDK creates the renderer with `antialias: true`, and `stats().contextAntialias` is `true`.
- **Emulator:** three.js takes the `XRWebGLLayer` path with `antialias: true`, and `stats().xr` reports `layerAntialias: true`.
- **Quest Browser (code path, three r185 `WebXRManager`):** it supports `XRWebGLBinding.createProjectionLayer`, so three.js renders into a `WebGLMultiviewRenderTarget` with `samples: attributes.antialias ? 4 : 0`, which is 4× multisampled render-to-texture. So MSAA holds in the XR layer as long as the context keeps `antialias: true`. Nothing in this app turns it off.
- **Foveation:** `src/xr-perf.ts` sets fixed foveation 0.4 (three.js defaults to 1.0) whenever the session becomes visible, and asks for 72 Hz. The emulator layer has no fixed foveation to report.
- **To prove it on the device:** see the steps below. `repoCity.stats().xr` should read `{ path: 'projection-layer', samples: 4, multiview: true, foveation: 0.4 }`.

### Frame rate on the headset (run when the Quest is plugged in)
1. Connect the Quest by USB with developer mode on. `npx metavr device list` must show it.
2. Run `npx @iwsdk/cli dev status` and open its network `https://…:8083` URL in Quest Browser (or the deployed URL). Enter XR and place the city.
3. Run `bash tools/headset-perf.sh after`. It does three things:
   - records 20 s of `VrApi` frame stats (`npx metavr log -s VrApi`, or `adb logcat -s VrApi`), giving lines like `FPS=72/72 … GPU%=…`, and writes the mean and minimum FPS to `artifacts/perf-after/summary.txt`;
   - captures a 10 s GPU Perfetto trace: `npx metavr perf capture --mode gpu --duration 10000 --app com.oculus.browser -o artifacts/perf-after/repo-city-after`;
   - analyses it: `npx metavr perf analyze-trace --app com.oculus.browser --report-out artifacts/perf-after/report.md`.
4. Measure three moments: the city idle; the building open with the fire burning (`?state=fire`); and the green test sweep (`?state=fix`, then poke **Run the tests**).
5. To compare against the old build, check out `4c326ec`, run `bash tools/headset-perf.sh before`, then `npx metavr perf traces` and `npx metavr perf compare <before-id> <after-id>`.
6. **MSAA and foveation on the device:** on the desktop open `chrome://inspect` (USB), inspect the Quest Browser tab and run `repoCity.stats().xr` in the console (dev server build only). If `samples` is 0, MSAA was lost: check that nothing created the renderer without `antialias`.

**Pass:** a steady 72 fps (60 is the rule's floor) with GPU use below ~90% in all three moments.

## 3. Headset-only checklist (Quest 3 / 3S, Quest Browser, https)
Not yet run on a device. Each item needs a real headset:
- [ ] **72 fps** with the fire burning and the building open, and during the green test sweep (`bash tools/headset-perf.sh`, steps above); 60 fps is the floor.
- [ ] **MSAA and foveation:** `repoCity.stats().xr` reports `samples: 4`, `multiview: true`, `foveation: 0.4`.
- [ ] **Baked lighting in a real room:** shadows and contact darkening read on the real desk; the city doesn't look too dark under dim room light.
- [ ] **Real table:** the city lands on a labelled table (Quest reports the normal pointing down, which we handle), on an unlabelled desk, and through hand placement with Space Setup skipped.
- [ ] **Text legibility** at the real distance: the code panel (~0.75 m), the floor label, the plaques. Foveation is 0.4.
- [ ] **Pinch on a roof** with real hands (22 mm start / 40 mm release), and the pinch-and-lift drag.
- [ ] **Fingertip into a floor** of the open building: select without false triggers while reaching past other floors.
- [ ] **Plaques on the real desk:** a poke registers when the finger reaches the table; nothing fires when a new plaque appears under the finger.
- [ ] **Two-hand pinch** scale and turn feel stable.
- [ ] **Tracking loss:** hands out of view show the "I can't see your hands" line; a lost hand mid-lift keeps the building's state.
- [ ] **Controllers in hand** show the hands-only notice, and the journey still completes with triggers.
- [ ] **Guide voice:** speech synthesis is available in Quest Browser; the captions always match.
- [ ] **Sound:** rise, lift, crackle, alarm, test ticks, steam and the chord are audible and not harsh.
- [ ] **System menu:** pause and resume (the logic freezes while the menu is up).
- [ ] **Production URL** logged out: both cities load; fonts load or fall back cleanly.
- [ ] **A new player, without coaching:** note where they hesitate.

## How to run a preset on the headset
`https://<host>/?state=open|fire|fix|done|explore`. It applies once, right after you place the city.
