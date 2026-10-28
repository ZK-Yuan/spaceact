import * as THREE from "three";
import { createCaseScene } from "./case-scene.js";
import { t as tr } from "./i18n.js";
import { bakedSource, createMirrorScene } from "./mirror-scene.js";
import { interpPose } from "./m1-section.js";
import { caseRows } from "./results-data.js";

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = (t) => t * t * (3 - 2 * t);
const PLAY = [0.04, 0.84];
const pad3 = (n) => String(n).padStart(3, "0");
const live = (a) => a.status === "done" || a.status === "blocked";
/** Pages whose clock never moves (D7): the replay steps through saved states instead of sim time. */
const isStatic = (data) => Boolean(data.page && data.page.static);
const frameTurn = (name) => Number(name.slice(5, 8));
const SEE_THROUGH = {
  // the screen in front of D7's hidden wire, and its frame
  shadow_mirror_lv: (o) => (o.geometry && o.geometry.type === "BoxGeometry" && Math.abs(o.position.z - 1.41) < 0.03
    && o.geometry.parameters.height > 1.4 ? 0.14 : null),
};
const PAIR_COLORS = ["#ff8a4c", "#d9b48f"];

const HUD = `
  <div class="hud">
    <div class="hud-id"><span class="dot"></span><b class="c-model"></b><span class="c-task"></span></div>
    <div class="hud-turn"><span>${tr("TURN", "轮次")}</span><b class="c-turn">000</b><span>/ 100</span></div>
    <figure class="eye"><div class="eye-view"></div>
      <figcaption><span class="rec"></span><b>${tr("What the model saw", "模型看到的画面")}</b><span class="c-eye">${tr("start", "开始")}</span></figcaption></figure>
    <div class="hud-action"><div class="chips c-chips"></div><p class="why c-why"></p></div>
    <div class="hud-meters">
      <div class="counters">
        <div class="ctr az"><b class="c-looks">0</b><span>${tr("looks", "观察")}</span></div>
        <div class="ctr gold"><b class="c-moves">0</b><span>${tr("actions", "动作")}</span></div>
        <div class="ctr mag"><b class="c-hits">0</b><span class="c-hits-l">${tr("collisions", "碰撞")}</span></div>
      </div>
      <div class="pbar"><i class="c-prog"></i><span class="c-prog-l">${tr("progress", "进度")}</span><b class="c-progv">0%</b></div>
    </div>
    <div class="hud-timeline c-timeline"><div class="fill c-fill"></div></div>
  </div>
  <div class="c-labels"></div>
  <p class="lineup-title">${tr("Same chasm · every scored bridge, strongest first", "同一道深谷 · 每座计分的桥，按承重从高到低")}</p>
  <div class="board c-board">
    <div class="board-head"><span class="c-board-title"></span><span>${tr("turns · collisions", "轮数 · 碰撞")}</span></div>
    <div class="c-rows"></div>
  </div>
  <div class="pair c-pair" hidden>
    <div class="pair-pick c-pick" role="group" aria-label="${tr("Choose a run", "选择一局")}"></div>
    <figure class="pair-chart"><div class="c-curve"></div>
      <figcaption>${tr("progress along the wire per turn · gray: other models", "每轮沿导线的进度 · 灰色：其他模型")}</figcaption></figure>
  </div>`;

/** Per-turn weights on the playback clock: look-only turns are brief, turns that change the world get room. */
function buildClock(data) {
  const temporal = data.kind === "temporal" && !isStatic(data);
  const spans = data.turns.map((t) => {
    if (temporal) return 0.6 + Math.max(0, (t.t_after ?? 0) - (t.t_before ?? 0)) / 3;
    const acts = t.actions.filter((a) => live(a) && a.kind !== "camera").length;
    return acts ? 1 + 0.45 * (acts - 1) : 0.45;
  });
  const cum = [0];
  spans.forEach((w) => cum.push(cum[cum.length - 1] + w));
  const segs = [];
  data.turns.forEach((t, ti) => {
    const acts = t.actions.filter(live);
    const span = 0.8 / Math.max(1, acts.length);
    acts.forEach((a, j) => segs.push({ a, ti, t0: ti + 0.15 + j * span, t1: ti + 0.15 + (j + 1) * span }));
  });
  return { cum, total: cum[cum.length - 1], segs };
}

