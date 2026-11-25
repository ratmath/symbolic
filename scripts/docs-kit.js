// Build helpers shared by the RatMath docs sites (scripts/docs-kit.js in core,
// analytic, linalg and algebraic; keep the copies in sync).
//
// - renderMath(html): typesets \( … \) and \[ … \] with KaTeX at build time,
//   so a page needs only the shared stylesheet at ratmath.com/assets/katex.
// - addRunbox(html): appends the runnable code box, seeded from a
//   <template data-runbox> in the page or else from the page's code examples.
// - stampAssets(dir) / stampLinks(html, v): cache-busting ?v= tags.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import katex from "katex";

export const KATEX_VERSION = "0.19.1";
export const KATEX_CSS = `https://ratmath.com/assets/katex/${KATEX_VERSION}/katex.min.css`;
export const KATEX_LINK = `<link rel="stylesheet" href="${KATEX_CSS}">`;

const PROTECTED = /<(pre|code|textarea|script|style|template)\b[\s\S]*?<\/\1>/gi;

export function unescapeHtml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Typeset \( … \) (inline) and \[ … \] (display) outside code, pre, textarea, script, style and template. */
export function renderMath(html, { macros = {} } = {}) {
  let count = 0;
  const typeset = (text) =>
    text.replace(/\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g, (m, display, inline) => {
      count++;
      const tex = unescapeHtml(display ?? inline);
      return katex.renderToString(tex, { displayMode: display !== undefined, throwOnError: true, macros, output: "htmlAndMathml" });
    });
  let out = "";
  let last = 0;
  for (const m of html.matchAll(PROTECTED)) {
    out += typeset(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += typeset(html.slice(last));
  return { html: out, count };
}

/** The code examples of a page (contents of <pre><code>), unescaped. */
export function codeBlocks(html) {
  return [...html.matchAll(/<pre(?![^>]*data-norun)[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g)].map((m) => unescapeHtml(m[1]));
}

const IMPORT_LINE = /^[ \t]*import\b[^;]*?\bfrom\s*["'][^"']*["'];?[ \t]*\n?/gm;

/**
 * The seed for a page's box: an explicit <template data-runbox> (removed from
 * the page), else the page's JavaScript examples joined, imports dropped.
 */
export function seedOf(html) {
  const t = html.match(/<template data-runbox>\n?([\s\S]*?)<\/template>\n?/);
  if (t) return { seed: unescapeHtml(t[1]).replace(/\s+$/, ""), html: html.replace(t[0], ""), explicit: true };
  const blocks = codeBlocks(html)
    .filter((b) => /[A-Za-z_$][\w$]*\s*[(.`]/.test(b))
    .map((b) => b.replace(IMPORT_LINE, "").trim())
    .filter(Boolean);
  return { seed: blocks.join("\n\n"), html, explicit: false };
}

export function runboxHtml(seed, { title = "Try it", lib = "the library" } = {}) {
  return `<section class="runbox" aria-label="Runnable code">
  <div class="runbox-head"><strong>${title}</strong><span>Edit the code and run it with ${lib} in scope. The last line's value is shown; <code>PRINT(…)</code> adds lines, <code>TEX(…)</code> typesets math.</span></div>
  <textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Code">${escapeHtml(seed)}</textarea>
  <div class="runbox-bar"><button type="button" data-run>Run</button><button type="button" class="ghost" data-reset>Reset</button><span class="runbox-meta">Ctrl/⌘ + Enter runs</span></div>
  <div class="runbox-out" aria-live="polite"></div>
</section>`;
}

/** Append the runnable box to a page body. Returns { html, seed }. */
export function addRunbox(body, opts = {}) {
  const { seed, html } = seedOf(body);
  return { html: `${html.trimEnd()}\n${runboxHtml(seed, opts)}`, seed };
}

const STAMP = /(\.(?:js|css|mjs))\?v=[0-9a-f]+/g;

/** Hash the assets in dir, stamp the hash on their relative imports, and return it. */
export function stampAssets(dir) {
  const files = readdirSync(dir).filter((f) => /\.(js|css|mjs)$/.test(f)).sort();
  const texts = Object.fromEntries(files.map((f) => [f, readFileSync(`${dir}/${f}`, "utf8")]));
  const hash = createHash("sha256");
  for (const f of files) hash.update(f).update(texts[f].replace(STAMP, "$1"));
  const v = hash.digest("hex").slice(0, 10);
  for (const f of files) {
    if (!/\.m?js$/.test(f)) continue;
    const out = texts[f].replace(/((?:from|import)\s*\(?\s*"\.\/[\w.-]+\.m?js)(?:\?v=[0-9a-f]+)?"/g, `$1?v=${v}"`);
    if (out !== texts[f]) writeFileSync(`${dir}/${f}`, out);
  }
  return v;
}

/** Stamp ?v= on every assets/*.js|css link in a page, and on inline module imports of them. */
export function stampLinks(html, v) {
  return html
    .replace(/((?:src|href)="assets\/[\w.-]+\.(?:js|css|mjs))(?:\?v=[0-9a-f]+)?"/g, `$1?v=${v}"`)
    .replace(/(from\s*"\.\/assets\/[\w.-]+\.m?js)(?:\?v=[0-9a-f]+)?"/g, `$1?v=${v}"`);
}
