import { t, ZH } from "./i18n.js";

// Everything here is drawn from data/paper.json: the paper's tables and figures.
const CATS = ["B", "P", "M", "A", "V", "D"];
const CAT_SHORT = {
  B: t("Build", "搭建"), P: t("Puzzle", "解谜"), M: t("Manip.", "操控"),
  A: t("Assem.", "拼装"), V: t("Percep.", "感知"), D: t("Dyn.", "动态"),
};
const RUN_COLORS = { "Claude Opus 5.5": "#ff8a4c", "GPT-6 Astra": "#3ddc84", "Gemini 4 Argon": "#35c9e8" };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f1 = (v) => (v == null ? "—" : v.toFixed(1));
const W = 400;

let paper = null;
export function loadPaper() {
  if (!paper) paper = fetch("data/paper.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return paper;
}

/* ---------- Table 1: comparison with existing benchmarks ---------- */

const GROUPS = {
  qa: t("Spatial question answering", "空间视觉问答"),
  agent: t("Interactive agents, games and building", "交互式智能体、游戏与搭建"),
  spatial: t("Interactive spatial reasoning", "交互式空间推理"),
};
const MARK = { y: t("Yes", "支持"), n: t("No", "不支持"), p: t("Partial", "部分支持") };
const zhCount = (s) => s.replace(" tiers", " 档").replace(" levels", " 级").replace("Generative", "生成式").replace(" (procedural)", "（程序化）");

function renderBench(el, d) {
  const heads = [t("Closed-loop", "闭环"), t("Zero-privilege 3D", "零特权三维"), t("3D topology & statics", "三维拓扑与静力学"),
    t("Temporal strobe", "时序频闪"), t("Controlled diagnosis", "受控诊断")];
  let group = null, rows = "";
  for (const b of d.benchmarks) {
    if (b.group !== group && GROUPS[b.group]) rows += `<tr class="grp"><td colspan="10">${GROUPS[b.group]}</td></tr>`;
    group = b.group;
    const ours = b.group === "ours";
    const cite = ours ? t("ours", "本文") : b.cite;
    rows += `<tr class="${ours ? "us" : ""}"><th scope="row"><b>${esc(b.name)}</b><small>${esc(cite)}</small></th>`
      + `<td>${esc(ZH ? b.catZh : b.cat)}</td><td>${esc(ZH ? b.actionZh : b.action)}</td>`
      + `<td class="num">${esc(ZH ? zhCount(b.fam) : b.fam)}</td><td class="num">${esc(ZH ? zhCount(b.tasks) : b.tasks)}</td>`
      + [...b.marks].map((m) => `<td class="mk"><i class="${m}" title="${MARK[m]}"></i></td>`).join("") + "</tr>";
  }
  el.innerHTML = `<table class="bt"><thead><tr><th scope="col">${t("Benchmark", "基准")}</th><th scope="col">${t("Category", "类别")}</th>`
    + `<th scope="col">${t("Action level", "动作层级")}</th><th scope="col" class="num">${t("#Fam.", "题族")}</th><th scope="col" class="num">${t("#Tasks", "任务数")}</th>`
    + heads.map((h) => `<th scope="col" class="mk">${h}</th>`).join("") + `</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- Table 3 and Fig. 5b ---------- */

function renderTable3(el, d) {
  const best = {};
  ["score", "sr", ...CATS].forEach((k) => { best[k] = Math.max(...d.models.map((m) => (k.length === 1 ? m.cats[k] : m[k]))); });
  const cell = (v, k) => `<td class="c${v === best[k] ? " best" : ""}" style="--a:${(0.04 + 0.5 * (v / 100)).toFixed(3)}">${f1(v)}</td>`;
  const tiers = { lead: t("Leading tier", "第一梯队"), mid: t("Middle tier", "中间档"), low: t("Bottom tier", "末档") };
  let tier = null, rows = "";
  for (const m of d.models) {
    if (m.tier !== tier) rows += `<tr class="tier"><td colspan="12">${tiers[m.tier]}</td></tr>`;
    tier = m.tier;
    rows += `<tr><th scope="row">${esc(m.name)}</th>`
      + `<td class="score${m.score === best.score ? " best" : ""}">${f1(m.score)}<i style="width:${m.score}%"></i></td>`
      + `<td class="num${m.sr === best.sr ? " best" : ""}">${f1(m.sr)}</td>`
      + CATS.map((c) => cell(m.cats[c], c)).join("")
      + `<td class="num cost">${f1(m.turns)}</td><td class="num cost">${f1(m.coll)}</td><td class="num cost">${m.tokens.toFixed(2)}</td></tr>`;
  }
  rows += `<tr class="tier base"><td colspan="12">${t("Baselines and reference solver", "基线与参考求解器")}</td></tr>`;
  for (const b of d.baselines) {
    const cover = b.cover === "44/44" ? "" : ` <small>(${b.cover})</small>`;
    rows += `<tr class="baseline"><th scope="row">${esc(ZH ? b.nameZh : b.name)}${cover}</th><td class="score">${f1(b.score)}</td><td class="num">${f1(b.sr)}</td>`
      + CATS.map((c) => `<td class="c plain">${f1(b.cats[c])}</td>`).join("")
      + `<td class="num cost">${f1(b.turns)}</td><td class="num cost">—</td><td class="num cost">—</td></tr>`;
  }
  const catHead = CATS.map((c) => `<th scope="col" class="c">${CAT_SHORT[c]}<small>${d.catCounts[c]}</small></th>`).join("");
  el.innerHTML = `<table class="t3"><thead>
    <tr class="band"><th></th><th colspan="2">${t("Overall", "总体")}</th><th colspan="6">${t("Category success rate (%)", "类内通关率（%）")}</th><th colspan="3">${t("Per episode", "每局开销")}</th></tr>
    <tr><th scope="col">${t("Model", "模型")}</th><th scope="col">${t("Score", "得分")}</th><th scope="col" class="num">${t("SR %", "通关率 %")}</th>${catHead}
      <th scope="col" class="num">${t("Turns", "轮数")}</th><th scope="col" class="num">${t("Coll.", "碰撞")}</th><th scope="col" class="num">${t("Tokens (M)", "Token（M）")}</th></tr>
    </thead><tbody>${rows}</tbody></table>`;
}

function renderCurve(el, d) {
  const H = 260, L = 38, R = 92, T = 12, B = 34;
  const sx = (v) => L + (v / 100) * (W + 80 - L - R), sy = (v) => H - B - (v / 100) * (H - T - B);
  const total = d.tasks;
  let s = "";
  [0, 25, 50, 75, 100].forEach((v) => {
    s += `<line class="g" x1="${L}" x2="${W + 80 - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="t" x="${L - 7}" y="${sy(v) + 3}" text-anchor="end">${v}%</text>`;
    s += `<text class="t" x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`;
  });
  s += `<text class="al" x="${(L + W + 80 - R) / 2}" y="${H - 4}" text-anchor="middle">${t("turn budget", "轮数预算")}</text>`;
  const ordered = [...d.models].sort((a, b) => Boolean(RUN_COLORS[a.name]) - Boolean(RUN_COLORS[b.name]));
  for (const m of ordered) {
    let pts = `M${sx(0)},${sy(0)}`, n = 0;
    for (let turn = 1; turn <= 100; turn++) {
      const k = m.solveTurns.filter((x) => x === turn).length;
      if (k) { pts += `L${sx(turn)},${sy((100 * n) / total)}`; n += k; pts += `L${sx(turn)},${sy((100 * n) / total)}`; }
    }
    pts += `L${sx(100)},${sy((100 * n) / total)}`;
    const c = RUN_COLORS[m.name];
    s += `<path class="${c ? "run" : "o"}" d="${pts}"${c ? ` style="stroke:${c}"` : ""}><title>${esc(m.name)}: ${n}/${total}</title></path>`;
    if (c) s += `<text class="lbl" x="${sx(100) + 6}" y="${sy((100 * n) / total) + 4}" style="fill:${c}">${esc(m.short)}</text>`;
  }
  s += `<text class="lbl o" x="${sx(100) + 6}" y="${sy(30)}">${t("7 others", "其余 7 个")}</text>`;
  el.innerHTML = `<svg viewBox="0 0 ${W + 80} ${H}" role="img">${s}</svg>
    <figcaption>${t("Share of the 44 main-matrix instances solved within a given turn budget (paper Fig. 5b).", "在给定轮数预算内解出的主实验实例占比（论文图 5b）。")}</figcaption>`;
}

