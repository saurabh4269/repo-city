import {
  createSystem,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRPlane,
  BoxGeometry,
  AdditiveBlending,
} from '@iwsdk/core';
import { sfx } from './audio.js';
import { CITY_SIZE, CityView, PLINTH_H } from './city/city-view.js';
import type { Building, CityData, Failure } from './city/types.js';
import { createDeskEnvironment } from './city/environment.js';
import { SUN_DIR } from './city/light-layout.js';
import { landmarkSize } from './city/details.js';
import { loadDataTexture } from './city/textures.js';
import { Fire } from './fx/fire.js';
import { Sparks } from './fx/sparks.js';
import { Hands, type HandState } from './input/hands.js';
import { gatherPlanes } from './mr/plane-source.js';
import { describeReport, emptyReport, findTableSpot, type PlaneInput, resetReport } from './mr/room-placement.js';
import { CanvasCard, fitText, glass, loadFonts, UI } from './ui/canvas.js';
import { MainPanel, PANEL_H, PANEL_W, type PanelMode } from './ui/panel.js';
import { Plaques, type PlaqueSpec } from './ui/plaques.js';

/**
 * Repo City director: one system, one phase machine.
 *
 *   page     the 2D page outside XR (the city turns slowly on a virtual desk)
 *   placing  find the real table (labelled plane) → hand-follow → virtual desk; pinch to place
 *   rising   the city grows out of the table
 *   city     free exploration + the guided journey (open the burning building,
 *            touch the smouldering floor, read the failing check, see the fix)
 *   testing  the test suite replays across the city; the fire goes out
 *   done     result card; keep exploring or load the next city
 *
 * All content maths happens in the anchored group's local space (`anchor`).
 */

type Phase = 'page' | 'placing' | 'rising' | 'city' | 'testing' | 'done';
type Step = 'find-fire' | 'touch-floor' | 'read-failure' | 'see-fix' | 'run-tests' | 'finished' | 'free';

const CITIES = ['semver', 'repo-city'];
const TAG = '[city]';
const PAGE_ID = Math.random().toString(36).slice(2, 7);
let seq = 0;
function log(event: string): void {
  if (import.meta.env.DEV) console.info(`${TAG} #${PAGE_ID}.${++seq} ${event}`);
}

/** City local (metres from the plinth top centre) → toward the user is +Z. */
const PANEL_POS = new Vector3(0, 0.27, -0.3);
const PANEL_TILT = -0.16;
const PLAQUE_Z = CITY_SIZE / 2 + 0.06;

