import * as THREE from "three";
import { t as tr, ZH } from "./i18n.js";
import { createM1Scene } from "./m1-scene.js";
import { caseRows } from "./results-data.js";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => t * t * (3 - 2 * t);
const window01 = (x, a, b, c, d) => smooth(a, b, x) * (1 - smooth(c, d, x));

function piecewise(keys, p) {
  if (p <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i][0]) {
      const [p0, v0] = keys[i - 1], [p1, v1] = keys[i];
      return p1 === p0 ? v1 : v0 + (v1 - v0) * ((p - p0) / (p1 - p0));
    }
  }
  return keys[keys.length - 1][1];
}

// Scroll progress -> tau, a fractional turn clock: turn t plays over tau in [t-1, t].
const TAU = [
  [0, 0], [0.02, 0], [0.14, 15],
  [0.15, 15], [0.3, 18],
  [0.31, 18], [0.48, 64],
  [0.5, 64], [0.53, 64.5], [0.6, 64.8], [0.66, 68],
  [0.67, 68], [0.8, 71], [1, 71],
];
const CHAPTER_START = [0, 0.145, 0.305, 0.49, 0.665, 0.81];
// Cinematic camera: p, azimuth, elevation, distance (three units), target X, target Y (studs), follow-payload
// weight. The looking chapters pull far back: the model's viewpoints spread over roughly 100 x 60 studs.
const CAM = [
  [0, -20, 38, 44, 14, -8, 0], [0.14, -6, 44, 45, 16, -8, 0],
  [0.17, -22, 24, 21, 12, 7, 1], [0.3, -18, 24, 22, 20, 7, 1],
  [0.33, -14, 44, 46, 20, -8, 0], [0.48, 12, 48, 46, 26, -8, 0],
  [0.51, -48, 26, 21, 23, 7, 1], [0.66, -40, 24, 21, 24, 7, 1],
  [0.69, -30, 22, 21, 30, 7, 1], [0.8, -26, 24, 22, 44, 7, 1],
  [0.84, -14, 42, 39, 19, -7, 0], [1, -4, 46, 38, 20, -7, 0],
];
const X_MIN = 2, X_MAX = 50;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const rotOf = (R) => new THREE.Matrix4().set(R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, 0, 0, 0, 1);

function camPose(p) {
  for (let i = 1; i < CAM.length; i++) {
    if (p <= CAM[i][0]) {
      const a = CAM[i - 1], b = CAM[i], t = smooth(a[0], b[0], p);
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
    }
  }
  return CAM[CAM.length - 1].slice(1);
}

/** Lays every executed action of every turn on the tau clock (skipped actions take no time). */
function buildClock(ep) {
  const segs = [];
  ep.turns.forEach((t, ti) => {
    const live = t.actions.filter((a) => a.status !== "skipped");
    const span = 0.8 / Math.max(1, live.length);
    live.forEach((a, j) => segs.push({ a, turn: ti, t0: ti + 0.15 + j * span, t1: ti + 0.15 + (j + 1) * span }));
  });
  return segs;
}

export function interpPose(a, f) {
  if (a.kind === "move") {
    return { R: a.after.R, c: a.before.c.map((v, i) => v + (a.after.c[i] - v) * f) };
  }
  const B = rotOf(a.before.R), A = rotOf(a.after.R);
  const d = new THREE.Matrix4().multiplyMatrices(A, B.clone().transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(d);
  // a blocked turn only got part of the way; its executed angle is read back from the recorded poses
  const ang = a.status === "done"
    ? THREE.MathUtils.degToRad(a.deg)
    : Math.sign(a.deg) * 2 * Math.acos(clamp(Math.abs(q.w)));
  const m = new THREE.Matrix4().makeRotationAxis(AXES[a.axis], ang * f).multiply(B);
  const e = m.elements;
  return { R: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]], c: a.before.c };
}

