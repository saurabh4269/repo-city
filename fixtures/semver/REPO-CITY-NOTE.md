# semver snapshot used by Repo City

This folder is a copy of **semver v7.7.3** from https://github.com/npm/node-semver
(tag `v7.7.3`, commit `a25789b09b1192fa8414c35f2cd679ae2e1d5192`), taken with a
shallow `git clone --depth 1 --branch v7.7.3`.

Kept: `LICENSE`, `README.md`, `package.json`, `index.js`, `preload.js`,
`range.bnf`, `map.js`, `bin/`, `classes/`, `functions/`, `internal/`, `ranges/`,
`test/` and `tap-snapshots/` (used by `test/bin/semver.js`). Left out:
`.github/`, `benchmarks/`, `CHANGELOG.md` and the other repo housekeeping files.
No `node_modules`.

## What we changed

One real bug, put back on purpose so that real tests fail. Upstream commit
[`2471d75`](https://github.com/npm/node-semver/commit/2471d7543e2e63d9d95358e2405e7e1cde926c36)
("fix: x-range build metadata support", 24 Sep 2025, part of v7.7.3) added one
line to `parseComparator` in `classes/range.js`. We removed that line again:

```diff
 const parseComparator = (comp, options) => {
-  comp = comp.replace(re[t.BUILD], '')
   debug('comp', comp, options)
```

Without it, ranges with build metadata such as `>2.x+build` throw
`TypeError: Invalid comparator`. The tests that commit added
(`test/fixtures/range-parse.js`) are part of v7.7.3, so 20 assertions in
`test/classes/range.js` (and friends) fail; every other test passes. The fix is
stored in `tools/repo-to-city/semver-fix.json` (an insertion: `before: null`);
`npm run city` runs the suite on this copy and on a temporary copy with the
line restored. `ranges/subset.js` is exactly upstream.

The test files are unchanged. They run under `tools/repo-to-city/tap-shim`, a
small stand-in for the parts of `tap@16` they use.

## Licence

semver is released under the ISC licence (see `LICENSE` in this folder):
Copyright (c) Isaac Z. Schlueter and Contributors.
