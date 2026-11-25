// Runnable code boxes for the RatMath docs sites.
//
// Every docs page ends with an editable JavaScript box. Run evaluates the
// code with the library in scope, shows the value of the last expression,
// and shows each PRINT(...) line above it. TEX(latex) typesets a line of
// math (KaTeX is loaded only then). The same file is shared verbatim by
// core, analytic, linalg and algebraic (docs/assets/runbox.js): keep the
// copies in sync.
//
// The evaluator (runCode, lastExpression, show) has no DOM use, so the
// docs tests run every page's box in Bun.

export const KATEX_BASE = "https://ratmath.com/assets/katex/0.19.1/";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const NAME = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await arguments eval".split(" "));
const STATEMENT = /^\s*(?:const|let|var|function|async\s+function|class|if|for|while|do|switch|try|throw|return|break|continue|import|export)\b/;

function compiles(src) {
  try {
    new AsyncFunction(src);
    return true;
  } catch {
    return false;
  }
}

/** Blank out import/export-from lines (the library is already in scope), keeping line numbers. */
export function stripImports(code) {
  return code
    .replace(/^[ \t]*import\b[^;]*?\bfrom\s*["'][^"']*["'];?[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^[ \t]*import\s*["'][^"']*["'];?[ \t]*$/gm, "");
}

function dropSemicolon(text) {
  return text.replace(/;(\s*(?:\/\/[^\n]*)?\s*)$/, "$1");
}

/**
 * Split code into statements before the last expression and the expression
 * itself: { head, expr }, or { head: code, expr: null } when the code does
 * not end in an expression (a declaration, a loop, a PRINT-only block ...).
 */
export function lastExpression(code) {
  const lines = code.replace(/\s+$/, "").split("\n");
  let end = lines.length;
  while (end > 0 && /^\s*(?:\/\/.*)?$/.test(lines[end - 1])) end--;
  for (let k = end - 1; k >= 0; k--) {
    const head = lines.slice(0, k).join("\n");
    const tail = lines.slice(k, end).join("\n");
    // The last line may hold several statements: try each split at a ';'.
    const tries = [["", tail]];
    if (k === end - 1) {
      for (let i = tail.length - 1; i >= 0; i--) if (tail[i] === ";" && tail.slice(i + 1).trim() && !/^\s*\/\//.test(tail.slice(i + 1))) tries.push([tail.slice(0, i + 1), tail.slice(i + 1)]);
    }
    for (const [lead, t] of tries) {
      const expr = dropSemicolon(t);
      if (!expr.trim() || STATEMENT.test(expr) || /^\s*[{}]/.test(expr)) continue;
      const before = head + (lead ? `\n${lead}` : "");
      if (!compiles(before)) continue;
      if (compiles(`${before}\nreturn (\n${expr}\n);`)) return { head: before, expr };
    }
  }
  return { head: code, expr: null };
}

function typeName(v) {
  if (v === null || typeof v !== "object") return "";
  const c = v.constructor;
  if (!c || c === Object || c === Array) return "";
  return c.name || "";
}

/**
 * A readable one-value display, REPL style. Library values use their own
 * toString. format(value) may return a string for values it knows (a site's
 * own display of intervals, say), or undefined; it applies at every depth.
 */
export function show(v, depth = 0, format) {
  if (format && v !== null && typeof v === "object") {
    const custom = format(v, depth);
    if (custom !== undefined) return custom;
  }
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return depth ? JSON.stringify(v) : v;
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "symbol") return String(v);
  if (typeof v === "function") return v.name ? `[function ${v.name}]` : "[function]";
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (depth > 4) return "…";
  if (Array.isArray(v) && (v.constructor === Array || v.toString === Array.prototype.toString)) {
    const items = v.slice(0, 200).map((x) => show(x, depth + 1, format));
    return `[${items.join(", ")}${v.length > 200 ? `, … ${v.length - 200} more` : ""}]`;
  }
  if (typeof v.toString === "function" && v.toString !== Object.prototype.toString) {
    try {
      const s = v.toString();
      if (typeof s === "string" && s !== "[object Object]") return s;
    } catch {
      /* fall through */
    }
  }
  if (v instanceof Map) return `Map(${v.size}) {${[...v].slice(0, 50).map(([k, x]) => `${show(k, depth + 1, format)} => ${show(x, depth + 1, format)}`).join(", ")}}`;
  if (v instanceof Set) return `Set(${v.size}) {${[...v].slice(0, 50).map((x) => show(x, depth + 1, format)).join(", ")}}`;
  if (ArrayBuffer.isView(v)) return `${typeName(v)} [${Array.from(v).slice(0, 50).join(", ")}]`;
  const keys = Object.keys(v);
  const inner = keys.slice(0, 40).map((k) => `${NAME.test(k) ? k : JSON.stringify(k)}: ${show(v[k], depth + 1, format)}`);
  if (keys.length > 40) inner.push(`… ${keys.length - 40} more`);
  return `${typeName(v) ? `${typeName(v)} ` : ""}{${inner.length ? ` ${inner.join(", ")} ` : ""}}`;
}

function shortQ(q, digits = 24) {
  const s = q.toString();
  if (s.length <= 48 || typeof q.toDecimal !== "function") return s;
  return `${q.toDecimal(digits)}…`;
}

/**
 * Display for RatMath values that are hard to read with toString alone:
 * intervals with huge endpoints (shown in compact decimal notation), very long
 * fractions (a decimal with "…"; the value itself stays exact), and
 * Refinements (the quick preview, and how to get the certified answer).
 */
export function ratmathFormat(v, depth = 0) {
  if (depth > 0 && typeof v.toStrings === "function" && Number.isInteger(v.rows) && Number.isInteger(v.cols)) {
    return `[${v.toStrings().map((row) => `[${row.join(", ")}]`).join(", ")}]`; // a matrix inside a structure, on one line
  }
  if (typeof v.compactedDecimalInterval === "function" && v.low && v.high) {
    if (v.low.compareTo(v.high) === 0) return shortQ(v.low);
    if (v.toString().length <= 48) return undefined;
    try {
      const c = String(v.compactedDecimalInterval());
      if (c.length <= 90) return c;
    } catch {
      /* fall through */
    }
    return `[${shortQ(v.low, 16)}, ${shortQ(v.high, 16)}]`;
  }
  if (typeof v.numerator === "bigint" && typeof v.denominator === "bigint") {
    const s = shortQ(v);
    return s === v.toString() ? undefined : s;
  }
  if (typeof v.stages === "function" && typeof v.exact === "function" && "quick" in v) {
    const q = v.quick;
    const val = q && "value" in q ? show(q.value, 1, ratmathFormat) : show(q, 1, ratmathFormat);
    return `Refinement { quick: ${val}${q?.trust ? ` (${q.trust})` : ""} } (.exact() gives the certified answer)`;
  }
  return undefined;
}

/**
 * Run code with `scope` names in scope. Returns { value, hasValue, type,
 * prints, error, ms }; prints are { kind: "text" | "tex", text, display }.
 * Promises (and anything with .then) are awaited.
 */
export async function runCode(code, scope = {}, { format } = {}) {
  const names = Object.keys(scope).filter((n) => NAME.test(n) && !RESERVED.has(n) && n !== "PRINT" && n !== "TEX");
  const prints = [];
  const both = (x, depth) => {
    const custom = format ? format(x, depth) : undefined;
    return custom === undefined ? ratmathFormat(x, depth) : custom;
  };
  const fmt = (x) => show(x, 0, both);
  const PRINT = (...args) => {
    prints.push({ kind: "text", text: args.map((a) => (typeof a === "string" ? a : fmt(a))).join(" ") });
  };
  const TEX = (latex, display = true) => {
    prints.push({ kind: "tex", text: String(latex), display });
  };
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const out = { value: undefined, hasValue: false, type: "", prints, error: null, ms: 0 };
  try {
    const src = stripImports(code);
    const { head, expr } = lastExpression(src);
    // The code runs in a block, so its own declarations may reuse library names.
    const body = `"use strict";\n{\n${head}\n${expr === null ? "" : `return (\n${expr}\n);`}\n}`;
    const run = new AsyncFunction(...names, "PRINT", "TEX", body);
    let value = await run(...names.map((n) => scope[n]), PRINT, TEX);
    if (value && typeof value.then === "function") value = await value;
    if (expr !== null) {
      out.hasValue = true;
      out.value = value;
      out.type = typeName(value) || (typeof value === "bigint" ? "bigint" : "");
      out.text = fmt(value);
    }
  } catch (e) {
    out.error = e;
  }
  out.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
  return out;
}

// ---------------------------------------------------------------- browser

const CSS = `
.runbox { margin: 3rem 0 0; border: 1px solid var(--line, #d9dee7); border-radius: 12px; background: var(--surface, #fff); padding: 1rem; display: flex; flex-direction: column; gap: .6rem; }
.runbox-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .8rem; }
.runbox-head strong { font: 600 1rem/1.2 var(--font-display, system-ui); }
.runbox-head span { color: var(--muted, #5b6676); font-size: .85rem; }
.runbox-head code { font-size: .8rem; }
.runbox textarea { width: 100%; min-height: 8rem; resize: vertical; font: .84rem/1.55 var(--font-mono, ui-monospace, monospace); padding: .7rem .8rem; border: 1px solid var(--line, #d9dee7); border-radius: 8px; background: var(--sunk, #eef1f5); color: var(--fg, #182131); tab-size: 2; white-space: pre; overflow-x: auto; }
.runbox-bar { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
.runbox-bar .runbox-meta { color: var(--muted, #5b6676); font-size: .78rem; margin-left: auto; font-family: var(--font-mono, monospace); }
.runbox-out { display: flex; flex-direction: column; gap: .2rem; min-height: 1.5rem; font: .84rem/1.5 var(--font-mono, ui-monospace, monospace); overflow-x: auto; }
.runbox-out:empty::before { content: "Output appears here."; color: var(--muted, #5b6676); font-family: var(--font-body, system-ui); }
.runbox-out .rb-print { white-space: pre-wrap; overflow-wrap: anywhere; }
.runbox-out .rb-value { white-space: pre-wrap; overflow-wrap: anywhere; border-top: 1px dashed var(--line, #d9dee7); padding-top: .35rem; margin-top: .15rem; font-weight: 500; }
.runbox-out .rb-value:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.runbox-out .rb-type { font: 600 .68rem/1 var(--font-body, system-ui); text-transform: uppercase; letter-spacing: .07em; color: var(--muted, #5b6676); margin-right: .5rem; }
.runbox-out .rb-error { color: var(--bad, #b42318); white-space: pre-wrap; }
.runbox-out .rb-tex { overflow-x: auto; }
pre.rb-has-try { position: relative; }
pre .rb-try { position: absolute; top: .35rem; right: .35rem; font: 500 .72rem/1 var(--font-body, system-ui); padding: .3rem .5rem; border-radius: 6px; border: 1px solid var(--line, #d9dee7); background: var(--surface, #fff); color: var(--accent, #2b55c9); cursor: pointer; opacity: .75; }
pre .rb-try:hover, pre .rb-try:focus-visible { opacity: 1; }
`;

let katexPromise = null;
function loadKatex() {
  if (!katexPromise) {
    if (!document.querySelector(`link[href^="${KATEX_BASE}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `${KATEX_BASE}katex.min.css`;
      document.head.append(link);
    }
    katexPromise = import(/* @vite-ignore */ `${KATEX_BASE}katex.mjs`).then((m) => m.default ?? m);
  }
  return katexPromise;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function render(outEl, res) {
  outEl.replaceChildren();
  for (const p of res.prints) {
    if (p.kind === "tex") {
      const d = el("div", "rb-tex");
      d.textContent = p.text;
      outEl.append(d);
      loadKatex()
        .then((katex) => katex.render(p.text, d, { displayMode: p.display, throwOnError: false }))
        .catch(() => {});
    } else outEl.append(el("div", "rb-print", p.text));
  }
  if (res.error) {
    const e = res.error;
    outEl.append(el("div", "rb-error", e && e.name ? `${e.name}: ${e.message}` : String(e)));
  } else if (res.hasValue && !(res.value === undefined && res.prints.length)) {
    const v = el("div", "rb-value");
    if (res.type) v.append(el("span", "rb-type", res.type));
    v.append(document.createTextNode(res.text));
    outEl.append(v);
  }
}

function fit(ta) {
  const lines = ta.value.split("\n").length;
  ta.rows = Math.min(Math.max(lines + 1, 5), 28);
}

/**
 * Wire every `.runbox` under root (the build writes the markup with its seed
 * code) and add a "Try" button to each code example in the page.
 * opts.scope: the names the code can use. opts.format(value) may return a
 * display string for library values, or undefined for the default.
 */
export function mountRunboxes(root = document, opts = {}) {
  if (!document.getElementById("runbox-css")) {
    const style = el("style");
    style.id = "runbox-css";
    style.textContent = CSS;
    document.head.append(style);
  }
  const boxes = [...root.querySelectorAll(".runbox")];
  for (const box of boxes) {
    if (box.dataset.ready) continue;
    box.dataset.ready = "1";
    const ta = box.querySelector("textarea");
    const seed = ta.value;
    const out = box.querySelector(".runbox-out");
    const meta = box.querySelector(".runbox-meta");
    const runBtn = box.querySelector("[data-run]");
    const resetBtn = box.querySelector("[data-reset]");
    fit(ta);
    const go = async () => {
      runBtn.disabled = true;
      meta.textContent = "running…";
      await new Promise((r) => setTimeout(r, 20));
      const res = await runCode(ta.value, opts.scope ?? {}, { format: opts.format });
      render(out, res);
      meta.textContent = `${res.ms < 10 ? res.ms.toFixed(1) : Math.round(res.ms)} ms`;
      runBtn.disabled = false;
    };
    box.runCode = (code) => {
      ta.value = code;
      fit(ta);
      return go();
    };
    runBtn.addEventListener("click", go);
    resetBtn.addEventListener("click", () => {
      ta.value = seed;
      fit(ta);
      out.replaceChildren();
      meta.textContent = "";
    });
    ta.addEventListener("input", () => fit(ta));
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        go();
      } else if (e.key === "Tab" && !e.shiftKey && !ta.dataset.tabOut) {
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      } else if (e.key === "Escape") {
        ta.dataset.tabOut = "1"; // after Esc, Tab leaves the box (keyboard users)
      }
    });
    ta.addEventListener("blur", () => delete ta.dataset.tabOut);
  }
  const box = boxes[boxes.length - 1];
  if (!box) return;
  for (const code of root.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    if (pre.closest(".runbox") || pre.classList.contains("rb-has-try") || pre.dataset.norun !== undefined) continue;
    if (!/[A-Za-z_$][\w$]*\s*[(.`]/.test(code.textContent)) continue; // only examples with calls
    pre.classList.add("rb-has-try");
    const b = el("button", "rb-try", "Try ↓");
    b.type = "button";
    b.title = "Copy this example into the box at the end of the page and run it";
    b.addEventListener("click", () => {
      box.scrollIntoView({ behavior: "smooth", block: "start" });
      box.runCode(stripImports(code.textContent).replace(/^\s*\n/, "").trimEnd());
    });
    pre.append(b);
  }
}
