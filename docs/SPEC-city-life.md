# Spec: City life (five features, 18 Nov 2026)

Inspired by Claude Clan (github.com/mittal-parth/claude-clan, a desktop isometric code city). It has **no licence**: ideas only, no code, art or text taken from it.

Ground rules for all five:
- No new runtime network calls. Anything learned from git happens in `tools/repo-to-city` at build time and lands in the city JSON.
- Each feature is optional in the data (a missing field means the old behaviour), so old city JSONs still load.
- Budget: at most **+4 draw calls** in total across all five (Quest multiview), no new shadow passes, 72 fps.
- One commit per feature, with typecheck, `npm run test:unit` and `npm run test:xr` (right and left hand) green before the next one.
- Feature cutoff: 10 PM IST. After that, only fixes, docs and the final run.

---

## 1. Town hall: the entry point

**Why:** a newcomer needs a place to start. "Everything enters here" is the first thing a senior engineer says when showing a repo.

**Data:** `CityData.entry?: string` (a building id), already in `types.ts`. Resolution order in the pipeline: `package.json` `exports["."]` (string, or `.import` / `.require` / `.default`) → `main` → `index.{js,mjs,cjs,ts}` at the root of the included folder → none. Unit test: one case per branch.

**Look:** the entry building keeps its footprint and height, plus a civic crown: a shallow dome (a half-sphere, 16×8 segments) on a drum, in the plinth's warm stone, with a small gold finial. Merge it into one mesh so it costs 1 draw call. Its roof vents are hidden.

**Behaviour:**
- When the city first stands, the guide flies to the town hall and says: *"This is `index.js`, the town hall. Everything that uses semver enters here."* It holds for about 3.5 s, then flies on to the fire. This adds one line; the find-fire step and its plaque stay the same.
- Opening the town hall works like any building. The panel's first line adds "Entry point".
- `?state=` presets skip the intro line.

**Tests:** in the e2e, after the city rises, check the log shows `guide entry <id>` before `guide fire`. Unit test for entry resolution.

---

## 2. The fix crane

**Why:** "Run the tests" is the story's climax, but today the fix appears with no physical action. A crane that lifts out the broken floor and lowers in a new one makes the fix visible, and gives the trailer a shot.

**When:** on **Run the tests** (not "Show me the fix", which stays a reading moment), before the green wave.

**Sequence** (total about 2.4 s; the test run starts at the end):

*As built:* the moving slab is the failing floor's own instance (0 extra draws), and the crane's cable and hook move in its vertex shader (1 draw). The fire goes out with steam as the old slab is lifted away (t ≈ 1.4 s), not after the new one lands, because the fire follows the failing floor.
| t (s) | What happens |
|---|---|
| 0.0–0.6 | A tower crane drops in from above the opened building's floor stack on the desk (ease-out), jib over the failing floor. Soft whoosh. |
| 0.6–1.1 | The hook lowers; the failing floor slides out sideways 3 cm and lifts up on the cable, still smouldering. Ratchet clicks. |
| 1.1–1.7 | The old slab fades up and away; a new slab, tinted the district colour with a faint green edge, lowers into place. Heavy *clunk* on landing, plus a small dust puff using the existing sparks (no new system). |
| 1.7–2.4 | The crane lifts out and fades. The fire goes out with steam (existing), then the green wave and test run start as now. |

**Geometry:** mast, jib, counter-jib, cable and hook built from boxes and cylinders, merged into one `BufferGeometry` with one `MeshStandardMaterial` (safety yellow, roughness 0.6) = 1 draw call. The moving slab reuses the floor material = 1 draw call. Height is about 1.4× the opened stack. It's created once and hidden when idle.

**Sound:** synthesised in `audio.ts`: ratchet (a short click train), clunk (low thump plus noise burst). No new files.

**Edge cases:** if the building closes mid-sequence, snap to the end state. A second press while it's running does nothing. Reduced motion (if the app has the option): skip to the end in 0.3 s.

**Tests:** the e2e waits up to +3 s for phase `testing`. The log has `crane start` and `crane done`.

---

## 3. Weathering: where the code keeps changing

**Why:** tests show where the code is broken *now*. History shows where it *keeps* changing. Files that change often and are complex are the hot spots where bugs tend to live. That's a second, real insight from the same city, and it's familiar from code-analysis tools.

**Pipeline** (`tools/repo-to-city/history.mjs`, new):
- `git -C <root> log --no-merges --numstat --format=%H%x09%at -- <include>`, limited to the last 2 years or 2,000 commits, whichever comes first.
- For each file: `commits` (number of commits touching it) and `churn` (lines added plus deleted). Follow renames only if it's cheap (`--follow` is per-file, so skip it).
- **Semver:** the vendored copy has no `.git`. At build time, `git clone --filter=blob:none --no-checkout https://github.com/npm/node-semver` into a temp folder, check the history up to tag `v7.7.3`, and map paths 1:1. If there's no network or the tag is missing, drop the history and log a warning. The city stays valid.
- **Repo City's own city:** use this repo's git history for `projects/repo-city/`.
- *As built:* semver uses a **4-year** window, not 2. In its last 2 years one reformatting commit touched nearly every file once, so 39 of 46 files tied at 1 commit and the score said nothing. The history is cached in `fixtures/semver-results/history.json`, so `npm run city` works offline; `--refresh-history` re-clones. Percentiles are mid-rank (ties share the average rank), so a value most files share doesn't score near the top.

