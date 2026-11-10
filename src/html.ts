import { RULES } from "./dpdp.js";
import { CLASS_LABEL } from "./fields.js";
import type { Finding, ScanResult, Severity } from "./types.js";

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function card(f: Finding, index: number): string {
  const rule = RULES[f.ruleId]!;
  const ai = f.ai
    ? `<p class="ai"><span class="tag ai-${f.ai.verdict}">AI: ${esc(f.ai.verdict.replace("_", " "))} · ${Math.round(f.ai.confidence * 100)}%</span> ${esc(f.ai.explanation)}</p>` +
      (f.ai.fix
        ? `<div class="fix"><pre><code>${esc(f.ai.fix)}</code></pre><button type="button" class="copy" data-copy="${esc(f.ai.fix)}">Copy fix</button></div>`
        : "")
    : "";
  return `<li class="card" data-severity="${f.severity}" style="--i:${Math.min(index, 14)}">
  <details>
    <summary>
      <span class="sev sev-${f.severity}">${f.severity}</span>
      <span class="msg">${esc(f.message)}</span>
      <span class="loc">${esc(f.path)}:${f.line}</span>
    </summary>
    <div class="body">
      <p><span class="tag">${f.ruleId}</span> <span class="tag">${esc(rule.citation)}</span> ${esc(rule.help)}</p>
      ${ai}
    </div>
  </details>
</li>`;
}

