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

One line, on purpose, so that a real test fails:

`ranges/subset.js`, line 233, inside `higherGT` (one of four functions in
the file: `subset`, `simpleSubset`, `higherGT`, `lowerLT`)

```diff
-    : b.operator === '>' && a.operator === '>=' ? b
+    : b.operator === '>=' && a.operator === '>' ? b
```

`higherGT` picks the stricter of two lower bounds. When both have the same
version, `>X` is stricter than `>=X`; the swapped operators make it keep `>=X`
instead, so `subset()` answers wrongly, e.g. it says `>2.0.0` is not a subset
of `>=2.0.0`. 3 assertions in `test/ranges/subset.js` fail; every other test
file passes. The original line is the fix, stored in
`tools/repo-to-city/semver-fix.json`; `npm run city` runs the suite on this
bugged copy and on a temporary copy with the fix applied.

The test files are unchanged. They run under `tools/repo-to-city/tap-shim`, a
small stand-in for the parts of `tap@16` they use.

## Licence

semver is released under the ISC licence (see `LICENSE` in this folder):
Copyright (c) Isaac Z. Schlueter and Contributors.
