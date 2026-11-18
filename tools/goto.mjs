// Dev helper: reload the app with a ?state= preset inside the IWSDK emulator
// (its managed browser drops URL queries, so the preset goes through sessionStorage).
//   echo '{"query":"?state=fire"}' > artifacts/goto-preset.json && npx @iwsdk/cli browser run tools/goto.mjs
// Adapted from skills/quest-hands-first-webxr/scripts/goto_preset.mjs.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function run({ page, workspaceRoot }) {
  let query = '';
  try {
    query = JSON.parse(readFileSync(join(workspaceRoot, 'artifacts', 'goto-preset.json'), 'utf8')).query || '';
  } catch {
    // no file: plain reload
  }
  for (const f of page.frames()) {
    try {
      await f.evaluate((q) => sessionStorage.setItem('repo-city-preset', q), query);
    } catch {
      /* cross-origin frame */
    }
  }
  await page.reload();
  return { query };
}
