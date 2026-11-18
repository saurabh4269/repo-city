// Dev probe: evaluate an expression against window.repoCity in the app frame.
// Usage: PROBE='expr' npx @iwsdk/cli browser run tools/probe.mjs   (expr sees `rc`)
export default async function ({ page }) {
  const expr = process.env.PROBE || 'rc.phase';
  for (const f of page.frames()) {
    try {
      const out = await f.evaluate((e) => {
        const rc = window.repoCity;
        if (!rc) return undefined;
        return JSON.stringify(eval(e));
      }, expr);
      if (out !== undefined) return out;
    } catch (e) { /* other frames */ }
  }
  return 'no repoCity';
}
