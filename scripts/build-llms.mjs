// Write docs/llms.txt and docs/llms-full.txt: documentation for AI assistants
// in the llms.txt format (https://llmstxt.org).
//
// llms.txt is a compact map, a few thousand tokens: what the library is, the
// shared types, every export with its signature (from index.d.ts), a one-line
// meaning (the comment above its definition), where it is defined (file:line)
// and the docs page about it, the namespaces, and an example. llms-full.txt
// is every docs page as Markdown, each with its runnable example.
//
// Everything is read from the source and the built docs, so the line numbers
// are those of the commit it was built from. Runs at the end of docs:build
// (it reads the built pages in docs/). Shared verbatim by every RatMath Shelf
// library: keep the copies in step.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const short = pkg.name.replace("@ratmath/", "");
const site = `https://ratmath.com/${short}/`;
let sha = "main", dirty = false;
try {
  sha = execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
  dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "index.js", "index.d.ts"]).toString().trim() !== "";
} catch { /* not a git checkout */ }
const gh = `https://github.com/ratmath/${short}/blob/${sha}/`;
const read = (f) => readFileSync(f, "utf8");
const ent = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (h) => ent(h.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const firstSentence = (t, max = 160) => {
  const s = t.split(/(?<=[.!?])\s+(?=[A-Z(`])/)[0];
  return s.length > max ? s.slice(0, max - 3).replace(/\s\S*$/, "") + "…" : s;
};

// ---- docs pages, in the order of the contents column ---------------------------
// From docs/assets/site.js PAGES (most libraries), else the built index page's
// contents links (or a docs/src/layout.html <select>, as in linalg).
const SKIP = new Set(["workbench.html"]);
function pageList() {
  if (existsSync("docs/assets/site.js")) {
    const m = /export const PAGES = \[([\s\S]*?)\n\];/.exec(read("docs/assets/site.js"));
    if (m) {
      const out = [];
      for (const o of m[1].matchAll(/\{\s*href:\s*"([^"]+)",\s*title:\s*"((?:[^"\\]|\\.)*)"(?:,\s*blurb:\s*"((?:[^"\\]|\\.)*)")?/g)) out.push({ file: o[1], name: o[2].replace(/\\"/g, '"'), blurb: o[3]?.replace(/\\"/g, '"') });
      if (out.length) return out;
    }
  }
  const index = existsSync("docs/src/layout.html") ? read("docs/src/layout.html") : read("docs/index.html");
  const nav = /<nav class="toc"[\s\S]*?<\/nav>/.exec(index)?.[0];
  if (nav) {
    const seen = new Set();
    return [...nav.matchAll(/<a href="([\w./-]+\.html)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].filter(([, f]) => !seen.has(f) && seen.add(f)).map(([, file, name]) => ({ file, name: text(name) }));
  }
  return [{ file: "index.html", name: "Introduction" }];
}
const PAGES = pageList().filter((p) => !SKIP.has(p.file) && existsSync(`docs/${p.file}`));
for (const p of PAGES) {
  const html = read(`docs/${p.file}`);
  const seedArea = /<section class="runbox"[\s\S]*?<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
  p.seed = seedArea ? ent(seedArea[1]).trim() : "";
  let body = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? /<body[^>]*>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? "";
  body = body
    .replace(/<section class="runbox"[\s\S]*?<\/section>/g, "")
    .replace(/<(script|style|template|nav|aside|svg|button|select|textarea)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<footer class="sitelinks"[\s\S]*?<\/footer>/g, "")
    .replace(/<span class="katex-mathml">[\s\S]*?<\/span>(?=<span class="katex-html")/g, "")
    .replace(/<span class="katex-html"[^>]*>[\s\S]*?<\/span><\/span><\/span>/g, (m) => text(m));
  p.body = body;
  p.lede = p.blurb ?? firstSentence(text(/<p[^>]*>([\s\S]*?)<\/p>/.exec(body)?.[1] ?? ""));
}
const id = (p) => p.file.replace(/\.html$/, "");

function toMarkdown(h) {
  return ent(h
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (_, c) => "\n```js\n" + c.replace(/<[^>]+>/g, "").trim() + "\n```\n")
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/g, (_, n, t) => `\n${"#".repeat(+n + 1)} ${text(t)}\n`)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/a>/g, (_, u, t, d) => `- [${text(t)}](${/^https?:/.test(u) ? u : site + u}): ${text(d)}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, t) => `- ${text(t)}\n`)
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, r) => "| " + [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => text(m[1]).replace(/\|/g, "\\|")).join(" | ") + " |\n")
    .replace(/<code>([\s\S]*?)<\/code>/g, (_, c) => "`" + c.replace(/<[^>]+>/g, "") + "`")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, u, t) => `[${text(t)}](${/^https?:|^#/.test(u) ? u : site + u})`)
    .replace(/<\/(p|div|section|figure|table|ul|ol)>|<br\s*\/?>/g, "\n\n")
    .replace(/<[^>]+>/g, ""))
    .split(/(```[\s\S]*?```)/).map((c, i) => (i % 2 ? c : c.replace(/^[ \t]+/gm, "").replace(/[ \t]{2,}/g, " "))).join("")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---- where each export is defined ------------------------------------------------