**Data:** `Building.history?: { commits: number; churn: number; hot: number }`. `hot` is in 0..1 and is the **hotspot score**: `rank(commits) × rank(complexity)`, each as a percentile within the city, then scaled so the top file is 1. Pure function `hotspot(buildings)` with unit tests: an empty history gives every file 0, ties are stable, and the top file is 1.

**Look:**
- Buildings with `hot ≥ 0.6` (about the top 15%) get **scaffolding**: a thin lattice of poles and planks on the two faces toward the viewer, from the ground to about 60% of the height. Use one `InstancedMesh` (a pole box plus a plank box merged), one instance per scaffolded face, for 1 draw call.
- Facade wear: the building material gets a `hot` instance attribute that slightly warms and darkens the facade toward the base (at most −12% luminance). No extra draw call.
- The fire building keeps its fire; scaffolding can sit on it as well.

**Panel:** the city overview gets one line, *"Scaffolding: files that change often and are complex. Bugs tend to live there."* An opened building shows *"Changed in 41 commits"* when it has history.

**Tests:** unit tests for parsing `--numstat` (from a fixture) and for `hotspot()`. The e2e screenshot tour adds one shot of the scaffolding.

---

## 4. Data flow along import routes

**Why:** the import routes are static arcs. Motion along them makes "this file uses those files" readable at a glance, and ties the city together.

**What:** while a building is open, small glowing dots move along each of its outgoing import routes, from the open file to the files it imports. Incoming imports (who uses this file) get fewer, dimmer dots going the other way. Cap: 12 routes × 6 dots = 72 points.

**How:**
- One `Points` object with a small `ShaderMaterial` (1 draw call). Per-point attributes: route start, control point and end (the same quadratic arc the routes already use), a phase offset, and the colour of the destination district.
- Position on the GPU: `p = bezier(fract(uTime * speed / arcLength + phase))`. Speed is 0.12 m/s in table space. Size is 4 px at arm's length with a soft round falloff, alpha fading in at both ends of the route.
- Additive blending is OK, but in `immersive-ar` keep alpha premultiplied so there are no black squares (see the sparks lesson in the skill).
- Rebuild attributes only when a building opens or closes. No per-frame CPU work besides `uTime`.

**Panel legend:** *"Dots run to the files it uses."*

*As built:* the dots are about twice a spark's size, not 4 px: at 4 px they disappeared against the bright route arcs in the emulator. Routes are sine arcs (the code's existing shape), not quadratic Béziers, so the shader uses the same sine. The legend sits in the code box's bottom-right corner.

**Tests:** check the log has `flow N` with the route count on open, and 0 on close. One tour screenshot.

---

## 5. Neighbours that talk (affinity layout)

**Why:** districts that import each other a lot should sit side by side. Routes get shorter and the city's shape starts to mean something.

**Algorithm** (in `layout.mjs`, behind `--layout affinity|size`, default `size` until it's proven):
1. Affinity `A[a][b]` = the number of import edges between district a and district b, in either direction.
2. Order the districts as a chain: start with the heaviest by weight; then repeatedly append the unplaced district with the highest summed affinity to the ones already placed (ties: higher weight, then id).
3. Squarify **without sorting** in that order (`squarify(items, rect, false)`). Squarify fills in rows, so neighbours in the order end up adjacent.
4. Score both layouts:
   - `cost = Σ A[a][b] × dist(centre_a, centre_b)`
   - `worstAspect` = the largest district aspect ratio.
5. Use affinity **only if** `cost_affinity ≤ 0.9 × cost_size` **and** `worstAspect_affinity ≤ maxAspect × 1.25`. Otherwise fall back to size and log why. The chosen mode and both scores go in the city JSON `stats` (for the README and the tests).

**Unit tests:**
- Each district's area is proportional to its weight (±1%).
- No two rectangles overlap, and all of them are inside the margin.
- Deterministic: the same input gives byte-identical output.
- On a fixture of two heavily coupled districts that size ordering puts apart, affinity puts them adjacent and the cost drops.
- A city with no edges gives the same result as size ordering.

**Then:**
- Regenerate both cities (`npm run city`), which also re-bakes the light.
- Check the fire building is still reachable from the seated pose and isn't hidden behind a taller building. If it is, keep `size` for that city.
- Before-and-after screenshots.
- Make `affinity` the default only for cities where the gate passed.

*As built:* the gate is in `layout.mjs` (`layoutCity(…, { mode: 'affinity', edges })`), `npm run city` asks for affinity for both cities, and both fall back to size:
| City | Coupling cost, size | Coupling cost, affinity | Worst district aspect, size → affinity | Result |
|---|---|---|---|---|
| semver | 49.60 | 45.32 (−8.6%) | 3.19 → 4.66 | size (not 10% better) |
| Repo City | 9.47 | 10.02 (+5.8%) | 5.41 → 1.53 | size (costlier) |

The size layout already searches many district orders and two treemap algorithms for the squarest cells, so a single chain order seldom beats it by 10%. The scores are in each city's `stats.layout`, so the shipped layouts are unchanged (no before/after screenshots needed) and the fire-reachability check doesn't apply. On a synthetic city with two strongly coupled small districts the gate passes (cost 8.61 → 4.11; `tools/test/affinity.test.mjs`).

---

## Docs
- README: the five features in "How to play" or the feature list (one line each), plus the history and `--layout` options under "Your own repository".
- JUDGING: a prior-art line: *Code cities go back to CodeCity and CodeCharta. Claude Clan (2026) draws a 2D isometric city on a desktop screen. Repo City is different: it sits in mixed reality on your real desk, it's hands only, failing tests are fires you touch, and buildings open into their functions as floors.*
- TESTING: new results and any added draw calls.