export class RepoCityDirector extends createSystem({
  planes: { required: [XRPlane] },
}) {
  private phase: Phase = 'page';
  private phaseT = 0;
  private step: Step = 'find-fire';
  private clock = 0;
  private immersive = false;

  private anchor!: Group;
  private anchorEntity!: ReturnType<typeof this.world.createTransformEntity>;
  /** Two-hand manipulation (scale/rotate) of the city about the plinth centre. */
  private manip!: Group;
  private city!: CityView;
  private fire!: Fire;
  private sparks = new Sparks();
  private fireLight!: PointLight;
  private sun!: DirectionalLight;
  private panel!: MainPanel;
  private plaques!: Plaques;
  private hoverCard!: CanvasCard;
  private floorCard!: CanvasCard;
  private guideOrb!: Group;
  private hintCard!: CanvasCard;
  private preview!: Group;
  private virtualDesk!: Mesh;
  private hands = new Hands();

  private cities = new Map<string, CityData>();
  private cityIndex = 0;
  private data: CityData | null = null;
  private failure: Failure | null = null;
  private fireIndex = -1;
  private panelMode: PanelMode = { kind: 'placing' };
  private journeyStart = 0;
  private journeyDone = false;

  // placement
  private planePool: PlaneInput[] = [];
  private placeReport = emptyReport();
  private placeHow = '';
  private placeSpot = new Vector3();
  private placeYaw = 0;
  private placeKind: 'none' | 'plane' | 'hand' | 'virtual' = 'none';
  private anchored = false;

  // interaction
  private activeHand: HandState | null = null;
  private dragHand: HandState | null = null;
  private dragKind: 'none' | 'lift' | 'roof' = 'none';
  private dragStartY = 0;
  private dragStartT = 0;
  private dragStartOpen = 0;
  private openTarget = 0;
  private twoHand = false;
  private twoStartDist = 0;
  private twoStartAngle = 0;
  private twoStartScale = 1;
  private twoStartYaw = 0;
  private userScale = 1;
  private userYaw = 0;
  private lastHover = -1;
  private fireDwell = 0;
  /** Floor the fingertip was inside last frame (-2 = must be seen outside first). */
  private tipFloorPrev = -2;
  private tipDepthPrev = [1, 1];
  private testing = { t: 0, order: [] as number[], next: 0, passed: 0, failed: 0, total: 0, extinguished: false };

  // scratch
  private readonly head = new Vector3();
  private readonly fwd = new Vector3();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly m = new Matrix4();
  private readonly mInv = new Matrix4();
  private readonly tipLocal = [new Vector3(), new Vector3()];
  private readonly pinchLocal = [new Vector3(), new Vector3()];
  private readonly tipsWorld: (Vector3 | null)[] = [null, null];
  private readonly pinchStartsWorld: (Vector3 | null)[] = [null, null];
  private readonly keys = new Set<string>();

  init(): void {
    void loadFonts().then(() => this.refreshPanel(true));
    this.anchor = new Group();
    this.anchor.name = 'city-anchor';
    this.anchorEntity = this.world.createTransformEntity(this.anchor, { persistent: true });
    this.manip = new Group();
    this.manip.name = 'city-manip';
    this.anchor.add(this.manip);

    this.city = new CityView();
    this.city.root.position.y = PLINTH_H;
    this.manip.add(this.city.root);

    this.fire = new Fire();
    this.city.root.add(this.fire.group);
    this.city.root.add(this.sparks.points);
    this.fireLight = new PointLight('#ff8a3a', 0, 0.35, 2);
    this.city.root.add(this.fireLight);

    // One key light, no runtime shadow map: its shadows and the ambient occlusion are baked per
    // city (tools/repo-to-city/light-bake.mjs) from the same direction. It lives in the city's
    // frame so it turns with the city, exactly like the baked shadows.
    this.sun = new DirectionalLight('#fff1dc', 3.0);
    this.sun.position.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
    this.manip.add(this.sun);
    this.manip.add(this.sun.target);
    this.renderer.shadowMap.enabled = false;
    // Reflections from a room lit like the city (warm window where the key light comes from).
    this.scene.environment = createDeskEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.5;
    void Promise.all([loadDataTexture(`${import.meta.env.BASE_URL}textures/contact.ktx2`, this.renderer), loadDataTexture(`${import.meta.env.BASE_URL}textures/blob.ktx2`, this.renderer)])
      .then(([contact, blob]) => {
        this.city.setMasks(contact, blob);
        this.plaques.setShadow(blob);
      })
      .catch((e) => log(`masks failed ${String(e)}`));

    // Virtual desk (only when no real table is found).
    this.virtualDesk = new Mesh(new BoxGeometry(0.78, 0.03, 0.56), new MeshStandardMaterial({ color: '#3a2a20', roughness: 0.6 }));
    this.virtualDesk.position.set(0, -0.015, 0.03);
    this.virtualDesk.visible = false;
    this.anchor.add(this.virtualDesk);

    // Main panel standing behind the city, tilted back a little.
    this.panel = new MainPanel();
    this.panel.card.mesh.name = 'main-panel';
    // drawn before the fire and the labels: the panel stands behind them, and transparent
    // objects without depth writes paint over whatever was drawn before them.
    this.panel.card.mesh.renderOrder = 1;
    this.panel.card.mesh.position.copy(PANEL_POS);
    this.panel.card.mesh.rotation.x = PANEL_TILT;
    this.anchor.add(this.panel.card.mesh);

    // The guide: a small lantern drone at the panel's top-left corner.
    this.guideOrb = makeGuide();
    this.guideOrb.position.set(-PANEL_W / 2 - 0.035, PANEL_POS.y + PANEL_H / 2 - 0.04, PANEL_POS.z + 0.02);
    this.anchor.add(this.guideOrb);

    this.plaques = new Plaques();
    this.plaques.group.position.set(0, 0, PLAQUE_Z);
    this.plaques.onPress = (id) => this.onPlaque(id);
    this.anchor.add(this.plaques.group);

    this.hoverCard = new CanvasCard(0.15, 0.05, 2400);
    this.hoverCard.mesh.renderOrder = 12;
    this.hoverCard.material.depthTest = false;
    this.hoverCard.opacity = 0;
    this.anchor.add(this.hoverCard.mesh);
    this.floorCard = new CanvasCard(0.13, 0.042, 2400);
    this.floorCard.mesh.renderOrder = 12;
    this.floorCard.opacity = 0;
    this.anchor.add(this.floorCard.mesh);

    // Placement: preview frame + a lazy-follow hint card.
    this.preview = makePreview();
    this.preview.visible = false;
    this.world.createTransformEntity(this.preview, { persistent: true });
    this.hintCard = new CanvasCard(0.36, 0.11, 2400);
    this.hintCard.mesh.visible = false;
    this.world.createTransformEntity(this.hintCard.mesh, { persistent: true });

    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.NonImmersive) {
          if (this.immersive) this.exitXR();
        } else if (!this.immersive) {
          this.enterXR();
        }
      }),
    );
    const onKey = (e: KeyboardEvent) => this.keys.add(e.key);
    window.addEventListener('keydown', onKey);
    this.cleanupFuncs.push(() => window.removeEventListener('keydown', onKey));

    void this.loadCities().then(() => this.enterPage());
    if (import.meta.env.DEV) (window as unknown as { repoCity: unknown }).repoCity = this;
  }

  // ───────────────────────── data

  private async loadCities(): Promise<void> {
    for (const id of CITIES) {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}cities/${id}.json`);
        if (r.ok) {
          const data = (await r.json()) as CityData;
          this.cities.set(id, data);
          if (data.light) this.lightUrls.set(data.id, `${import.meta.env.BASE_URL}cities/${data.light}`);
        }
      } catch {
        /* missing city: skipped */
      }
    }
    // "Your own repo": ?city=<url of a city.json made by tools/repo-to-city> goes first.
    const own = new URLSearchParams(location.search).get('city');
    if (own) {
      try {
        const r = await fetch(own);
        if (r.ok) {
          const data = (await r.json()) as CityData;
          if (data.version === 1 && Array.isArray(data.buildings)) {
            this.cities.set(data.id, data);
            CITIES.unshift(data.id);
            if (data.light) this.lightUrls.set(data.id, new URL(data.light, new URL(own, location.href)).href);
          }
        }
      } catch {
        log(`own city failed ${own}`);
      }
    }
    log(`cities loaded ${[...this.cities.keys()].join(',')}`);
  }

  /** Where each city's baked light atlas lives (next to its JSON). */
  private lightUrls = new Map<string, string>();

  private loadLight(data: CityData): void {
    const url = this.lightUrls.get(data.id);
    if (!url) return;
    loadDataTexture(url, this.renderer)
      .then((t) => {
        if (this.data === data) this.city.setLight(t);
        log(`light ${data.id} ${(t.image as { width?: number } | null)?.width ?? '?'}px`);
      })
      .catch((e) => log(`light failed ${data.id} ${String(e)}`));
  }

  private useCity(index: number): void {
    const ids = CITIES.filter((id) => this.cities.has(id));
    if (!ids.length) return;
    this.cityIndex = ((index % ids.length) + ids.length) % ids.length;
    const data = this.cities.get(ids[this.cityIndex])!;
    this.data = data;
    this.panel.city = data;
    this.city.setData(data);
    this.loadLight(data);
    this.failure = data.run.failures[0] ?? null;
    this.fireIndex = this.failure ? this.city.indexOf(this.failure.building) : -1;
    this.journeyDone = !this.failure;
    this.step = this.failure ? 'find-fire' : 'free';
    this.closeBuilding(true);
    this.placeFire();
    this.city.shadowDirty = true;
    log(`city ${data.id} buildings=${data.buildings.length} fire=${this.fireIndex}`);
  }

  // ───────────────────────── lifecycle

  private enterPage(): void {
    this.immersive = false;
    this.phase = 'page';
    this.phaseT = 0;
    this.useCity(0);
    this.city.finishRise();
    this.setAnchorPose(this.v.set(0, 0.74, -0.12), 0);
    this.virtualDesk.visible = true;
    this.anchor.visible = true;
    // a seated view over the desk for the browser page
    this.camera.position.set(0, 1.27, 0.62);
    this.camera.lookAt(0, 0.86, -0.2);
    this.guide(this.data ? `This is ${this.data.name} as a city. Put on a Quest and press Enter XR to build it on your own desk.` : 'Loading the city…');
    this.panelMode = { kind: 'welcome' };
    this.plaques.set([]);
    this.refreshPanel();
    log('phase page');
  }

  private enterXR(): void {
    this.immersive = true;
    sfx.unlock();
    this.useCity(this.cityIndex);
    this.beginPlacing();
  }

  private exitXR(): void {
    sfx.setFire(0);
    sfx.stopSpeech();
    this.enterPage();
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    log(`phase ${p}`);
  }

  // ───────────────────────── placement

  private beginPlacing(): void {
    this.setPhase('placing');
    this.anchor.visible = false;
    this.virtualDesk.visible = false;
    this.placeKind = 'none';
    this.preview.visible = false;
    this.hintCard.mesh.visible = true;
    this.drawHint('Look at your table', 'Pinch to build the city where the frame is.');
  }

  private drawHint(title: string, body: string): void {
    this.hintCard.draw(title + body, (ctx, W, H) => {
      glass(ctx, W, H, UI.amber, 40);
      fitText(ctx, title, 60, 26, W - 100, 90, { size: 76, weight: 800 });
      fitText(ctx, body, 60, 120, W - 100, H - 150, { size: 50, color: UI.dim });
    });
  }

  private readHead(): void {
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldDirection(this.fwd);
    this.fwd.negate(); // the viewer looks down -Z
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
  }

  private updatePlacing(dt: number): void {
    this.readHead();
    // Hint card: lazy-follow 0.55 m ahead, ~18° below eye level.
    const hc = this.hintCard.mesh;
    this.v.copy(this.head).addScaledVector(this.fwd, 0.55);
    this.v.y = this.head.y - 0.12;
    hc.position.lerp(this.v, Math.min(1, dt * 3));
    hc.lookAt(this.head);

    // 1. a real table plane
    const count = gatherPlanes(this.queries.planes.entities, this.planePool);
    const spot = findTableSpot(this.planePool, this.head, this.fwd, resetReport(this.placeReport), count);
    let kind: typeof this.placeKind = 'none';
    if (spot) {
      kind = 'plane';
      this.placeHow = spot.kind === 'small-table' ? 'small table' : `table (${spot.label || 'unlabelled'})`;
      this.placeSpot.set(spot.x, spot.y, spot.z);
    } else {
      // 2. follow the hand: put it where you pinch
      const h = this.hands.right.tracked ? this.hands.right : this.hands.left.tracked ? this.hands.left : null;
      if (h && this.phaseT > 1.5) {
        kind = 'hand';
        this.placeHow = 'hand';
        this.placeSpot.copy(h.pinchPoint);
        this.placeSpot.y -= 0.01;
      } else if (this.phaseT > 6) {
        kind = 'virtual';
      }
      if (this.phaseT > 6 && kind !== 'hand') kind = 'virtual';
    }
    if (kind === 'virtual') {
      this.placeHow = 'virtual desk';
      this.placeSpot.copy(this.head).addScaledVector(this.fwd, 0.5);
      this.placeSpot.y = this.head.y - 0.45;
    }
    if (kind !== this.placeKind) {
      this.placeKind = kind;
      log(`placing preview=${kind} ${describeReport(this.placeReport)}`);
      if (kind === 'plane') this.drawHint('Table found', 'Pinch to build the city on it.');
      else if (kind === 'hand') this.drawHint('Show me where', 'Hold your hand over the table and pinch.');
      else if (kind === 'virtual') this.drawHint('No table found', 'Pinch to use a virtual desk, or move your hand over a table.');
    }
    this.preview.visible = kind !== 'none';
    if (this.preview.visible) {
      const yaw = Math.atan2(this.head.x - this.placeSpot.x, this.head.z - this.placeSpot.z);
      this.placeYaw = yaw;
      this.preview.position.copy(this.placeSpot);
      this.preview.rotation.set(0, yaw, 0);
      const pulse = 1 + Math.sin(this.clock * 4) * 0.015;
      this.preview.scale.setScalar(pulse);
    }
    for (const h of this.hands.both) {
      if (h.pinchStarted && kind !== 'none' && this.phaseT > 0.6) {
        this.place(kind);
        return;
      }
    }
  }

  private place(kind: 'plane' | 'hand' | 'virtual' | 'none'): void {
    this.readHead();
    this.preview.visible = false;
    this.hintCard.mesh.visible = false;
    // Yaw so local +Z points at the user.
    this.setAnchorPose(this.placeSpot, this.placeYaw);
    this.virtualDesk.visible = kind === 'virtual';
    this.anchor.visible = true;
    if (!this.anchored) {
      this.anchorEntity.addComponent(XRAnchor);
      this.anchored = true;
    }
    log(`placed how=${this.placeHow} ${describeReport(this.placeReport)}`);
    this.userScale = 1;
    this.userYaw = 0;
    this.manip.scale.setScalar(1);
    this.manip.rotation.set(0, 0, 0);
    this.startRise();
  }

  private setAnchorPose(position: Vector3, yaw: number): void {
    const root = this.anchor;
    this.q.setFromAxisAngle(this.v2.set(0, 1, 0), yaw);
    this.m.compose(position, this.q, this.v2.set(1, 1, 1));
    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      this.m.premultiply(this.mInv.copy(root.parent.matrixWorld).invert());
    }
    this.m.decompose(root.position, root.quaternion, root.scale);
    root.updateWorldMatrix(true, true);
    this.city.shadowDirty = true;
  }

  /**
   * Named moments for filming and headset QA: ?state=open|fire|fix|done|explore
   * (and ?city=<id>). In dev the emulator drops URL queries, so it is also read
   * once from sessionStorage['repo-city-preset'] (tools/goto.mjs).
   */
  private preset: string | null = (() => {
    let q = location.search;
    if (import.meta.env.DEV) {
      try {
        q = q || sessionStorage.getItem('repo-city-preset') || '';
        sessionStorage.removeItem('repo-city-preset');
      } catch {
        /* storage blocked */
      }
    }
    const v = new URLSearchParams(q).get('state');
    return v && ['open', 'fire', 'fix', 'done', 'explore'].includes(v) ? v : null;
  })();

  private applyPreset(): void {
    const p = this.preset;
    if (!p || this.fireIndex < 0) return;
    this.preset = null; // once
    log(`preset ${p}`);
    if (p === 'explore') {
      this.step = 'free';
      this.applyStep();
      return;
    }
    this.openBuilding(this.fireIndex);
    this.city.open = 1;
    if (p === 'open') return;
    const f = this.data!.buildings[this.fireIndex].functions.findIndex((x) => x.failing);
    this.selectFloor(f);
    if (p === 'fire') return;
    this.showFix();
    if (p === 'fix') return;
    this.runTests();
  }

  private startRise(): void {
    this.setPhase('rising');
    this.city.startRise();
    sfx.rise();
    this.panelMode = { kind: 'welcome' };
    this.guide(this.data ? this.data.guide.intro : '');
    this.plaques.set([]);
    this.journeyStart = this.clock;
    this.refreshPanel();
  }

  // ───────────────────────── guide + panel

  private guideText = '';
  private notice = '';
  private lostT = 0;
  private idleT = 0;
  /** Seconds the guide spends flying over the current target. */
  private guideBeacon = 0;
  /** The entry tour: seconds left pointing at the entry building, once per city, before the fire. */
  private entryT = 0;
  private entryShown = new Set<string>();

  /** Point at the entry building first (once per city). True when the tour started. */
  private entryTour(d: CityData): boolean {
    const e = this.city.entryIndex;
    if (e < 0 || this.entryShown.has(d.id) || this.city.openIndex >= 0) return false;
    this.entryShown.add(d.id);
    this.entryT = 3.5;
    this.guideBeacon = 3.5;
    const b = d.buildings[e];
    this.guide(`This is ${b.name}, the town hall. Everything that uses ${d.name} enters here.`);
    log(`guide entry ${b.id}`);
    return true;
  }
  private readonly guideHome = new Vector3();
  private readonly guideGoal = new Vector3();
  private guide(text: string, speak = true): void {
    this.idleT = 0;
    if (text === this.guideText) return;
    this.guideText = text;
    if (!this.notice) this.panel.guide = text;
    this.refreshPanel();
    if (speak && this.immersive) sfx.speak(text);
    log(`guide "${text.slice(0, 80)}"`);
  }

  /** A temporary line over the guide's (hands lost, controllers in hand); '' restores the guide. */
  private setNotice(text: string): void {
    if (text === this.notice) return;
    this.notice = text;
    this.panel.guide = text || this.guideText;
    this.refreshPanel();
    if (text) log(`notice "${text}"`);
  }

  /** Watch the input: hands lost for a while, controllers instead of hands, nothing happening. */
  private updateCare(dt: number): void {
    const H = this.hands.both;
    const anyHand = H.some((h) => h.tracked && h.isHand);
    const controllers = H.some((h) => h.tracked && !h.isHand);
    this.lostT = anyHand || controllers ? 0 : this.lostT + dt;
    if (controllers && !anyHand) this.setNotice('This is a hands-only experience: put your controllers down and pinch with your fingers.');
    else if (this.lostT > 2.5) this.setNotice('I can\'t see your hands. Hold them up in front of you, over the table.');
    else this.setNotice('');
    // Tracking lost mid-lift: keep what the player had (open if mostly lifted), never guess further.
    for (const h of H) if (h.justLost && h === this.dragHand) this.endDrag(performance.now() + 1000);
    // Contextual reminder: after 15 s without progress, say the current step again.
    this.idleT += dt;
    if (this.idleT > 15 && this.phase === 'city' && this.step !== 'free' && !this.journeyDone && this.city.openIndex < 0 === (this.step === 'find-fire')) {
      this.idleT = 0;
      sfx.speak(this.guideText);
      this.guideBeacon = 3;
      log('reminder');
    }
  }

  private refreshPanel(force = false): void {
    if (force) this.panel.card.draw('', () => undefined);
    this.panel.render(this.panelMode);
  }

  private setPlaques(specs: PlaqueSpec[]): void {
    this.plaques.set(specs);
    if (import.meta.env.DEV) {
      this.anchor.updateWorldMatrix(true, true);
      log(`plaques ${specs.map((s) => s.id).join(',')} layout=${JSON.stringify(this.plaques.centres())}`);
    }
  }

  /** Prompt + plaques for the current journey step. */
  private applyStep(): void {
    const d = this.data;
    if (!d) return;
    const fireB = this.fireIndex >= 0 ? d.buildings[this.fireIndex] : null;
    switch (this.step) {
      case 'find-fire':
        this.setPlaques(fireB ? [{ id: 'goto-fire', text: 'Open the fire', accent: UI.fire }, nextCityPlaque(this)] : [nextCityPlaque(this)]);
        if (this.entryTour(d)) break;
        this.guideBeacon = 4;
        this.guide(fireB ? `A test is failing, so ${fireB.name} is on fire. Pinch its roof and lift it off.` : d.guide.intro);
        if (fireB) log(`guide fire ${fireB.id}`);
        break;
      case 'touch-floor':
        this.guideBeacon = 4;
        this.guide(d.guide.onFire);
        this.setPlaques([{ id: 'touch-floor', text: 'Find the bug', accent: UI.fire }, { id: 'close', text: 'Close the building' }]);
        break;
      case 'read-failure':
        this.guide('This check fails. Read what it expected and what it got. Then ask me for the fix.');
        this.setPlaques([{ id: 'see-fix', text: 'Show me the fix', accent: UI.green }, { id: 'close', text: 'Close the building' }]);
        break;
      case 'see-fix':
      case 'run-tests':
        this.guide('One line changes. Run the tests to see if the city is safe.');
        this.setPlaques([{ id: 'run-tests', text: 'Run the tests', accent: UI.green }, { id: 'close', text: 'Close the building' }]);
        break;
      case 'finished':
        this.guide(d.guide.done);
        this.setPlaques([{ id: 'explore', text: 'Keep exploring' }, nextCityPlaque(this), { id: 'again', text: 'Start again' }]);
        break;
      case 'free':
        if (this.entryTour(d)) {
          this.setPlaques([nextCityPlaque(this), { id: 'again', text: 'Start again' }]);
          break;
        }
        this.guide(this.city.openIndex >= 0 ? 'Touch a floor to read its code. Pinch the roof to close.' : `${d.guide.intro} Pinch any roof to look inside.`);
        this.setPlaques(this.city.openIndex >= 0 ? [{ id: 'close', text: 'Close the building' }, nextCityPlaque(this)] : [nextCityPlaque(this), { id: 'again', text: 'Start again' }]);
        break;
    }
  }

  private onPlaque(id: string): void {
    sfx.click();
    log(`plaque ${id}`);
    const fi = this.fireIndex;
    switch (id) {
      case 'goto-fire':
        if (fi >= 0) this.openBuilding(fi);
        break;
      case 'touch-floor': {
        const b = this.data?.buildings[fi];
        const f = b ? b.functions.findIndex((x) => x.failing) : -1;
        if (f >= 0) this.selectFloor(f);
        break;
      }
      case 'see-fix':
        this.showFix();
        break;
      case 'run-tests':
        this.runTests();
        break;
      case 'close':
        this.closeBuilding();
        break;
      case 'district': {
        const b = this.data?.buildings[this.city.openIndex];
        const d = b ? this.data!.districts.find((x) => x.id === b.district) : undefined;
        if (d) this.guide(`The ${d.name} district: ${d.summary}`);
        break;
      }
      case 'explore':
        this.step = 'free';
        this.closeBuilding();
        break;
      case 'next-city':
        this.useCity(this.cityIndex + 1);
        this.startRise();
        break;
      case 'again':
        this.useCity(this.cityIndex);
        this.startRise();
        break;
    }
  }

  // ───────────────────────── buildings

  /** "Ask the guide" about the district of an open building. */
  private districtPlaque(b: Building): PlaqueSpec {
    const d = this.data?.districts.find((x) => x.id === b.district);
    return { id: 'district', text: `What is ${d?.name ?? 'this district'}?`, accent: UI.amber };
  }

  private openBuilding(i: number): void {
    if (i < 0) return;
    if (this.city.openIndex !== i) {
      this.city.setOpen(i);
      this.city.setRoutes(i);
      this.tipFloorPrev = -2;
    }
    this.openTarget = 1;
    sfx.lift();
    const b = this.data!.buildings[i];
    log(`open ${b.id}`);
    const failing = b.functions.findIndex((f) => f.failing);
    this.panelMode = { kind: 'building', b, floor: failing >= 0 && i === this.fireIndex ? -1 : b.functions.length - 1 };
    if (i === this.fireIndex && this.step === 'find-fire') this.step = 'touch-floor';
    if (this.step === 'free' || this.journeyDone) {
      this.guide(`${b.name}: ${b.summary}`, false);
      this.setPlaques([{ id: 'close', text: 'Close the building' }, this.districtPlaque(b), nextCityPlaque(this)]);
    } else if (i !== this.fireIndex) {
      this.guide(`${b.name}: ${b.summary} The fire is in ${this.data!.buildings[this.fireIndex]?.name}.`, false);
      this.setPlaques([{ id: 'goto-fire', text: 'Open the fire', accent: UI.fire }, this.districtPlaque(b), { id: 'close', text: 'Close the building' }]);
    } else {
      this.applyStep();
    }
    this.refreshPanel();
  }

  private closeBuilding(instant = false): void {
    if (this.city.openIndex < 0) return;
    this.openTarget = 0;
    if (instant) {
      this.city.setOpen(-1);
    } else sfx.close();
    this.city.setRoutes(-1);
    log('close');
    // the journey falls back a step if the building closes mid-way
    if (!this.journeyDone && this.step !== 'find-fire') this.step = 'find-fire';
    this.panelMode = { kind: 'welcome' };
    if (this.phase === 'city' || this.phase === 'done') this.applyStep();
    this.refreshPanel();
  }

  private selectFloor(f: number): void {
    const i = this.city.openIndex;
    const b = this.data?.buildings[i];
    if (!b || f < 0 || f === this.city.selectedFloor) return;
    this.city.selectedFloor = f;
    sfx.floor(f);
    const fn = b.functions[f];
    log(`floor ${f} ${fn.name} failing=${!!fn.failing}`);
    if (fn.failing && this.failure && i === this.fireIndex && !this.journeyDone) {
      sfx.alarm();
      this.panelMode = { kind: 'fire', b, f: this.failure, fix: this.data!.fix };
      this.step = 'read-failure';
      this.applyStep();
    } else {
      this.panelMode = { kind: 'building', b, floor: f };
      if (this.journeyDone || this.step === 'free') this.guide(`${fn.name}: floor ${f + 1} of ${b.name}, ${fn.lines} lines.`, false);
    }
    this.refreshPanel();
  }

  private showFix(): void {
    const d = this.data;
    if (!d?.fix || this.fireIndex < 0) return;
    if (this.city.openIndex !== this.fireIndex) this.openBuilding(this.fireIndex);
    this.panelMode = { kind: 'fix', b: d.buildings[this.fireIndex], fix: d.fix };
    this.step = 'see-fix';
    this.applyStep();
    this.refreshPanel();
  }

  private runTests(): void {
    const d = this.data;
    if (!d) return;
    const run = d.fix?.run ?? d.run;
    this.setPhase('testing');
    // sweep from the back-left to the front-right of the city
    const order = d.buildings.map((_, i) => i).sort((a, b) => d.buildings[a].x + d.buildings[a].z * 0.4 - (d.buildings[b].x + d.buildings[b].z * 0.4));
    this.testing = { t: 0, order, next: 0, passed: 0, failed: 0, total: run.total, extinguished: false };
    this.plaques.set([]);
    this.guide('Running the tests…', false);
    this.updateTesting(0);
  }

  private updateTesting(dt: number): void {
    const d = this.data!;
    const T = this.testing;
    T.t += dt;
    const DUR = 4.2;
    const k = Math.min(1, T.t / DUR);
    const target = Math.floor(k * T.order.length);
    while (T.next < target) {
      const i = T.order[T.next++];
      this.city.pulseBuilding(i);
      this.city.roofWorld(i, this.v);
      this.city.root.worldToLocal(this.v);
      this.sparks.burst(this.v, 4, '#6dffb0', 0.12);
      sfx.testTick(T.next);
      if (i === this.fireIndex && !T.extinguished) {
        T.extinguished = true;
        this.extinguish();
      }
    }
    T.passed = Math.round(k * T.total);
    const file = d.buildings[T.order[Math.max(0, T.next - 1)]]?.path ?? '';
    this.panelMode = { kind: 'testing', done: T.passed, total: T.total, passed: T.passed, failed: 0, file: `test/${file}` };
    this.refreshPanel();
    if (k >= 1 && T.t > DUR + 0.6) {
      this.finishJourney();
    }
  }

  private extinguish(): void {
    const i = this.fireIndex;
    if (i < 0) return;
    this.city.fire[i] = 0;
    this.fire.level = 0;
    this.fire.steam();
    sfx.steam();
    sfx.setFire(0);
    log('fire out');
  }

  private finishJourney(): void {
    // a gold burst over the city, in three waves
    for (let w = 0; w < 3; w++) {
      window.setTimeout(() => {
        for (let k = 0; k < 6; k++) {
          const b = this.data?.buildings[Math.floor(Math.random() * (this.data?.buildings.length ?? 1))];
          if (!b) continue;
          this.v.set(b.x * CITY_SIZE, b.h * CITY_SIZE + 0.01, b.z * CITY_SIZE);
          this.sparks.burst(this.v, 14, w === 1 ? '#7ee0a6' : '#ffd27a', 0.42);
        }
      }, w * 280);
    }
    this.journeyDone = true;
    this.step = 'finished';
    this.setPhase('done');
    sfx.success();
    const total = this.data?.fix?.run.total ?? this.data?.run.total ?? 0;
    log(`result tests=${total} seconds=${(this.clock - this.journeyStart).toFixed(1)}`);
    this.panelMode = { kind: 'done', seconds: this.clock - this.journeyStart, total };
    this.applyStep();
    this.refreshPanel();
  }

  /** Put the fire on the burning building's roof, or on its failing floor when open. */
  private placeFire(): void {
    const i = this.fireIndex;
    const b = i >= 0 ? this.data?.buildings[i] : undefined;
    if (!b || this.city.fire[i] <= 0) {
      this.fire.level = 0;
      this.fireLight.intensity = 0;
      return;
    }
    if (this.city.openIndex === i && this.city.open > 0.05) {
      const f = b.functions.findIndex((x) => x.failing);
      const o = f * 6;
      const bx = this.city.floorBoxes;
      this.fire.origin.set(bx[o], bx[o + 1] + bx[o + 4], bx[o + 2] + bx[o + 5] * 0.6);
      this.fire.spread = 0.025;
      this.fire.smoulder = 0.7;
    } else {
      this.fire.origin.set(b.x, b.h * Math.max(0.02, this.cityRise(i)), b.z);
      this.fire.spread = Math.min(0.07, Math.min(b.w, b.d) * 0.4);
      this.fire.smoulder = 0;
    }
    // computed in city units; the particles live in metres under city.root
    this.fire.origin.multiplyScalar(CITY_SIZE);
    this.fire.spread *= CITY_SIZE;
    this.fire.level = this.phase === 'placing' || this.phase === 'page' ? (this.phase === 'page' ? 1 : 0) : 1;
    this.fireLight.position.copy(this.fire.origin);
    this.fireLight.position.y += 0.05;
  }

  private cityRise(i: number): number {
    return (this.city as unknown as { rise: Float32Array }).rise[i] ?? 1;
  }

  // ───────────────────────── per frame

  update(delta: number, time: number): void {
    const dt = Math.min(delta, 0.05);
    this.clock = time;
    this.phaseT += dt;
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) {
      sfx.setFire(0);
      return;
    }
    this.updateHands(dt);
    this.devKeys();

    switch (this.phase) {
      case 'page':
        this.manip.rotation.y = Math.sin(time * 0.15) * 0.35;
        break;
      case 'placing':
        this.updatePlacing(dt);
        break;
      case 'rising':
        if (!this.city.rising && this.phaseT > 4.5) {
          this.setPhase('city');
          if (this.preset && this.data) this.entryShown.add(this.data.id); // presets skip the town-hall intro
          this.applyStep();
          this.applyPreset();
          this.logTargets();
        }
        break;
      case 'city':
      case 'done':
        this.updateInteraction(dt);
        this.updateCare(dt);
        break;
      case 'testing':
        this.updateInteraction(dt);
        this.updateTesting(dt);
        break;
    }

    // open/close animation of the open building
    if (this.city.openIndex >= 0) {
      if (this.dragKind !== 'lift') {
        const k = Math.min(1, dt * 7);
        this.city.open += (this.openTarget - this.city.open) * k;
        if (this.openTarget === 0 && this.city.open < 0.01) {
          this.city.setOpen(-1);
        }
      }
      if (this.dragKind !== 'roof') this.city.roofExtra *= Math.max(0, 1 - dt * 6);
    }
    this.city.update(dt, time);
    this.placeFire();
    const vh = this.viewportHeight();
    this.fire.setViewport(vh);
    this.sparks.setViewport(vh);
    this.sparks.update(dt);
    this.fire.update(dt);
    // the fire light flickers
    if (this.fire.level > 0) {
      this.fireLight.intensity = 0.06 * (0.8 + 0.2 * Math.sin(time * 23) * Math.sin(time * 7.7));
    } else this.fireLight.intensity = Math.max(0, this.fireLight.intensity - dt * 0.2);
    if (this.immersive) sfx.setFire(this.phase === 'placing' ? 0 : this.fire.level * (this.city.openIndex === this.fireIndex ? 0.6 : 0.35));
    if (this.entryT > 0 && this.phase === 'city') {
      this.entryT -= dt;
      if (this.entryT <= 0 && (this.step === 'find-fire' || this.step === 'free') && this.city.openIndex < 0) this.applyStep();
    }
    this.animateGuide(time, dt);
    this.perfLog(time);
    this.updateFloorCard();
    this.city.shadowDirty = false;
    // the environment turns with the city (its window matches the key light)
    this.city.root.getWorldQuaternion(this.qEnv);
    this.scene.environmentRotation.y = Math.atan2(2 * (this.qEnv.w * this.qEnv.y + this.qEnv.x * this.qEnv.z), 1 - 2 * (this.qEnv.y * this.qEnv.y + this.qEnv.x * this.qEnv.x));
  }

  private readonly qEnv = new Quaternion();

  private perfAt = 0;
  /** Dev: draw calls and triangles every 5 s (the emulator renders each eye: halve them). */
  private perfLog(time: number): void {
    if (!import.meta.env.DEV || time - this.perfAt < 5) return;
    this.perfAt = time;
    const r = this.renderer.info.render;
    log(`perf calls=${r.calls} tris=${r.triangles} xr=${this.renderer.xr.isPresenting}`);
  }

  /**
   * Dev: render and memory numbers for the visual pass (tools/e2e/stats.py).
   * Texture bytes are estimated from every texture reachable from the scene's
   * materials, the scene environment and shadow maps (compressed: real mip bytes;
   * otherwise w×h×bytes-per-pixel, ×4/3 with mipmaps).
   */
  stats(): Record<string, unknown> {
    const r = this.renderer;
    const seen = new Set<unknown>();
    let bytes = 0;
    const list: string[] = [];
    type Tex = { isTexture?: boolean; isCompressedTexture?: boolean; isRenderTargetTexture?: boolean; image?: { width?: number; height?: number; depth?: number }; mipmaps?: { data?: ArrayBufferView }[]; type?: number; generateMipmaps?: boolean; name?: string; minFilter?: number };
    const add = (t: Tex | null | undefined, label: string) => {
      if (!t || !t.isTexture || seen.has(t)) return;
      seen.add(t);
      let b = 0;
      if (t.isCompressedTexture && t.mipmaps?.length) for (const m of t.mipmaps) b += m.data?.byteLength ?? 0;
      else {
        const w = t.image?.width ?? 0, h = t.image?.height ?? 0, d = t.image?.depth ?? 1;
        const bpp = t.type === 1016 /* HalfFloat */ ? 8 : t.type === 1015 /* Float */ ? 16 : 4;
        b = w * h * d * bpp * (t.generateMipmaps !== false && t.minFilter !== 1006 && t.minFilter !== 1003 ? 4 / 3 : 1);
      }
      bytes += b;
      list.push(`${label}:${t.image?.width}x${t.image?.height}${t.isCompressedTexture ? 'c' : ''}=${Math.round(b / 1024)}K`);
    };
    this.scene.traverse((o) => {
      const mats = (o as { material?: unknown }).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        for (const [k, v] of Object.entries(m as object)) if ((v as Tex)?.isTexture) add(v as Tex, `${o.name || o.type}.${k}`);
        const u = (m as { uniforms?: Record<string, { value: unknown }> }).uniforms;
        if (u) for (const [k, v] of Object.entries(u)) if ((v?.value as Tex)?.isTexture) add(v.value as Tex, `${o.name || o.type}.${k}`);
      }
      const sh = (o as { shadow?: { map?: { width: number; height: number } | null } }).shadow;
      if (sh?.map) {
        bytes += sh.map.width * sh.map.height * 8; // colour + depth
        list.push(`shadow:${sh.map.width}x${sh.map.height}=${Math.round((sh.map.width * sh.map.height * 8) / 1024)}K`);
      }
    });
    add(this.scene.environment as Tex, 'scene.environment');
    add(this.city.uniforms.uLight.value as Tex, 'city.lightAtlas');
    const xrt = r.xr.isPresenting ? ((r.xr as unknown as { getRenderTarget(): unknown }).getRenderTarget() as { samples?: number; isWebGLMultiviewRenderTarget?: boolean; width: number; height: number } | null) : null;
    const session = r.xr.getSession();
    const proj = session?.renderState.layers?.[0] as { fixedFoveation?: number } | undefined;
    const base = session?.renderState.baseLayer as { antialias?: boolean; fixedFoveation?: number } | undefined;
    return {
      calls: r.info.render.calls,
      tris: r.info.render.triangles,
      programs: r.info.programs?.length,
      gpuTextures: r.info.memory.textures,
      geometries: r.info.memory.geometries,
      texKB: Math.round(bytes / 1024),
      textures: list,
      contextAntialias: r.getContext().getContextAttributes()?.antialias,
      xr: r.xr.isPresenting
        ? { path: proj ? 'projection-layer' : 'XRWebGLLayer', samples: xrt?.samples, multiview: !!xrt?.isWebGLMultiviewRenderTarget, size: xrt ? `${xrt.width}x${xrt.height}` : null, layerAntialias: base?.antialias, foveation: proj?.fixedFoveation ?? base?.fixedFoveation }
        : null,
      shadowMap: r.shadowMap.enabled,
    };
  }

  private viewportHeight(): number {
    const layer = this.renderer.xr.isPresenting ? (this.renderer.xr.getSession()?.renderState.baseLayer as XRWebGLLayer | undefined) : undefined;
    if (layer?.framebufferHeight) return layer.framebufferHeight;
    if (this.renderer.xr.isPresenting) return 1900; // projection layers: Quest 3 eye buffer height
    return this.renderer.domElement.height;
  }

  private animateGuide(time: number, dt: number): void {
    this.guideHome.set(-PANEL_W / 2 - 0.035, PANEL_POS.y + PANEL_H / 2 - 0.04 + Math.sin(time * 1.6) * 0.006, PANEL_POS.z + 0.02);
    let goal = this.guideHome;
    if (this.guideBeacon > 0 && this.phase === 'city') {
      this.guideBeacon -= dt;
      const t = this.guideTarget();
      if (t) goal = this.guideGoal.copy(t);
    }
    this.guideOrb.position.lerp(goal, 0.06);
    this.guideOrb.rotation.y = time * 0.8;
  }

  /** Where the guide points for the current step (anchor space), or null. */
  private guideTarget(): Vector3 | null {
    const e = this.city.entryIndex;
    if (this.entryT > 0 && e >= 0 && this.city.openIndex < 0) {
      this.city.roofWorld(e, this.v2);
      this.anchor.worldToLocal(this.v2);
      this.v2.y += 0.1 + landmarkSize(this.data!.buildings[e]).h * CITY_SIZE;
      return this.v2;
    }
    const i = this.fireIndex;
    if (i < 0) return null;
    if (this.step === 'find-fire' && this.city.openIndex < 0) {
      this.city.roofWorld(i, this.v2);
      this.anchor.worldToLocal(this.v2);
      this.v2.y += 0.12;
      return this.v2;
    }
    if (this.step === 'touch-floor' && this.city.openIndex === i) {
      const f = this.data!.buildings[i].functions.findIndex((x) => x.failing);
      if (f < 0) return null;
      this.city.floorWorld(f, this.v2, true);
      this.anchor.worldToLocal(this.v2);
      this.v2.z += 0.06;
      this.v2.x += this.city.inspectX > 0 ? 0.06 : -0.06;
      return this.v2;
    }
    return null;
  }

  private updateHands(dt: number): void {
    const frame = this.xrFrame as XRFrame | undefined;
    const ref = this.renderer.xr.getReferenceSpace();
    const xr = this.input.xr;
    this.player.updateWorldMatrix(true, false);
    const now = performance.now();
    for (const h of this.hands.both) {
      const src = this.immersive ? xr.getPrimaryInputSource(h.side) : undefined;
      let sel = false;
      try {
        sel = xr.getSelectState(h.side).active;
      } catch {
        sel = false;
      }
      h.update(frame, ref, src, this.player.matrixWorld, sel, now, dt);
    }
  }

  /** Hands → city: hover, pinch-lift a roof, touch floors, two-hand scale/rotate, plaques. */
  private updateInteraction(dt: number): void {
    const now = performance.now();
    const H = this.hands.both;
    if (H[0].pinchStarted || H[1].pinchStarted) this.idleT = 0;
    // Fingertips and pinch points in city units.
    this.city.units.updateWorldMatrix(true, false);
    this.mInv.copy(this.city.units.matrixWorld).invert();
    for (let k = 0; k < 2; k++) {
      const h = H[k];
      this.tipsWorld[k] = h.tracked ? h.indexTip : null;
      this.pinchStartsWorld[k] = h.tracked && h.pinchStarted ? h.pinchPoint : null;
      this.tipLocal[k].copy(h.indexTip).applyMatrix4(this.mInv);
      this.pinchLocal[k].copy(h.pinchPoint).applyMatrix4(this.mInv);
    }
    this.plaques.update(dt, this.tipsWorld, this.pinchStartsWorld, now);
    if (this.phase === 'testing') return;

    // Two-hand scale and rotate.
    const both = H[0].tracked && H[1].tracked && H[0].pinching && H[1].pinching && this.dragKind === 'none';
    if (both && !this.twoHand) {
      this.twoHand = true;
      this.twoStartDist = H[0].pinchPoint.distanceTo(H[1].pinchPoint);
      this.twoStartAngle = Math.atan2(H[1].pinchPoint.z - H[0].pinchPoint.z, H[1].pinchPoint.x - H[0].pinchPoint.x);
      this.twoStartScale = this.userScale;
      this.twoStartYaw = this.userYaw;
      log('two-hand start');
    } else if (!both && this.twoHand) {
      this.twoHand = false;
      log(`two-hand end scale=${this.userScale.toFixed(2)} yaw=${this.userYaw.toFixed(2)}`);
    }
    if (this.twoHand) {
      const dist = H[0].pinchPoint.distanceTo(H[1].pinchPoint);
      const ang = Math.atan2(H[1].pinchPoint.z - H[0].pinchPoint.z, H[1].pinchPoint.x - H[0].pinchPoint.x);
      this.userScale = Math.min(2.2, Math.max(0.6, this.twoStartScale * (dist / Math.max(0.03, this.twoStartDist))));
      this.userYaw = this.twoStartYaw - (ang - this.twoStartAngle);
      this.manip.scale.setScalar(this.userScale);
      this.manip.rotation.y = this.userYaw;
      this.city.shadowDirty = true;
      this.hoverCard.opacity = 0;
      return;
    }

    // Active hand: the one whose fingertip is nearest the city (or the one dragging).
    let best: HandState | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 2; k++) {
      if (!H[k].tracked) continue;
      const t = this.tipLocal[k];
      const d = Math.hypot(t.x, Math.max(0, t.y - 0.3), t.z);
      if (d < bestD) {
        bestD = d;
        best = H[k];
      }
    }
    const hand = this.dragHand ?? best;
    this.activeHand = hand;
    const k = hand === H[0] ? 0 : 1;
    const tip = this.tipLocal[k];
    const pin = this.pinchLocal[k];

    // Dragging the roof (lift to open, push down to close).
    if (this.dragKind !== 'none' && this.dragHand) {
      const dy = (this.dragHand.pinchPoint.y - this.dragStartY) / (CITY_SIZE * this.userScale);
      if (this.dragKind === 'lift') {
        this.city.open = Math.min(1, Math.max(0, this.dragStartOpen + dy / 0.12));
      } else {
        this.city.roofExtra = Math.min(1, Math.max(0, dy / 0.2));
      }
      if (!this.dragHand.pinching) this.endDrag(now);
      return;
    }

    if (!hand) {
      this.setHover(-1);
      return;
    }

    const open = this.city.openIndex;
    if (open >= 0 && this.city.open > 0.6) {
      // Roof of the open building: pinch it (to close or lift further).
      const r = this.city.roof.position;
      const nearRoof = Math.hypot(pin.x - r.x, (pin.y - r.y) * 1.2, pin.z - r.z) < 0.09;
      if (hand.pinchStarted && nearRoof) {
        this.beginDrag(hand, 'roof', now);
        return;
      }
      // Floors: hover with the fingertip, touch (poke into) or pinch to select.
      const f = this.city.floorAt(tip.x, tip.y, tip.z, 0.03);
      const fp = hand.pinchStarted ? this.city.floorAt(pin.x, pin.y, pin.z, 0.04) : -1;
      if (f !== this.city.hoverFloor) {
        this.city.hoverFloor = f;
        if (f >= 0) sfx.hover();
      }
      // Touch = the fingertip ENTERS a floor after the stack has settled; a stack
      // growing around a resting finger never selects anything.
      const settled = this.city.open > 0.95;
      const inside = settled ? this.city.floorAt(tip.x, tip.y, tip.z, 0.004) : -1;
      const prev = this.tipFloorPrev;
      if (settled && inside >= 0 && prev !== -2 && prev !== inside) this.selectFloor(inside);
      else if (fp >= 0) this.selectFloor(fp);
      // -2 (just opened) holds until the fingertip is seen outside every floor
      this.tipFloorPrev = !settled || (prev === -2 && inside >= 0) ? -2 : inside;
      if (f >= 0 || fp >= 0) {
        this.setHover(-1);
        return;
      }
    }

    // Buildings: hover with fingertip or pinch point; pinch to lift the roof.
    const hb = Math.max(this.city.buildingAt(tip.x, tip.y, tip.z, 0.03), -1);
    const hp = this.city.buildingAt(pin.x, pin.y, pin.z, 0.04);
    const hov = hp >= 0 ? hp : hb;
    this.setHover(hov === open && this.city.open > 0.3 ? -1 : hov);
    if (hand.pinchStarted && hp >= 0 && hp !== open) {
      if (open >= 0) this.city.setOpen(-1);
      // the building comes out on the side of the hand that took it
      this.city.inspectX = hand.side === 'left' ? -0.66 : 0.66;
      this.city.setOpen(hp);
      this.city.setRoutes(hp);
      this.beginDrag(hand, 'lift', now);
      return;
    }
    // Poking the fire on the roof opens the burning building.
    if (this.fireIndex >= 0 && this.fire.level > 0 && open !== this.fireIndex) {
      // A fingertip held in the flames for 0.3 s (never a hand passing over) opens it.
      const o = this.v.copy(this.fire.origin).divideScalar(CITY_SIZE);
      const inFlames = Math.hypot(tip.x - o.x, tip.z - o.z) < 0.055 && tip.y > o.y - 0.02 && tip.y < o.y + 0.09;
      this.fireDwell = inFlames ? this.fireDwell + dt : 0;
      if (this.fireDwell > 0.3) {
        this.fireDwell = 0;
        log('poked fire');
        this.openBuilding(this.fireIndex);
      }
    }
  }

  private beginDrag(h: HandState, kind: 'lift' | 'roof', now: number): void {
    this.dragHand = h;
    this.dragKind = kind;
    this.dragStartY = h.pinchPoint.y;
    this.dragStartT = now;
    this.dragStartOpen = this.city.open;
    sfx.tick();
    log(`drag ${kind} start building=${this.city.openIndex}`);
  }

  private endDrag(now: number): void {
    const kind = this.dragKind;
    const tap = now - this.dragStartT < 350;
    const dy = this.dragHand ? this.dragHand.pinchPoint.y - this.dragStartY : 0;
    this.dragKind = 'none';
    this.dragHand = null;
    if (kind === 'lift') {
      if (tap || this.city.open > 0.25) this.openBuilding(this.city.openIndex);
      else this.closeBuilding();
    } else if (kind === 'roof') {
      // a tap or a push down closes; a pull up just bobs back
      if (tap || dy < -0.02) this.closeBuilding();
    }
    log(`drag ${kind} end tap=${tap} dy=${dy.toFixed(3)} open=${this.city.open.toFixed(2)}`);
  }

  private setHover(i: number): void {
    this.city.hoverIndex = i;
    if (i !== this.lastHover) {
      this.lastHover = i;
      if (i >= 0) sfx.hover();
    }
    const b = i >= 0 ? this.data?.buildings[i] : undefined;
    if (!b) {
      this.hoverCard.opacity = Math.max(0, this.hoverCard.opacity - 0.15);
      return;
    }
    this.drawHoverCard(b, i === this.fireIndex && this.city.fire[i] > 0);
    this.hoverCard.opacity = 1;
    this.city.roofWorld(i, this.v);
    this.anchor.worldToLocal(this.v);
    this.v.y += 0.045;
    this.hoverCard.mesh.position.copy(this.v);
    this.readHead();
    this.hoverCard.mesh.lookAt(this.head);
  }

  /** Name of the floor under the fingertip (or the selected one), beside the stack, facing the user. */
  private updateFloorCard(): void {
    const b = this.city.openIndex >= 0 ? this.data?.buildings[this.city.openIndex] : undefined;
    const f = this.city.hoverFloor >= 0 ? this.city.hoverFloor : this.city.selectedFloor;
    if (!b || f < 0 || f >= this.city.floorCount || this.city.open < 0.9) {
      this.floorCard.opacity = Math.max(0, this.floorCard.opacity - 0.1);
      return;
    }
    const fn = b.functions[f];
    const burning = !!fn.failing && this.city.fire[this.city.openIndex] > 0;
    this.floorCard.draw(`${b.id}${f}${burning}`, (ctx, W, H) => {
      glass(ctx, W, H, burning ? UI.fire : UI.blue, 30);
      fitText(ctx, fn.name, 44, 14, W - 70, H * 0.52, { size: 62, weight: 800, font: `'JetBrains Mono', Menlo, monospace` });
      fitText(ctx, `floor ${f + 1} · ${fn.lines} lines${burning ? ' · failing' : ''}`, 44, H * 0.58, W - 70, H * 0.34, { size: 38, color: burning ? UI.fire : UI.dim });
    });
    this.floorCard.opacity = Math.min(1, this.floorCard.opacity + 0.15);
    const o = f * 6;
    const bx = this.city.floorBoxes;
    const side = this.city.inspectX > 0 ? -1 : 1;
    this.v.set(bx[o] + side * (bx[o + 3] + 0.17), bx[o + 1], bx[o + 2] + bx[o + 5]);
    this.city.units.localToWorld(this.v);
    this.anchor.worldToLocal(this.v);
    this.floorCard.mesh.position.copy(this.v);
    this.readHead();
    this.floorCard.mesh.lookAt(this.head);
  }

  private drawHoverCard(b: Building, burning: boolean): void {
    this.hoverCard.draw(`${b.id}${burning}`, (ctx, W, H) => {
      glass(ctx, W, H, burning ? UI.fire : UI.blue, 30);
      fitText(ctx, b.name, 44, 18, W - 70, H * 0.5, { size: 64, weight: 800 });
      fitText(ctx, `${b.lines} lines · ${b.functions.length} floors${burning ? ' · on fire' : ''}`, 44, H * 0.56, W - 70, H * 0.36, { size: 40, color: burning ? UI.fire : UI.dim });
    });
  }

  // ───────────────────────── dev

  private logTargets(): void {
    if (!import.meta.env.DEV || !this.data) return;
    this.anchor.updateWorldMatrix(true, true);
    const fire = this.fireIndex >= 0 ? this.city.roofWorld(this.fireIndex, new Vector3()).toArray().map((x) => +x.toFixed(3)) : null;
    const other = this.fireIndex === 0 ? 1 : 0;
    const o = other >= 0 ? this.city.roofWorld(other, new Vector3()).toArray().map((x) => +x.toFixed(3)) : null;
    const c = new Vector3();
    this.city.root.getWorldPosition(c);
    log(`targets layout=${JSON.stringify({ fireId: this.data.buildings[this.fireIndex]?.id ?? null, fire, other, center: c.toArray().map((x) => +x.toFixed(3)), plaques: this.plaques.centres() })}`);
  }

  /** World positions of the open building's floors and roof (for tests). */
  logFloors(): void {
    if (!import.meta.env.DEV) return;
    const floors: number[][] = [];
    for (let f = 0; f < this.city.floorCount; f++) floors.push(this.city.floorWorld(f, new Vector3(), true).toArray().map((x) => +x.toFixed(3)));
    const roof = this.city.units.localToWorld(this.city.roof.position.clone()).toArray().map((x) => +x.toFixed(3));
    const failing = this.data?.buildings[this.city.openIndex]?.functions.findIndex((x) => x.failing) ?? -1;
    log(`floors layout=${JSON.stringify({ floors, roof, failing })}`);
  }

  private devKeys(): void {
    if (!this.keys.size) return;
    if (import.meta.env.DEV) {
      for (const k of this.keys) {
        if (k === 'R') {
          localStorage.clear();
          location.reload();
        } else if (k === 'p' && this.phase === 'placing') {
          this.placeKind = 'virtual';
          this.placeSpot.set(0, 0.45, -0.45);
          this.place('virtual');
        } else if (k === 'f') this.logFloors();
        else if (k === 't') this.logTargets();
        else if (k === 'o' && this.fireIndex >= 0) this.openBuilding(this.fireIndex);
        else if (k === 'x') this.onPlaque('see-fix');
        else if (k === 'g') this.onPlaque('run-tests');
        else if (k === 'n') this.onPlaque('next-city');
      }
    }
    this.keys.clear();
  }
}

function nextCityPlaque(d: RepoCityDirector): PlaqueSpec {
  void d;
  return { id: 'next-city', text: 'Next city', accent: UI.amber };
}

/** The guide: a small lantern with a halo ring, warm and friendly, never a person. */
function makeGuide(): Group {
  const g = new Group();
  g.name = 'guide';
  const core = new Mesh(new SphereGeometry(0.014, 24, 16), new MeshBasicMaterial({ color: '#ffe2a8', toneMapped: false }));
  const glow = new Mesh(new SphereGeometry(0.024, 24, 16), new MeshBasicMaterial({ color: '#ffb04a', transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false }));
  const ring = new Mesh(new RingGeometry(0.026, 0.029, 48), new MeshBasicMaterial({ color: '#8cc8ff', transparent: true, opacity: 0.8, side: 2, toneMapped: false }));
  ring.rotation.x = Math.PI / 2.4;
  g.add(core, glow, ring);
  return g;
}

/** Placement preview: the plinth outline as a glowing frame. */
function makePreview(): Group {
  const g = new Group();
  g.name = 'placement-preview';
  const half = CITY_SIZE / 2 + 0.02;
  const mat = new MeshBasicMaterial({ color: '#8cc8ff', transparent: true, opacity: 0.9, toneMapped: false });
  const t = 0.006;
  for (const [x, z, w, d] of [
    [0, -half, half * 2, t],
    [0, half, half * 2, t],
    [-half, 0, t, half * 2],
    [half, 0, t, half * 2],
  ]) {
    const bar = new Mesh(new BoxGeometry(w, 0.003, d), mat);
    bar.position.set(x, 0.002, z);
    g.add(bar);
  }
  const fill = new Mesh(new BoxGeometry(half * 2, 0.001, half * 2), new MeshBasicMaterial({ color: '#8cc8ff', transparent: true, opacity: 0.12, depthWrite: false }));
  g.add(fill);
  return g;
}

export type { Object3D };
