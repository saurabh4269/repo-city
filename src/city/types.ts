/**
 * The city format: what `tools/repo-to-city` writes (public/cities/<id>.json)
 * and what the app reads. Plain data, no three.js.
 *
 * Coordinates are in CITY UNITS: the whole city fits in the square
 * x, z ∈ [-0.5, 0.5] (x to the right, z toward the viewer); the app scales it
 * to ~0.46 m on the table. Heights `h` are in the same units (max ~0.36).
 */

export interface CityData {
  version: 1;
  id: string; // 'semver'
  name: string; // 'semver'
  tagline: string; // one line: what this repo does
  source: { repo: string; url: string; commit: string; license: string; note: string };
  stats: { files: number; lines: number; functions: number; tests: number; failing: number };
  districts: District[];
  buildings: Building[];
  /** Imports between buildings (ids). Drawn as lit routes. */
  streets: Street[];
  /** The test run with the bug in place. */
  run: TestRun;
  /** The one-line fix, and the run after it. Absent when nothing fails. */
  fix?: Fix;
  guide: Guide;
}

export interface District {
  id: string; // 'functions'
  path: string; // 'functions/'
  name: string; // 'Functions'
  summary: string; // 1–2 sentences for the guide, ≤ 220 chars
  /** Palette index 0..5 (the app owns the colours). */
  color: number;
  /** Rectangle in city units (centre x/z, width w along x, depth d along z). */
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface Building {
  id: string; // stable, e.g. 'functions/diff.js'
  path: string; // repo-relative path
  name: string; // 'diff.js'
  district: string; // District.id
  lines: number; // non-blank lines
  complexity: number; // sum of a cyclomatic proxy over the file
  summary: string; // one sentence, ≤ 140 chars
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** Floors bottom to top, in source order. At least one (a file with no functions gets a 'module' floor). */
  functions: Fn[];
  /** Building ids this file imports. */
  imports: string[];
  /** Test assertions that exercise this file (from its test file), in the bugged run. */
  tests: { passed: number; failed: number };
}

export interface Fn {
  name: string; // 'diff', 'SemVer.compare', '(module)'
  startLine: number; // 1-based
  endLine: number;
  lines: number;
  complexity: number;
  /** Source excerpt from startLine: ≤ 16 lines, each ≤ 60 chars (longer lines cut with '…'). */
  code: string;
  /** First line of `code` when the excerpt doesn't start at startLine (the failing floor shows the bug). */
  codeStart?: number;
  /** True when the bug lives in this function. */
  failing?: boolean;
  /** 1-based line of the bug (failing floor only). */
  bugLine?: number;
}

export interface Street {
  from: string;
  to: string;
}

export interface TestRun {
  runner: string; // 'tap 16 (node 22)'
  total: number; // assertions
  passed: number;
  failed: number;
  durationMs: number;
  failures: Failure[];
}

export interface Failure {
  building: string; // Building.id of the source file under test
  fn: string; // Fn.name containing the bug
  testFile: string; // 'test/functions/diff.js'
  testName: string; // human name of the failing case
  /** The assertion line from the test file, ≤ 60 chars. */
  assertion: string;
  expected: string;
  actual: string;
  message: string; // ≤ 120 chars
}

export interface Fix {
  building: string;
  fn: string;
  line: number; // 1-based line in the file
  before: string; // the buggy line (trimmed, ≤ 60 chars)
  after: string; // the fixed line
  /** One or two sentences: why it failed and what the fix changes. ≤ 240 chars. */
  explanation: string;
  /** The real run after the fix. */
  run: TestRun;
}

export interface Guide {
  /** First thing the guide says after the city rises (≤ 200 chars). */
  intro: string;
  /** Said when the user first opens the burning building (≤ 200 chars). */
  onFire: string;
  /** Said after the tests go green (≤ 160 chars). */
  done: string;
}
