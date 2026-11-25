// Build the docs site: bundle the library (with @ratmath/core) to
// docs/assets/symbolic.js, then write docs/<page>.html from docs/src/<page>.html.
//
// Each source page is a full HTML document. The build ends its <article> with
// the runnable code box (docs/assets/runbox.js, shared with the other RatMath
// docs sites; seed code from the page's <template data-runbox>), typesets
// \\( … \\) and \\[ … \\] with KaTeX, and stamps asset links with a content hash so
// a browser never mixes a cached script with a new page. Finally it runs every
// page's box against the library and fails if any of them throws.
//
//   bun run docs:build [--verbose]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { renderMath, seedOf, runboxHtml, stampAssets, stampLinks, KATEX_LINK } from "./docs-kit.js";
import { runCode } from "../docs/assets/runbox.js";

const NAME = "symbolic";
const TITLE = "RatMath Symbolic algebra";
const DESCRIPTION = "Symbolic algebra for RatMath: expressions, rewriting, solving and closed forms, with every step checked by the certified libraries.";

const out = await Bun.build({ entrypoints: ["./scripts/docs-entry.js"], outdir: "./docs/assets", naming: `${NAME}.js`, target: "browser", format: "esm", minify: { whitespace: true, syntax: true, identifiers: true, keepNames: true } });
if (!out.success) {
  for (const m of out.logs) console.error(m);
  process.exit(1);
}
console.log(`docs/assets/${NAME}.js written`);

const SITE_LINKS = `<footer class="sitelinks"><a href="https://github.com/ratmath/${NAME}">GitHub</a> · <a href="https://ratmath.com/">ratmath.com</a> · <a href="https://ratmath.com/shelf/">shelf</a> · <a href="https://ratmath.com/core/">core</a></footer>`;

const v = stampAssets("docs/assets");
const seeds = [];
let formulas = 0;
const files = readdirSync("docs/src").filter((f) => f.endsWith(".html")).sort();
for (const file of files) {
  const { seed, html } = seedOf(readFileSync(`docs/src/${file}`, "utf8"));
  seeds.push({ page: file, seed });
  const box = runboxHtml(seed, { lib: `<code>@ratmath/${NAME}</code> and Core's <code>Rational</code>` });
  if (!html.includes("</article>")) throw new Error(`${file}: no </article> to put the code box in`);
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? TITLE;
  const og = `<meta property="og:title" content="${title}">\n<meta property="og:description" content="${DESCRIPTION}">\n<meta property="og:type" content="website">\n<meta property="og:url" content="https://ratmath.com/${NAME}/${file === "index.html" ? "" : file}">`;
  const math = renderMath(html.replace("</title>", `</title>\n${og}`).replace("</article>", `${box}\n${SITE_LINKS}\n</article>`));
  formulas += math.count;
  const page = math.count ? math.html.replace('<link rel="stylesheet" href="assets/style.css">', `${KATEX_LINK}\n<link rel="stylesheet" href="assets/style.css">`) : math.html;
  writeFileSync(`docs/${file}`, stampLinks(page, v));
}
console.log(`${files.length} pages written to docs/ (${formulas} formulas typeset, assets ?v=${v})`);

const scope = await import("./docs-entry.js");
let failed = 0;
for (const { page, seed } of seeds) {
  const res = await runCode(seed, scope);
  if (res.error) {
    failed++;
    console.error(`✗ ${page}: ${res.error.name}: ${res.error.message}`);
  } else if (process.argv.includes("--verbose")) {
    console.log(`— ${page} (${res.ms.toFixed(0)} ms)`);
    for (const pr of res.prints) console.log(`  ${pr.text}`);
    if (res.hasValue) console.log(`  → ${res.type ? `${res.type} ` : ""}${res.text}`);
  }
}
if (failed) {
  console.error(`${failed} code box(es) failed`);
  process.exit(1);
}
console.log(`${seeds.length} code boxes run without errors`);
