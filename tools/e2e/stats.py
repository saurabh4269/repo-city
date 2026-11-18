"""Visual-pass review (dev): render numbers and the same four shots every time.
  python3 tools/e2e/stats.py <label>      -> artifacts/stats-<label>.json, artifacts/e2e-<label>-*.png
Shots: the seated view of the city, a leaning-in view from ~45 cm, a 3/4 hero close-up, the open burning building, and the floor stack."""
import json, os, sys, time
os.environ.setdefault('XR_LOG_TAG', 'city')
sys.path.insert(0, os.path.dirname(__file__))
from xr_e2e_lib import *
import xr_e2e_lib

label = sys.argv[1] if len(sys.argv) > 1 else 'now'
out = {}


def probe(name):
    xr_e2e_lib.ENV['PROBE'] = 'rc.stats()'
    r = cli('browser', 'run', 'tools/probe.mjs')
    try:
        s = json.loads(r['data']['result']) if isinstance(r.get('data', {}).get('result'), str) else r.get('data', {}).get('result')
    except Exception:
        s = r
    out[name] = s
    print(name, json.dumps({k: v for k, v in (s or {}).items() if k != 'textures'}), flush=True)


pin_page()
enter_hands(seat=True, head=(0.0, 0.92, -1.28), head_quat=(-0.42, 0.0, 0.0, 0.907))
wait_for(r'placing preview=plane', 15)
select()
wait_for(r'phase city', 20)
t = field(wait_for(r'targets layout='), 'layout')
time.sleep(3.0)
cli('xr', 'set-transform', payload={'device': 'hand-right', 'position': {'x': 0.4, 'y': 0.3, 'z': -0.8}})
time.sleep(1.0)
probe('city')
shot(f'{label}-seated')
cx, cy, cz = t['center']
look_at((cx, cy + 0.02, cz - 0.02), head=(cx - 0.05, cy + 0.36, cz + 0.3))
time.sleep(1.2)
shot(f'{label}-near')
fx, fy, fz = t['fire']
look_at((fx + 0.12, fy - 0.08, fz + 0.02), head=(fx - 0.18, fy + 0.12, fz + 0.36))
time.sleep(1.2)
shot(f'{label}-hero')
look_at((fx, fy + 0.03, fz), head=(fx + 0.12, fy + 0.2, fz + 0.28))
time.sleep(1.0)
shot(f'{label}-fire')
key('o')
time.sleep(2.0)
key('f')
fl = field(wait_for(r'floors layout='), 'layout')
f = fl['floors'][fl['failing']]
look_at((f[0], f[1], f[2]), head=(f[0] - 0.1, f[1] + 0.12, f[2] + 0.32))
time.sleep(1.2)
probe('open')
shot(f'{label}-open')
with open(os.path.join(ROOT, 'artifacts', f'stats-{label}.json'), 'w') as fh:
    json.dump(out, fh, indent=1)
cli('xr', 'exit', check=False)
