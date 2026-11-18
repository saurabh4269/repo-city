"""Close-up review shots (dev): place the city, then look at the burning roof and the open building from ~30 cm."""
import os, sys, time
os.environ.setdefault('XR_LOG_TAG', 'city')
sys.path.insert(0, os.path.dirname(__file__))
from xr_e2e_lib import *
pin_page()
enter_hands(seat=True, head=(0.0, 0.92, -1.28), head_quat=(-0.42, 0.0, 0.0, 0.907))
wait_for(r'placing preview=plane', 15)
select()
wait_for(r'phase city', 20)
t = field(wait_for(r'targets layout='), 'layout')
fx, fy, fz = t['fire']
cli('xr', 'set-transform', payload={'device': 'hand-right', 'position': {'x': 0.4, 'y': 0.5, 'z': -1.0}})
look_at((fx, fy + 0.03, fz), head=(fx + 0.12, fy + 0.2, fz + 0.28))
time.sleep(1.0)
shot('close-fire')
key('o')
time.sleep(2.0)
key('f')
fl = field(wait_for(r'floors layout='), 'layout')
f = fl['floors'][fl['failing']]
look_at((f[0], f[1], f[2]), head=(f[0] - 0.1, f[1] + 0.12, f[2] + 0.32))
time.sleep(1.0)
shot('close-open')
