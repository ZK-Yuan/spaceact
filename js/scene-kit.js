import * as THREE from "three";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";

// World conventions of the benchmark renderer (the one that produced the frames the models saw):
// world studs (X, Y, Z) -> three (X, Z, -Y) * S, LDraw parts via ldrawMatrix().
export const S = 0.35;
export const LDU = S / 20;
export const PLATE = 0.4;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const toThree = (c) => V(c[0] * S, c[2] * S, -c[1] * S);

// stem -> [length studs, width studs, height plates, studs on top]
const STEMS = {
  "3070b": [1, 1, 1, false], "3024": [1, 1, 1, true], "3023b": [2, 1, 1, true], "3623": [3, 1, 1, true],
  "3710": [4, 1, 1, true], "3666": [6, 1, 1, true], "3460": [8, 1, 1, true], "3022": [2, 2, 1, true],
  "3021": [3, 2, 1, true], "3020": [4, 2, 1, true], "3795": [6, 2, 1, true], "3034": [8, 2, 1, true],
  "3832": [10, 2, 1, true], "3005": [1, 1, 3, true], "3004": [2, 1, 3, true], "3622": [3, 1, 3, true],
  "3010": [4, 1, 3, true], "3009": [6, 1, 3, true], "3008": [8, 1, 3, true], "3003": [2, 2, 3, true],
  "3002": [3, 2, 3, true], "3001": [4, 2, 3, true], "2456": [6, 2, 3, true], "3007": [8, 2, 3, true],
  "3068b": [2, 2, 1, false], "87079": [4, 2, 1, false], "69729": [6, 2, 1, false], "1751": [4, 4, 1, false],
  "6320": [8, 6, 1, false], "48288": [16, 8, 1, false],
};
export const COLORS = {
  white: 0xf6f5f0, yellow: 0xf4c82e, orange: 0xf07f22, black: 0x1e2529, red: 0xc9302c, blue: 0x2f6db5,
  green: 0x3f9a4a, lime: 0x9bcf3a, tan: 0xd9c08c, purple: 0x7a4fa8, "light bluish gray": 0xa2abb1,
  "dark bluish gray": 0x5b666d, "reddish brown": 0x7d4630, "dark blue": 0x1f3f70, "medium azure": 0x2cc0e0,
  magenta: 0xd6267f, azure: 0x2cc0e0, board: 0xd9c9a0, "trans clear": 0xd6ebf2, glass: 0xd6ebf2,
};
// rival models' ghosts: kept clear of payload white/yellow/orange and the magenta/azure diagnostics
export const GHOST_COLORS = [0x9b8cff, 0x4fd1c5, 0xff7a90, 0xa3e635, 0x60a5fa, 0xe879f9, 0x94a3b8, 0xfda4af,
  0xfb923c, 0xf5f5f4, 0x0f9f8f, 0xb7793f];
const GLASS = new Set(["9047", "glass", "trans clear", "manip_glass"]);
export const isGlass = (c) => GLASS.has(String(c ?? "").toLowerCase().trim());
export function colorHex(c) {
  if (typeof c === "number") return c;
  const s = String(c ?? "").toLowerCase().trim();
  if (s.startsWith("#")) return parseInt(s.slice(1), 16);
  if (isGlass(s)) return COLORS.glass;
  return COLORS[s] ?? 0x8f969a;
}

const A_MAT = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const A_INV = A_MAT.clone().invert();

export function ldrawMatrix(m) {
  return new THREE.Matrix4().set(
    m[0], -m[1], -m[2], (m[3] + 10) * LDU,
    -m[4], m[5], m[6], -m[7] * LDU,
    -m[8], m[9], m[10], -(m[11] + 10) * LDU,
    0, 0, 0, 1,
  );
}

/** Rigid pose (row-major 3x3 R in world axes, centre c in world studs) as a three.js matrix. */
export function poseMatrix(R, c) {
  const r = new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);
  const m = A_MAT.clone().multiply(r).multiply(A_INV);
  m.setPosition(toThree(c));
  return m;
}

