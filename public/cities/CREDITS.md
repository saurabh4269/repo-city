# City credits

## semver.json

Built from **semver** (https://github.com/npm/node-semver), version 7.7.3,
commit `a25789b09b1192fa8414c35f2cd679ae2e1d5192`.
Licence: ISC, Copyright (c) Isaac Z. Schlueter and Contributors.

The source snapshot lives in `fixtures/semver/` with its LICENSE. We removed one
line to put a real bug from semver's own history back: upstream commit
[`2471d75`](https://github.com/npm/node-semver/commit/2471d7543e2e63d9d95358e2405e7e1cde926c36)
("fix: x-range build metadata support", Sep 2025) added
`comp = comp.replace(re[t.BUILD], '')` to `parseComparator` in
`classes/range.js`. Without it, semver's real test suite fails 20 assertions
(`TypeError: Invalid comparator: >2.x+build`); with the upstream fix restored,
8,827 of 8,827 pass. The test results in this file come from really running
semver's own suite on both copies (`npm run city`). Details:
`fixtures/semver/REPO-CITY-NOTE.md`. File summaries were written by hand for
Repo City.

## repo-city.json

Built from this project's own `src/` folder.

## *.light.ktx2

Baked lighting (ambient occlusion and sun visibility) for each city, generated
by `tools/repo-to-city/light-bake.mjs` from the city layout. No external assets.
