#!/usr/bin/env python3
"""
Repo City: the whole hands-only journey in the IWSDK emulator (IWER).

  place the city on the table (pinch) → it rises → pinch the burning roof →
  touch the smouldering floor → read the failure → "Show me the fix" →
  "Run the tests" → fire out, all green → two-hand scale → next city.

Needs the dev server: `npx @iwsdk/cli dev up --ai-mode agent --allow-browser-automation`.
Run: `npm run test:xr` (or `XR_LOG_TAG=city python3 tools/e2e/journey.py [--tour] [--hand left] [--jitter 4]`).
Never edit src/ while this runs (hot reload ends the XR session).
"""
import argparse
import os
import random
import sys
import time

os.environ.setdefault('XR_LOG_TAG', 'city')
sys.path.insert(0, os.path.dirname(__file__))
from xr_e2e_lib import *  # noqa: E402,F403

ap = argparse.ArgumentParser()
ap.add_argument('--tour', action='store_true', help='screenshot every first-of-its-kind moment')
ap.add_argument('--hand', default='right', choices=['right', 'left'])
ap.add_argument('--jitter', type=float, default=3.0, help='random fingertip error, mm')
ap.add_argument('--drag', action='store_true', help='open the roof by pinch-drag instead of a pinch tap')
args = ap.parse_args()
HAND = f'hand-{args.hand}'
OTHER = 'hand-left' if args.hand == 'right' else 'hand-right'
J = args.jitter / 1000.0
# A seated user at the emulator's coffee table (eyes ~0.47 m above it), looking down at it.
HEAD = (0.0, 0.92, -1.28)
HEAD_Q = (-0.42, 0.0, 0.0, 0.907)


def jit(p):
    return (p[0] + random.uniform(-J, J), p[1] + random.uniform(-J, J), p[2] + random.uniform(-J, J))


def tour(name):
    if args.tour:
        time.sleep(0.7)
        shot(f'tour-{name}')


def park(device):
    cli('xr', 'set-transform', payload={'device': device, 'position': {'x': -0.35 if device == 'hand-left' else 0.35, 'y': 0.55, 'z': -1.1}})


def poke_down(p, device=HAND, above=0.05, below=0.012):
    """Fingertip from above a point down through it, then back up."""
    tip_to(jit((p[0], p[1] + above, p[2])), 0.35, device)
    tip_to(jit((p[0], p[1] - below, p[2])), 0.25, device)
    time.sleep(0.25)
    tip_to((p[0], p[1] + above, p[2]), 0.25, device)


pin_page()
enter_hands(pose='point', device=HAND, seat=True, head=HEAD, head_quat=HEAD_Q)
cli('xr', 'set-hand-pose', payload={'device': OTHER, 'poseId': 'point'})
park(OTHER)

# 1. Placement on the labelled table
m = wait_for(r'placing preview=plane', 15)
check('placement finds the table', bool(m), m.group(0))
tour('placing')
tip_to((0.05, 0.75, -1.55), 0.3, HAND)
select(HAND)
m = wait_for(r'placed how=(\S+)', 10)
check('placed on the real table', m.group(1) == 'table', m.group(0)[:120])
time.sleep(1.2)
tour('rising')
wait_for(r'phase city', 20)
m = wait_for(r'guide entry (\S+)', 5)
t = field(wait_for(r'targets layout='), 'layout')
time.sleep(1.5)
tour('entry')
m2 = wait_for(r'guide fire (\S+)', 8)
check('the guide names the town hall, then the fire', bool(m and m2), f"{m.group(0) if m else 'no entry'} -> {m2.group(0) if m2 else 'no fire line'}")
fire, center = t['fire'], t['center']
check('city sits on the table', abs(center[1] - 0.438) < 0.05, f'center={center}')
plaques = t['plaques']
check('first prompt offers the burning building', 'goto-fire' in plaques, str(list(plaques)))
tour('city')

# 2. Hover the burning building, then open it by pinching its roof
tip_to(jit((fire[0], fire[1] + 0.07, fire[2])), 0.5, HAND)
time.sleep(0.6)
tour('hover-fire')
if args.drag:
    sequence([{'label': 'grip', 'anchor': 'index-tip', 'position': {'x': fire[0], 'y': fire[1] + 0.012, 'z': fire[2]}, 'duration': 0.3, 'pinch': {'value': 1, 'at': 'arrival'}},
              {'label': 'lift', 'position': {'x': fire[0], 'y': fire[1] + 0.09, 'z': fire[2]}, 'duration': 0.8},
              {'label': 'let go', 'pinch': 0, 'duration': 0.2}], HAND)
