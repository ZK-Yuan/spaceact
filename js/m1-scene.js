import * as THREE from "three";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/RoundedBoxGeometry.js";
import { COLORS, GHOST_COLORS, LDU, S, V, glassMat, ldrawPart, plastic, poseMatrix, toThree } from "./scene-kit.js";

/** Where the benchmark put the model's camera for a camera action (960x640 frames). */
function agentCamera(points, cam) {
  const center = points.reduce((s, p) => s.add(p), V(0, 0, 0)).divideScalar(points.length);
  const az = THREE.MathUtils.degToRad(cam.az);
  const el = THREE.MathUtils.degToRad(Math.min(88, Math.max(-25, cam.el)));
  const dir = V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
  const right = V(Math.cos(az), 0, -Math.sin(az));
  const up = V(0, 0, 0).crossVectors(dir, right);
  const pts = points.map((p) => { const q = p.clone().sub(center); return V(q.dot(right), q.dot(up), q.dot(dir)); });
  const vertical = Math.tan((45 * Math.PI) / 360), horizontal = vertical * 1.5;
  let l = -Infinity, r = -Infinity, b = -Infinity, t = -Infinity;
  for (const p of pts) {
    l = Math.max(l, -p.x / horizontal + p.z); r = Math.max(r, p.x / horizontal + p.z);
    b = Math.max(b, -p.y / vertical + p.z); t = Math.max(t, p.y / vertical + p.z);
  }
  const distance = 1.1 * Math.max(LDU, (l + r) / 2, (b + t) / 2);
  for (const [axis, basis] of [["x", right], ["y", up]]) {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      let mn = Infinity, mx = -Infinity;
      for (const p of pts) { const v = (p[axis] - mid) / (distance - p.z); mn = Math.min(mn, v); mx = Math.max(mx, v); }
      if (mn + mx > 0) lo = mid; else hi = mid;
    }
    center.addScaledVector(basis, (lo + hi) / 2);
  }
  // pan reaches the engine as LDraw-axis LDU and is added in three axes, exactly as in the recorded frames
  const pan = V(cam.pan[0] * S, -cam.pan[2] * S, cam.pan[1] * S);
  const target = center.clone().add(pan);
  const eye = target.clone().addScaledVector(dir, distance * cam.zoom);
  return { eye, target };
}