const rowsToQuat = (M) => new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().set(M[0][0], M[0][1], M[0][2], 0, M[1][0], M[1][1], M[1][2], 0, M[2][0], M[2][1], M[2][2], 0, 0, 0, 0, 1));
function quatToRows(q) {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
  return [[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]];
}

export function initCases(lenis) {
  const player = document.getElementById("player");
  const stage = player.querySelector(".stage");
  stage.insertAdjacentHTML("beforeend", HUD);
  const $ = (c) => stage.querySelector(c);
  const playBtn = player.querySelector(".pc-play");
  const cache = new Map();
  let cur = null;

  const load = (key) => {
    if (!cache.has(key)) cache.set(key, fetch(`data/cases/${key}.json`, { cache: "no-cache" }).then((r) => r.json()));
    return cache.get(key);
  };

  /** `key` picks one run of a paired card (D7: Claude or Qwen on the same instance). */
  async function open(card, key = card.dataset.case) {
    const switching = Boolean(cur && cur.card === card);
    if (cur) close(switching);
    cur = { card, key, target: 0, shown: 0, playing: true, last: performance.now(), shownTurn: -1, shownFrame: "", view: null, sim: null };
    const c = cur;
    player.hidden = false;
    document.documentElement.classList.add("player-open");
    if (lenis) lenis.stop();
    $(".chapter").innerHTML = card.querySelector("template").innerHTML;
    if (!switching) player.querySelector(".player-close").focus({ preventScroll: true });
    const keys = card.dataset.pair ? [card.dataset.case, card.dataset.pair] : [key];
    const [data, ...rest] = await Promise.all([key, ...keys.filter((k) => k !== key)].map(load));
    if (cur !== c) return;
    c.data = data;
    c.clock = buildClock(data);
    c.duration = clamp(c.clock.total * 1.25, 12, 42) / (PLAY[1] - PLAY[0]);
    data.frames.forEach((n) => { new Image().src = `media/cases/${key}/${n}.jpg`; });
    $(".c-model").textContent = data.model;
    $(".c-task").textContent = card.dataset.label;
    $(".c-hits-l").textContent = data.kind === "temporal" && !isStatic(data) ? tr("sim seconds", "模拟秒数")
      : data.key === "h1" ? tr("rollbacks", "回滚") : tr("collisions", "碰撞");
    buildPair(c, keys, rest[0]);
    $(".c-prog-l").textContent = data.key === "h1" ? tr("best load vs 1,800 g target", "最佳承重 / 目标 1,800 g") : tr("progress", "进度");
    const tl = $(".c-timeline");
    tl.querySelectorAll(".tick").forEach((k) => k.remove());
    data.turns.forEach((t, i) => {
      const k = document.createElement("i");
      const hit = t.actions.some((a) => a.status === "blocked");
      const moved = t.actions.some((a) => live(a) && a.kind !== "camera");
      k.className = `tick k-${i === data.turns.length - 1 && data.success ? "finish" : hit ? "reject" : moved ? "move" : "camera"}`;
      tl.appendChild(k);
    });
    if (data.kind === "snap") {
      c.keyframes = [data.scene.start];
      for (const s of c.clock.segs) if (s.a.ids && s.a.kind !== "camera") c.keyframes.push(s.a.ids);
    }
    if (data.kind === "maze") {
      const { center, n, cell } = data.scene;
      c.ballPos = (b) => [0, 1, 2].map((i) => center[i] + (b[i] + 0.5 - n / 2) * cell);
    }
    makeView(c);
    buildBoard(c);
    requestAnimationFrame(frame);
  }

  function close(switching = false) {
    if (!cur) return;
    const c = cur;
    cur = null;
    if (c.view) { c.view.dispose(); stage.querySelector(".case-canvas")?.remove(); }
    const simEl = c.sim && (c.sim.frame || c.sim.img);
    if (simEl) simEl.remove();
    $(".eye-view").innerHTML = "";
    clearTimeout(c.simTimer);
    $(".c-labels").innerHTML = "";
    stage.classList.remove("finale", "lineup");
    if (switching) return;
    $(".c-pair").hidden = true;
    player.hidden = true;
    document.documentElement.classList.remove("player-open");
    if (lenis) lenis.start();
    c.card.focus({ preventScroll: true });
  }

  /** Paired cards: a switch between the two runs and both progress curves over the other models' in gray. */
  function buildPair(c, keys, other) {
    const box = $(".c-pair");
    box.hidden = keys.length < 2;
    if (box.hidden) return;
    const { data } = c;
    const runs = keys.map((k) => (k === c.key ? data : other));
    const peak = (d) => Math.max(0, ...d.turns.map((t) => t.progress || 0));
    $(".c-pick").innerHTML = runs.map((d, i) => {
      const sub = d.success ? tr(`solved · ${d.turns_used} turns · ${d.contacts} collisions`, `解出 · ${d.turns_used} 轮 · 碰撞 ${d.contacts} 次`)
        : tr(`stuck at ${Math.round(peak(d) * 100)}% · ${d.contacts} collisions`, `停在 ${Math.round(peak(d) * 100)}% · 碰撞 ${d.contacts} 次`);
      return `<button type="button" data-key="${keys[i]}" class="${keys[i] === c.key ? "on" : ""}" style="--c:${PAIR_COLORS[i]}"><b>${d.model}</b><small>${sub}</small></button>`;
    }).join("");
    $(".c-pick").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.key !== c.key && cur === c) open(c.card, b.dataset.key);
    }));
    const W = 300, H = 168, L = 26, R = 8, T = 10, B = 22;
    const sx = (v) => L + (v / 100) * (W - L - R), sy = (v) => H - B - v * (H - T - B);
    const path = (pts) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join("");
    const curveOf = (d) => [[0, 0], ...d.turns.map((t) => [t.turn, t.progress || 0])];
    const named = new Set(runs.map((d) => d.model));
    let s = "";
    [0, 0.5, 1].forEach((v) => { s += `<line class="g" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="t" x="${L - 5}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`; });
    [0, 50, 100].forEach((v) => { s += `<text class="t" x="${sx(v)}" y="${H - 6}" text-anchor="middle">${v}</text>`; });
    for (const o of data.others) if (o.curve && !named.has(o.model)) s += `<path class="o" d="${path(o.curve.map((p, i) => [i + 1, p]))}"/>`;
    runs.forEach((d, i) => { s += `<path class="run${keys[i] === c.key ? " now" : ""}" style="stroke:${PAIR_COLORS[i]}" d="${path(curveOf(d))}"/>`; });
    const me = PAIR_COLORS[keys.indexOf(c.key)];
    s += `<line class="cur c-cur" y1="${T}" y2="${H - B}" x1="${L}" x2="${L}"/><circle class="c-dot" r="4" cx="${L}" cy="${sy(0)}" style="fill:${me}"/>`;
    $(".c-curve").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
    c.pair = { sx, sy, cur: $(".c-cur"), dot: $(".c-dot"), pts: curveOf(data) };
  }

  /** The other models on this instance: live rows from the results file when the card names its task, else the
   *  rows baked in at build time. Bridge loads and lineup colours only exist in the baked rows. */
  async function rivals(c) {
    const { data, card } = c;
    const baked = data.others.map((o) => ({ ...o, status: "done" }));
    const live = card.dataset.task ? await caseRows(card.dataset.task) : null;
    if (!live) return baked;
    const byName = new Map(data.others.map((o) => [o.model, o]));
    return live.filter((r) => r.name !== data.model).map((r) => {
      const b = byName.get(r.name) || {};
      return { model: r.name, status: r.status, success: r.success, turns: r.turns, contacts: r.contacts,
        progress: data.me_value ? b.progress : r.progress, value: b.value, color: b.color,
        noBridge: Boolean(data.me_value) && !b.value && r.status === "done" };
    });
  }

  async function buildBoard(c) {
    const { data, card } = c;
    $(".c-board-title").textContent = card.dataset.boardTitle || `${data.task_id} · ${tr("same instance", "同一实例")}`;
    const others = await rivals(c);
    if (cur !== c) return;
    const load = (r) => (r.value ? Number(r.value.split("g")[0].replace(/[^\d.]/g, "")) : -1);
    others.sort((a, b) => (a.status !== "done") - (b.status !== "done")
      || (data.me_value ? load(b) - load(a) : (b.success ? 1 : 0) - (a.success ? 1 : 0) || (b.progress || 0) - (a.progress || 0)));
    const rows = [{ model: data.model, status: "done", success: data.success, turns: data.turns_used, contacts: data.contacts,
      progress: data.me_progress ?? (data.success ? 1 : null), value: data.me_value, me: true }].concat(others);
    $(".c-rows").innerHTML = rows.map((r) => {
      const done = r.status === "done";
      const pct = !done ? 0 : r.value ? Math.round((r.progress || 0) * 100) : r.success ? 100 : Math.round((r.progress || 0) * 100);
      const sw = r.color ? ` style="background:#${r.color.toString(16).padStart(6, "0")}"`
        : r.me ? "" : ' style="background:rgba(242,240,234,0.25)"';
      const text = !done ? tr("running", "运行中") : r.noBridge ? tr("no bridge", "没搭成桥")
        : r.value || (r.success ? tr("solved", "解出") : `${pct}%`);
      return `<div class="board-row${r.me ? " me" : ""}${done ? "" : " pending"}"><span class="name"><i class="sw"${sw}></i>${r.model}</span>` +
        `<span class="pbar mini"><i style="width:${pct}%"></i></span><span class="pct${r.success ? " ok" : ""}">${text}</span>` +
        `<span class="hits">${done ? `${r.turns ?? "–"} · ${r.contacts ?? "–"}` : "–"}</span></div>`;
    }).join("");
    $(".c-board").classList.toggle("wide", Boolean(data.me_value));
  }

  function makeView(c) {
    const { data } = c;
    if (data.kind === "temporal") {
      // the public site ships without the benchmark pages and mirrors a baked copy of the run instead
      const src = `bench/temporal/${data.page.name}.html`;
      c.sim = { frame: null, bench: null, t: -1 };
      fetch(src, { method: "HEAD" }).then((r) => r.ok, () => false).then((live) => {
        if (cur !== c) return;
        if (!live) { replayBaked(c); return; }
        const frame = document.createElement("iframe");
        frame.className = "sim-src";
        frame.setAttribute("aria-hidden", "true");
        frame.tabIndex = -1;
        frame.src = `${src}?bench=1${data.page.query}`;
        stage.appendChild(frame);
        c.sim.frame = frame;
        frame.addEventListener("load", () => replayTemporal(c, frame));
        c.simTimer = setTimeout(() => { if (cur === c && !c.sim.bench) strobeFallback(c); }, 8000);
      });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.className = "case-canvas";
    stage.insertBefore(canvas, stage.firstChild);
    c.view = createCaseScene(canvas, data, { keyframes: c.keyframes, glowThin: c.card.dataset.glow === "1" });
    if (c.view.hasLineup) {
      $(".c-labels").innerHTML = data.scene.lineup.map((e) =>
        `<div class="lu${e.me ? " me" : ""}"><b>${e.model}</b><span class="${e.success ? "ok" : "no"}">${e.load.toLocaleString("en-US", { maximumFractionDigits: 0 })} g</span><em>${e.mass.toFixed(0)} g · ${e.parts} ${tr("parts", "块")}</em></div>`).join("");
    }
  }

  async function replayTemporal(c, frame) {
    const w = frame.contentWindow;
    for (let i = 0; i < 150 && !(w.game && w.game.benchReady); i++) await new Promise((r) => setTimeout(r, 100));
    const bench = w.game && w.game.bench;
    if (!bench || cur !== c || !w.__benchScenes) return;
    bench.preroll(c.data.page.preroll);
    // static pages: one saved state after every action, and where each blocked move stopped
    const cps = [bench.checkpoint()], hits = [], hitsUpTo = [0];
    let mismatches = 0;
    for (const t of c.data.turns) for (const a of t.actions) if (live(a)) {
      // finish() ends the episode in the harness; the page itself has no such action
      if (a.kind !== "finish" && bench.act(a.raw).status !== a.status) mismatches++;
      if (isStatic(c.data)) {
        cps.push(bench.checkpoint());
        if (a.status === "blocked") hits.push(bench.info().pos);
        hitsUpTo.push(hits.length);
      }
    }
    player.dataset.replaySuccess = String(Boolean(bench.status().success));
    player.dataset.replayMismatches = String(mismatches);
    const canvas = document.createElement("canvas");
    canvas.className = "case-canvas";
    stage.insertBefore(canvas, stage.firstChild);
    c.view = createMirrorScene(canvas, w.__benchScenes[0], { seeThrough: SEE_THROUGH[c.data.page.name] });
    c.sim.bench = bench;
    if (isStatic(c.data)) Object.assign(c.sim, { cps, hitsUpTo, k: -1, marks: c.view.markers(hits, { color: 0xff5a5a }) });
  }

  /** Same replay as replayTemporal, posed from data/cases/<key>.mirror.json (tools/bake_mirror.py) instead of the live page. */
  async function replayBaked(c) {
    const b = await fetch(`data/cases/${c.key}.mirror.json`).then((r) => (r.ok ? r.json() : null), () => null);
    const src = b && await bakedSource(b);
    if (cur !== c) return;
    if (!src) { strobeFallback(c); return; }
    src.frame(0);
    const canvas = document.createElement("canvas");
    canvas.className = "case-canvas";
    stage.insertBefore(canvas, stage.firstChild);
    c.view = createMirrorScene(canvas, src.scene, { seeThrough: (o) => o.userData.glass ?? null });
    const nearest = (t) => {
      let lo = 0, hi = src.times.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (src.times[mid] <= t) lo = mid; else hi = mid; }
      return Math.abs(src.times[hi] - t) < Math.abs(src.times[lo] - t) ? hi : lo;
    };
    c.sim.bench = { showAt: (t) => src.frame(nearest(t)), rollback: (k) => src.frame(k) };
    if (isStatic(c.data)) {
      Object.assign(c.sim, { cps: Array.from({ length: src.frames }, (_, k) => k), hitsUpTo: src.hitsUpTo, k: -1,
        marks: c.view.markers(src.hits, { color: 0xff5a5a }) });
    }
  }

  /** The recorded strobe frames stand in when neither the live page nor a baked copy can be shown (e.g. no WebGL context left). */
  function strobeFallback(c) {
    if (c.sim.frame) c.sim.frame.remove();
    const img = document.createElement("img");
    img.className = "sim sim-frames";
    img.alt = "";
    stage.insertBefore(img, stage.firstChild);
    const shots = [];
    if (isStatic(c.data)) c.data.frames.forEach((n) => shots.push({ turn: frameTurn(n), src: `media/cases/${c.key}/${n}.jpg` }));
    else c.data.turns.forEach((t) => (t.frame_times || []).forEach((tt, k) => shots.push({ t: tt, src: `media/cases/${c.key}/turn_${pad3(t.turn)}_${k + 1}.jpg` })));
    c.sim = { img, shots, src: "" };
  }

  function stateAt(c, tau) {
    const { data, clock } = c;
    let pose = data.scene && data.scene.start, from = c.keyframes && c.keyframes[0], to = from, f = 1, flash = false;
    let M = data.kind === "maze" ? data.scene.start[0] : null, balls = data.kind === "maze" ? data.scene.start[1] : null;
    let looks = 0, moves = 0, hits = 0, ki = 0, simT = null, done = 0;
    for (const s of clock.segs) {
      if (s.t0 > tau) break;
      const g = ease(clamp((tau - s.t0) / (s.t1 - s.t0)));
      const a = s.a;
      if (g >= 1) done++;
      if (a.kind === "finish") continue;
      if (a.kind === "camera") { if (g >= 1) looks++; continue; }
      if (g >= 1) moves++;
      if (a.status === "blocked") { hits++; if (tau < s.ti + 1) flash = true; }
      if (data.kind === "pose" && a.before) pose = g >= 1 ? a.after : interpPose(a, g);
      if (data.kind === "snap" && a.ids) { from = c.keyframes[ki]; ki++; to = c.keyframes[ki]; f = g; }
      if (data.kind === "maze" && a.before) {
        const rot = clamp(g / 0.55), fall = clamp((g - 0.55) / 0.45);
        M = quatToRows(rowsToQuat(a.before[0]).slerp(rowsToQuat(a.after[0]), ease(rot)));
        balls = a.before[1].map((b, i) => b.map((v, j) => v + (a.after[1][i][j] - v) * ease(fall)));
      }
    }
    if (data.kind === "temporal" && !isStatic(data)) {
      const ti = Math.min(data.turns.length - 1, Math.floor(tau));
      const t = data.turns[ti];
      simT = tau <= 0 ? data.turns[0].t_before : t.t_before + (t.t_after - t.t_before) * clamp(tau - ti);
    }
    return { pose, from, to, f, flash, M, balls, looks, moves, hits, simT, done };
  }

  function setTurn(c, ti) {
    if (ti === c.shownTurn) return;
    c.shownTurn = ti;
    const t = c.data.turns[ti];
    stage.querySelectorAll(".tick").forEach((k, i) => { k.classList.toggle("past", i < ti); k.classList.toggle("now", i === ti); });
    $(".c-turn").textContent = pad3(t.turn);
    $(".c-chips").innerHTML = t.actions.map((a) => {
      const cls = a.status === "skipped" ? "skipped" : a.status === "blocked" ? "blocked" : a.kind === "camera" ? "cam" : "move";
      const tag = a.status === "blocked" ? tr(" · blocked", " · 被挡住") : a.status === "skipped" ? tr(" · skipped", " · 跳过") : "";
      return `<code class="chip ${cls}">${a.label}${tag}</code>`;
    }).join("") || `<code class="chip skipped">${tr("no valid action", "无有效动作")}</code>`;
    $(".c-why").textContent = t.reason;
    const p = t.progress ?? 0;
    $(".c-prog").style.width = `${clamp(p) * 100}%`;
    $(".c-progv").textContent = t.best_load != null ? `${Math.round(t.best_load).toLocaleString("en-US")} g` : `${Math.round(p * 100)}%`;
  }

  function setFrame(c, k) {
    const names = c.data.frames;
    let src, cap;
    if (isStatic(c.data)) {
      let best = names[0];
      for (const n of names) if (frameTurn(n) <= k) best = n;
      src = `media/cases/${c.key}/${best}.jpg`;
      cap = k === 0 ? tr("start", "开始") : tr(`after turn ${frameTurn(best)}`, `第 ${frameTurn(best)} 轮之后`);
    } else if (c.data.kind === "temporal") {
      const j = Math.floor(performance.now() / 380) % 5 + 1;
      src = `media/cases/${c.key}/turn_${pad3(k)}_${j}.jpg`;
      cap = tr(`strobe ${j}/5 · ${k === 0 ? "before turn 1" : `after turn ${k}`}`, `频闪 ${j}/5 · ${k === 0 ? "第 1 轮之前" : `第 ${k} 轮之后`}`);
    } else {
      let best = names[0];
      for (const n of names) if (Number(n.slice(5)) <= k) best = n;
      src = `media/cases/${c.key}/${best}.jpg`;
      cap = k === 0 ? tr("start", "开始") : tr(`after turn ${k}`, `第 ${k} 轮之后`);
    }
    if (src === c.shownFrame) return;
    c.shownFrame = src;
    const holder = $(".eye-view");
    (holder.querySelector("img") || holder.appendChild(document.createElement("img"))).src = src;
    $(".c-eye").textContent = cap;
  }

  function tauToP(c, tau) {
    const ti = clamp(Math.floor(tau), 0, c.data.turns.length - 1);
    const cc = c.clock.cum[ti] + (c.clock.cum[ti + 1] - c.clock.cum[ti]) * clamp(tau - ti);
    return PLAY[0] + (PLAY[1] - PLAY[0]) * (cc / c.clock.total);
  }

  function frame(now) {
    const c = cur;
    if (!c || !c.data) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - c.last) / 1000);
    c.last = now;
    if (c.playing) {
      c.target = Math.min(1, c.target + dt / c.duration);
      if (c.target >= 1) c.playing = false;
    }
    playBtn.textContent = c.playing ? tr("❚❚ pause", "❚❚ 暂停") : c.target >= 1 ? tr("↺ replay", "↺ 重播") : tr("▶ play", "▶ 播放");
    c.shown += (c.target - c.shown) * (1 - Math.exp(-dt * 14));
    if (Math.abs(c.target - c.shown) < 1e-5) c.shown = c.target;
    const p = c.shown, { data, clock } = c;
    const cc = clock.total * clamp((p - PLAY[0]) / (PLAY[1] - PLAY[0]));
    let ti = 0;
    while (ti < data.turns.length - 1 && clock.cum[ti + 1] <= cc) ti++;
    const tau = ti + clamp((cc - clock.cum[ti]) / (clock.cum[ti + 1] - clock.cum[ti]));
    c.tau = tau;
    const st = stateAt(c, tau);
    const finale = smooth(0.86, 0.92, p);

    if (c.sim && c.sim.bench && st.simT != null && Math.abs(st.simT - c.sim.t) > 0.01) {
      c.sim.t = st.simT;
      c.sim.bench.showAt(st.simT);
      c.view.sync();
    }
    if (c.sim && c.sim.cps && st.done !== c.sim.k) {
      c.sim.k = Math.min(st.done, c.sim.cps.length - 1);
      c.sim.bench.rollback(c.sim.cps[c.sim.k]);
      c.view.sync();
      c.sim.marks.show(c.sim.hitsUpTo[c.sim.k]);
    }
    if (c.pair) {
      const x = c.pair.sx(clamp(tau, 0, 100));
      let p = 0;
      for (const [turn, v] of c.pair.pts) if (turn <= tau) p = v;
      c.pair.cur.setAttribute("x1", x); c.pair.cur.setAttribute("x2", x);
      c.pair.dot.setAttribute("cx", x); c.pair.dot.setAttribute("cy", c.pair.sy(p));
    }
    if (c.view) {
      const [az0, az1, el, dist] = (c.card.dataset.orbit || "-30,10,28,1.05").split(",").map(Number);
      const wide = c.view.hasLineup ? finale : 0;
      c.view.update({ R: st.pose && st.pose.R, c: st.pose && st.pose.c, flash: st.flash, ghosts: finale, lineup: wide,
        from: st.from, to: st.to, f: st.f, M: st.M, balls: st.balls && st.balls.map(c.ballPos) });
      const az = az0 + (az1 - az0) * smooth(0, 1, p);
      c.view.setCamera({ az: az + (-6 - az) * wide, el: el + (40 - el) * wide, dist: dist * (1 + 0.08 * finale) * (1 - 0.18 * wide), wide, shift: 1 - wide });
      c.view.render();
      if (c.view.hasLineup) {
        const nodes = $(".c-labels").children;
        c.view.labels().forEach((l, i) => {
          const n = nodes[i];
          n.style.opacity = l.on ? String(clamp((wide - 0.6) * 4)) : "0";
          n.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)`;
        });
      }
    }
    if (c.sim && c.sim.shots && (st.simT != null || isStatic(data))) {
      let best = c.sim.shots[0];
      for (const s of c.sim.shots) if (isStatic(data) ? s.turn <= tau : s.t <= st.simT + 1e-6) best = s;
      if (best && best.src !== c.sim.src) { c.sim.src = best.src; c.sim.img.src = best.src; }
    }
    setTurn(c, ti);
    setFrame(c, clamp(Math.floor(tau + 0.15), 0, data.turns.length));
    $(".c-looks").textContent = st.looks;
    $(".c-moves").textContent = st.moves;
    $(".c-hits").textContent = data.kind === "temporal" && !isStatic(data) ? (st.simT ?? 0).toFixed(1) : st.hits;
    $(".c-fill").style.left = `${clamp(tau / data.turns.length) * 100}%`;
    stage.querySelector(".stage-flash").style.opacity = st.flash ? (0.75 + 0.25 * Math.sin(now / 90)).toFixed(3) : "0";
    const board = c.view && c.view.hasLineup ? 0 : finale;
    $(".c-board").style.opacity = board.toFixed(3);
    $(".c-board").style.transform = `translateY(${(1 - board) * 24}px)`;
    stage.classList.toggle("finale", finale > 0.5);
    stage.classList.toggle("lineup", Boolean(c.view && c.view.hasLineup && finale > 0.5));
  }

  // ---------------------------------------------------------------- controls
  const scrubTo = (p) => { if (!cur || !cur.data) return; cur.playing = false; cur.target = clamp(p); };
  playBtn.addEventListener("click", () => {
    if (!cur || !cur.data) return;
    if (cur.target >= 1) { cur.target = cur.shown = 0; cur.playing = true; } else cur.playing = !cur.playing;
  });
  player.querySelector(".player-close").addEventListener("click", () => close());
  player.addEventListener("wheel", (e) => { e.preventDefault(); if (cur) scrubTo(cur.target + e.deltaY * 0.0004); }, { passive: false });
  const tl = $(".c-timeline");
  const fromX = (e) => {
    const r = tl.getBoundingClientRect();
    return PLAY[0] + (PLAY[1] - PLAY[0]) * clamp((e.clientX - r.left) / r.width);
  };
  tl.addEventListener("pointerdown", (e) => { tl.setPointerCapture(e.pointerId); scrubTo(fromX(e)); });
  tl.addEventListener("pointermove", (e) => { if (tl.hasPointerCapture(e.pointerId)) scrubTo(fromX(e)); });
  document.addEventListener("keydown", (e) => {
    if (!cur) return;
    if (e.key === "Escape") close();
    else if (e.key === " ") { e.preventDefault(); playBtn.click(); }
    else if (cur.data && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      const step = e.key === "ArrowRight" ? 1 : -1;
      scrubTo(tauToP(cur, Math.floor(cur.tau ?? 0) + step + 0.9));
    }
  });
  window.addEventListener("resize", () => cur && cur.view && cur.view.resize());

  document.querySelectorAll(".case-card").forEach((card) => {
    card.addEventListener("click", () => open(card));
    card.addEventListener("open-run", (e) => open(card, e.detail || card.dataset.case));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(card); } });
  });
}
