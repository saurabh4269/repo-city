# Submission: Repo City

Paste-ready Devpost text, trailer shot list, gallery list and the pre-submit checklist.

- **Track:** Productivity · **Division:** New Experience
- **URL:** _to fill after deploy (the user approves deploying)_ · **Mirror:** _second URL_
- **Deadline:** Wed 18 Nov 2026, 12:00 PM PST (Thu 19 Nov, 1:30 AM IST). No build updates after it.

## Devpost text

### Tagline (≤ 200 chars)
A real code repository rises as a city on your real desk. A failing test is a building on fire: lift the roof, touch the burning floor, ship the fix, watch it go out.

### Inspiration
Every developer has stared at a red test run and a wall of text. Code has shape (big files, tangled imports, one function everyone is afraid of), but we only ever see it flat. We wanted to hold a codebase in our hands, on the desk where we actually work, and make the one thing that matters right now, the failing test, impossible to miss.

### What it does
Repo City turns a real repository into a miniature architectural model on your table, in passthrough mixed reality:
- **Files are buildings** (footprint from lines of code, height from complexity), **folders are districts**, and **imports are lit routes** between buildings.
- **A failing test is a fire.** Pinch the burning roof and lift: the building slides out onto your desk as a stack of lit floors, one per function, and one floor is smouldering.
- **Touch that floor** and the panel shows the real failing check: the assertion, what it expected and what it got.
- Ask for the fix, **run the tests**: a tower crane lifts the smouldering floor out and lowers in the fixed one, then a green wave sweeps the city and every check passes.
- The **town hall** (the package's entry file) is where the tour starts. **Scaffolding** marks hot spots, files that change often in git history and are complex. While a building is open, **glowing dots flow** along its imports.
- A small **lantern guide** explains every step, out loud and in captions, and flies over to point at what to do next.
- **Two-hand pinch** scales and turns the city. A second city is Repo City's own source code.

The bundled city is semver, the version library npm uses (ISC licence). We introduced one realistic one-line bug, ran its genuine test suite (8,827 assertions, 3 failing) and the fixed suite (all passing), and built both runs into the city.

### How we built it
- **WebXR + Meta's Immersive Web SDK (IWSDK 1.1.0)** in Meta Quest Browser, `immersive-ar` with hand tracking, plane detection and anchors.
- **A repo-to-city pipeline** in Node (`tools/repo-to-city`):
  - the TypeScript compiler API parses JS/TS into functions, line spans, a complexity measure and imports;
  - a treemap layout keeps every building big enough to pinch;
  - a small tap-compatible runner executes the project's real tests and records the failing assertions;
  - summaries written from the code power the offline guide.
- **Rendering for a mobile GPU:**
  - all buildings in one instanced draw call, with a procedural window shader: windows sized in real millimetres, floor slabs, contact darkening, burning rows and a charred roof;
  - the fire is particle sprites in two draw calls;
  - lighting baked at build time for each city (ambient occlusion and soft shadows in one ~90 KB KTX2 texture), so no shadow pass runs on the headset;
  - reflections from a small environment lit like the city: glass windows and glazed roofs.
- **Placement in rooms we never saw:** labelled table or desk → your hand → a virtual desk. We found on a real Quest 3 that table planes report their normal pointing down, and made the check sign-agnostic.
- **Tested without a headset:** an end-to-end script drives the whole hands-only journey in Meta's IWER emulator, right- and left-handed with fingertip jitter, plus 33 unit tests.

### Challenges we ran into
- **Reading code in a headset.** We cut the panel to 12 lines of large monospace, highlight the bug line, and moved the opened building beside the city so it never covers the text.
- **Never doing what the player didn't mean:**
  - a hand passing over the flames does nothing;
  - a growing floor stack can't "select" a resting finger;
  - a half-hearted lift puts the roof back.
- **A fire that didn't show:** the transparent panel behind it was drawn later and painted over every flame. One live probe of the particle buffers found it.

### Accomplishments we're proud of
- Real tests, really run: the fire is a genuine failing assertion from a real open-source project.
- The moment the roof lifts and the building slides out onto your actual desk.
- It works fully offline. No accounts, no keys, no servers.

### What we learned
Hands-first design is mostly about intent: deliberate commits, forgiving release, and a physical surface under every button (our buttons are plaques lying on your real table).

### What's next
- Point it at your own repository from the headset; today it works through `?city=<json>` and the CLI.
- Live test runs streamed from your machine.
- A conversational guide behind an optional key.
- Shared cities for code review.

### Built with
WebXR, Immersive Web SDK (IWSDK), three.js, TypeScript, Web Audio, Web Speech, Node.js, TypeScript compiler API, Vite, Vercel.

## Trailer (target ~70 s, under 3 min, recorded on the headset)
Hook first; real room visible; real code readable.

| Time | Shot | Action | Voice-over / caption |
|---|---|---|---|
| 0:00–0:06 | MR, close on the panel | Real semver code, the failing check in red | "This test has been failing all morning." |
| 0:06–0:15 | MR, the desk | Pinch: the city grows out of the real table with a dust ring; one tower burns | "So I built the repo as a city. On my desk." |
| 0:15–0:22 | MR, wide | The guide lantern flies to the fire; hover labels | "Files are buildings. Folders are districts. The fire is the failing test." |
| 0:22–0:34 | MR, hero close-up | Pinch the burning roof and lift; the building slides out as lit floors; one smoulders | "Lift the roof. Every floor is a function." |
| 0:34–0:42 | MR, fingertip | Touch the smouldering floor; expected `true`, got `false` | "Touch it, and it tells you exactly what broke." |
| 0:42–0:50 | MR, table plaques | Poke "Show me the fix": the one-line diff | "One line." |
| 0:50–0:55 | MR, close on the stack | Poke "Run the tests": the crane lifts the burning floor away (steam) and lowers the fixed one, clunk | "Swap in the fix…" |
| 0:55–1:00 | MR, wide | Green wave, "All tests pass"; scaffolding on the hot spots, the domed town hall | "…and the fire goes out." |
| 1:00–1:08 | MR, two hands | Two-hand pinch scales the city; Next city: Repo City's own code rises | "Any repo. Even this one. Repo City." |

**Capture:** `metavr capture video start --width 1920 --height 1080` (or the Quest camera app), slow head moves, plain desk, no logos or private code in view. If no headset footage is possible, the rules accept emulator footage (the HOAM recorder in `projects/hands-of-a-master/tools/trailer/`).

## Gallery (1920×1080 from the headset)
1. The city on a real desk, one tower on fire (hero).
2. The roof lifted, the building beside the city, the smouldering floor and its label.
3. The failing check on the panel (expected vs got).
4. The fix diff.
5. The green test sweep with steam.
6. Two-hand scale, Repo City's own city.

## Pre-submit checklist
- [ ] `npm run typecheck && npm run build`; `grep -c "\[city\]" dist/assets/*.js` is 0 (dev logs stripped)
- [ ] `npm run test:unit` and `npm run test:xr` green on the release commit
- [ ] Deployed (user approval) and the production URL opened logged out on a Quest 3: page, fonts, both cities load
- [ ] Headset checklist in `docs/TESTING.md` ticked
- [ ] Trailer < 3 min uploaded; screenshots attached
- [ ] Credits checked against sources (`public/cities/CREDITS.md`)
