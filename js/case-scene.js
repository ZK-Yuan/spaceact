import * as THREE from "three";
import {
  COLORS, GHOST_COLORS, V, boardMesh, colorHex, createStage, frameOrbit, isGlass, ldrawPart, materialFor, plastic,
  poseMatrix, primitiveMesh, specPart, toThree,
} from "./scene-kit.js";

const A_MAT = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const A_INV = A_MAT.clone().invert();
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const flashMat = plastic(COLORS.magenta, { emissive: new THREE.Color(COLORS.magenta), emissiveIntensity: 0.55 });

/** Wraps an object so it scales and slides about its own bounding-box centre. */
function pivoted(obj) {
  const c = new THREE.Box3().setFromObject(obj).getCenter(V(0, 0, 0));
  const w = new THREE.Group();
  w.position.copy(c);
  obj.position.sub(c);
  w.add(obj);
  w.userData.home = c.clone();
  return w;
}

function itemObject(it, glowThin) {
  if (it.k === "s") return specPart(it, materialFor(it.color));
  if (it.k === "p") return ldrawPart(it.stem, it.m4, materialFor(it.color), isGlass(it.color)).group;
  if (glowThin && it.type === "tube" && it.radius <= 0.08) {
    const hex = colorHex(it.hex || it.color);
    return primitiveMesh(it, new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.6, roughness: 0.4 }));
  }
  return primitiveMesh(it);
}

/** Same shape and orientation, possibly elsewhere: lets a moved piece slide instead of popping. */
function signature(it) {
  const r = (v) => Math.round(v * 100) / 100;
  if (it.k === "s") return `s|${it.part}|${it.yaw}|${it.color}`;
  if (it.k === "p") return `p|${it.stem}|${it.color}|${it.m4.filter((_, i) => i % 4 !== 3 && i < 12).map(r)}`;
  if (it.type === "prism") {
    const [x0, y0] = it.points[0];
    return `prism|${it.hex || it.color}|${r(it.height)}|${it.points.map(([x, y]) => `${r(x - x0)},${r(y - y0)}`)}`;
  }
  if (it.type === "sphere") return `sphere|${it.hex || it.color}|${it.radius}`;
  if (it.type === "cylinder") return `cyl|${it.hex || it.color}|${it.radius}|${it.b.map((v, i) => r(v - it.a[i]))}`;
  return null;
}