function inventory(result: ScanResult): string {
  if (!result.inventory.length) return `<p class="muted">No personal data columns found in SQL, Prisma, JPA, or Python ORM schemas.</p>`;
  return result.inventory
    .map(
      (t) => `<section class="table">
  <h3>${esc(t.table)} <span class="tag ${t.hasErasurePath ? "ok" : "warn"}">${t.hasErasurePath ? "erasure path found" : "no erasure path"}</span></h3>
  <p class="muted">${esc(t.path)}${t.purpose ? ` · Purpose (AI inferred): ${esc(t.purpose)}` : ""}${t.retention ? ` · Retention (AI inferred): ${esc(t.retention)}` : ""}</p>
  <div class="scroll"><table>
    <thead><tr><th>Column</th><th>Category</th><th>Type</th><th>Protection</th></tr></thead>
    <tbody>${t.columns
      .map(
        (c) =>
          `<tr><td><code>${esc(c.column)}</code></td><td>${CLASS_LABEL[c.dataClass!]}</td><td><code>${esc(c.type.slice(0, 40))}</code></td><td>${c.protected ? "visible" : "none visible"}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>
</section>`,
    )
    .join("\n");
}

/** Single-file HTML report. All repository-derived text is escaped. */
export function renderHtml(result: ScanResult): string {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of result.findings) counts[f.severity]++;
  const columns = result.inventory.reduce((n, t) => n + t.columns.length, 0);
  const chip = (key: string, label: string, n: number) =>
    `<button type="button" class="chip" data-filter="${key}" aria-pressed="${key === "all"}">${label} <b data-count="${n}">${n}</b></button>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dpdp-scan report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{--paper:#f6f1e7;--card:#fffdf8;--ink:#1d1a16;--muted:#6f675c;--line:#e2d9c8;--ok:#1f7a4d;--high:#b3261e;--medium:#a15c00;--low:#2c5d8f;--accent:#e4572e}
@media (prefers-color-scheme:dark){:root{--paper:#16140f;--card:#1f1c16;--ink:#f1eadb;--muted:#a59b8a;--line:#35302699;--ok:#5fd39a;--high:#ff8a80;--medium:#f2b25c;--low:#8fc1f2;--accent:#ff7a52}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 "Bricolage Grotesque",system-ui,sans-serif}
code,pre,.loc,.tag{font-family:"JetBrains Mono",ui-monospace,monospace}
main{max-width:980px;margin:0 auto;padding:32px 16px 80px}
h1{font-size:clamp(32px,6vw,56px);line-height:1;margin:0 0 8px;font-weight:800;letter-spacing:-.02em}
h1 span{color:var(--accent)}
h2{font-size:24px;margin:48px 0 12px}
h3{font-size:18px;margin:0 0 4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.muted{color:var(--muted);font-size:14px;margin:0 0 8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:24px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.stat b{display:block;font-size:34px;line-height:1.1;font-weight:800}
.stat span{color:var(--muted);font-size:13px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 16px}
.chip{font:inherit;font-size:14px;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:6px 14px;cursor:pointer;transition:transform .15s}
.chip:active{transform:scale(.96)}
.chip[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;animation:rise .45s both;animation-delay:calc(var(--i)*45ms)}
.card[hidden]{display:none}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
summary{cursor:pointer;padding:12px 16px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;align-items:center;list-style:none;border-radius:14px}
summary::-webkit-details-marker{display:none}
.msg{font-weight:600}
.loc{grid-column:2;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.sev{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:2px 10px;border-radius:999px;border:1.5px solid currentColor}
.sev-high{color:var(--high)}.sev-medium{color:var(--medium)}.sev-low{color:var(--low)}
.body{padding:0 16px 14px;border-top:1px dashed var(--line);animation:fade .25s both}
@keyframes fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.tag{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:1px 6px;white-space:nowrap}
.tag.ok,.ai-false_positive{color:var(--ok)}.tag.warn,.ai-true_positive{color:var(--high)}
.fix{position:relative;margin-top:8px}
pre{margin:0;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px 96px 12px 12px;overflow-x:auto;font-size:13px;white-space:pre-wrap}
.copy{position:absolute;top:8px;right:8px;font:600 12px "JetBrains Mono",monospace;color:var(--paper);background:var(--ink);border:0;border-radius:8px;padding:6px 10px;cursor:pointer;transition:transform .15s}
.copy:active{transform:scale(.94)}
.copy.done{background:var(--ok)}
.table{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:6px 10px 6px 0;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
footer{margin-top:48px;color:var(--muted);font-size:13px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main>
  <h1>dpdp<span>-scan</span></h1>
  <p class="muted">${result.filesScanned} files scanned · ${result.ai.used ? `AI review by ${esc(result.ai.model ?? "")} (local)` : "AI review off"} · Findings are pointers for review, not a compliance determination.</p>
  <div class="stats">
    <div class="stat"><b data-count="${counts.high}" style="color:var(--high)">${counts.high}</b><span>high</span></div>
    <div class="stat"><b data-count="${counts.medium}" style="color:var(--medium)">${counts.medium}</b><span>medium</span></div>
    <div class="stat"><b data-count="${counts.low}" style="color:var(--low)">${counts.low}</b><span>low</span></div>
    <div class="stat"><b data-count="${columns}">${columns}</b><span>personal data columns</span></div>
    <div class="stat"><b data-count="${result.thirdParties.length}">${result.thirdParties.length}</b><span>third parties</span></div>
  </div>

  <h2 id="findings">Findings</h2>
  <div class="chips" role="group" aria-label="Filter findings by severity">
    ${chip("all", "All", result.findings.length)}${chip("high", "High", counts.high)}${chip("medium", "Medium", counts.medium)}${chip("low", "Low", counts.low)}
  </div>
  <ul id="list">
${result.findings.map(card).join("\n") || `<li class="muted">No findings.</li>`}
  </ul>

  <h2 id="inventory">Personal data inventory</h2>
  ${inventory(result)}
  <p class="muted">Third parties receiving personal data: ${result.thirdParties.length ? esc(result.thirdParties.join(", ")) : "none detected"}.</p>
  <footer>Generated by dpdp-scan. References point to the DPDP Act, 2023 and DPDP Rules, 2025.</footer>
</main>
<div class="sr" aria-live="polite" id="live"></div>
<script>
(function () {
  var live = document.getElementById("live");
  var chips = [].slice.call(document.querySelectorAll(".chip"));
  var cards = [].slice.call(document.querySelectorAll(".card"));
  function filter(key) {
    chips.forEach(function (c) { c.setAttribute("aria-pressed", String(c.dataset.filter === key)); });
    var shown = 0;
    cards.forEach(function (c) { var on = key === "all" || c.dataset.severity === key; c.hidden = !on; if (on) shown++; });
    live.textContent = shown + " findings shown";
  }
  chips.forEach(function (c) { c.addEventListener("click", function () { filter(c.dataset.filter); }); });

  function copy(button) {
    var text = button.dataset.copy;
    function done() {
      button.classList.add("done"); button.textContent = "Copied"; live.textContent = "Fix copied to clipboard";
      setTimeout(function () { button.classList.remove("done"); button.textContent = "Copy fix"; }, 1600);
    }
    function fallback() {
      var area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { document.execCommand("copy"); done(); } catch (e) { live.textContent = "Copy failed"; }
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest(".copy"); if (b) copy(b); });

  // #demo: scripted 15 second showcase. Every frame is a function of elapsed time.
  if (location.hash !== "#demo") return;
  var counters = [].slice.call(document.querySelectorAll(".stat b"));
  var firstAi = document.querySelector(".card .fix") ? document.querySelector(".card .fix").closest(".card") : cards[0];
  var steps = [
    [0, function () { window.scrollTo(0, 0); filter("all"); cards.forEach(function (c) { c.querySelector("details").open = false; }); }],
    [3500, function () { filter("high"); }],
    [5500, function () { if (firstAi) { firstAi.hidden = false; firstAi.querySelector("details").open = true; firstAi.scrollIntoView({ block: "center" }); } }],
    [8500, function () { var b = firstAi && firstAi.querySelector(".copy"); if (b) { b.classList.add("done"); b.textContent = "Copied"; } }],
    [10500, function () { var b = firstAi && firstAi.querySelector(".copy"); if (b) { b.classList.remove("done"); b.textContent = "Copy fix"; } document.getElementById("inventory").scrollIntoView({ block: "start" }); }],
  ];
  var LOOP = 15000, start = performance.now(), lastStep = -1, lastLap = 0;
  function frame(now) {
    var elapsed = now - start, lap = Math.floor(elapsed / LOOP), t = elapsed % LOOP;
    if (lap !== lastLap) { lastLap = lap; lastStep = -1; }
    var k = Math.min(1, t / 1600), eased = 1 - Math.pow(1 - k, 3);
    counters.forEach(function (el) { el.textContent = String(Math.round(Number(el.dataset.count) * eased)); });
    var step = -1;
    for (var i = 0; i < steps.length; i++) if (t >= steps[i][0]) step = i;
    if (step !== lastStep) { for (var j = lastStep + 1; j <= step; j++) steps[j][1](); lastStep = step; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`;
}
