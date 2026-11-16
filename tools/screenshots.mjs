// Drives Spatial BI inside GeoLibre Web with the sample layers, checks each tool's result and saves README screenshots.
// Needs `node tools/serve.mjs` running and Google Chrome installed. Usage: node tools/screenshots.mjs [light|dark]
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.env.BASE || `http://localhost:${process.env.PORT || 8098}`;
// ENGINE=firefox|webkit runs the same checks in another engine; PLAYWRIGHT points at the playwright-core that owns that browser
const engine = process.env.ENGINE || "chrome";
const { chromium, firefox, webkit } = await import(process.env.PLAYWRIGHT || "playwright-core");
const scheme = process.argv[2] === "dark" ? "dark" : "light";
const out = process.env.OUT || join(root, "docs", "images");
mkdirSync(out, { recursive: true });

const browser =
  engine === "firefox"
    ? await firefox.launch({ headless: true })
    : engine === "webkit"
      ? await webkit.launch({ headless: true })
      : await chromium.launch({
          channel: "chrome",
          headless: true,
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"],
        });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1, locale: "en-US", ignoreHTTPSErrors: true });
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || /Spatial BI/.test(m.text())) problems.push(`${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto("https://web.geolibre.app/?lat=5.556&lon=95.325&zoom=11.4", { waitUntil: "load" });
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Settings"), null, { timeout: 90000 });
await page.waitForTimeout(2000);

await page.evaluate(`
  window.__w = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__t = (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t);
  window.__f = async (sel, t, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { const e = t == null ? document.querySelector(sel) : __t(sel, t); if (e) return e; await __w(100); } throw new Error("not found: " + sel + " " + (t ?? "")); };
  window.__p = (el) => ["pointerdown","mousedown","pointerup","mouseup","click"].forEach((t) => el.dispatchEvent(new (t.startsWith("pointer") ? PointerEvent : MouseEvent)(t, { bubbles: true, cancelable: true, button: 0 })));
  window.__v = (inp, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(inp, v); inp.dispatchEvent(new Event("input", { bubbles: true })); };
  window.__k = (k) => document.querySelector('.sbi [data-k="' + k + '"]');
  // pick a select option by value or by visible text, or type into an input, the way a person would
  window.__set = async (k, v) => {
    const el = __k(k);
    if (!el) throw new Error("no control " + k);
    if (el.tagName === "SELECT") {
      const o = [...el.options].find((o) => o.value === v || o.textContent.trim() === v);
      if (!o) throw new Error(k + " has no option " + v + " (" + [...el.options].map((o) => o.textContent).join(" | ") + ")");
      el.value = o.value;
    } else if (el.type === "checkbox") el.checked = v;
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await __w(350);
  };
  window.__tab = async (k) => { document.querySelector('.sbi [data-tab="' + k + '"]').click(); await __w(400); };
  window.__act = async (a, ms = 900) => { const b = [...document.querySelectorAll('.sbi [data-a="' + a + '"]')].find((b) => b.offsetParent); if (!b) throw new Error("no visible button " + a); if (b.disabled) throw new Error("button " + a + " is disabled"); b.click(); await __w(ms); };
  window.__state = (k) => ({ out: document.querySelector('.sbi [data-o="' + k + '"]').innerText.replace(/\\s+/g, " ").trim(), err: document.querySelector('.sbi [data-o="err"]').textContent, msg: document.querySelector('.sbi [data-o="msg"]').textContent });
`);

await page.evaluate((scheme) => document.querySelector(`[aria-label="Switch to ${scheme} mode"]`)?.click(), scheme);

await page.evaluate(async (base) => {
  __p(await __f("button", "Settings")); await __w(300);
  __p(await __f("[role=menuitem]", "Manage plugins")); await __w(300);
  __p(await __f("[role=dialog] button", "Settings")); await __w(300);
  const inp = await __f('[role=dialog] input[placeholder*="plugin.json"]');
  __v(inp, `${base}/plugin/plugin.json`); await __w(300);
  [...inp.parentElement.parentElement.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add").click();
  await __w(3500);
  (await __f("[role=dialog] button", "Close")).click(); await __w(500);
}, base);

if (process.env.DEBUG) {
  await page.screenshot({ path: join(out, "debug-install.png") });
  console.log(await page.evaluate(() => [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].map((d) => d.innerText.slice(0, 600)).join(" --- ")));
}

await page.evaluate(async (base) => {
  __p(await __f("button", "Plugins")); await __w(300);
  __p(await __f("[role=menuitem]", "Installed")); await __w(300);
  __p(await __f("[role=menuitem]", "Spatial BI")); await __w(300);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await __w(300);
  for (const name of ["zones", "customers", "outlets"]) {
    __p(await __f("button", "Add data")); await __w(300);
    __p(await __f("[role=menuitem]", "Vector layer")); await __w(300);
    __v(await __f('input[placeholder="https://example.com/data.geojson"]'), `${base}/sample/${name}.geojson`); await __w(200);
    (await __f("button", "Load")).click(); await __w(3000);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "×").forEach((b) => { b.click(); });
    await __w(400);
  }
  __p(await __f("button", "Spatial BI")); await __w(300);
  __p(await __f("[role=menuitem]", "Open Spatial BI")); await __w(600);
  if (!document.querySelector(".sbi")) throw new Error("Spatial BI panel did not open");
  await __act("refresh");
}, base);

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (file) => {
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, file) });
};
const layerOptions = () => page.evaluate(() => [...__k("sum_src").options].map((o) => o.textContent));

console.log("layers:", (await layerOptions()).join(" | "));

let s = await page.evaluate(async () => {
  await __set("sum_src", "customers"); await __set("sum_m", "spend_k"); await __set("sum_g", "segment");
  return __state("summary");
});
check("summary: 900 features and four segments", /900/.test(s.out) && /Reseller/.test(s.out) && /Household/.test(s.out) && !s.err, s.err || s.out.slice(0, 160));
await shot(`01-summary-${scheme}.png`);
s = await page.evaluate(async () => {
  document.querySelector('.sbi [data-cat="Reseller"]').click(); await __w(1500);
  return { pressed: document.querySelector('.sbi [data-cat="Reseller"]').getAttribute("aria-pressed"), layers: [...__k("th_src").options].length, ...__state("summary") };
});
check("summary: clicking a bar highlights the group", s.pressed === "true" && !s.err, s.err);
await shot(`02-highlight-${scheme}.png`);
await page.evaluate(() => __act("clear"));

s = await page.evaluate(async () => {
  await __tab("trend"); await __set("t_src", "customers"); await __set("t_p", "date"); await __set("t_m", "spend_k");
  const auto = __state("trend");
  await __set("t_unit", "quarter"); const quarter = __state("trend");
  await __set("t_p", "month"); const numeric = { ...__state("trend"), unitHidden: document.querySelector('.sbi [data-w="t_unit"]').hidden };
  await __set("t_p", "date"); await __set("t_unit", "auto");
  return { auto, quarter, numeric, dots: document.querySelectorAll(".sbi .sbi-line circle").length };
});
check("trend: 18 months from the date field, quarters, and a numeric period", /^18 Periods/.test(s.auto.out) && /2026-06/.test(s.auto.out) && /^6 Periods/.test(s.quarter.out) && /2025-Q1/.test(s.quarter.out) && /^12 Periods/.test(s.numeric.out) && s.numeric.unitHidden && s.dots === 18 && !s.auto.err, s.auto.err || s.auto.out.slice(0, 200));
await shot(`03-trend-${scheme}.png`);

s = await page.evaluate(async () => {
  await __tab("theme"); await __set("th_src", "zones"); await __set("th_f", "population"); await __set("th_m", "jenks"); await __set("th_ramp", "Blues");
  await __act("th_apply", 1500);
  return __state("theme");
});
check("thematic: five classes styled on the zone layer", (s.out.match(/–/g) ?? []).length >= 5 && /Styled/.test(s.msg) && !s.err, s.err || s.msg);
s = await page.evaluate(async () => {
  await __set("th_src", "customers"); await __set("th_f", "segment");
  await __act("th_apply", 1500);
  return __state("theme");
});
check("thematic: categories styled on the customer layer", /Reseller/.test(s.out) && /Styled/.test(s.msg) && !s.err, s.err || s.msg);
await shot(`04-thematic-${scheme}.png`);

s = await page.evaluate(async () => {
  await __tab("zones"); await __set("z_pts", "customers"); await __set("z_m", "spend_k"); await __set("z_mode", "hex"); await __set("z_hex", "1"); await __set("z_stat", "sbi_sum");
  await __act("run"); const ran = __state("zones");
  await __act("add", 1500);
  return { ran, after: __state("zones") };
});
check("zones: hexagon grid counts all 900 customers", /900/.test(s.ran.out) && !s.ran.err && /Added/.test(s.after.msg), s.ran.err || s.ran.out.slice(0, 160));
await shot(`05-zones-${scheme}.png`);
s = await page.evaluate(async () => {
  await __set("z_mode", "poly"); await __set("z_poly", "zones"); await __set("z_name", "zone");
  await __act("run");
  return __state("zones");
});
check("zones: polygon zones aggregate with names", /Z[A-F][1-6]/.test(s.out) && /36/.test(s.out) && !s.err, s.err || s.out.slice(0, 200));

s = await page.evaluate(async () => {
  await __tab("market"); await __set("m_fac", "outlets"); await __set("m_name", "outlet"); await __set("m_dem", "customers"); await __set("m_w", "spend_k"); await __set("m_model", "huff"); await __set("m_a", "floor_m2");
  await __act("run"); const ran = __state("market");
  await __act("add", 2000);
  return { ran, after: __state("market") };
});
check("market: Huff shares for 12 outlets, three layers added", /Outlet 01/.test(s.ran.out) && /HHI/.test(s.ran.out) && !s.ran.err && /3/.test(s.after.msg), s.ran.err || s.ran.out.slice(0, 220));
await shot(`06-market-${scheme}.png`);
s = await page.evaluate(async () => {
  await __set("m_model", "nearest"); await __act("run");
  return __state("market");
});
check("market: nearest-outlet model runs", /Outlet/.test(s.out) && !s.err, s.err);
s = await page.evaluate(async () => {
  await __set("m_dist", "factor"); await __set("m_factor", "1.4"); await __act("run");
  return __state("market");
});
check("market: detour factor lengthens the distances", /straight lines × 1\.40/.test(s.out) && !s.err, s.err || s.out.slice(-120));
s = await page.evaluate(async () => {
  await __set("m_dist", "straight"); await __set("m_model", "huff"); await __set("m_a", "floor_m2"); await __set("m_obs", "revenue_m"); await __set("m_beta", "3");
  document.querySelector('.sbi [data-a="calib"]').click(); await __w(1500);
  return { beta: __k("m_beta").value, ...__state("market") };
});
check("market: β calibrated from observed revenue", s.beta === "1.55" && /R² 1\.00/.test(s.msg) && !s.err, s.err || `${s.beta} ${s.msg}`);
if (process.env.OSRM_URL) {
  s = await page.evaluate(async (url) => {
    await __set("m_dist", "road"); await __set("m_url", url); await __set("m_imp", "time"); await __set("m_rings", "3, 6"); await __set("m_iso", true);
    const run = document.querySelector('.sbi [data-foot="market"] [data-a="run"]');
    run.click();
    for (let i = 0; i < 1500 && run.disabled; i++) await __w(200);
    const ran = __state("market");
    // only the new layers stay visible, so the picture shows the reach areas and nothing under them
    const eye = (re) => [...document.querySelectorAll("button")].find((b) => re.test(`${b.getAttribute("aria-label") ?? ""} ${b.title ?? ""}`));
    const hidden = eye(/hide all layers/i);
    hidden?.click(); await __w(600);
    await __act("add", 2500);
    const names = [...__k("sum_src").options].map((o) => o.textContent);
    return { ran, names, hidden: Boolean(hidden) };
  }, process.env.OSRM_URL);
  check("market: travel times and reach areas from the OSRM server", /Travel times follow/.test(s.ran.out) && /≤ 3 min/.test(s.ran.out) && /Mean min/.test(s.ran.out) && /points \d\.\d\d km apart/.test(s.ran.out) && !s.ran.err && s.names.includes("Market · reach areas"), s.ran.err || `${s.ran.out.slice(0, 200)} … ${s.ran.out.slice(-200)}`);
  await shot(`06-market-road-${scheme}.png`);
  await page.evaluate(async () => {
    [...document.querySelectorAll("button")].find((b) => /show all layers/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.title ?? ""}`))?.click();
    await __w(600);
    await __set("m_rings", "1, 3, 5");
  });
}
s = await page.evaluate(async () => {
  await __set("m_dist", "road"); await __set("m_url", "not a url"); await __act("run");
  const bad = __state("market").err;
  await __set("m_dist", "straight");
  return bad;
});
check("market: a missing server address is explained", /https:\/\//.test(s), s);

s = await page.evaluate(async () => {
  await __tab("sites"); await __set("s_dem", "customers"); await __set("s_w", "spend_k"); await __set("s_fac", "outlets"); await __set("s_mode", "hex"); await __set("s_goal", "coverage"); await __set("s_radius", "1"); await __set("s_p", "3");
  await __act("run", 1500); const cover = __state("sites");
  await __act("add", 2000); const added = __state("sites").msg;
  await __set("s_goal", "huff"); await __set("s_a", "floor_m2"); await __act("run", 1500); const huff = __state("sites");
  await __set("s_fac", ""); await __set("s_goal", "pmedian"); await __act("run", 1500); const median = __state("sites");
  await __set("s_mode", "layer"); await __set("s_cand", "zones"); await __act("run", 1500); const layer = __state("sites");
  return { cover, added, huff, median, layer };
});
check("sites: three sites raise coverage, added as two layers", /44% → \d\d%/.test(s.cover.out) && /Site 3/.test(s.cover.out) && !s.cover.err && /2/.test(s.added), s.cover.err || s.cover.out.slice(0, 200));
check("sites: Huff goal, no existing outlets, and a candidate layer", /New-site share/.test(s.huff.out) && !s.huff.err && /– → /.test(s.median.out) && !s.median.err && /Z[A-F][1-6]/.test(s.layer.out) && !s.layer.err, s.huff.err || s.median.err || s.layer.err || s.layer.out.slice(0, 200));
if (process.env.OSRM_URL) {
  s = await page.evaluate(async (url) => {
    await __set("s_mode", "hex"); await __set("s_hex", "1.5"); await __set("s_fac", "outlets"); await __set("s_goal", "coverage"); await __set("s_dist", "road"); await __set("s_imp", "time"); await __set("s_url", url); await __set("s_radius", "4");
    const run = document.querySelector('.sbi [data-foot="sites"] [data-a="run"]');
    run.click();
    for (let i = 0; i < 1500 && run.disabled; i++) await __w(200);
    const ran = __state("sites");
    await __set("s_dist", "factor"); await __set("s_hex", "1"); await __set("s_radius", "1");
    return ran;
  }, process.env.OSRM_URL);
  check("sites: chosen by travel time from the OSRM server", /\d+% → \d+%/.test(s.out) && /Mean min/.test(s.out) && /Travel times follow/.test(s.out) && /Site 3/.test(s.out) && !s.err, s.err || s.out.slice(0, 260));
}
await page.evaluate(async () => { await __set("s_mode", "hex"); await __set("s_fac", "outlets"); await __set("s_goal", "coverage"); await __act("run", 1500); });
await shot(`07-sites-${scheme}.png`);

s = await page.evaluate(async () => {
  await __tab("hot"); await __set("h_src", "customers · zones"); await __set("h_f", "sbi_sum");
  await __act("run", 1500); const ran = __state("hot");
  await __act("add", 2000);
  return { ran, after: __state("hot") };
});
check("hot spots: Gi* classes on the hexagon layer", /Hot spot 99%/.test(s.ran.out) && /Distance band/.test(s.ran.out) && !s.ran.err && /Added/.test(s.after.msg), s.ran.err || s.ran.out.slice(0, 220));
await shot(`08-hot-spots-${scheme}.png`);

s = await page.evaluate(async () => {
  await __tab("market"); await __set("m_dem", "outlets"); await __act("run");
  return __state("market");
});
check("errors are shown in the panel, not thrown", /different layers/.test(s.err), s.err);

console.log("layers at the end:", (await layerOptions()).join(" | "));
if (problems.length) console.log(`console:\n  ${problems.join("\n  ")}`);
await browser.close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed || problems.some((p) => p.startsWith("pageerror")) ? 1 : 0);
