import type { World } from '@iwsdk/core';

/**
 * The 2D page around the canvas: what this is, and an Enter button only when
 * the browser can actually run immersive AR (a button that does nothing reads
 * as a broken site).
 */
export function setupPage(world: World): void {
  const box = document.createElement('div');
  box.id = 'page-overlay';
  box.style.cssText =
    'position:fixed;left:16px;bottom:16px;max-width:440px;padding:18px 20px;border-radius:16px;background:rgba(14,22,34,.88);color:#f4efe6;font:500 15px/1.45 Inter,Helvetica,Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);z-index:10';
  box.innerHTML = `<div style="font:800 24px Inter,Helvetica,Arial,sans-serif;margin-bottom:6px">Repo City</div>
  <div>A real code repository rises as a city on your desk. Files are buildings, functions are floors, and a failing test is a building on fire. Lift the roof, find the bug, run the tests.</div>
  <div id="xr-status" style="margin-top:10px;color:#a9b4c2">Checking for mixed reality…</div>
  <button id="enter-xr" style="display:none;margin-top:12px;padding:10px 18px;border:0;border-radius:999px;background:#8cc8ff;color:#08111c;font:700 16px Inter,Helvetica,Arial,sans-serif;cursor:pointer">Enter XR</button>`;
  document.body.appendChild(box);
  const status = box.querySelector('#xr-status') as HTMLDivElement;
  const button = box.querySelector('#enter-xr') as HTMLButtonElement;
  button.onclick = () => world.launchXR();
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) {
    status.textContent = 'This is a preview. Open this address in Meta Quest Browser on a Quest 3 or 3S, seated at a table, hands free.';
    return;
  }
  xr.isSessionSupported('immersive-ar')
    .then((ok) => {
      status.textContent = ok
        ? 'Sit at a table, put your controllers down and use your hands.'
        : 'This is a preview. Open this address in Meta Quest Browser on a Quest 3 or 3S.';
      button.style.display = ok ? 'inline-block' : 'none';
    })
    .catch(() => (status.textContent = 'This is a preview. Open it in Meta Quest Browser.'));
  world.visibilityState.subscribe((s) => {
    box.style.display = s === 'non-immersive' ? 'block' : 'none';
  });
}