function renderNotes(el, d) {
  const rest = d.models.filter((m) => m.tier !== "lead");
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const ms = d.catMeanSr;
  el.innerHTML = [
    t(`<b>Three tiers.</b> Claude Opus 5.5 (79.1), GPT-6 Astra (65.0) and Gemini 4 Argon (42.1) lead; the other seven average ${mean(rest.map((m) => m.score)).toFixed(1)}. Models 4–7 score 19.5–29.0 and the last three 4.8–10.4.`,
      `<b>三档分明。</b>Claude Opus 5.5（79.1）、GPT-6 Astra（65.0）和 Gemini 4 Argon（42.1）领先，其余 7 个模型平均只有 ${mean(rest.map((m) => m.score)).toFixed(1)} 分；第 4–7 名在 19.5–29.0 之间，后三名在 4.8–10.4 之间。`),
    t(`<b>Hardest where geometry must come from pixels.</b> Mean success is ${ms.D}% on dynamics and ${ms.P}% on puzzles, but ${ms.M}% on 6-DoF manipulation and ${ms.V}% on multi-view perception. Seven of ten models solve at most 27.3% of manipulation tasks, and seven solve no perception task.`,
      `<b>最难的是要从像素里恢复几何的两类。</b>平均通关率在动态类是 ${ms.D}%，解谜类 ${ms.P}%，而六自由度操控只有 ${ms.M}%，多视图感知只有 ${ms.V}%。10 个模型中有 7 个在操控类的通关率不超过 27.3%，7 个在感知类一题未过。`),
    t("<b>No instance is solved by all ten</b>, and the opaque 4×4×4 gravity maze (P4-L5) by none. Every model scores above the random baseline (3.2), though the two weakest only match its 6.8% success rate.",
      "<b>没有任何实例被 10 个模型全部解出</b>，不透明的 4×4×4 重力迷宫（P4-L5）无人解出。所有模型的得分都高于随机基线（3.2），但最弱的两个模型通关率只与它持平（6.8%）。"),
  ].map((p) => `<p>${p}</p>`).join("");
}

