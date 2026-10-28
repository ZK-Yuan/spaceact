const fill = (pattern, n) => pattern.replace(/%(0?)(\d*)d/, (_, z, w) => String(n).padStart(z ? Number(w) : 0, "0"));

/** Runs `tick` every `ms` while `el` is on screen. */
function whileVisible(el, ms, tick) {
  let timer = 0;
  new IntersectionObserver(([e]) => {
    clearInterval(timer);
    if (e.isIntersecting) timer = setInterval(tick, ms);
  }, { threshold: 0.2 }).observe(el);
}

function preload(srcs) {
  srcs.forEach((s) => { const i = new Image(); i.src = s; });
}

function initFlip(fig) {
  const { flip, from, to, ms } = fig.dataset;
  const img = fig.querySelector("img");
  const label = fig.querySelector(".how-tag b");
  const frames = [];
  for (let n = Number(from); n <= Number(to); n++) frames.push(n);
  let i = 0, loaded = false;
  whileVisible(fig, Number(ms) || 420, () => {
    if (!loaded) { preload(frames.map((n) => fill(flip, n))); loaded = true; }
    i = (i + 1) % frames.length;
    img.src = fill(flip, frames[i]);
    if (label) label.textContent = String(frames[i]).padStart(3, "0");
  });
}

function initStrobe(fig) {
  const srcs = [1, 2, 3, 4, 5].map((n) => fill(fig.dataset.strobe, n));
  const img = fig.querySelector("img");
  const strip = fig.querySelector(".strip");
  strip.innerHTML = srcs.map((s, j) => `<img src="${s}" alt="" loading="lazy" data-j="${j}">`).join("");
  const thumbs = [...strip.children];
  let j = 0;
  const show = () => {
    img.src = srcs[j];
    thumbs.forEach((t, k) => t.classList.toggle("on", k === j));
  };
  show();
  thumbs.forEach((t, k) => t.addEventListener("mouseenter", () => { j = k; show(); }));
  whileVisible(fig, 520, () => { j = (j + 1) % srcs.length; show(); });
}

function initLevers(card) {
  const img = card.querySelector(".lv-img");
  const text = card.querySelector(".lv-text");
  const desc = card.querySelector(".lv-desc");
  const tabs = [...card.querySelectorAll(".lv-tabs button")];
  preload(tabs.map((t) => t.dataset.img).filter(Boolean));
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.toggle("on", t === tab));
    text.hidden = !tab.dataset.text;
    if (tab.dataset.img) img.src = tab.dataset.img;
    desc.textContent = tab.querySelector("span").textContent;
  }));
}

export function initHow() {
  document.querySelectorAll(".how-fig.flip").forEach(initFlip);
  document.querySelectorAll(".how-fig.strobe").forEach(initStrobe);
  document.querySelectorAll(".how-card.levers").forEach(initLevers);
}
