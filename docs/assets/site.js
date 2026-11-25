// Shared page furniture for the symbolic docs: the contents column, the theme
// switch and the code boxes. Add each topic page to PAGES as it is written.

import * as A from "./symbolic.js?v=b1c6b6b38b";
import { mountRunboxes } from "./runbox.js?v=b1c6b6b38b";

export { A };

export const PAGES = [
  { href: "index.html", title: "Overview" },
  { href: "reference.html", title: "Reference" },
  { href: "explore.html", title: "Explore" },
  // { group: "Topics" },
  // { href: "topic.html", title: "A topic", blurb: "One line about it" },
];

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};

// ---- chrome -------------------------------------------------------------------

function theme() {
  let saved = null;
  try {
    saved = localStorage.getItem("ratmath-theme");
  } catch {
    /* storage may be blocked */
  }
  const apply = (t) => {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("ratmath-theme", t);
    } catch {
      /* ignore */
    }
    for (const b of document.querySelectorAll(".theme button")) b.classList.toggle("on", b.dataset.t === t);
  };
  if (saved) apply(saved);
  return h("div", { class: "theme", role: "group", "aria-label": "Theme" },
    ["auto", "light", "dark"].map((t) => h("button", { "data-t": t, class: (saved ?? "auto") === t ? "on" : "", onclick: () => apply(t) }, t)));
}

function chrome() {
  const here = location.pathname.split("/").pop() || "index.html";
  const aside = document.querySelector("aside");
  if (!aside) return;
  const nav = h("nav", { class: "toc", "aria-label": "Contents" });
  const sel = h("select", { id: "toc-select", "aria-label": "Page", onchange: (e) => (location.href = e.target.value) });
  let group = null;
  for (const p of PAGES) {
    if (p.group) {
      nav.append(h("div", { class: "group" }, p.group));
      group = h("optgroup", { label: p.group });
      sel.append(group);
      continue;
    }
    nav.append(h("a", { href: p.href, class: p.href === here ? "on" : null, "aria-current": p.href === here ? "page" : null }, p.title));
    (group ?? sel).append(h("option", { value: p.href, selected: p.href === here }, p.title));
  }
  aside.append(
    h("header", { class: "brand" }, h("a", { href: "index.html" }, h("div", { class: "mark" }, "RatMath ", h("span", {}, "symbolic"))), h("small", {}, "Rewriting, solving and closed forms")),
    sel, nav, theme(),
  );
}

/** Topic cards for the overview page (pages that have a blurb). */
export function topicCards(el) {
  el.append(...PAGES.filter((p) => p.blurb).map((p) => h("a", { href: p.href }, h("strong", {}, p.title), h("span", {}, p.blurb))));
}

chrome();
mountRunboxes(document, { scope: A });