else:
    tip_to((fire[0], fire[1] + 0.01, fire[2]), 0.25, HAND)
    select(HAND)
mf = wait_for(r'flow (\d+)', 8)
m = wait_for(r'open (\S+)', 8)
check('flow dots run along its routes', int(mf.group(1)) > 0, mf.group(0))
check('pinching the roof opens the burning building', m.group(1) == t['fireId'], m.group(0))
tip_to((fire[0] + 0.15, fire[1] + 0.12, fire[2] + 0.2), 0.4, HAND)  # out of the way
time.sleep(1.0)
tour('open')

# 3. Touch the smouldering floor
key('f')
fl = field(wait_for(r'floors layout='), 'layout')
f = fl['floors'][fl['failing']]
tip_to(jit((f[0], f[1], f[2] + 0.05)), 0.4, HAND)
tip_to((f[0], f[1], f[2] - 0.012), 0.35, HAND)
m = wait_for(r'floor (\d+) (\S+) failing=(\w+)', 6)
check('touching the smouldering floor selects it', m.group(3) == 'true', m.group(0))
tip_to((f[0], f[1] + 0.02, f[2] + 0.12), 0.3, HAND)
m = wait_for(r'plaques (\S+) layout=', 5)
plaques = field(m, 'layout')
check('fire report offers the fix', 'see-fix' in plaques, m.group(1))
tour('fire-report')

# 4. Plaques on the table: poke "Show me the fix", then "Run the tests"
poke_down(plaques['see-fix'])
m = wait_for(r'plaques (\S+) layout=', 6)
plaques = field(m, 'layout')
check('fix shown, tests offered', 'run-tests' in plaques, m.group(1))
tour('fix')
poke_down(plaques['run-tests'])
check('the fix crane starts', bool(wait_for(r'crane start', 6)))
if args.tour:
    time.sleep(0.4)
    shot('tour-crane')
check('the fire goes out', bool(wait_for(r'fire out', 10)))
check('the crane finishes', bool(wait_for(r'crane done', 6)))
check('tests run', bool(wait_for(r'phase testing', 3)))
time.sleep(2.0)
tour('testing')
m = wait_for(r'result tests=(\d+) seconds=([\d.]+)', 10)
check('all tests pass', int(m.group(1)) > 8000, m.group(0))
m = wait_for(r'plaques (\S+) layout=', 6)
plaques = field(m, 'layout')
tour('done')

# 5. Two-hand pinch scales the city
park(HAND)
cx, cy, cz = center
cli('xr', 'set-hand-pose', payload={'device': 'hand-left', 'poseId': 'point'})
cli('xr', 'set-hand-pose', payload={'device': 'hand-right', 'poseId': 'point'})
tip_to((cx - 0.08, cy + 0.22, cz + 0.1), 0.3, 'hand-left')
tip_to((cx + 0.08, cy + 0.22, cz + 0.1), 0.3, 'hand-right')
cli('xr', 'set-device-state', payload={'state': {'hands': {'left': {'pinchValue': 1}, 'right': {'pinchValue': 1}}}}, check=False)
time.sleep(0.4)
tip_to((cx - 0.13, cy + 0.22, cz + 0.1), 0.5, 'hand-left')
tip_to((cx + 0.13, cy + 0.22, cz + 0.1), 0.5, 'hand-right')
time.sleep(0.3)
cli('xr', 'set-device-state', payload={'state': {'hands': {'left': {'pinchValue': 0}, 'right': {'pinchValue': 0}}}}, check=False)
m = wait_for(r'two-hand end scale=([\d.]+)', 6)
check('two-hand pinch scales the city', float(m.group(1)) > 1.08, m.group(0))
tour('scaled')
park('hand-left')

# 6. Next city
plaques = field(wait_for(r'plaques (\S+) layout=', 6), 'layout') if 'next-city' not in plaques else plaques
poke_down(plaques['next-city'])
mf = wait_for(r'flow (\d+)', 8)
check('flow dots stop when the building closes', mf.group(1) == '0', mf.group(0))
m = wait_for(r'city (\S+) buildings=(\d+)', 8)
check('next city loads', m.group(1) == 'repo-city', m.group(0))
time.sleep(3)
tour('next-city')
finish()
