import * as THREE from "three";
import { V, frameOrbit } from "./scene-kit.js";

const TYPED = { Float32Array, Uint16Array, Uint32Array, Uint8Array, Int16Array, Int32Array, Int8Array, Uint8ClampedArray };

/** Typed arrays from the page's realm fail three.js' instanceof checks, so attributes are copied into this realm. */
function copyAttribute(a) {
  const Ctor = TYPED[a.array.constructor.name] || Float32Array;
  return new THREE.BufferAttribute(new Ctor(a.array), a.itemSize, a.normalized);
}

function copyGeometry(g) {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, copyAttribute(a));
  if (g.index) out.setIndex(copyAttribute(g.index));
  for (const gr of g.groups || []) out.addGroup(gr.start, gr.count, gr.materialIndex);
  return out;
}

function copyMaterial(m) {
  if (m.isSpriteMaterial) {
    const map = m.map ? new THREE.CanvasTexture(m.map.image) : null;
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.SpriteMaterial({ map, transparent: true, depthTest: m.depthTest, depthWrite: false, opacity: m.opacity });
  }
  return new THREE.MeshStandardMaterial({
    color: m.color ? m.color.getHex() : 0xcccccc, roughness: m.roughness ?? 1, metalness: m.metalness ?? 0,
    emissive: m.emissive ? m.emissive.getHex() : 0, transparent: m.transparent, opacity: m.opacity,
    // overlapping see-through pieces (the ghost discs) must not hide each other when the orbit flips their order
    depthWrite: m.transparent ? false : m.depthWrite, side: m.side, flatShading: m.flatShading,
  });
}

/** The page's lights, so the mirror is lit (and shadowed) exactly as the frames the model saw. */
function copyLight(l) {
  if (l.isHemisphereLight) {
    const h = new THREE.HemisphereLight(l.color.getHex(), l.groundColor.getHex(), l.intensity);
    h.position.fromArray(l.position.toArray());
    return [h];
  }
  if (l.isDirectionalLight) {
    const d = new THREE.DirectionalLight(l.color.getHex(), l.intensity);
    d.position.fromArray(l.position.toArray());
    d.target.position.fromArray(l.target.position.toArray());
    d.castShadow = l.castShadow;
    d.shadow.mapSize.set(l.shadow.mapSize.x, l.shadow.mapSize.y);
    // the page's camera never moves; under an orbiting camera its zero normal bias shows as crawling shadow acne
    d.shadow.bias = Math.min(l.shadow.bias, -0.0005);
    d.shadow.normalBias = Math.max(l.shadow.normalBias, 0.03);
    d.shadow.radius = l.shadow.radius;
    const c = l.shadow.camera;
    Object.assign(d.shadow.camera, { left: c.left, right: c.right, top: c.top, bottom: c.bottom, near: c.near, far: c.far });
    return [d, d.target];
  }
  if (l.isAmbientLight) return [new THREE.AmbientLight(l.color.getHex(), l.intensity)];
  if (l.isPointLight || l.isSpotLight) {
    const p = l.isPointLight ? new THREE.PointLight(l.color.getHex(), l.intensity, l.distance, l.decay) : new THREE.SpotLight(l.color.getHex(), l.intensity);
    p.position.fromArray(l.position.toArray());
    return [p];
  }
  return [];
}

const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

/**
 * Re-renders a benchmark page's own scene graph (geometry, materials, lights and live transforms) with the site's
 * camera on the site's dark stage. `src` is the page's THREE.Scene; call sync() after the page moved its objects.
 * `seeThrough(obj)` may return an opacity for page meshes that should be drawn as glass (e.g. a screen hiding a wire).
 */
export function createMirrorScene(canvas, src, { seeThrough } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);
  const root = new THREE.Group();
  scene.add(root);
  const pairs = [];
  const known = new Set();
  const geos = new Map(), mats = new Map();
  const reuse = (cache, key, make) => (cache.has(key) ? cache.get(key) : cache.set(key, make()).get(key));

  function adoptNew() {
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if (known.has(o.uuid)) return;
      known.add(o.uuid);
      if (o.isLight) { scene.add(...copyLight(o)); return; }
      if (!(o.isMesh || o.isSprite)) return;
      let slab = false;
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        const size = o.geometry.boundingBox.getSize(V(0, 0, 0));
        if (Math.max(size.x, size.y, size.z) > 40) return; // the room floor; the site's dark stage replaces it
        slab = size.y < 0.4 && Math.max(size.x, size.z) > 3;
      }
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      const glass = o.isMesh && seeThrough ? seeThrough(o) : null;
      // parts resting on the table share its top plane exactly; pushing the table back in depth stops the
      // coplanar faces from fighting once the camera moves (the page's own camera never does)
      const mat = glass
        ? Object.assign(copyMaterial(m), { transparent: true, opacity: glass, depthWrite: false })
        : slab
          ? Object.assign(copyMaterial(m), { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 })
          : reuse(mats, m.uuid, () => copyMaterial(m));
      const u = o.isSprite ? new THREE.Sprite(mat) : new THREE.Mesh(reuse(geos, o.geometry.uuid, () => copyGeometry(o.geometry)), mat);
      u.matrixAutoUpdate = false;
      u.castShadow = o.castShadow;
      u.receiveShadow = o.receiveShadow;
      u.renderOrder = o.renderOrder;
      root.add(u);
      pairs.push([o, u, m, glass]);
    });
  }
  adoptNew();

  const box = new THREE.Box3();
  for (const [t, u] of pairs) {
    u.matrix.fromArray(t.matrixWorld.elements);
    u.updateMatrixWorld(true);
    box.expandByObject(u);
  }
  const center = box.getCenter(V(0, 0, 0));
  const radius = box.getSize(V(0, 0, 0)).length() / 2;

  function sync() {
    adoptNew();
    for (const [t, u, m, glass] of pairs) {
      u.matrix.fromArray(t.matrixWorld.elements);
      u.matrixWorldNeedsUpdate = true;
      u.visible = shown(t);
      if (!glass && u.material.opacity !== m.opacity) u.material.opacity = m.opacity;
    }
  }

  /** Small spheres at page-world points (e.g. where a run touched the wire); show(n) reveals the first n. */
  const extras = [];
  function markers(points, { color = 0xff4d4d, r = 0.035 } = {}) {
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color }), Math.max(1, points.length));
    const m4 = new THREE.Matrix4();
    points.forEach((p, i) => mesh.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
    mesh.count = 0;
    mesh.renderOrder = 5;
    scene.add(mesh);
    extras.push(mesh);
    return { show: (n) => { mesh.count = Math.min(n, points.length); } };
  }

  let W = 1, H = 1;
  function resize() {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
  }

  resize();
  sync();
  return {
    sync, resize, markers,
    setCamera: ({ wide, ...orbit }) => frameOrbit(camera, W, H, center, radius, orbit),
    update: () => {},
    render: () => renderer.render(scene, camera),
    dispose: () => {
      for (const g of geos.values()) g.dispose();
      for (const e of extras) { e.geometry.dispose(); e.material.dispose(); }
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