/* ---------- controlled diagnostics (Table 4, Fig. 7, Table C.3) ---------- */

function diagBars(d) {
  const rows = d.diag.perModel;
  const H = 250, L = 30, R = 8, T = 30, B = 44, gap = 16;
  const inner = W + 160 - L - R, groupW = (inner - gap) / rows.length;
  const bw = (groupW - 12) / 3, sy = (v) => H - B - (v / 100) * (H - T - B);
  const conds = [["main", t("main", "主实验")], ["plan", "+plan"], ["state", "+state"]];
  let s = "";
  [0, 25, 50, 75, 100].forEach((v) => { s += `<line class="g" x1="${L}" x2="${W + 160 - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="t" x="${L - 6}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`; });
  conds.forEach(([k, label], i) => { s += `<rect class="b-${k}" x="${L + i * 90}" y="4" width="10" height="10" rx="2"/><text class="t" x="${L + 15 + i * 90}" y="13">${label}</text>`; });
  rows.forEach(([name, ...vals], gi) => {
    const x0 = L + gi * groupW + (gi >= 3 ? gap : 0) + 6;
    vals.forEach((v, i) => {
      const x = x0 + i * bw;
      s += `<rect class="b-${conds[i][0]}" x="${x}" y="${sy(v)}" width="${bw - 3}" height="${sy(0) - sy(v)}" rx="2"><title>${esc(name)} · ${conds[i][1]}: ${v}</title></rect>`;
      s += `<text class="v" x="${x + (bw - 3) / 2}" y="${sy(v) - 4}" text-anchor="middle">${Math.round(v)}</text>`;
    });
    s += `<text class="n" x="${x0 + (groupW - 12) / 2}" y="${H - B + 16}" text-anchor="middle">${esc(d.models.find((m) => m.name === name).short)}</text>`;
  });
  const split = L + 3 * groupW + gap / 2 + 3;
  s += `<line class="split" x1="${split}" x2="${split}" y1="${T - 6}" y2="${H - B + 4}"/>`;
  s += `<text class="al" x="${L + 1.5 * groupW}" y="${H - 8}" text-anchor="middle">${t("top three frontier models", "最强 3 个前沿模型")}</text>`;
  s += `<text class="al" x="${split + 2 * groupW + gap / 2}" y="${H - 8}" text-anchor="middle">${t("four further models (5th–8th)", "另外 4 个模型（第 5–8 名）")}</text>`;
  return `<svg viewBox="0 0 ${W + 160} ${H}" role="img">${s}</svg>`;
}