const lines = new Map();
const linesOf = (f) => lines.get(f) ?? lines.set(f, read(f).split("\n")).get(f);
const resolveFile = (from, spec) => {
  if (!spec.startsWith(".")) return null;
  const f = normalize(join(dirname(from), spec));
  return existsSync(f) ? f : existsSync(f + ".js") ? f + ".js" : existsSync(join(f, "index.js")) ? join(f, "index.js") : null;
};
const esc = (n) => n.replace(/\$/g, "\\$");
const specList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [a, b] = x.split(/\s+as\s+/); return { local: a.trim(), name: (b ?? a).trim() }; });
// Find name in file: its definition, or follow re-exports and imports.
function definition(file, name, depth = 0) {
  if (!file || depth > 6) return null;
  const src = read(file), L = linesOf(file);
  const decl = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${esc(name)}\\b`);
  const i = L.findIndex((l) => decl.test(l));
  if (i >= 0) return { file, line: i + 1 };
  for (const m of src.matchAll(/(?:export|import)\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const hit = specList(m[1]).find((s) => s.name === name);
    if (hit) return definition(resolveFile(file, m[2]), hit.local, depth + 1) ?? { file, line: src.slice(0, m.index).split("\n").length, external: resolveFile(file, m[2]) ? null : m[2] };
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    const hit = specList(m[1]).find((x) => x.name === name && x.local !== name);
    if (hit) return definition(file, hit.local, depth + 1);
  }
  let outside = null;
  for (const m of src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)) {
    const target = resolveFile(file, m[1]);
    if (!target) { outside ??= { file, line: src.slice(0, m.index).split("\n").length, external: m[1] }; continue; }
    const d = definition(target, name, depth + 1);
    if (d) return d;
  }
  return outside;
}
// The /** … */ or // comment just above a line.
function docOf(file, line) {
  const L = linesOf(file);
  let i = line - 2;
  const out = [];
  if (/\*\/\s*$/.test(L[i] ?? "")) { while (i >= 0 && !/\/\*\*?/.test(L[i])) out.unshift(L[i--]); out.unshift(L[i] ?? ""); }
  else while (i >= 0 && /^\s*\/\//.test(L[i])) out.unshift(L[i--]);
  const t = out.join(" ").replace(/\/\*\*?|\*\/|^\s*\*|\s\*\s|\/\//g, " ").replace(/\{@link\s+([^}]+)\}/g, "$1").replace(/@\w+.*$/, "").replace(/\s+/g, " ").trim();
  return firstSentence(t);
}

// ---- signatures from index.d.ts -----------------------------------------------------
// Refinement<Q, E> is written (Q ⇒ E): the float preview, then the exact value.
const decls = {};
if (existsSync("index.d.ts")) {
  const L = read("index.d.ts").split("\n");
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^export (?:declare )?(function|const|class|type|interface|namespace|enum)\s+(\w+)/);
    if (!m) continue;
    let t = L[i], depth = 0, j = i;
    const count = (s) => { for (const c of s.replace(/=>/g, "")) depth += "({[<".includes(c) ? 1 : ")}]>".includes(c) ? -1 : 0; };
    count(t);
    while (depth > 0 && j + 1 < L.length) { t += " " + L[++j].trim(); count(L[j]); }
    const prev = decls[m[2]];
    if (prev && prev.kind === "function" && m[1] === "function") { prev.overloads++; continue; }
    decls[m[2]] = { kind: m[1], text: t.replace(/\s+/g, " "), overloads: 1 };
    if (m[1] === "class") {
      const body = t.slice(t.indexOf("{") + 1, t.lastIndexOf("}"));
      let d = 0, cur = "";
      const parts = [];
      for (const c of body) { if ("({[<".includes(c)) d++; if (")}]>".includes(c)) d--; if ((c === ";" || c === "\n") && d === 0) { parts.push(cur); cur = ""; } else cur += c; }
      parts.push(cur);
      decls[m[2]].members = [...new Set(parts.map((p) => /^\s*(?:\/\*\*[\s\S]*?\*\/\s*)?(?:(?:static|readonly|get|set|private|protected|public|abstract)\s+)*\[?([\w$.]+)\]?\s*[(:?<]/.exec(p)?.[1]).filter((n) => n && n !== "constructor"))];
    }
  }
}
const nest = "(?:[^<>]|<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)*?";
const refine = (t) => { let o = t, p; do { p = o; o = o.replace(new RegExp(`Refinement<(${nest}), (${nest})>`), "($1 ⇒ $2)"); } while (o !== p); return o; };
const MAXSIG = 220;
function sigOf(name) {
  const d = decls[name];
  if (!d) return "";
  let s = "";
  if (d.kind === "function") {
    const t = d.text.replace(/^export (?:declare )?function \w+(<[^(]*?>)?(?=\()/, "").replace(/;$/, "");
    let depth = 0, end = 0;
    for (let i = 0; i < t.length; i++) { if (t[i] === "(") depth++; if (t[i] === ")" && --depth === 0) { end = i; break; } }
    s = refine(t.slice(0, end + 1) + t.slice(end + 1).replace(/^\s*:\s*/, " → "));
  }
  else if (d.kind === "const") s = refine(d.text.replace(/^export (?:declare )?const \w+\s*:\s*/, ": ").replace(/;$/, ""));
  else if (d.kind === "class") return ` class: ${d.members.join(", ")}`;
  else if (d.kind === "namespace") return " namespace";
  if (s.length > MAXSIG) s = s.slice(0, MAXSIG - 1).replace(/[\s,;]+\S*$/, "") + " …";
  return s + (d.overloads > 1 ? ` (+${d.overloads - 1} overload${d.overloads > 2 ? "s" : ""})` : "");
}
const TYPES = Object.entries(decls).filter(([, d]) => d.kind === "type" && d.text.length < 170 && !/=\s*;?$/.test(d.text)).map(([, d]) => d.text.replace(/^export (?:declare )?/, "").replace(/;$/, ""));

// ---- the exports of index.js --------------------------------------------------------
const idx = read("index.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const imported = {};
for (const m of idx.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) for (const s of specList(m[1])) imported[s.name] = { local: s.local, from: m[2] };
for (const m of idx.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']/g)) imported[m[1]] = { ns: true, from: m[2] };
const rows = [], spaces = [], seen = new Set();
const pageFor = (name) => {
  const re = new RegExp(`<code>[^<]*(?<![\\w.])${esc(name)}\\b`);
  const topics = PAGES.filter((p) => !/^(index|reference|explore|api)\.html$/.test(p.file));
  return (topics.find((p) => re.test(p.body)) ?? PAGES.find((p) => re.test(p.body)))?.file;
};
const addRow = (name, spec, local = name) => {
  if (seen.has(name)) return;
  seen.add(name);
  const file = resolveFile("index.js", spec);
  if (!file) return rows.push({ name, from: spec });
  const d = definition(file, local);
  rows.push({ name, file: d?.file ?? file, line: d?.line, external: d?.external, doc: d && !d.external ? docOf(d.file, d.line) : "", page: pageFor(name) });
};
const addSpace = (ns, spec) => {
  if (seen.has(ns)) return;
  seen.add(ns);
  const file = resolveFile("index.js", spec);
  if (!file) return spaces.push({ ns, from: spec, members: [] });
  const src = read(file);
  const members = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([\w$]+)/gm)].map((x) => x[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) members.push(...specList(m[1]).map((s) => s.name));
  const more = [...src.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']/g)].map((x) => x[1]);
  spaces.push({ ns, file, members: [...new Set(members)], more });
};
for (const m of idx.matchAll(/export\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|\*)\s*(?:from\s*["']([^"']+)["'])?/g)) {
  const [, ns, names, from] = m;
  if (ns) addSpace(ns, from);
  else if (names !== undefined) {
    for (const s of specList(names)) {
      if (from) addRow(s.name, from, s.local);
      else if (imported[s.local]?.ns) addSpace(s.name, imported[s.local].from);
      else if (imported[s.local]) addRow(s.name, imported[s.local].from, imported[s.local].local);
      else addRow(s.name, "./index.js", s.local);
    }
  } else if (from) {
    const file = resolveFile("index.js", from);
    if (!file) { rows.push({ name: "*", from }); continue; }
    for (const x of read(file).matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([\w$]+)/gm)) addRow(x[1], from);
  }
}
for (const m of idx.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class|const|let)\s+([\w$]+)/gm)) addRow(m[1], "./index.js");

// ---- llms.txt ----------------------------------------------------------------------
const L = [];
const sum = (pkg.description ?? "").replace(/\.$/, "");
L.push(`# ${pkg.name}`, "", `> ${sum}. Part of the RatMath Shelf; numbers come from @ratmath/core (a peer dependency). ESM: \`import * as ${short} from "${pkg.name}"\`.`, "");
L.push(`Built from ${pkg.version}, commit ${sha}${dirty ? " plus uncommitted changes" : ""}. \`file:line\` is relative to the package root (also node_modules/${pkg.name}/); on GitHub: ${gh}<file>#L<line>. Docs pages are under ${site}. Full types: index.d.ts.${Object.values(decls).some((d) => d.text.includes("Refinement<")) ? " `(Q ⇒ E)` is a Refinement: `.quick.value` is the float preview Q at once, `.exact()` the exact E." : ""}`, "");
if (TYPES.length) L.push("Types: " + TYPES.map((t) => `\`${t}\``).join("; "), "");
L.push("## Docs", "", `- ${site}llms-full.txt: every page below as Markdown, each with a runnable example`, "- Pages: " + PAGES.map((p) => `${id(p)} (${p.name})`).join(", "), "");
L.push("## API", "", "name(params) → result — meaning · file:line · docs page", "");
for (const r of rows) {
  if (!r.file) { L.push(`- \`${r.name}\` — from ${r.from}`); continue; }
  const where = r.external ? `from ${r.external}` : r.line ? `${r.file}:${r.line}` : r.file;
  L.push(`- \`${r.name}${sigOf(r.name)}\`${r.doc ? ` — ${r.doc}` : ""} · ${where}${r.page ? ` · ${r.page.replace(/\.html$/, "")}` : ""}`);
}
if (spaces.length) {
  L.push("", "## Namespaces", "");
  for (const s of spaces) {
    if (!s.file) { L.push(`- \`${s.ns}\`: all of ${s.from}`); continue; }
    L.push(`- \`${s.ns}\` (${s.file}): ${[...s.members, ...s.more.map((x) => `everything from ${x}`)].join(", ")}`);
  }
}
const intro = PAGES.find((p) => p.file === "index.html") ?? PAGES[0];
const ex = intro?.seed || PAGES.find((p) => p.seed)?.seed;
if (ex) {
  const used = [...rows.filter((r) => r.file).map((r) => r.name), ...spaces.map((s) => s.ns)].filter((n) => new RegExp(`(?<![.\\w$])${esc(n)}\\s*[.(\`]`).test(ex));
  L.push("", "## Example", "", "```js", `import { ${used.join(", ")} } from "${pkg.name}";`, ex.replace(/\bPRINT\(/g, "console.log("), "```");
}
L.push("", "## More", "", "- tests/: worked examples for every function", "- https://ratmath.com/core/ (numbers), https://ratmath.com/shelf/ (all the libraries)");
writeFileSync("docs/llms.txt", L.join("\n") + "\n");

// ---- llms-full.txt -------------------------------------------------------------------
const F = [`# ${pkg.name} ${pkg.version}: full documentation`, "", `> ${sum}. From ${site}, commit ${sha}. Each page ends with a runnable example; in it, PRINT(...) prints.`, ""];
for (const p of PAGES) {
  F.push("", "---", "", `Page: ${site}${p.file}`, "", toMarkdown(p.body));
  if (p.seed) F.push("", "### Try it", "", "```js", p.seed, "```");
}
writeFileSync("docs/llms-full.txt", F.join("\n") + "\n");
const tok = (f) => Math.round(read(f).length / 4);
const unplaced = rows.filter((r) => r.file && !r.line).map((r) => r.name);
console.log(`docs/llms.txt (~${tok("docs/llms.txt")} tokens, ${rows.length} exports, ${spaces.length} namespaces) and docs/llms-full.txt (~${tok("docs/llms-full.txt")} tokens, ${PAGES.length} pages) written${unplaced.length ? `; no definition line found for ${unplaced.join(", ")}` : ""}`);
