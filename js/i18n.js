// The language is picked by the inline script in <head> (?lang=, then the saved choice, else English) so the page
// can stay hidden until it is translated. English lives in the markup; Chinese sits next to it in data-zh (inner HTML)
// and data-zh-<attr> (any attribute, e.g. data-zh-aria-label, data-zh-data-label).
const STORE = "spaceact-lang";
const SCROLL = "spaceact-scroll";

export const ZH = document.documentElement.dataset.lang === "zh";
export const t = (en, zh) => (ZH ? zh : en);

function translate(root) {
  root.querySelectorAll("*").forEach((el) => {
    for (const { name, value } of [...el.attributes]) {
      if (name === "data-zh") el.innerHTML = value;
      else if (name.startsWith("data-zh-")) el.setAttribute(name.slice(8), value);
    }
  });
}

export function applyLang() {
  if (ZH) {
    translate(document);
    document.querySelectorAll("template").forEach((tpl) => translate(tpl.content));
    document.title = "SpaceAct — 通过闭环行动评测三维空间与时间推理";
  }
  document.querySelectorAll(".lang-toggle").forEach((btn) => btn.addEventListener("click", () => {
    const next = ZH ? "en" : "zh";
    try {
      localStorage.setItem(STORE, next);
      sessionStorage.setItem(SCROLL, String(window.scrollY));
    } catch { /* private mode: the URL still carries the choice */ }
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    location.replace(url);
  }));
  document.documentElement.classList.remove("i18n-pending");
}

/** After a language switch, return to roughly where the reader was. */
export function restoreScroll(lenis) {
  let y = null;
  try {
    y = sessionStorage.getItem(SCROLL);
    sessionStorage.removeItem(SCROLL);
  } catch { /* ignore */ }
  if (y == null) return;
  window.scrollTo(0, Number(y));
  if (lenis) lenis.scrollTo(Number(y), { immediate: true });
}