export function plastic(hex, extra = {}) {
  return new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.7, ...extra });
}
export const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xd6ebf2, transparent: true, opacity: 0.1, roughness: 0.08, metalness: 0, depthWrite: false, envMapIntensity: 1.2,
});
const matCache = new Map();
/** Shared material for a benchmark colour (named, "#rrggbb" or LDraw glass code) and opacity. */
export function materialFor(color, opacity = 1, metal = false) {
  if (isGlass(color)) return glassMat;
  const key = `${colorHex(color)}|${opacity}|${metal}`;
  if (!matCache.has(key)) {
    const see = opacity < 0.95;
    matCache.set(key, plastic(colorHex(color), {
      transparent: see, opacity, depthWrite: !see, metalness: metal ? 0.3 : 0, roughness: metal ? 0.34 : 0.38,
      side: see ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  return matCache.get(key);
}

const geoCache = new Map();
function bodyGeos(w, h, d, rounded) {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${rounded}`;
  if (!geoCache.has(key)) {
    geoCache.set(key, {
      body: rounded ? new RoundedBoxGeometry(w, h, d, 2, 0.01) : new THREE.BoxGeometry(w, h, d),
      edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    });
  }
  return geoCache.get(key);
}
const studGeo = new THREE.CylinderGeometry(0.3 * S, 0.3 * S, 0.18 * S, 18);
export const edgeDark = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
export const edgeGlass = new THREE.LineBasicMaterial({ color: 0xcfeaf5, transparent: true, opacity: 0.22 });

/** A brick in its own frame: length along x, width along z, body below y = 0, studs on top. */
function legoBody(l, w, h, studs, material, glass) {
  const gap = glass ? 0.004 : 0.03;
  const bw = (l - gap) * S, bd = (w - gap) * S, bh = (h * PLATE - gap * 0.6) * S;
  const g = new THREE.Group();
  const geos = bodyGeos(bw, bh, bd, !glass);
  const body = new THREE.Mesh(geos.body, material);
  body.position.y = -bh / 2 - gap * 0.3 * S;
  body.castShadow = !glass;
  body.receiveShadow = !glass;
  const edges = new THREE.LineSegments(geos.edges, glass ? edgeGlass : edgeDark);
  edges.position.copy(body.position);
  g.add(body, edges);
  if (studs && !glass) {
    for (let i = 0; i < l; i++) {
      for (let j = 0; j < w; j++) {
        const s = new THREE.Mesh(studGeo, material);
        s.position.set((i + 0.5 - l / 2) * S, 0.09 * S, (j + 0.5 - w / 2) * S);
        s.castShadow = true;
        g.add(s);
      }
    }
  }
  return { g, body };
}

/** One LDraw part. Returns the group plus the 8 corners of its frame box (engine localBox) in three coords. */
export function ldrawPart(stem, m4, material, glass = false) {
  const [l, w, h, studs] = STEMS[stem] || [2, 2, 3, true];
  const { g, body } = legoBody(l, w, h, studs, material, glass);
  const mat = ldrawMatrix(m4);
  g.applyMatrix4(mat);
  const top = studs && !glass ? 0.18 * S : 0;
  const box = [];
  for (const x of [-l / 2 * S, l / 2 * S]) for (const y of [-h * PLATE * S, top]) for (const z of [-w / 2 * S, w / 2 * S]) box.push(V(x, y, z));
  return { group: g, body, localCorners: box.map((p) => p.clone().applyMatrix4(mat)) };
}

/** BrickAgent placed spec {part, x, y, z, yaw, l, w, h, studs}: min stud corner (x, y), bottom plate z. */
export function specPart(sp, material) {
  const turned = ((((sp.yaw || 0) % 360) + 360) % 180) !== 0;
  const dx = turned ? sp.w : sp.l, dy = turned ? sp.l : sp.w;
  const { g: body } = legoBody(sp.l, sp.w, sp.h, sp.studs, material, false);
  const g = new THREE.Group();
  if (turned) body.rotation.y = Math.PI / 2;
  g.add(body);
  g.position.copy(toThree([sp.x + (dx - 1) / 2, sp.y + (dy - 1) / 2, (sp.z + sp.h) * PLATE]));
  return g;
}

const METAL = new Set(["dark bluish gray", "reddish brown", "yellow", "light bluish gray"]);
/** Tube, cylinder, sphere, disc, prism and box primitives in world studs, drawn as the benchmark renderer draws them. */
export function primitiveMesh(m, override) {
  const color = m.hex || m.color || "dark bluish gray";
  const opacity = m.opacity ?? 1;
  const mt = override || materialFor(color, opacity, METAL.has(String(m.color || "")));
  const g = new THREE.Group();
  const add = (mesh) => { mesh.castShadow = opacity >= 0.95; mesh.receiveShadow = true; g.add(mesh); return mesh; };
  if (m.type === "tube" && m.points && m.points.length >= 2) {
    const pts = m.points.map(toThree);
    const curve = new THREE.CatmullRomCurve3(pts, Boolean(m.closed), "centripetal");
    const r = m.radius * S;
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(1200, Math.max(24, pts.length * 2)), r, 12, Boolean(m.closed)), mt));
    if (!m.closed) for (const e of [pts[0], pts[pts.length - 1]]) add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mt)).position.copy(e);
  } else if (m.type === "cylinder") {
    const a = toThree(m.a), b = toThree(m.b), d = b.clone().sub(a);
    const r = m.radius * S;
    const c = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(d.length(), 1e-6), 20), mt));
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    for (const e of [a, b]) add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mt)).position.copy(e);
  } else if (m.type === "sphere") {
    add(new THREE.Mesh(new THREE.SphereGeometry(m.radius * S, 32, 20), mt)).position.copy(toThree(m.center));
  } else if (m.type === "disc") {
    const d = add(new THREE.Mesh(new THREE.CylinderGeometry(m.radius * S, m.radius * S, Math.max(0.01, m.height * S), 48), mt));
    d.position.copy(toThree(m.center));
  } else if (m.type === "prism") {
    const shape = new THREE.Shape(m.points.map((p) => new THREE.Vector2(p[0] * S, p[1] * S)));
    for (const h of m.holes || []) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0] * S, p[1] * S))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, m.height * S), bevelEnabled: false });
    const p = add(new THREE.Mesh(geo, mt));
    p.rotation.x = -Math.PI / 2;
    p.position.y = (m.z0 || 0) * S;
    if (m.edges !== false) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), opacity < 0.95 ? edgeGlass : edgeDark);
      e.rotation.x = -Math.PI / 2;
      e.position.y = p.position.y;
      g.add(e);
    }
  } else if (m.type === "box") {
    if (m.ground) return g;
    const b = add(new THREE.Mesh(new THREE.BoxGeometry(m.size[0] * S, m.size[2] * S, m.size[1] * S), mt));
    b.position.copy(toThree(m.center));
  }
  return g;
}

/** Renderer, scene, environment, camera and a warm key/rim light pair aimed at `mid` (three coords). */
export function createStage(canvas, mid, span = 14) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3326, 0.6));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.copy(mid).add(V(-0.6 * span, 1.3 * span, 0.9 * span));
  key.target.position.copy(mid);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: span * 5 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x8fdcff, 0.8);
  rim.position.copy(mid).add(V(0.7 * span, 0.6 * span, -span));
  scene.add(rim);
  return { renderer, scene, camera };
}

/** Orbit framing around a bounding sphere: az/el in degrees, dist as a multiple of the radius, shift = text column offset. */
export function frameOrbit(camera, W, H, center, radius, { az, el, dist, shift = 1, lift = 0 }) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  const vf = THREE.MathUtils.degToRad(camera.fov / 2);
  const aspect = W / H;
  const fit = (radius / Math.sin(Math.min(vf, Math.atan(Math.tan(vf) * aspect)))) * dist;
  const look = center.clone().add(V(0, lift * radius, 0));
  camera.position.set(look.x + fit * Math.sin(a) * Math.cos(e), look.y + fit * Math.sin(e), look.z + fit * Math.cos(a) * Math.cos(e));
  camera.lookAt(look);
  camera.aspect = aspect;
  if (shift && aspect > 1.15) camera.setViewOffset(W, H, -shift * 0.13 * W, 0, W, H);
  else if (shift) camera.setViewOffset(W, H, 0, -shift * 0.1 * H, W, H);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

export function boardMesh(bb) {
  const bw = (bb.x1 - bb.x0) * S, bd = (bb.y1 - bb.y0) * S, bt = 0.5 * S;
  const board = new THREE.Mesh(new RoundedBoxGeometry(bw, bt, bd, 3, 0.05), plastic(COLORS.board, { clearcoat: 0.1, roughness: 0.7 }));
  board.position.copy(toThree([(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, bb.top ?? 0])).add(V(0, -bt / 2, 0));
  board.receiveShadow = true;
  return board;
}
