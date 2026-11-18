# Contributing to Repo City

Thanks for your interest. Issues and pull requests are welcome, especially:

- trying `npm run city:repo` on your own repository and telling us what the city got right or wrong;
- support for more test runners or languages in `tools/repo-to-city/`;
- interaction and comfort feedback from a real headset.

## Setup

```bash
npm ci
npm run dev          # IWSDK dev server + emulator, https://localhost:8083
```

Node 22.18+ or 24 (`.nvmrc`). `npm run setup` additionally generates IWSDK's agent and editor configs (they are git-ignored).

## Before you open a pull request

```bash
npm run typecheck
npm run test:unit
npm run build
```

CI runs the same three. If your change touches interaction or the guided journey, also run the emulator journey with both hands (see [docs/TESTING.md](docs/TESTING.md)):

```bash
npx @iwsdk/cli dev up --ai-mode agent --allow-browser-automation
npm run test:xr
npm run test:xr -- --hand left --drag --jitter 5
```

If it touches rendering or performance, please check it on a Quest if you can; `tools/quest-debug.mjs` logs fps and draw calls from the headset during `npm run dev`.

## Guidelines

- Keep the runtime free of network calls beyond loading the city's own files.
- Keep the draw-call budget in mind (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
- Changes to the city JSON format go in `src/city/types.ts` and `tools/test/validate-city.mjs` together; a missing new field must keep old cities loading.
- Screenshots or captures in issues and PRs should not show people in passthrough.

By contributing you agree that your contribution is licensed under the MIT licence of this project, and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
