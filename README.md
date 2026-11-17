# Repo City

A real code repository rises as a city on your desk.
- Files are buildings; height shows size or complexity.
- Folders are districts and imports are streets.
- **A failing test is a building on fire.**

- **Track:** Productivity. **Awards:** Boldest Original Concept, Best Agentic Interaction (AI guide).
- **Awe moment:** you lift the roof off your own project. Last night's code is a lit building, with one floor smouldering.
- **Core loop:** load a repo JSON → survey the city → pinch a building to lift its roof (floors are functions, a panel shows the code) → ask the guide → follow a street → watch fires go out as tests pass.

## Minimum playable version
This repo (or a small open-source one) pre-processed to JSON, with an instanced city on the table, roof-lift with a code panel, and fire on failing tests.

## Reuse
- Metrics: CodeCharta `ccsh` (BSD-3) or `scc --format json` (MIT); lizard for per-function complexity.
- `InstancedMesh` buildings (the RepoVerse/CodeCharta treemap pattern); three.quarks fire.
- `XRQuadLayer` + shiki (MIT) tokens for crisp code text; foveation 0.3.
- Claude through a `/api` Vercel function for the guide.

## Build steps
1. `tools/repo-to-city` CLI → `public/city.json`.
2. Treemap layout.
3. Instanced buildings + `ContactShadow`.
4. Pinch-lift roof → floors → code panel.
5. Two-hand zoom.
6. Test results → fire.
7. AI guide as a small character you can place.

## Risks
- Text readability: use layers, large type and angular scaling.
- Show real source files early in the video so it doesn't read as another mind map.
- Keep private code local.

## Common to every project
- Stack: IWSDK 1.1.0 (pinned) · WebXR in Meta Quest Browser · mixed-reality `ar` session · hands only · seated · Vercel.
- Shared rules, visual/hands/MR playbooks, perf budget, assets & licenses, and the submission gate: **[common build plan](../meta-vr-start-2026-kit/research/common-build-plan.md)**.
- Competition: Meta VR Start Developer Competition 2026. Deadline **Wed 18 Nov 2026, 12:00 PM PST (Thu 19 Nov, 1:30 AM IST)**.

## Run
```bash
npm ci            # Node >=20.19 (see .nvmrc). .npmrc skips onnxruntime's CUDA download.
npm run setup     # once per machine: MCP configs for Claude/Cursor/Codex + IWSDK reference index
npm run dev       # HTTPS dev server + emulator on https://localhost:8081
npm run typecheck && npm run build
```
Testing on a Quest from Linux: `adb reverse tcp:8081 tcp:8081`, then open `https://localhost:8081` in Quest Browser.
Agent workflow: start every task with the `iwsdk-dev` skill. More in [docs/IWSDK-STARTER.md](docs/IWSDK-STARTER.md) and [AGENTS.md](AGENTS.md).