export function createM1Scene(canvas, ep) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 400);

  const mid = toThree([26, 7, 5]);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3326, 0.6));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.copy(mid).add(V(-8, 18, 12));
  key.target.position.copy(mid);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 60 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x8fdcff, 0.8);
  rim.position.copy(mid).add(V(10, 8, -14));
  scene.add(rim);

  const bb = ep.scene.board;
  const bw = (bb.x1 - bb.x0) * S, bd = (bb.y1 - bb.y0) * S, bt = 0.5 * S;
  const board = new THREE.Mesh(new RoundedBoxGeometry(bw, bt, bd, 3, 0.05), plastic(COLORS.board, { clearcoat: 0.1, roughness: 0.7 }));
  board.position.copy(toThree([(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, bb.top ?? 0])).add(V(0, -bt / 2, 0));
  board.receiveShadow = true;
  scene.add(board);

  const mats = {};
  const shared = (color) => (mats[color] ??= plastic(COLORS[color] ?? 0x8f969a));
  const staticCorners = [];
  const panels = ep.scene.panels.map((p) => {
    const glass = p.kind === "glass" || p.kind === "roof";
    const part = ldrawPart(p.stem, p.m4, glass ? glassMat : shared(p.color), glass);
    part.base = part.body.material;
    staticCorners.push(...part.localCorners);
    scene.add(part.group);
    return part;
  });
  for (const p of ep.scene.reference) {
    const part = ldrawPart(p.stem, p.m4, shared(p.color), false);
    staticCorners.push(...part.localCorners);
    scene.add(part.group);
  }

  const hitMat = plastic(COLORS.azure, { emissive: new THREE.Color(COLORS.azure), emissiveIntensity: 0.5 });
  const flashMat = plastic(COLORS.magenta, { emissive: new THREE.Color(COLORS.magenta), emissiveIntensity: 0.5 });

  function payloadGroup(materialFor) {
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const parts = ep.scene.payload.map((p) => {
      const part = ldrawPart(p.stem, p.m4, materialFor(p.color), false);
      g.add(part.group);
      return part;
    });
    return { g, parts };
  }
  const payload = payloadGroup((c) => shared(c));
  payload.parts.forEach((p) => { p.base = p.body.material; });
  scene.add(payload.g);

  let gi = 0;
  const ghosts = ep.others.map((o) => {
    const color = o.success ? 0xffffff : GHOST_COLORS[gi++ % GHOST_COLORS.length];
    const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.55, roughness: 0.5, depthWrite: false });
    const gh = payloadGroup(() => m);
    gh.g.matrix.copy(poseMatrix(o.best.R, o.best.c));
    gh.g.matrixWorldNeedsUpdate = true;
    gh.g.visible = false;
    gh.mat = m;
    gh.color = color;
    scene.add(gh.g);
    return gh;
  });

  // the model's own camera: a small frustum glyph, its line of sight, and a dot for every viewpoint it used
  const glyph = new THREE.Group();
  const az = new THREE.Color(COLORS.azure);
  const frustum = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.ConeGeometry(0.28, 0.42, 4, 1, true).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).translate(0, 0, 0.21)),
    new THREE.LineBasicMaterial({ color: az }),
  );
  const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.16), new THREE.MeshBasicMaterial({ color: az }));
  camBody.position.z = -0.08;
  glyph.add(frustum, camBody);
  glyph.visible = false;
  scene.add(glyph);
  const sightGeo = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0), V(0, 0, 1)]);
  const sight = new THREE.Line(sightGeo, new THREE.LineDashedMaterial({ color: az, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.8 }));
  sight.visible = false;
  scene.add(sight);
  const disc = document.createElement("canvas");
  disc.width = disc.height = 64;
  const dctx = disc.getContext("2d");
  dctx.fillStyle = "#fff";
  dctx.beginPath();
  dctx.arc(32, 32, 28, 0, Math.PI * 2);
  dctx.fill();

  // agent camera poses for every executed camera action, framed on the payload pose of that moment
  const payloadLocalCorners = payload.parts.flatMap((p) => p.localCorners);
  function cornersWithPayload(R, c) {
    const m = poseMatrix(R, c);
    return staticCorners.concat(payloadLocalCorners.map((p) => p.clone().applyMatrix4(m)));
  }
  let pose = ep.scene.start;
  const startView = agentCamera(cornersWithPayload(pose.R, pose.c), { az: 30, el: 35, zoom: 1, pan: [0, 0, 0] });
  const webPoints = [];
  for (const t of ep.turns) {
    for (const a of t.actions) {
      if (a.after) pose = a.after;
      if (a.cam) {
        const v = agentCamera(cornersWithPayload(pose.R, pose.c), a.cam);
        a.view = v;
        webPoints.push(v.eye, v.target);
      }
    }
  }
  // viewpoints as constant-size discs, so ones that land right next to the cinematic camera stay small
  const dots = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(webPoints.filter((_, i) => i % 2 === 0)),
    new THREE.PointsMaterial({
      color: az, size: 9, sizeAttenuation: false, map: new THREE.CanvasTexture(disc),
      transparent: true, alphaTest: 0.3, depthWrite: false,
    }),
  );
  dots.geometry.setDrawRange(0, 0);
  scene.add(dots);
  // one faint line of sight per viewpoint used so far
  const web = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(webPoints),
    new THREE.LineBasicMaterial({ color: az, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  web.geometry.setDrawRange(0, 0);
  scene.add(web);

  let W = 1, H = 1;
  function resize() {
    W = canvas.clientWidth || 1;
    H = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
  }

  const look = new THREE.Vector3();
  function update(st) {
    payload.g.matrix.copy(poseMatrix(st.R, st.c));
    payload.g.matrixWorldNeedsUpdate = true;
    for (const p of payload.parts) p.body.material = st.flash > 0.5 ? flashMat : p.base;
    flashMat.emissiveIntensity = 0.35 + 0.35 * st.flash;
    panels.forEach((p, i) => { p.body.material = i === st.hitPanel ? hitMat : p.base; });

    glyph.visible = sight.visible = !!st.agent;
    glyph.scale.setScalar(st.markerScale);
    if (st.agent) {
      glyph.position.copy(st.agent.eye);
      glyph.lookAt(st.agent.target);
      sight.geometry.setFromPoints([st.agent.eye, st.agent.target]);
      sight.computeLineDistances();
    }
    dots.geometry.setDrawRange(0, st.dotsShown);
    dots.material.opacity = 0.85 * st.dotFade;
    web.geometry.setDrawRange(0, 2 * st.dotsShown);
    web.material.opacity = 0.22 * st.dotFade;
    ghosts.forEach((g) => { g.g.visible = st.ghosts > 0.01; g.mat.opacity = 0.6 * st.ghosts; });

    const { az: a, el: e, dist, target } = st.cam;
    const ar = THREE.MathUtils.degToRad(a), er = THREE.MathUtils.degToRad(e);
    look.copy(toThree(target));
    camera.position.set(
      look.x + dist * Math.sin(ar) * Math.cos(er),
      look.y + dist * Math.sin(er),
      look.z + dist * Math.cos(ar) * Math.cos(er),
    );
    camera.lookAt(look);
    camera.aspect = W / H;
    const wide = W / H > 1.15;
    if (st.shift && wide) camera.setViewOffset(W, H, -st.shift * 0.13 * W, 0, W, H);
    else if (st.shift) camera.setViewOffset(W, H, 0, -st.shift * 0.1 * H, W, H);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function render() { renderer.render(scene, camera); }

  /** Screen position (CSS px) of a world-stud point, for HTML labels. */
  function project(c) {
    const v = toThree(c).project(camera);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, behind: v.z > 1 };
  }

  resize();
  return { update, render, resize, project, startView, ghostColors: ghosts.map((g) => g.color) };
}
