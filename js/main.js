import { initCases } from "./case-section.js";
import { createWall } from "./hero-wall.js";
import { initHow } from "./how-section.js";
import { applyLang, restoreScroll } from "./i18n.js";
import { initRun } from "./m1-section.js";
import { initPaper } from "./paper-sections.js";

applyLang();

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// One clock for everything: Lenis smooth scroll is advanced by the GSAP ticker and feeds ScrollTrigger.
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

document.querySelectorAll('a[href^="#"]:not([aria-disabled])').forEach((a) => {
  a.addEventListener("click", (e) => {
    const el = document.querySelector(a.getAttribute("href"));
    if (!el) return;
    e.preventDefault();
    lenis ? lenis.scrollTo(el, { duration: 1.6 }) : el.scrollIntoView({ behavior: "smooth" });
  });
});
document.querySelectorAll('[aria-disabled="true"]').forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));

// nav: frosted after the first screen; hidden while scrolling down and for the whole pinned replay
const nav = document.querySelector(".nav");
const replays = [...document.querySelectorAll(".run")];
let lastY = 0;
function syncNav(y) {
  const inReplay = replays.some((el) => y > el.offsetTop - 2 && y < el.offsetTop + el.offsetHeight - window.innerHeight);
  nav.classList.toggle("scrolled", y > 40);
  nav.classList.toggle("hide", inReplay || (y > window.innerHeight * 0.8 && y > lastY));
  lastY = y;
}
ScrollTrigger.create({ start: 0, end: "max", onUpdate: (self) => syncNav(self.scroll()) });
syncNav(window.scrollY);

// hero: the wall of tasks behind the title
const title = document.querySelector(".title");
title.innerHTML = [..."SpaceAct"].map((c, i) => `<span class="ch${i >= 5 ? " acc" : ""}">${c}</span>`).join("");
const videos = [...document.querySelectorAll(".hero video")];
createWall(document.querySelector(".hero-mosaic"));

const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
intro
  .from(".wall", { opacity: 0, duration: 1.2, ease: "power1.out" }, 0)
  .from(".hero .eyebrow", { opacity: 0, y: 12, duration: 0.8 }, 0.2)
  .from(".title .ch", { yPercent: 110, opacity: 0, duration: 1.1, stagger: 0.045 }, 0.25)
  .from([".lede", ".sub", ".authors", ".author-notes", ".cta"], { opacity: 0, y: 22, duration: 0.9, stagger: 0.1 }, 0.7)
  .from(".stats li", { opacity: 0, y: 16, duration: 0.7, stagger: 0.07 }, 1.0)
  .from(".scroll-hint", { opacity: 0, duration: 0.8 }, 1.5);
document.querySelectorAll(".stats b[data-count]").forEach((b) => {
  const o = { v: 0 };
  intro.to(o, { v: Number(b.dataset.count), duration: 1.6, ease: "power2.out", onUpdate: () => { b.textContent = Math.round(o.v); } }, 1.0);
});
const skipIntro = () => { if (intro.progress() < 1) intro.progress(1); };
if (reduceMotion || window.scrollY > 50) skipIntro();
["wheel", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, skipIntro, { once: true, passive: true }));

videos.forEach((v) => { v.play().catch(() => {}); });
new IntersectionObserver(([e]) => {
  videos.forEach((v) => (e.isIntersecting ? v.play().catch(() => {}) : v.pause()));
}).observe(document.getElementById("hero"));

gsap.to(".hero-content", {
  yPercent: -22, opacity: 0, ease: "none",
  scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: true },
});
gsap.to(".hero-mosaic", {
  scale: 1.12, opacity: 0.25, ease: "none",
  scrollTrigger: { trigger: "#hero", start: "top top", end: "bottom top", scrub: true },
});

document.querySelectorAll(".sec-head").forEach((head) => {
  gsap.from(head.children, {
    opacity: 0, y: 30, duration: 0.9, stagger: 0.1, ease: "power3.out",
    scrollTrigger: { trigger: head, start: "top 80%" },
  });
});
gsap.from(".how-grid .how-card", {
  opacity: 0, y: 40, duration: 0.9, stagger: 0.08, ease: "power3.out",
  scrollTrigger: { trigger: ".how-grid", start: "top 85%" },
});
gsap.from(".sapa-steps li", {
  opacity: 0, y: 24, duration: 0.8, stagger: 0.1, ease: "power3.out",
  scrollTrigger: { trigger: ".sapa", start: "top 85%" },
});
gsap.from(".fact", {
  opacity: 0, y: 30, duration: 0.8, stagger: 0.08, ease: "power3.out",
  scrollTrigger: { trigger: ".cmp-facts", start: "top 88%" },
});
gsap.from(".case-card", {
  opacity: 0, y: 36, duration: 0.85, stagger: 0.07, ease: "power3.out",
  scrollTrigger: { trigger: ".case-cards", start: "top 85%" },
});

initCases(lenis);
initHow();
const reveal = (sel, trigger, from) => document.querySelector(sel) && gsap.from(sel, {
  ...from, ease: "power3.out", scrollTrigger: { trigger, start: "top 82%" },
});
const results = initPaper(lenis).then(() => {
  reveal(".bt tbody tr", ".bt", { opacity: 0, y: 14, duration: 0.5, stagger: 0.03 });
  reveal(".t3 tbody tr", ".t3", { opacity: 0, x: -16, duration: 0.6, stagger: 0.03 });
  reveal(".dg-stat, .dg-card", ".dg", { opacity: 0, y: 30, duration: 0.8, stagger: 0.08 });
  reveal(".fx-card", ".fx-grid", { opacity: 0, y: 40, duration: 0.9, stagger: 0.1 });
});
Promise.all([results, initRun(ScrollTrigger)]).then(() => {
  ScrollTrigger.refresh();
  restoreScroll(lenis);
  if (window.scrollY > 50) skipIntro();
});