const nameList = (rows) => {
  const names = rows.map((r) => r.model);
  if (ZH) return names.join("、");
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/** The last chapter and the board note, written from the live rows so they stay true as the last runs finish. */
function describeRivals(section, featured, rows) {
  const others = rows.slice(1);
  const done = others.filter((r) => r.status === "done");
  const pending = others.filter((r) => r.status !== "done");
  const solved = done.filter((r) => r.success);
  const failed = done.filter((r) => !r.success);
  const n = rows.length, made = 1 + solved.length;
  const hits = failed.map((r) => r.contacts).filter((h) => h != null);
  const best = Math.round(Math.max(0, ...failed.map((r) => r.xProg || 0)) * 100);
  const ch = section.querySelector('.chapter[data-ch="5"]');
  const range = hits.length ? `${Math.min(...hits)}–${Math.max(...hits)}` : "";
  ch.querySelector(".kicker").textContent = tr(`Same instance · ${n} models`, `同一实例 · ${n} 个模型`);
  const words = ["Zero", "One", "Two", "Three", "Four"];
  const zhWords = ["零个", "只有一个", "两个", "三个", "四个"];
  ch.querySelector("h2").innerHTML = tr(`${words[made] || made} made it<br>through.`, `${zhWords[made] || `${made} 个`}<br>穿了过去。`);
  ch.querySelector("p:not(.kicker)").textContent = tr(
    `${others.length} other models, same task, same 100 turns. `
      + (solved.length ? `${nameList(solved)} also made it through; the other ${failed.length} stopped at the walls (the closest got ${best}% of the way along the corridor). `
        : `None of the ${done.length} that finished made it through; the closest got ${best}% of the way along the corridor. `)
      + (range ? `The failed runs collided ${range} times; ${featured} collided once.` : "")
      + (pending.length ? ` ${nameList(pending)} ${pending.length > 1 ? "are" : "is"} still running.` : ""),
    `另外 ${others.length} 个模型，同一道题，同样 100 轮。`
      + (solved.length ? `${nameList(solved)} 也穿了过去；其余 ${failed.length} 个都停在墙前，最远的沿走廊推进了 ${best}%。`
        : `已经跑完的 ${done.length} 个都没能穿过，最远的沿走廊推进了 ${best}%。`)
      + (range ? `未通关的模型撞了 ${range} 次，${featured} 只撞了一次。` : "")
      + (pending.length ? `${nameList(pending)} 仍在运行。` : ""));
  section.querySelector(".board-note").textContent = pending.length
    ? tr(`${n - pending.length} of ${n} models finished; ${nameList(pending)} ${pending.length > 1 ? "are" : "is"} still running. The board updates by itself.`,
      `${n} 个模型中已有 ${n - pending.length} 个跑完，${nameList(pending)} 仍在运行，跑完后这里会自动更新。`)
    : tr(`All ${n} models finished.`, `${n} 个模型全部跑完。`);
}

export async function initRun(ScrollTrigger) {
  const section = document.getElementById("run");
  const stage = section.querySelector(".stage");
  const canvas = document.getElementById("run-canvas");
  const ep = await (await fetch("data/m1_episode.json", { cache: "no-cache" })).json();
  const scene = createM1Scene(canvas, ep);
  const segs = buildClock(ep);
  const $ = (id) => document.getElementById(id);
  const ui = {
    turn: $("hud-turn"), chips: $("hud-chips"), why: $("hud-why"), looks: $("ctr-looks"), moves: $("ctr-moves"),
    hits: $("ctr-hits"), fill: $("hud-fill"), eye: $("eye"), eyeImg: $("eye-img"), eyeCap: $("eye-cap"),
    corridor: $("hud-corridor"), board: $("board"), boardRows: $("board-rows"), flash: section.querySelector(".stage-flash"),
    chapters: [...section.querySelectorAll(".chapter")], meters: section.querySelector(".hud-meters"),
  };
  const xPct = (x) => `${clamp((x - X_MIN) / (X_MAX - X_MIN)) * 100}%`;

  // corridor strip: walls in their own colours, goal in green, a dot for the payload
  const WALL_CSS = { "dark bluish gray": "#5b666d", "reddish brown": "#8a4f35", "dark blue": "#2a4f8f" };
  const corridorMarks = (el) => {
    for (const [k, [lo, hi]] of Object.entries(ep.scene.walls)) {
      const m = document.createElement("i");
      m.className = k === "goal" ? "goal" : "wall";
      m.style.left = xPct(lo - (k === "goal" ? 0 : 0.5));
      m.style.width = `calc(${xPct(hi + 1)} - ${xPct(lo)})`;
      if (k !== "goal") m.style.background = WALL_CSS[k];
      el.appendChild(m);
    }
    const dot = document.createElement("b");
    el.appendChild(dot);
    return dot;
  };
  const payloadDot = corridorMarks(ui.corridor);

  // the board: the replayed run, then every other model on this instance (live rows when the results file has them;
  // models with a replayed best pose also get a ghost and a corridor marker). Progress is the corridor X advance
  // from startX to finalX, so the percentage always matches the dot's position along the corridor bar.
  const startX = ep.scene.start.c[0];
  const finalX = segs.filter((s) => s.a.after).at(-1).a.after.c[0];
  const xAdvance = (r) => (r.success ? 1 : r.x != null ? clamp((r.x - startX) / (finalX - startX)) : 0);
  const ghosts = new Map(ep.others.map((o, i) => [o.model, { x: o.best.c[0], color: scene.ghostColors[i] }]));
  const live = await caseRows(ep.meta.task_id);
  const rivals = (live
    ? live.filter((r) => r.name !== ep.meta.model).map((r) => ({ ...r, model: r.name, ...ghosts.get(r.name) }))
    : ep.others.map((o) => ({ ...o, status: "done", ...ghosts.get(o.model) }))
  ).map((r) => ({ ...r, xProg: xAdvance(r) }));
  rivals.sort((a, b) => (a.status !== "done") - (b.status !== "done") || (b.success ? 1 : 0) - (a.success ? 1 : 0)
    || Math.round(b.xProg * 100) - Math.round(a.xProg * 100) || (a.contacts ?? 999) - (b.contacts ?? 999));
  const rows = [{ model: ep.meta.model, status: "done", xProg: 1, contacts: ep.meta.contacts, success: true, x: finalX, me: true }]
    .concat(rivals);
  const hex = (c) => `#${c.toString(16).padStart(6, "0")}`;
  for (const r of rows) {
    const row = document.createElement("div");
    const done = r.status === "done";
    row.className = `board-row${r.me ? " me" : ""}${r.success ? " ok" : ""}${done ? "" : " pending"}`;
    const sw = r.color != null ? `style="background:${hex(r.color)}"` : r.me ? "" : 'style="background:rgba(242,240,234,0.25)"';
    row.innerHTML = `<span class="name"><i class="sw" ${sw}></i>${r.model}</span><span class="corridor mini"></span>` +
      `<span class="pct">${done ? `${Math.round((r.xProg || 0) * 100)}%` : tr("running", "运行中")}</span>` +
      `<span class="hits">${done ? r.contacts : "–"}</span>`;
    ui.boardRows.appendChild(row);
    const dot = corridorMarks(row.querySelector(".corridor"));
    if (r.x != null) dot.style.left = xPct(r.x);
    else dot.remove();
    if (r.color != null) dot.style.background = hex(r.color);
  }
  if (live) describeRivals(section, ep.meta.model, rows);

  const timeline = $("hud-timeline");
  const ticks = ep.turns.map((t, i) => {
    const el = document.createElement("i");
    const hit = t.actions.some((a) => a.status === "blocked");
    const moved = t.actions.some((a) => (a.kind === "move" || a.kind === "rotate") && a.status !== "skipped");
    const last = i === ep.turns.length - 1;
    el.className = `tick k-${last ? "finish" : hit ? "reject" : moved ? "move" : "camera"}`;
    el.title = tr(`Turn ${t.turn}`, `第 ${t.turn} 轮`);
    timeline.appendChild(el);
    return el;
  });

  const frames = ep.turns.map((_, i) => `media/m1/eye/turn_${String(i + 1).padStart(3, "0")}.jpg`);
  frames.unshift("media/m1/eye/turn_000.jpg");
  let preloaded = false;
  const preload = () => { if (preloaded) return; preloaded = true; frames.forEach((src) => { new Image().src = src; }); };

  let shownTurn = -1, shownFrame = -1, shownChapter = -1;
  function setTurn(ti) {
    if (ti === shownTurn) return;
    shownTurn = ti;
    const t = ep.turns[ti];
    ticks.forEach((k, i) => { k.classList.toggle("past", i < ti); k.classList.toggle("now", i === ti); });
    ui.turn.textContent = String(t.turn).padStart(3, "0");
    ui.chips.innerHTML = t.actions.map((a) => {
      const cls = a.status === "skipped" ? "skipped" : a.status === "blocked" ? "blocked" : a.kind === "camera" ? "cam" : "move";
      const tag = a.status === "blocked" ? tr(" · blocked", " · 被挡住") : a.status === "skipped" ? tr(" · skipped", " · 跳过") : "";
      return `<code class="chip ${cls}">${a.label}${tag}</code>`;
    }).join("");
    ui.why.textContent = t.reason;
  }

  let target = 0, shown = 0, active = false, last = performance.now();
  const trigger = ScrollTrigger.create({
    trigger: section, start: "top top", end: "bottom bottom",
    onUpdate: (self) => { target = self.progress; },
  });
  target = shown = trigger.progress;
  new IntersectionObserver(([e]) => {
    active = e.isIntersecting;
    if (active) { last = performance.now(); preload(); }
  }, { rootMargin: "200px" }).observe(section);
  window.addEventListener("resize", () => { scene.resize(); scene.render(); });

  const hitSeg = segs.find((s) => s.a.status === "blocked");

  function stateAt(tau) {
    let pose = ep.scene.start, view = scene.startView, prevView = scene.startView;
    let looks = 0, moves = 0, hits = 0, dots = 0;
    for (const s of segs) {
      if (s.t0 > tau) break;
      const f = ease(clamp((tau - s.t0) / (s.t1 - s.t0)));
      const a = s.a;
      if (a.kind === "camera") {
        prevView = view;
        view = f >= 1 ? a.view : {
          eye: prevView.eye.clone().lerp(a.view.eye, f), target: prevView.target.clone().lerp(a.view.target, f),
        };
        if (f >= 1) { looks++; dots++; }
      } else if (a.before) {
        pose = f >= 1 ? a.after : interpPose(a, f);
        if (f >= 1) moves++;
        if (a.status === "blocked" && tau > s.t0 + 0.02) hits++;
      }
    }
    return { pose, view, looks, moves, hits, dots };
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!active) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    shown += (target - shown) * (1 - Math.exp(-dt * 7));
    if (Math.abs(target - shown) < 1e-5) shown = target;
    const p = shown;
    const tau = piecewise(TAU, p);
    const st = stateAt(tau);

    const [az, el, dist, tx, ty, follow] = camPose(p);
    const flash = hitSeg && tau > hitSeg.t0 + 0.02 && tau < 65.15 ? 1 : 0;
    const finale = smooth(0.82, 0.86, p);
    scene.update({
      R: st.pose.R, c: st.pose.c, flash, hitPanel: flash ? hitSeg.a.contact.panel : -1,
      agent: finale < 0.5 && p > 0.015 ? st.view : null, dotsShown: st.dots, dotFade: 1 - 0.7 * finale,
      ghosts: finale,
      cam: { az, el, dist, target: [tx + (st.pose.c[0] - tx) * follow, ty, 4] },
      markerScale: Math.max(1, dist / 16),
      shift: 1,
    });
    scene.render();

    const ti = clamp(Math.ceil(tau) - 1, 0, ep.turns.length - 1);
    setTurn(ti);
    ui.looks.textContent = st.looks;
    ui.moves.textContent = st.moves;
    ui.hits.textContent = st.hits;
    payloadDot.style.left = xPct(st.pose.c[0]);
    ui.fill.style.left = `${clamp(tau / ep.turns.length) * 100}%`;

    const fi = clamp(Math.floor(tau + 0.15), 0, ep.turns.length);
    if (fi !== shownFrame) {
      shownFrame = fi;
      ui.eyeImg.src = frames[fi];
      ui.eyeCap.textContent = fi === 0 ? tr("start", "开始") : tr(`after turn ${fi}`, `第 ${fi} 轮之后`);
    }

    let ch = 0;
    for (let i = 0; i < CHAPTER_START.length; i++) if (p >= CHAPTER_START[i]) ch = i;
    if (ch !== shownChapter) {
      shownChapter = ch;
      ui.chapters.forEach((c, i) => c.classList.toggle("on", i === ch));
    }
    ui.flash.style.opacity = (flash * (0.75 + 0.25 * Math.sin(now / 90))).toFixed(3);
    ui.eye.style.opacity = (1 - finale).toFixed(3);
    ui.meters.style.opacity = (1 - finale).toFixed(3);
    ui.board.style.opacity = finale.toFixed(3);
    ui.board.style.transform = `translateY(${(1 - finale) * 24}px)`;
    stage.classList.toggle("finale", finale > 0.5);
  }
  requestAnimationFrame(frame);
  setTurn(0);
}