function renderDiag(el, d) {
  const g = d.diag, top = g.top3, add = g.add4;
  const arrow = (a, b) => `${f1(a)}<span class="to">→</span>${f1(b)}`;
  const abl = [
    ["blind", t("No images", "去掉图像"), t("text feedback only · top three · 5 instances", "只有文字反馈 · 最强 3 个模型 · 5 个实例"),
      t("Without pictures, models probe by collision: collisions rise about ninefold. Where a contact alone reveals the boundary (B1, M1, M3) they still solve 77.8%; where the global state must be seen (P2, B6), success falls from 83.3% to 16.7%.",
        "没有图像时，模型靠碰撞探路，碰撞增加约 9 倍。在仅凭碰撞就能摸出边界的题上（B1、M1、M3）通关率仍有 77.8%；在必须看到全局状态的题上（P2、B6），通关率从 83.3% 降到 16.7%。")],
    ["nocam", t("Camera locked", "锁住相机"), t("initial view only · top three · 8 occluded instances", "只能看初始视角 · 最强 3 个模型 · 8 个遮挡题"),
      t("Heavily occluded tasks need the model to move its own viewpoint: 14 of 19 pairs decline.", "遮挡严重的题离不开主动换视角：19 对里有 14 对下降。")],
    ["nonote", t("No persistent note", "去掉持久笔记"), t("all seven models · 6 L5 tasks", "全部 7 个模型 · 6 个 L5 题"),
      t("Without a scratchpad for ruler readings and plans, episodes run longer (60.1 → 67.5 turns) and collide more (14.6 → 17.8).", "没有记录标尺读数和计划的便签，对局更长（60.1 → 67.5 轮），碰撞更多（14.6 → 17.8）。")],
    ["nosplit", t("No split rollback view", "去掉分屏回滚图"), t("all seven models · 6 L5 tasks", "全部 7 个模型 · 6 个 L5 题"),
      t("Without the magenta/blue contact snapshot, collisions per episode rise by 59% (14.6 → 23.2): explicit contact localization keeps models from hitting the same wall blind.", "没有品红/亮蓝的接触快照，每局碰撞增加 59%（14.6 → 23.2）：明确标出接触位置，才能避免模型反复盲撞同一面墙。")],
  ];
  const short = Object.fromEntries(d.models.map((m) => [m.name, m.short]));
  const blind = g.blindColl.map(([n, a, b]) => `<div class="bc"><span>${esc(short[n] || n)}</span><i class="a" style="--w:${a}"></i><b>${a.toFixed(1)}</b><i class="b" style="--w:${b}"></i><b class="hot">${b.toFixed(1)}</b></div>`).join("");
  el.innerHTML = `
    <div class="dg-main">
      <figure class="dg-chart">${diagBars(d)}<figcaption>${t("Mean score on the eight L5 instances shared by +plan and +state (paper Fig. 7a, Table C.3; Claude Opus 5.5 over its six complete pairs).", "+plan 与 +state 共用的 8 个 L5 实例上的平均分（论文图 7a、表 C.3；Claude Opus 5.5 取其 6 对完整对局）。")}</figcaption></figure>
      <div class="dg-stats">
        <div class="dg-stat state"><p class="k">+state · ${t("exact 3D state every turn", "每轮给精确三维状态")}</p>
          <p class="big">${arrow(top.state.score[0], top.state.score[1])}</p>
          <p>${t(`Closes <b>${top.state.gap}%</b> of the remaining gap for the top three (18 pairs up, 0 down); collisions fall from ${top.state.coll[0]} to <b>${top.state.coll[1]}</b> per episode and episodes get about seven times shorter.`,
            `为最强 3 个模型弥补了剩余差距的 <b>${top.state.gap}%</b>（18 对上升、0 对下降）；每局碰撞从 ${top.state.coll[0]} 次降到 <b>${top.state.coll[1]}</b> 次，对局缩短约 7 倍。`)}</p></div>
        <div class="dg-stat plan"><p class="k">+plan · ${t("reference high-level plan", "参考高层计划")}</p>
          <p class="big">${arrow(top.plan.score[0], top.plan.score[1])}</p>
          <p>${t(`Closes only <b>${top.plan.gap}%</b> (10 up, 8 down), and collisions do not move at all: ${top.plan.coll[0]} → <b>${top.plan.coll[1]}</b>.`,
            `只弥补了 <b>${top.plan.gap}%</b>（10 对上升、8 对下降），碰撞次数纹丝不动：${top.plan.coll[0]} → <b>${top.plan.coll[1]}</b>。`)}</p></div>
        <div class="dg-stat more"><p class="k">${t("four further models · ranked 5th–8th", "另外 4 个模型 · 第 5–8 名")}</p>
          <p>${t(`+state lifts them from ${add.state.score[0]} to <b>${add.state.score[1]}</b> (Qwen 3.8 Max reaches 92.2) and cuts collisions from ${add.state.coll[0]} to ${add.state.coll[1]}; +plan reaches only <b>${add.plan.score[1]}</b>, and collisions rise to ${f1(add.plan.coll[1])} as they push toward a known goal without accurate coordinates.`,
            `+state 让它们从 ${add.state.score[0]} 分升到 <b>${add.state.score[1]}</b> 分（Qwen 3.8 Max 达到 92.2），碰撞从 ${add.state.coll[0]} 次降到 ${add.state.coll[1]} 次；+plan 只到 <b>${add.plan.score[1]}</b> 分，碰撞反而升到 ${f1(add.plan.coll[1])} 次：没有准确坐标，知道目标也只能硬闯。`)}</p></div>
      </div>
    </div>
    <div class="dg-abl">${abl.map(([k, title, sub, text]) => {
      const r = g[k];
      return `<article class="dg-card"><p class="k">${title}</p><p class="sub">${sub}</p>
        <p class="big">${arrow(r.score[0], r.score[1])}<span class="u">${t("score", "得分")}</span></p>
        <p class="coll">${t("collisions", "碰撞")} ${arrow(r.coll[0], r.coll[1])}</p>
        ${k === "blind" ? `<div class="blind">${blind}</div>` : ""}<p>${text}</p></article>`;
    }).join("")}</div>
    <p class="dg-take">${t("Every intervention points the same way: hand models the 3D state and they solve nearly everything; hand them the plan, and they still hit the same walls.",
      "所有干预都指向同一个方向：给模型三维状态，它们几乎全部解出；只给计划，它们照样撞同一面墙。")}</p>`;
}

