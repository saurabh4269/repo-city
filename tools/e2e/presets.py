"""Each ?state= preset lands on its moment after placement (and gives a screenshot for the gallery)."""
import os, sys, time
os.environ.setdefault('XR_LOG_TAG', 'city')
sys.path.insert(0, os.path.dirname(__file__))
from xr_e2e_lib import *

EXPECT = {'open': r'open ranges/', 'fire': r'floor \d+ \S+ failing=true', 'fix': r'plaques run-tests', 'done': r'result tests=', 'explore': r'preset explore'}
for name in (sys.argv[1:] or ['fire', 'done']):
    cli('xr', 'exit', check=False)
    goto_preset(f'?state={name}', 'repo-city-preset')
    enter_hands(seat=True, head=(0.0, 0.92, -1.28), head_quat=(-0.42, 0.0, 0.0, 0.907))
    wait_for(r'placing preview=plane', 30)
    select()
    check(f'preset {name}', bool(wait_for(EXPECT[name], 25)))
    time.sleep(1.5)
    shot(f'preset-{name}')
finish()