export function createCaseScene(canvas, data, opts = {}) {
  const sc = data.scene;
  const root = new THREE.Group();
  const frameBox = new THREE.Box3();
  const addFramed = (o) => { root.add(o); frameBox.expandByObject(o); return o; };
  root.add(boardMesh(sc.board));
  let update = () => {};

  if (data.kind === "pose") {
    sc.obstacles.forEach((m) => addFramed(primitiveMesh(m)));
    sc.reference.forEach((p) => root.add(ldrawPart(p.stem, p.m4, materialFor(p.color)).group));
    const payload = new THREE.Group();
    payload.matrixAutoUpdate = false;
    const normal = new THREE.Group(), flash = new THREE.Group();
    sc.payload.forEach((m) => { normal.add(primitiveMesh(m)); flash.add(primitiveMesh(m, flashMat)); });
    payload.add(normal, flash);
    root.add(payload);
    payload.matrix.copy(poseMatrix(sc.start.R, sc.start.c));
    payload.updateMatrixWorld(true);
    frameBox.expandByObject(payload);
    const ghosts = data.others.filter((o) => o.best).map((o, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: GHOST_COLORS[i % GHOST_COLORS.length], transparent: true, opacity: 0.5, depthWrite: false });
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      sc.payload.forEach((m) => g.add(primitiveMesh(m, mat)));
      g.matrix.copy(poseMatrix(o.best.R, o.best.c));
      g.visible = false;
      o.color = GHOST_COLORS[i % GHOST_COLORS.length];
      root.add(g);
      return { g, mat };
    });
    update = (st) => {
      payload.matrix.copy(poseMatrix(st.R, st.c));
      payload.matrixWorldNeedsUpdate = true;
      normal.visible = !st.flash;
      flash.visible = !!st.flash;
      for (const { g, mat } of ghosts) { g.visible = st.ghosts > 0.01; mat.opacity = 0.55 * st.ghosts; }
    };
  } else if (data.kind === "snap") {
    const objs = new Map();
    const get = (id) => {
      if (!objs.has(id)) {
        const w = pivoted(itemObject(sc.items[id], opts.glowThin));
        w.visible = false;
        root.add(w);
        objs.set(id, w);
      }
      return objs.get(id);
    };
    const always = new Set(sc.start.filter((id) => opts.keyframes.every((k) => k.includes(id))));
    for (const id of always) { const w = get(id); w.visible = true; frameBox.expandByObject(w); }
    for (const k of opts.keyframes) for (const id of k) frameBox.expandByObject(get(id));
    const plans = new Map();
    const plan = (a, b) => {
      const key = `${a.join(",")}>${b.join(",")}`;
      if (plans.has(key)) return plans.get(key);
      const A = new Set(a), B = new Set(b);
      const gone = a.filter((id) => !B.has(id) && !always.has(id));
      const born = b.filter((id) => !A.has(id) && !always.has(id));
      const slides = new Map();
      const free = new Map();
      for (const id of gone) {
        const s = signature(sc.items[id]);
        if (s) free.set(s, [...(free.get(s) || []), id]);
      }
      for (const id of born) {
        const s = signature(sc.items[id]);
        const pool = s && free.get(s);
        if (pool && pool.length) slides.set(id, pool.shift());
      }
      const slid = new Set(slides.values());
      const p = { keep: b.filter((id) => A.has(id) && !always.has(id)), gone: gone.filter((id) => !slid.has(id)), born, slides };
      plans.set(key, p);
      return p;
    };
    let shown = new Set();
    update = (st) => {
      const next = new Set();
      const show = (id, scale, offset) => {
        const w = get(id);
        w.visible = true;
        w.scale.setScalar(Math.max(0.001, scale));
        w.position.copy(w.userData.home);
        if (offset) w.position.add(offset);
        next.add(id);
      };
      const e = st.f * st.f * (3 - 2 * st.f);
      if (st.f >= 1 || st.from === st.to) {
        for (const id of st.to) if (!always.has(id)) show(id, 1);
      } else {
        const p = plan(st.from, st.to);
        for (const id of p.keep) show(id, 1);
        for (const id of p.gone) show(id, 1 - e);
        for (const id of p.born) {
          const src = p.slides.get(id);
          if (src !== undefined) show(id, 1, get(src).userData.home.clone().sub(get(id).userData.home).multiplyScalar(1 - e));
          else show(id, 0.2 + 0.8 * e, V(0, (1 - e) * 0.9, 0));
        }
      }
      for (const id of shown) if (!next.has(id)) get(id).visible = false;
      shown = next;
    };
  } else if (data.kind === "maze") {
    sc.static.forEach((it) => addFramed(itemObject(it)));
    const c3 = toThree(sc.center);
    const maze = new THREE.Group();
    maze.matrixAutoUpdate = false;
    sc.maze.forEach((it) => maze.add(itemObject(it)));
    const balls = sc.balls.map((it) => {
      const w = pivoted(itemObject(it));
      maze.add(w);
      return w;
    });
    root.add(maze);
    frameBox.expandByObject(maze);
    const T1 = new THREE.Matrix4().makeTranslation(c3.x, c3.y, c3.z);
    const T0 = new THREE.Matrix4().makeTranslation(-c3.x, -c3.y, -c3.z);
    update = (st) => {
      const M = st.M;
      const r = new THREE.Matrix4().set(M[0][0], M[0][1], M[0][2], 0, M[1][0], M[1][1], M[1][2], 0, M[2][0], M[2][1], M[2][2], 0, 0, 0, 0, 1);
      maze.matrix.copy(T1).multiply(A_MAT.clone().multiply(r).multiply(A_INV)).multiply(T0);
      maze.matrixWorldNeedsUpdate = true;
      st.balls.forEach((b, i) => { if (balls[i]) balls[i].position.copy(toThree(b)); });
    };
  }

  const center = frameBox.getCenter(V(0, 0, 0));
  const radius = Math.max(2, frameBox.getSize(V(0, 0, 0)).length() / 2);

  // finale lineup: every model's scored structure on one floor, two rows deep
  const lineup = [];
  const lineupRoot = new THREE.Group();
  let lineupCenter = center, lineupRadius = radius;
  if (sc.lineup) {
    const COLS = 5, DX = 30, DY = 32, cx = (sc.board.x0 + sc.board.x1) / 2;
    sc.lineup.forEach((e, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const off = [(col - (COLS - 1) / 2) * DX, row * DY];
      const g = new THREE.Group();
      let top = 0;
      for (const id of e.ids) {
        const it = sc.items[id];
        if (it.part === "tile_1x1") continue;
        g.add(itemObject(it));
        top = Math.max(top, (it.z + it.h) * 0.4);
      }
      g.position.copy(toThree([off[0], off[1], 0]));
      g.visible = false;
      lineupRoot.add(g);
      lineup.push({ g, e, anchor: [cx + off[0], 1.5 + off[1], top + 1.6] });
    });
    const rows = Math.ceil(sc.lineup.length / COLS);
    const floor = boardMesh({ x0: cx - COLS * DX / 2, x1: cx + COLS * DX / 2, y0: -8, y1: (rows - 1) * DY + 10, top: 0 });
    floor.visible = false;
    lineupRoot.add(floor);
    lineup.floor = floor;
    const box = new THREE.Box3().setFromObject(lineupRoot);
    lineupCenter = box.getCenter(V(0, 0, 0));
    lineupRadius = box.getSize(V(0, 0, 0)).length() / 2;
  }

  const { renderer, scene, camera } = createStage(canvas, center, radius * 1.2);
  scene.add(root, lineupRoot);

  function showLineup(f) {
    if (!lineup.length) return;
    root.visible = f < 0.5;
    lineup.floor.visible = f >= 0.5;
    lineup.forEach((l, i) => {
      const s = clamp01((f - 0.5) * 2.4 - i * 0.07);
      l.g.visible = s > 0;
      l.g.scale.setScalar(Math.max(0.001, 0.6 + 0.4 * s));
    });
  }

  let W = 1, H = 1;
  function resize() {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
  }

  /** Orbit framing: az/el in degrees, dist as a multiple of the scene radius, shift = text column offset,
   * wide = 0..1 blend toward framing the finale lineup. */
  function setCamera({ wide = 0, ...orbit }) {
    frameOrbit(camera, W, H, center.clone().lerp(lineupCenter, wide), radius + (lineupRadius - radius) * wide, orbit);
  }

  /** Screen positions (CSS px) of the lineup labels. */
  function labels() {
    return lineup.map((l) => {
      const v = toThree(l.anchor).project(camera);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, on: l.g.visible && v.z < 1, e: l.e };
    });
  }

  function dispose() {
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    renderer.dispose();
    renderer.forceContextLoss();
  }

  resize();
  return {
    update: (st) => { update(st); showLineup(st.lineup || 0); }, setCamera, resize, dispose, labels,
    render: () => renderer.render(scene, camera),
    hasLineup: lineup.length > 0,
    ghostColors: data.others.map((o) => o.color),
  };
}