/* ---------- findings ---------- */

function card(el, { chart, big, bigNote, title, text, link }) {
  el.innerHTML = `<div class="fx-chart">${chart}</div>
    <div class="fx-body">
      <p class="fx-big">${big}<span>${bigNote}</span></p>
      <h3>${title}</h3><p>${text}</p>
      ${link ? `<a class="fx-link" href="${link.href}"${link.open ? ` data-open="${link.open}"` : ""}${link.key ? ` data-key="${link.key}"` : ""}>${link.label} →</a>` : ""}
    </div>`;
}

function leverChart(levers) {
  const H = 252, L = 34, R = 10, T = 34, B = 40;
  const n = levers.length, inner = W - L - R, step = (inner - 24) / n;
  const sy = (v) => H - B - (v / 70) * (H - T - B);
  let s = "";
  [0, 20, 40, 60].forEach((v) => { s += `<line class="g" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="t" x="${L - 6}" y="${sy(v) + 3}" text-anchor="end">${v}</text>`; });
  levers.forEach((l, i) => {
    const x = L + 12 + i * step + step / 2 + (l.cat === "D" ? 24 : 0);
    const cls = l.l7 < l.l5 ? "lo" : "hi";
    s += `<line class="lnk" x1="${x}" x2="${x}" y1="${sy(l.l5)}" y2="${sy(l.l7)}"/>`;
    s += `<circle class="o" cx="${x}" cy="${sy(l.l5)}" r="5"><title>${l.family} L5: ${l.l5}</title></circle>`;
    s += `<circle class="${cls}" cx="${x}" cy="${sy(l.l7)}" r="5"><title>${l.family} L7: ${l.l7}</title></circle>`;
    s += `<text class="n" x="${x}" y="${H - B + 15}" text-anchor="middle">${l.family}</text>`;
    s += `<text class="t" x="${x}" y="${H - B + 28}" text-anchor="middle">${l.s5}→${l.s7}</text>`;
  });
  const split = L + 12 + 6 * step + 12;
  s += `<line class="split" x1="${split}" x2="${split}" y1="${T}" y2="${H - B + 4}"/>`;
  s += `<circle class="o" cx="${L + 6}" cy="6" r="4.5"/><text class="t" x="${L + 15}" y="10">L5</text>`;
  s += `<circle class="lo" cx="${L + 46}" cy="6" r="4.5"/><text class="t" x="${L + 55}" y="10">${t("L7, lower", "L7，更低")}</text>`;
  s += `<circle class="hi" cx="${L + 132}" cy="6" r="4.5"/><text class="t" x="${L + 141}" y="10">${t("L7, higher", "L7，更高")}</text>`;
  s += `<text class="al" x="${W - R}" y="10" text-anchor="end">${t("score · solved L5→L7", "平均分 · 解出 L5→L7")}</text>`;
  s += `<text class="al" x="${L + 12}" y="28">${t("spatial · perception and frame levers", "空间题族 · 感知与坐标系杠杆")}</text>`;
  s += `<text class="al" x="${split + 8}" y="28">${t("temporal", "时序")}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

function loopChart(beh) {
  const rows = [...beh].sort((a, b) => b.repeatHit - a.repeatHit);
  const L = 70, mid = 236, R = 34, T = 26, step = 20, H = T + rows.length * step + 22;
  const sx = (v) => L + (v / 0.7) * (mid - 16 - L), bx = (v) => (v / 100) * (W - R - mid);
  let s = `<text class="al" x="${L}" y="10">${t("camera share of actions", "相机动作占比")}</text>`;
  s += `<circle class="win" cx="${L + 4}" cy="20" r="4"/><text class="t" x="${L + 11}" y="23">${t("solved", "解出局")}</text>`;
  s += `<circle class="hit" cx="${L + 70}" cy="20" r="4"/><text class="t" x="${L + 77}" y="23">${t("unsolved", "未解出局")}</text>`;
  s += `<text class="al" x="${W}" y="10" text-anchor="end">${t("repeat collisions", "碰撞后再撞")}</text>`;
  rows.forEach((r, i) => {
    const y = T + i * step + step / 2 + 6;
    s += `<text class="n" x="0" y="${y + 4}">${esc(r.short)}</text>`;
    if (r.camSolved != null && r.camUnsolved != null) {
      s += `<line class="lnk2" x1="${sx(r.camSolved / 100)}" x2="${sx(r.camUnsolved / 100)}" y1="${y}" y2="${y}"/>`;
      s += `<circle class="win" cx="${sx(r.camSolved / 100)}" cy="${y}" r="4.2"><title>${esc(r.name)}: ${r.camSolved.toFixed(0)}% ${t("when solved", "解出局")}</title></circle>`;
      s += `<circle class="hit" cx="${sx(r.camUnsolved / 100)}" cy="${y}" r="4.2"><title>${esc(r.name)}: ${r.camUnsolved.toFixed(0)}% ${t("when unsolved", "未解出局")}</title></circle>`;
    } else {
      s += `<text class="t" x="${L}" y="${y + 3}">${t("no unsolved batched episode", "没有未解出的批量协议对局")}</text>`;
    }
    s += `<rect class="bf" x="${mid}" y="${y - 6}" width="${bx(100)}" height="12" rx="3"/><rect class="bm" x="${mid}" y="${y - 6}" width="${bx(r.repeatHit)}" height="12" rx="3"/>`;
    s += `<text class="t v" x="${mid + bx(r.repeatHit) + 5}" y="${y + 4}">${Math.round(r.repeatHit)}%</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

const MODE_NAMES = {
  "collision loop": t("collision loop", "碰撞循环"), "observation loop": t("observation loop", "观察循环"), stalled: t("stalled", "停滞"),
  "near miss": t("near miss", "差一点"), "early stop": t("early stop", "提前结束"), irreversible: t("irreversible", "不可逆失误"),
};
const MODE_CLASS = ["m-coll", "m-obs", "m-stall", "m-near", "m-early", "m-irr"];
const GROUP_NAMES = {
  Construction: t("Construction", "搭建"), Puzzles: t("Puzzles", "解谜"), "6-DoF manip.": t("6-DoF manip.", "六自由度操控"),
  Assembly: t("Assembly", "拼装"), Perception: t("Perception", "感知"), Dynamics: t("Dynamics", "动态"),
};

function modeChart(f) {
  const L = 104, R = 10, T = 36, step = 26, H = T + f.byCategory.length * step + 6;
  const w = W * 2 - L - R;
  let s = "", lx = L;
  f.modes.forEach((m, i) => { s += `<rect class="${MODE_CLASS[i]}" x="${lx}" y="4" width="10" height="10" rx="2"/><text class="t" x="${lx + 14}" y="13">${MODE_NAMES[m]}</text>`; lx += 30 + MODE_NAMES[m].length * (ZH ? 11 : 6.2); });
  f.byCategory.forEach((r, i) => {
    const y = T + i * step;
    s += `<text class="n" x="0" y="${y + 13}">${GROUP_NAMES[r.group] || r.group} <tspan class="t">(${r.n})</tspan></text>`;
    let x = L;
    r.counts.forEach((c, j) => {
      const ww = (c / r.n) * w;
      if (ww > 0) s += `<rect class="${MODE_CLASS[j]}" x="${x}" y="${y}" width="${Math.max(0, ww - 1.5)}" height="18" rx="2"><title>${MODE_NAMES[f.modes[j]]}: ${c} / ${r.n}</title></rect>`;
      if (ww > 26) s += `<text class="in" x="${x + ww / 2}" y="${y + 13}" text-anchor="middle">${Math.round((100 * c) / r.n)}%</text>`;
      x += ww;
    });
  });
  return `<svg viewBox="0 0 ${W * 2} ${H}" role="img">${s}</svg>`;
}

function renderFindings(fx, d) {
  const sp = d.levers.filter((l) => l.cat !== "D"), tm = d.levers.filter((l) => l.cat === "D");
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const [s5, s7] = [mean(sp.map((l) => l.l5)), mean(sp.map((l) => l.l7))];
  const [t5, t7] = [mean(tm.map((l) => l.l5)), mean(tm.map((l) => l.l7))];
  const drop = Math.round(100 * (1 - s7 / s5));
  card(fx.querySelector('[data-fx="levers"]'), {
    chart: leverChart([...sp, ...tm]),
    big: `−${drop}%`, bigNote: t("spatial score at level 7", "L7 空间题均分"),
    title: t("Perception levers hurt. Hidden physics doesn't.", "感知杠杆伤得重，隐藏物理却不。"),
    text: t(`In the six spatial families, level 7's perception and coordinate-frame levers cut the mean score from ${s5.toFixed(1)} to ${s7.toFixed(1)}, and outside the top three, 0 of 42 level-7 episodes were solved. In D3 and D5, where level 7 only hides a physical change, the mean holds (${t5.toFixed(1)} → ${t7.toFixed(1)}): models probe and adapt. The task and its plan never change, so the drop is the cost of 3D grounding.`,
      `在 6 个空间题族里，L7 的感知与坐标系杠杆把平均分从 ${s5.toFixed(1)} 压到 ${s7.toFixed(1)}；前三名之外的模型在 42 局 L7 里一局没解出。D3 和 D5 的 L7 只是悄悄改了物理参数，平均分却没降（${t5.toFixed(1)} → ${t7.toFixed(1)}）：模型会探测并适应。题目和解法本身没变，所以这部分下降纯粹是三维定位的代价。`),
    link: { href: "#more", open: "d2", label: t("Watch M4 at level 7", "看 L7 的 M4") },
  });
  const rh = d.behaviour.map((b) => b.repeatHit);
  card(fx.querySelector('[data-fx="loops"]'), {
    chart: loopChart(d.behaviour),
    big: `${Math.round(Math.min(...rh))}–${Math.round(Math.max(...rh))}%`, bigNote: t("of collisions are followed by another", "的碰撞紧接着再撞一次"),
    title: t("Failing runs look more and learn less.", "失败局看得更多，学到的更少。"),
    text: t("In 8 of 9 models, unsolved episodes spend a larger share of actions on the camera (0.30–0.55, against 0.08–0.34 when solved): failing agents keep hunting for a view instead of testing a hypothesis. And although the split screen marks the contact, 44%–71% of collisions are followed by another on the very next turn; even GPT-6 Astra, the lowest, repeats 44% of the time.",
      "9 个模型中有 8 个，未解出局里相机动作的占比更高（0.30–0.55，解出局为 0.08–0.34）：失败的智能体一直在找视角，而不是提出并检验假设。分屏图明明标出了接触位置，可 44%–71% 的碰撞之后，下一轮又会再撞；最低的 GPT-6 Astra 也有 44%。"),
    link: { href: "#more", open: "d7", key: "d7q", label: t("Watch Qwen's 93 collisions on D7", "看 Qwen 在 D7 上的 93 次碰撞") },
  });
  const f = d.failures, all = f.byCategory.reduce((a, r) => a + r.n, 0);
  const share = (j) => Math.round((100 * f.byCategory.reduce((a, r) => a + r.counts[j], 0)) / all);
  const m6 = f.byCategory.find((r) => r.group.startsWith("6-DoF"));
  const manip = Math.round((100 * (m6.counts[0] + m6.counts[1])) / m6.n);
  card(fx.querySelector('[data-fx="modes"]'), {
    chart: modeChart(f),
    big: `${share(0) + share(1)}%`, bigNote: t(`of ${all} unsolved episodes end in a loop`, `的未解出对局（共 ${all} 局）陷入循环`),
    title: t("Loops, not wrong plans.", "败在循环，不在计划。"),
    text: t(`Each unsolved batched-protocol episode gets one behavioral label. Collision loops (${share(0)}%) and observation loops (${share(1)}%) dominate, reaching ${manip}% in 6-DoF manipulation, while only ${share(5)}% end in an irreversible planning error. Mechanism synthesis is the exception: 86% of its 14 failures stall without looping, because the hard part there is the design itself.`,
      `每个未解出的批量协议对局都打上一个行为标签。碰撞循环（${share(0)}%）和观察循环（${share(1)}%）占了大头，在六自由度操控里达到 ${manip}%；死于不可逆规划失误的只有 ${share(5)}%。机构综合是例外：它的 14 个失败局里 86% 是没有循环的停滞，难点在机构设计本身。`),
    link: { href: "#run", label: t("Watch M1, where eight of ten stopped at the walls", "看 M1：10 个模型里 8 个停在墙前") },
  });
}

/* ---------- entry ---------- */

export async function initPaper(lenis) {
  const d = await loadPaper();
  if (!d) return;
  const go = (href) => {
    const el = document.querySelector(href);
    if (el) lenis ? lenis.scrollTo(el, { duration: 1.6 }) : el.scrollIntoView({ behavior: "smooth" });
  };
  const bt = document.getElementById("bt");
  if (bt) renderBench(bt, d);
  const t3 = document.getElementById("t3");
  if (t3) renderTable3(t3, d);
  const curve = document.getElementById("r-curve");
  if (curve) renderCurve(curve, d);
  const notes = document.getElementById("r-notes");
  if (notes) renderNotes(notes, d);
  const dg = document.getElementById("dg");
  if (dg) renderDiag(dg, d);
  const fx = document.getElementById("findings");
  if (fx) renderFindings(fx, d);
  document.querySelectorAll(".lv-tabs button[data-lever]").forEach((b) => {
    const r = d.leverAblation[b.dataset.lever];
    const em = b.querySelector("em");
    if (!r || !em) return;
    const dv = r.delta;
    em.textContent = `${dv > 0 ? "+" : "−"}${Math.abs(dv).toFixed(1)}`;
    em.className = dv > 0 ? "up" : "down";
  });
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest(".fx-link");
    if (!a) return;
    ev.preventDefault();
    const card = a.dataset.open && document.querySelector(`.case-card[data-case="${a.dataset.open}"]`);
    if (card) card.dispatchEvent(new CustomEvent("open-run", { detail: a.dataset.key || card.dataset.case }));
    else go(a.getAttribute("href"));
  });
}
