# Testing: Repo City

Three layers: Node unit tests for the pure parts, the hands-only journey in Meta's IWER emulator, and the headset checks only a Quest can prove.

## 1. Unit tests: `npm run test:unit` (Node `node:test`)
28 tests, all passing (18 Nov 2026):
- **Layout** (`tools/test/layout.test.mjs`): no overlapping buildings, everything inside its district and the city square, the smallest building side stays pinchable.
- **Parser** (`parser.test.mjs`): function spans and complexity for declarations, class methods and arrow functions; the shifted code window for the failing floor.
- **City contract** (`cities.test.mjs` + `validate-city.mjs`): every field and length limit of `src/city/types.ts`; exactly one failing function; failures and streets reference real buildings; the fixed run has 0 failures; the bug line falls inside the failing floor's excerpt.
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

**Performance in the emulator** (dev `perf` log; the emulator renders each eye separately, so halve these): 9–55 draw calls, 24–25k triangles. On Quest multiview that is about 28 draw calls, against a budget of 100.

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

## 3. Headset-only checklist (Quest 3 / 3S, Quest Browser, https)
Not yet run on a device. Each item needs a real headset:
- [ ] **72 fps** with the fire burning and the building open, and during the green test sweep (`metavr perf capture`); 60 fps is the floor.
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
