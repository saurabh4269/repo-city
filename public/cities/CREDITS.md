# City credits

## semver.json

Built from **semver** (https://github.com/npm/node-semver), version 7.7.3,
commit `a25789b09b1192fa8414c35f2cd679ae2e1d5192`.
Licence: ISC, Copyright (c) Isaac Z. Schlueter and Contributors.

The source snapshot lives in `fixtures/semver/` with its LICENSE. We changed one
line to plant a bug for the demo: `ranges/subset.js` line 233 (in
`higherGT`), where the operators `'>'` and `'>='` were swapped. The test results in this file come from really running
semver's own test suite on that copy and on the fixed copy
(`npm run city`). File summaries were written by hand for Repo City.

## repo-city.json

Built from this project's own `src/` folder.

## *.light.ktx2

Baked lighting (ambient occlusion and sun visibility) for each city, generated
by `tools/repo-to-city/light-bake.mjs` from the city layout. No external assets.
