import * as C from "./core.js";
import { ID_TEXT } from "./i18n.js";

const ID = "spatial-bi";
const PANEL = `${ID}-panel`;
const VERSION = __VERSION__;
const HIGHLIGHT = "Spatial BI (highlight)";
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    // an <img> SVG follows the color-scheme GeoLibre sets on <html>, so the mark flips with the theme
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><style>*{fill:#000}@media (prefers-color-scheme:dark){*{fill:#fff}}</style><rect x="2" y="13" width="4.5" height="9" rx="1"/><rect x="8" y="9" width="4.5" height="13" rx="1"/><rect x="14" y="15" width="4.5" height="7" rx="1"/><path d="M17.5 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 7 4.5 7s4.5-3.8 4.5-7a4.5 4.5 0 0 0-4.5-4.5zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"/></svg>',
  );

const RAMPS = {
  Blues: ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
  Greens: ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"],
  Oranges: ["#feedde", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#8c2d04"],
  Purples: ["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"],
  "Yellow–Red": ["#ffffb2", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#b10026"],
  Viridis: ["#440154", "#443983", "#31688e", "#21918c", "#35b779", "#90d743", "#fde725"],
  "Red–Green": ["#d73027", "#fc8d59", "#fee08b", "#ffffbf", "#d9ef8b", "#91cf60", "#1a9850"],
};
const CATEGORY_COLORS = ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#882255", "#F0E442", "#332288", "#999999", "#117733", "#AA4499"];
const OTHER_COLOR = "#b8b8b8";
const GI_COLORS = {
  "Hot spot 99%": "#b2182b", "Hot spot 95%": "#ef8a62", "Hot spot 90%": "#fddbc7", "Not significant": "#e0e0e0",
  "Cold spot 90%": "#d1e5f0", "Cold spot 95%": "#67a9cf", "Cold spot 99%": "#2166ac",
};
const TABS = [["summary", "Summary"], ["trend", "Trend"], ["theme", "Thematic"], ["zones", "Zones"], ["market", "Market"], ["sites", "Sites"], ["hot", "Hot spots"]];
// field selects that follow a layer select: [select, field type, label of the empty option]
const DEPENDS = {
  sum_src: [["sum_m", "number", "(count features)"], ["sum_g", "any", "(none)"]],
  t_src: [["t_p", "any", null], ["t_m", "number", "(count features)"]],
  th_src: [["th_f", "any", null]],
  z_pts: [["z_m", "number", "(count points)"]],
  z_poly: [["z_name", "any", "(row number)"]],
  m_fac: [["m_name", "any", "(row number)"], ["m_a", "number", "(equal)"], ["m_obs", "number", "(none)"]],
  s_fac: [["s_a", "number", "(equal)"]],
  m_dem: [["m_w", "number", "(count features)"]],
  s_dem: [["s_w", "number", "(count features)"]],
  h_src: [["h_f", "number", null]],
};
const HOT_LIMIT = 5000;
const PAIR_LIMIT = 4e6;
const SITE_LIMIT = 3e7;
// OSRM answers a table of at most 100 coordinates per request unless the server is configured otherwise
const OSRM_COORDS = 100;
const OSRM_REQUESTS = 150;
// how a reach is measured: metres shown as km, or seconds shown as minutes; `floor` keeps Huff away from a division by zero
const KM = { per: 1000, label: "km", floor: 50 };
const MIN = { per: 60, label: "min", floor: 30 };

const S = { app: null, root: null, dispose: [], tab: "summary", timer: null, res: {}, hl: null, hlId: null, profiles: new Map(), runId: 0, trendKind: "", pending: null };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 70);
// "zones" in a layer name and "Zones" on a tab are different strings in Indonesian
const keyOf = (en) => `plugin.${ID}.${/^[a-z]/.test(en) ? "lc_" : ""}${slug(en)}`;
const fillIn = (s, p) => (p ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in p ? p[k] : "")) : s);
function t(en, params) {
  const r = S.app?.translate?.(keyOf(en), en, params);
  return typeof r === "string" && r ? r : fillIn(en, params);
}
const locale = () => S.app?.getLocale?.() ?? "en";
const nf = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
function nc(n) {
  if (!Number.isFinite(n)) return "–";
  if (Math.abs(n) >= 1e6) return n.toLocaleString(locale(), { notation: "compact", maximumFractionDigits: 2 });
  return nf(n, Number.isInteger(n) || Math.abs(n) >= 1000 ? 0 : 2);
}
const pct = (v, d = 1) => (Number.isFinite(v) ? `${nf(v * 100, d)}%` : "–");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r2 = (v, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);

const opt = (pairs, sel) => pairs.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(t(l))}</option>`).join("");
const num = (k, d, attrs = "") => `<input type="number" data-k="${k}" value="${d}" ${attrs}>`;
const fld = (label, inner, wrap = "") => `<label class="sbi-f"${wrap ? ` data-w="${wrap}"` : ""}><span>${esc(t(label))}</span>${inner}</label>`;
const layerSel = (k, optional) => `<select data-k="${k}" data-layer="${optional ? "optional" : "required"}"></select>`;
const check = (k, label, on, wrap = "") => `<label class="sbi-check"${wrap ? ` data-w="${wrap}"` : ""}><input type="checkbox" data-k="${k}"${on ? " checked" : ""}>${esc(t(label))}</label>`;
const btn = (a, label, primary) => `<button type="button" class="${primary ? "sbi-btn" : "sbi-btn sbi-ghost"}" data-a="${a}">${esc(t(label))}</button>`;

function template() {
  return `
  <div class="sbi-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${esc(t(l))}</button>`).join("")}</div>
  <div class="sbi-body">
    <section data-pane="summary">
      <div class="sbi-sec">
        ${fld("Layer", layerSel("sum_src"))}
        <div class="sbi-row">${fld("Measure", `<select data-k="sum_m"></select>`)}${fld("Group by", `<select data-k="sum_g"></select>`)}</div>
        <div class="sbi-row">
          ${fld("Aggregate", `<select data-k="sum_agg">${opt([["sum", "Sum"], ["mean", "Mean"], ["count", "Count"]])}</select>`, "sum_agg")}
          ${fld("Show top", num("sum_top", 10, 'min="3" max="50" step="1"'), "sum_top")}
        </div>
        ${check("sum_sel", "Selected features only", false)}
      </div>
      <div class="sbi-out" data-o="summary"></div>
    </section>
    <section data-pane="trend" hidden>
      <div class="sbi-sec">
        ${fld("Layer", layerSel("t_src"))}
        <div class="sbi-row">${fld("Period field", `<select data-k="t_p"></select>`)}${fld("Measure", `<select data-k="t_m"></select>`)}</div>
        <div class="sbi-row">
          ${fld("Aggregate", `<select data-k="t_agg">${opt([["sum", "Sum"], ["mean", "Mean"], ["count", "Count"]])}</select>`, "t_agg")}
          ${fld("Period", `<select data-k="t_unit">${opt([["auto", "Automatic"], ["day", "Day"], ["month", "Month"], ["quarter", "Quarter"], ["year", "Year"]])}</select>`, "t_unit")}
        </div>
      </div>
      <div class="sbi-out" data-o="trend"></div>
    </section>
    <section data-pane="theme" hidden>
      <div class="sbi-sec">
        ${fld("Layer", layerSel("th_src"))}
        ${fld("Field", `<select data-k="th_f"></select>`)}
        <div class="sbi-row">
          ${fld("Classes by", `<select data-k="th_m">${opt([["quantile", "Quantiles"], ["jenks", "Natural breaks"], ["equal", "Equal intervals"]])}</select>`, "th_m")}
          ${fld("Classes", num("th_k", 5, 'min="2" max="7" step="1"'), "th_k")}
        </div>
        <div class="sbi-row">
          ${fld("Colours", `<select data-k="th_ramp">${Object.keys(RAMPS).map((r) => `<option value="${r}">${esc(t(r))}</option>`).join("")}</select>`, "th_ramp")}
          ${fld("Opacity (%)", num("th_op", 80, 'min="10" max="100" step="5"'))}
        </div>
        ${check("th_rev", "Reverse colours", false, "th_rev")}
        ${check("th_prop", "Size points by value", false, "th_prop")}
      </div>
      <div class="sbi-out" data-o="theme"></div>
    </section>
    <section data-pane="zones" hidden>
      <div class="sbi-sec">
        ${fld("Points", layerSel("z_pts"))}
        ${fld("Measure", `<select data-k="z_m"></select>`)}
        <div class="sbi-row">
          ${fld("Zones", `<select data-k="z_mode">${opt([["hex", "Hexagon grid"], ["poly", "Polygon layer"]])}</select>`)}
          ${fld("Hexagon width (km)", num("z_hex", 1, 'min="0.05" step="0.25"'), "z_hex")}
        </div>
        ${fld("Zone layer", layerSel("z_poly"), "z_poly")}
        ${fld("Zone name", `<select data-k="z_name"></select>`, "z_name")}
        ${fld("Colour by", `<select data-k="z_stat">${opt([["sbi_count", "Count"], ["sbi_sum", "Sum"], ["sbi_mean", "Mean"], ["sbi_count_km2", "Count per km²"], ["sbi_share_pct", "Share (%)"]])}</select>`)}
      </div>
      <div class="sbi-out" data-o="zones"></div>
    </section>
    <section data-pane="market" hidden>
      <div class="sbi-sec">
        ${fld("Outlets", layerSel("m_fac"))}
        <div class="sbi-row">${fld("Outlet name", `<select data-k="m_name"></select>`)}${fld("Model", `<select data-k="m_model">${opt([["huff", "Huff (gravity)"], ["nearest", "Nearest outlet"]])}</select>`)}</div>
        ${fld("Demand", layerSel("m_dem"))}
        ${fld("Demand weight", `<select data-k="m_w"></select>`)}
        <div class="sbi-row" data-w="m_huff">
          ${fld("Attractiveness", `<select data-k="m_a"></select>`)}
          ${fld("Distance decay β", num("m_beta", 2, 'min="0.1" max="5" step="0.05"'))}
        </div>
        <div class="sbi-row" data-w="m_cal">
          ${fld("Observed sales", `<select data-k="m_obs"></select>`)}
          <div class="sbi-f sbi-end">${btn("calib", "Calibrate β")}</div>
        </div>
        <div class="sbi-row">
          ${fld("Rings (km or min)", `<input type="text" data-k="m_rings" value="1, 3, 5" placeholder="1, 3, 5">`)}
          ${fld("Maximum (km or min)", `<input type="number" data-k="m_max" value="" min="0.1" step="0.5" placeholder="${esc(t("no limit"))}">`, "m_max")}
        </div>
        <div class="sbi-row">
          ${fld("Distance", `<select data-k="m_dist">${opt([["straight", "Straight line"], ["factor", "Straight line × factor"], ["road", "Road network (OSRM)"]])}</select>`)}
          ${fld("Detour factor", num("m_factor", 1.3, 'min="1" max="3" step="0.05"'), "m_factor")}
        </div>
        <div class="sbi-row" data-w="m_road">
          ${fld("Measure reach by", `<select data-k="m_imp">${opt([["distance", "Road distance (km)"], ["time", "Travel time (min)"]])}</select>`)}
          <div class="sbi-f sbi-end">${check("m_iso", "Draw reach areas", true)}</div>
        </div>
        ${fld("Routing server URL", `<input type="text" data-k="m_url" value="" placeholder="https://router.example.org" inputmode="url">`, "m_url")}
        <p class="sbi-note" data-w="m_url_note">${esc(t("The coordinates of both layers are sent to this server. Attributes stay in the browser."))}</p>
      </div>
      <div class="sbi-out" data-o="market"></div>
    </section>
    <section data-pane="sites" hidden>
      <div class="sbi-sec">
        ${fld("Demand", layerSel("s_dem"))}
        ${fld("Demand weight", `<select data-k="s_w"></select>`)}
        ${fld("Existing outlets", layerSel("s_fac", true))}
        <div class="sbi-row">
          ${fld("Candidates", `<select data-k="s_mode">${opt([["hex", "Hexagon centres"], ["layer", "Candidate layer"]])}</select>`)}
          ${fld("Hexagon width (km)", num("s_hex", 1, 'min="0.05" step="0.25"'), "s_hex")}
        </div>
        ${fld("Candidate layer", layerSel("s_cand"), "s_cand")}
        ${fld("Goal", `<select data-k="s_goal">${opt([["coverage", "Cover the most demand within a distance"], ["pmedian", "Shortest average distance"], ["huff", "Largest market share (Huff)"]])}</select>`)}
        <div class="sbi-row">
          ${fld("New sites", num("s_p", 3, 'min="1" max="20" step="1"'))}
          ${fld("Service limit (km or min)", num("s_radius", 2, 'min="0.1" step="0.5"'), "s_radius")}
          ${fld("Distance decay β", num("s_beta", 2, 'min="0.1" max="5" step="0.05"'), "s_beta")}
        </div>
        <div class="sbi-row" data-w="s_huff">
          ${fld("Attractiveness of outlets", `<select data-k="s_a"></select>`)}
          ${fld("Attractiveness of a new site", `<input type="number" data-k="s_new" value="" min="0" step="any" placeholder="${esc(t("mean of outlets"))}">`)}
        </div>
        <div class="sbi-row">
          ${fld("Distance", `<select data-k="s_dist">${opt([["factor", "Straight line × factor"], ["road", "Road network (OSRM)"]])}</select>`)}
          ${fld("Detour factor", num("s_factor", 1, 'min="1" max="3" step="0.05"'), "s_factor")}
          ${fld("Measure reach by", `<select data-k="s_imp">${opt([["distance", "Road distance (km)"], ["time", "Travel time (min)"]])}</select>`, "s_imp")}
        </div>
        ${fld("Routing server URL", `<input type="text" data-k="s_url" value="" placeholder="https://router.example.org" inputmode="url">`, "s_url")}
        <p class="sbi-note" data-w="s_url_note">${esc(t("The coordinates of both layers are sent to this server. Attributes stay in the browser."))}</p>
      </div>
      <div class="sbi-out" data-o="sites"></div>
    </section>
    <section data-pane="hot" hidden>
      <div class="sbi-sec">
        ${fld("Layer", layerSel("h_src"))}
        <div class="sbi-row">
          ${fld("Value", `<select data-k="h_f"></select>`)}
          ${fld("Distance band (km)", `<input type="number" data-k="h_band" value="" min="0.01" step="0.1" placeholder="${esc(t("auto"))}">`)}
        </div>
      </div>
      <div class="sbi-out" data-o="hot"></div>
    </section>
  </div>
  <div class="sbi-foot">
    <div class="sbi-err" data-o="err" hidden></div>
    <div class="sbi-btns" data-foot="summary">${btn("refresh", "Refresh")}${btn("clear", "Clear highlight")}${btn("csv", "CSV")}</div>
    <div class="sbi-btns" data-foot="trend" hidden>${btn("refresh", "Refresh")}${btn("csv", "CSV")}</div>
    <div class="sbi-btns" data-foot="theme" hidden>${btn("refresh", "Refresh")}${btn("th_copy", "Add as new layer")}${btn("th_apply", "Style layer", true)}</div>
    <div class="sbi-btns" data-foot="zones" hidden>${btn("csv", "CSV")}${btn("add", "Add to map")}${btn("run", "Run", true)}</div>
    <div class="sbi-btns" data-foot="market" hidden>${btn("csv", "CSV")}${btn("add", "Add to map")}${btn("run", "Run", true)}</div>
    <div class="sbi-btns" data-foot="sites" hidden>${btn("csv", "CSV")}${btn("add", "Add to map")}${btn("run", "Run", true)}</div>
    <div class="sbi-btns" data-foot="hot" hidden>${btn("csv", "CSV")}${btn("add", "Add to map")}${btn("run", "Run", true)}</div>
    <div class="sbi-msg" data-o="msg" role="status"></div>
  </div>`;
}

const el = (k) => S.root.querySelector(`[data-k="${k}"]`);
const out = (k) => S.root.querySelector(`[data-o="${k}"]`);
const wrap = (k) => S.root.querySelector(`[data-w="${k}"]`);
const val = (k) => el(k).value;
const numv = (k, d) => {
  const v = parseFloat(el(k).value);
  return Number.isFinite(v) ? v : d;
};
const message = (text) => { out("msg").textContent = text; };
function fail(text) {
  out("err").hidden = !text;
  out("err").textContent = text ?? "";
}

function layers() {
  return (S.app.listLayers?.() ?? []).filter((l) => l.id !== S.hlId);
}
const layerName = (id) => layers().find((l) => l.id === id)?.name ?? "Layer";
function feats(id) {
  if (!id) return [];
  try {
    return (S.app.getLayerFeatures?.(id) ?? []).filter((f) => f?.geometry);
  } catch {
    return [];
  }
}
function kindOf(features) {
  const count = { point: 0, line: 0, polygon: 0 };
  for (const f of features.slice(0, 200)) {
    const type = f.geometry.type;
    if (type.includes("Point")) count.point++;
    else if (type.includes("Line")) count.line++;
    else if (type.includes("Polygon")) count.polygon++;
  }
  const [kind, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return n ? kind : null;
}
function inWgs84(features) {
  const b = C.bboxOfFeatures(features);
  return !b || (b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90);
}
function profileOf(id) {
  const features = feats(id);
  const key = `${id}:${features.length}`;
  if (!S.profiles.has(key)) {
    if (S.profiles.size > 30) S.profiles.clear();
    S.profiles.set(key, C.profile(features));
  }
  return S.profiles.get(key);
}

function refreshSources() {
  const list = layers();
  for (const sel of S.root.querySelectorAll("select[data-layer]")) {
    const prev = sel.value, optional = sel.dataset.layer === "optional", first = !sel.options.length;
    sel.innerHTML =
      (optional ? `<option value="">${esc(t("(none)"))}</option>` : "") +
      (list.length || optional ? list.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("") : `<option value="">${esc(t("No layers on the map"))}</option>`);
    if (prev && list.some((l) => l.id === prev)) sel.value = prev;
    else if (optional) sel.value = "";
    else if (list.length && (first || prev)) sel.value = (list.slice().reverse().find((l) => feats(l.id).length) ?? list[0]).id;
    fillFields(sel.dataset.k);
  }
}

function fillFields(layerKey) {
  const fields = profileOf(val(layerKey));
  for (const [k, type, none] of DEPENDS[layerKey] ?? []) {
    const sel = el(k), prev = sel.value, had = sel.dataset.layerId === val(layerKey);
    const list = fields.filter((f) => type === "any" || f.type === type);
    sel.innerHTML = (none ? `<option value="">${esc(t(none))}</option>` : "") + list.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join("");
    sel.dataset.layerId = val(layerKey);
    if (had && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (k === "sum_g") sel.value = list.find((f) => f.type === "category" && f.distinct >= 2 && f.distinct <= 50)?.name ?? "";
    else if (k === "sum_m") sel.value = list[0]?.name ?? "";
    else if (k === "t_p") sel.value = (list.find((f) => /date|tanggal|tgl|time|waktu/i.test(f.name)) ?? list.find((f) => /period|month|bulan|year|tahun|quarter|triwulan|week|minggu/i.test(f.name)) ?? list[0])?.name ?? "";
    else if (k === "th_f") sel.value = (list.find((f) => f.type === "number") ?? list[0])?.name ?? "";
    else if (k === "m_name" || k === "z_name") sel.value = list.find((f) => f.type === "category" && f.distinct === f.filled)?.name ?? "";
    else if (none) sel.value = "";
  }
}

function syncFields() {
  const measure = val("sum_m"), group = val("sum_g");
  wrap("sum_agg").hidden = !measure;
  wrap("sum_top").hidden = !group;
  const field = profileOf(val("th_src")).find((f) => f.name === val("th_f"));
  const numeric = field?.type === "number";
  wrap("th_m").hidden = wrap("th_k").hidden = wrap("th_ramp").hidden = wrap("th_rev").hidden = !numeric;
  wrap("th_prop").hidden = !numeric || kindOf(feats(val("th_src"))) !== "point";
  const hex = val("z_mode") === "hex";
  wrap("z_hex").hidden = !hex;
  wrap("z_poly").hidden = wrap("z_name").hidden = hex;
  for (const o of el("z_stat").options) if (o.value === "sbi_sum" || o.value === "sbi_mean") o.disabled = !val("z_m");
  if (!val("z_m") && ["sbi_sum", "sbi_mean"].includes(val("z_stat"))) el("z_stat").value = "sbi_count";
  wrap("m_huff").hidden = wrap("m_max").hidden = val("m_model") !== "huff";
  wrap("t_agg").hidden = !val("t_m");
  wrap("t_unit").hidden = S.trendKind !== "date";
  wrap("m_factor").hidden = val("m_dist") !== "factor";
  wrap("m_url").hidden = wrap("m_url_note").hidden = wrap("m_road").hidden = val("m_dist") !== "road";
  wrap("m_cal").hidden = val("m_model") !== "huff";
  wrap("s_huff").hidden = val("s_goal") !== "huff";
  wrap("s_factor").hidden = val("s_dist") === "road";
  wrap("s_imp").hidden = wrap("s_url").hidden = wrap("s_url_note").hidden = val("s_dist") !== "road";
  wrap("s_hex").hidden = val("s_mode") !== "hex";
  wrap("s_cand").hidden = val("s_mode") === "hex";
  wrap("s_radius").hidden = val("s_goal") !== "coverage";
  wrap("s_beta").hidden = val("s_goal") !== "huff";
  for (const [k] of TABS) {
    S.root.querySelector(`[data-pane="${k}"]`).hidden = k !== S.tab;
    S.root.querySelector(`[data-foot="${k}"]`).hidden = k !== S.tab;
    S.root.querySelector(`[data-tab="${k}"]`).setAttribute("aria-selected", String(k === S.tab));
  }
  const ready = Boolean(S.res[S.tab]);
  for (const b of S.root.querySelectorAll(`[data-foot="${S.tab}"] [data-a="add"], [data-foot="${S.tab}"] [data-a="csv"]`)) b.disabled = S.tab !== "summary" && !ready;
}

// ---- styles ---------------------------------------------------------------

function pickColors(ramp, k, reverse) {
  const base = RAMPS[ramp] ?? RAMPS.Blues;
  const colors = k === 1 ? [base[4]] : Array.from({ length: k }, (_, i) => base[Math.round((i * (base.length - 1)) / (k - 1))]);
  return reverse ? colors.reverse() : colors;
}
function stepExpr(field, breaks, colors) {
  const e = ["step", ["to-number", ["get", field], breaks[0]], colors[0]];
  for (let i = 1; i < breaks.length - 1; i++) e.push(breaks[i], colors[i]);
  return e;
}
function matchExpr(field, pairs, fallback) {
  const e = ["match", ["to-string", ["get", field]]];
  for (const [value, color] of pairs) e.push(value, color);
  e.push(fallback);
  return e;
}
/** A Mapbox GL style in the shapes GeoLibre's style import reads back as graduated, categorized or proportional renderers. */
function styleText(kind, { color, opacity = 0.8, radius = 5, stroke = "#ffffff", width = 0.6 }) {
  const layers =
    kind === "point"
      ? [{ id: "sbi-circle", type: "circle", source: "sbi", paint: { "circle-color": color, "circle-radius": radius, "circle-opacity": opacity, "circle-stroke-color": stroke, "circle-stroke-width": 1 } }]
      : kind === "line"
        ? [{ id: "sbi-line", type: "line", source: "sbi", paint: { "line-color": color, "line-width": Math.max(2, width) } }]
        : [
            { id: "sbi-fill", type: "fill", source: "sbi", paint: { "fill-color": color, "fill-opacity": opacity } },
            { id: "sbi-line", type: "line", source: "sbi", paint: { "line-color": stroke, "line-width": width } },
          ];
  return JSON.stringify({ version: 8, sources: {}, layers });
}
function applyStyle(layerId, text) {
  try {
    const r = S.app.importLayerStyle?.(layerId, text);
    if (r && !r.ok) console.warn("[Spatial BI] style", r);
    return !r || r.ok;
  } catch (e) {
    console.warn("[Spatial BI] style", e);
    return false;
  }
}
const fc = (features) => ({ type: "FeatureCollection", features });
const copyFeature = (f, extra) => ({ type: "Feature", properties: { ...(f.properties ?? {}), ...extra }, geometry: f.geometry });
function addLayer(name, features, style) {
  const id = S.app.addGeoJsonLayer(name, fc(features));
  if (style) applyStyle(id, style);
  return id;
}
function graduated(features, field, kind, ramp = "Blues", k = 5) {
  const breaks = C.classify(features.map((f) => C.toNumber(f.properties[field])).filter((v) => v !== null), "quantile", k);
  if (breaks.length < 2) return styleText(kind, { color: RAMPS[ramp][4] });
  return styleText(kind, { color: stepExpr(field, breaks, pickColors(ramp, breaks.length - 1)), stroke: kind === "point" ? "#ffffff" : "#5a5a5a" });
}

// ---- summary --------------------------------------------------------------

function summarySource() {
  const id = val("sum_src");
  let features = feats(id), selected = false;
  if (el("sum_sel").checked && S.app.getSelectedLayerId?.() === id) {
    const picked = (S.app.getSelectedFeatures?.() ?? []).filter((f) => f?.geometry);
    if (picked.length) {
      features = picked;
      selected = true;
    }
  }
  return { id, features, selected, total: feats(id).length };
}

function runSummary() {
  const { features, selected, total } = summarySource();
  const measure = val("sum_m"), group = val("sum_g"), agg = measure ? val("sum_agg") : "count";
  const box = out("summary");
  if (!features.length) {
    S.res.summary = null;
    box.innerHTML = `<p class="sbi-hint">${esc(t("Pick a layer with features to see its numbers."))}</p>`;
    return;
  }
  const values = measure ? features.map((f) => C.toNumber(f.properties?.[measure])).filter((v) => v !== null) : [];
  const s = C.summary(values);
  const kpi = (label, value, title = "") => `<div class="sbi-kpi"${title ? ` title="${esc(title)}"` : ""}><b>${esc(value)}</b><span>${esc(t(label))}</span></div>`;
  const cards = [kpi("Features", selected ? `${nf(features.length)} / ${nf(total)}` : nf(features.length), selected ? t("Selected / all features") : "")];
  if (measure) {
    cards.push(kpi("Total", nc(s.sum), nf(s.sum, 2)), kpi("Mean", nc(s.mean), nf(s.mean, 2)), kpi("Median", nc(s.median), nf(s.median, 2)), kpi("Minimum", nc(s.min)), kpi("Maximum", nc(s.max)));
  }
  let html = `<div class="sbi-kpis">${cards.join("")}</div>`;
  if (measure && s.n < features.length) html += `<p class="sbi-note">${esc(t("{{n}} features have no number in this field and are left out.", { n: nf(features.length - s.n) }))}</p>`;

  let rows = [];
  if (group) {
    rows = C.pareto(C.groupBy(features, group, measure, agg));
    const top = Math.max(3, Math.round(numv("sum_top", 10)));
    const shown = rows.slice(0, top), rest = rows.slice(top);
    const max = Math.max(...shown.map((r) => (r.value > 0 ? r.value : 0)), 0) || 1;
    const aggLabel = agg === "count" ? t("Count") : `${agg === "mean" ? t("Mean") : t("Sum")} · ${measure}`;
    html += `<h4>${esc(aggLabel)} ${esc(t("by"))} ${esc(group)}</h4><div class="sbi-bars">`;
    for (const r of shown) {
      const on = S.hl === r.key;
      html += `<button type="button" class="sbi-bar" data-cat="${esc(r.key)}" aria-pressed="${on}" title="${esc(t("Show on the map"))}">
        <span class="sbi-bar-l">${esc(r.key)}</span>
        <span class="sbi-bar-t"><i style="width:${Math.max(0, (r.value / max) * 100).toFixed(1)}%"></i></span>
        <span class="sbi-bar-v">${esc(nc(r.value))}</span><span class="sbi-bar-s">${Number.isFinite(r.share) ? pct(r.share, 0) : ""}</span></button>`;
    }
    html += "</div>";
    if (rest.length) {
      const sum = rest.reduce((a, r) => a + (r.value > 0 ? r.value : 0), 0);
      html += `<p class="sbi-note">${esc(t("{{n}} more groups", { n: nf(rest.length) }))}${agg !== "mean" ? ` · ${esc(nc(sum))}` : ""}</p>`;
    }
    if (agg !== "mean" && rows.length > 1) {
      const a = rows.filter((r) => r.abc === "A").length;
      const g = C.gini(rows.map((r) => r.value));
      html += `<p class="sbi-note">${esc(t("ABC: {{a}} of {{n}} groups carry 80% of the total.", { a: nf(a), n: nf(rows.length) }))} ${esc(t("Gini {{g}}", { g: nf(g, 2) }))}</p>`;
    }
  }
  const h = measure ? C.histogram(values) : null;
  if (h && h.counts.length > 1) {
    const peak = Math.max(...h.counts), w = 100 / h.counts.length;
    html += `<h4>${esc(t("Distribution"))} · ${esc(measure)}</h4><svg class="sbi-hist" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="${esc(t("Distribution"))}">`;
    h.counts.forEach((c, i) => {
      const bar = (c / peak) * 30;
      html += `<rect x="${(i * w + 0.4).toFixed(2)}" y="${(32 - bar).toFixed(2)}" width="${(w - 0.8).toFixed(2)}" height="${bar.toFixed(2)}"><title>${esc(nc(h.min + i * h.step))} – ${esc(nc(h.min + (i + 1) * h.step))}: ${nf(c)}</title></rect>`;
    });
    html += `</svg><div class="sbi-axis"><span>${esc(nc(h.min))}</span><span>${esc(nc(h.max))}</span></div>`;
  }
  box.innerHTML = html;
  S.res.summary = { rows, group, measure, agg, s, features };
}

function highlight(key) {
  const r = S.res.summary;
  if (!r?.group) return;
  S.hl = S.hl === key ? null : key;
  if (S.hl === null) {
    dropHighlight();
    runSummary();
    return;
  }
  const picked = r.features.filter((f) => (f.properties?.[r.group] === null || f.properties?.[r.group] === undefined || f.properties?.[r.group] === "" ? "(blank)" : String(f.properties[r.group])) === key);
  const data = fc(picked.map((f) => copyFeature(f)));
  if (!(S.hlId && S.app.updateGeoJsonLayer?.(S.hlId, data))) {
    dropHighlight(true);
    S.hlId = S.app.addGeoJsonLayer(HIGHLIGHT, data);
    applyStyle(S.hlId, styleText(kindOf(picked) ?? "polygon", { color: "#ff2d95", opacity: 0.45, radius: 7, stroke: "#ff2d95", width: 2.5 }));
  }
  const b = C.bboxOfFeatures(picked);
  if (b) S.app.fitBounds?.(b);
  runSummary();
}
function dropHighlight(keepKey) {
  if (S.hlId) {
    try {
      S.app.removeLayer?.(S.hlId);
    } catch {
      /* the user already removed it */
    }
  }
  S.hlId = null;
  if (!keepKey) S.hl = null;
}

// ---- thematic -------------------------------------------------------------

function themeSpec() {
  const id = val("th_src"), features = feats(id), field = val("th_f");
  if (!features.length || !field) return null;
  const kind = kindOf(features);
  const numeric = profileOf(id).find((f) => f.name === field)?.type === "number";
  const opacity = Math.min(1, Math.max(0.1, numv("th_op", 80) / 100));
  if (numeric) {
    const values = features.map((f) => C.toNumber(f.properties?.[field])).filter((v) => v !== null);
    const breaks = C.classify(values, val("th_m"), Math.min(7, Math.max(2, Math.round(numv("th_k", 5)))));
    if (breaks.length < 2) return null;
    const k = breaks.length - 1;
    const colors = pickColors(val("th_ramp"), k, el("th_rev").checked);
    const counts = new Array(k).fill(0);
    for (const v of values) counts[C.classOf(v, breaks)]++;
    const legend = colors.map((c, i) => ({ color: c, label: `${nc(breaks[i])} – ${nc(breaks[i + 1])}`, n: counts[i] }));
    const radius = el("th_prop").checked && kind === "point" && breaks[0] < breaks[k] ? ["interpolate", ["linear"], ["to-number", ["get", field], breaks[0]], breaks[0], 3, breaks[k], 18] : 5;
    return { id, features, field, kind, legend, missing: features.length - values.length, style: styleText(kind, { color: stepExpr(field, breaks, colors), opacity, radius, stroke: kind === "point" ? "#ffffff" : "#5a5a5a" }) };
  }
  const rows = C.groupBy(features, field, "", "count");
  const top = rows.slice(0, CATEGORY_COLORS.length);
  const legend = top.map((r, i) => ({ color: CATEGORY_COLORS[i], label: r.key, n: r.n }));
  const rest = rows.slice(top.length).reduce((a, r) => a + r.n, 0);
  if (rest) legend.push({ color: OTHER_COLOR, label: t("Other"), n: rest });
  return { id, features, field, kind, legend, missing: 0, style: styleText(kind, { color: matchExpr(field, top.map((r, i) => [r.key, CATEGORY_COLORS[i]]), OTHER_COLOR), opacity, stroke: kind === "point" ? "#ffffff" : "#5a5a5a" }) };
}

function legendHtml(legend) {
  return `<ul class="sbi-legend">${legend.map((l) => `<li><i style="background:${l.color}"></i><span>${esc(l.label)}</span><b>${nf(l.n)}</b></li>`).join("")}</ul>`;
}

function runTheme() {
  const spec = themeSpec();
  S.res.theme = spec;
  const box = out("theme");
  if (!spec) {
    box.innerHTML = `<p class="sbi-hint">${esc(t("Pick a layer and a field to colour it by."))}</p>`;
    return;
  }
  box.innerHTML =
    `<h4>${esc(spec.field)}</h4>${legendHtml(spec.legend)}` +
    (spec.missing ? `<p class="sbi-note">${esc(t("{{n}} features without a number are drawn in the lowest class.", { n: nf(spec.missing) }))}</p>` : "");
}

function applyTheme(copy) {
  const spec = S.res.theme;
  if (!spec) return message(t("Nothing to style yet."));
  const name = layerName(spec.id);
  const target = copy ? S.app.addGeoJsonLayer(`${name} · ${spec.field}`, fc(spec.features.map((f) => copyFeature(f)))) : spec.id;
  const ok = applyStyle(target, spec.style);
  if (copy) refreshSources();
  message(ok ? (copy ? t('Added "{{name}}".', { name: `${name} · ${spec.field}` }) : t('Styled "{{name}}".', { name })) : t("GeoLibre could not apply this style to the layer."));
}

// ---- shared inputs for the spatial tools ----------------------------------

function weighted(features, field) {
  const list = [];
  let skipped = 0;
  for (const f of features) {
    const xy = C.centroid(f.geometry);
    const w = field ? C.toNumber(f.properties?.[field]) : 1;
    if (!xy || w === null || w < 0) skipped++;
    else list.push({ xy, w, f });
  }
  return { list, skipped };
}
const labelOf = (f, field, i) => (field && f.properties?.[field] !== null && f.properties?.[field] !== undefined && f.properties[field] !== "" ? String(f.properties[field]) : `#${i + 1}`);
function table(head, rows, limit = 12) {
  const more = rows.length - limit;
  return (
    `<table class="sbi-table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows.slice(0, limit).map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("") +
    `</tbody></table>` +
    (more > 0 ? `<p class="sbi-note">${esc(t("{{n}} more rows in the CSV.", { n: nf(more) }))}</p>` : "")
  );
}

// ---- zones ----------------------------------------------------------------

function runZones() {
  const ptsFeatures = feats(val("z_pts")), measure = val("z_m");
  if (!ptsFeatures.length) throw new Error(t("Pick a layer with features."));
  if (!inWgs84(ptsFeatures)) throw new Error(t("Layers must be in WGS 84 (EPSG:4326)."));
  const { list: pts, skipped } = weighted(ptsFeatures, measure);
  if (!pts.length) throw new Error(t("No usable features in this layer."));
  let features, outside = 0, labels;
  const stats = (n, sum, areaM2, total) => {
    const km2 = areaM2 / 1e6;
    return { sbi_count: n, sbi_sum: measure ? r2(sum) : null, sbi_mean: measure && n ? r2(sum / n) : null, sbi_area_km2: r2(km2, 4), sbi_count_km2: km2 > 0 ? r2(n / km2) : null, sbi_share_pct: total > 0 ? r2(((measure ? sum : n) / total) * 100) : null };
  };
  const total = pts.reduce((a, p) => a + (measure ? p.w : 1), 0);
  if (val("z_mode") === "hex") {
    const width = numv("z_hex", 1) * 1000;
    if (!(width > 0)) throw new Error(t("Hexagon width must be above zero."));
    const b = C.bboxOfFeatures(pts.map((p) => ({ geometry: { type: "Point", coordinates: p.xy } })));
    if ((C.haversine([b[0], b[1]], [b[2], b[1]]) * C.haversine([b[0], b[1]], [b[0], b[3]])) / (width * width) > 250000) throw new Error(t("This hexagon width makes too many cells; use a larger width."));
    const { cells } = C.hexBin(pts, width);
    features = cells.map((c, i) => ({ type: "Feature", properties: { sbi_zone: `H${i + 1}`, ...stats(c.n, c.sum, c.areaM2, total) }, geometry: { type: "Polygon", coordinates: [c.ring] } }));
    labels = features.map((f) => f.properties.sbi_zone);
  } else {
    const zones = feats(val("z_poly")).filter((f) => f.geometry.type.includes("Polygon"));
    if (!zones.length) throw new Error(t("The zone layer has no polygons."));
    if (zones.length * pts.length > 5e7) throw new Error(t("Too many points and zones for one run; filter the layers first."));
    const r = C.aggregate(pts, zones);
    outside = r.outside;
    features = zones.map((z, i) => copyFeature(z, stats(r.stats[i].n, r.stats[i].sum, C.areaM2(z.geometry), total)));
    labels = zones.map((z, i) => labelOf(z, val("z_name"), i));
  }
  const stat = val("z_stat");
  const order = features.map((_, i) => i).sort((a, b) => (features[b].properties[stat] ?? -Infinity) - (features[a].properties[stat] ?? -Infinity));
  const head = [t("Zone"), t("Count"), ...(measure ? [t("Sum"), t("Mean")] : []), t("per km²"), t("Share (%)")];
  const raw = order.map((i) => {
    const p = features[i].properties;
    return [labels[i], p.sbi_count, ...(measure ? [p.sbi_sum, p.sbi_mean] : []), p.sbi_count_km2, p.sbi_share_pct];
  });
  const filled = features.filter((f) => f.properties.sbi_count > 0).length;
  S.res.zones = { features, stat, name: `${layerName(val("z_pts"))} · ${t("zones")}`, csv: { head, rows: raw } };
  out("zones").innerHTML =
    `<div class="sbi-kpis"><div class="sbi-kpi"><b>${nf(features.length)}</b><span>${esc(t("Zones"))}</span></div><div class="sbi-kpi"><b>${nf(filled)}</b><span>${esc(t("With points"))}</span></div><div class="sbi-kpi"><b>${nf(pts.length - outside)}</b><span>${esc(t("Points counted"))}</span></div></div>` +
    (outside || skipped ? `<p class="sbi-note">${esc(t("{{a}} points fall outside every zone; {{b}} features were skipped (no geometry or number).", { a: nf(outside), b: nf(skipped) }))}</p>` : "") +
    table(head, raw.map((r) => r.map((c, i) => (i ? nc(c ?? NaN) : c))), 8);
}

function addZones() {
  const r = S.res.zones;
  addLayer(r.name, r.features, graduated(r.features, r.stat, "polygon", "Oranges"));
  refreshSources();
  message(t('Added "{{name}}".', { name: r.name }));
}

// ---- market ---------------------------------------------------------------

async function osrmTable(url, sources, destinations, annotations) {
  let body;
  try {
    const response = await fetch(C.osrmTableUrl(url, sources, destinations, annotations));
    body = await response.json();
  } catch (e) {
    throw new Error(t("The routing server did not answer ({{why}}).", { why: e?.message ?? "network" }));
  }
  const rows = body?.[`${annotations}s`];
  if (body?.code !== "Ok" || !Array.isArray(rows)) throw new Error(t("The routing server refused the request ({{why}}).", { why: body?.message ?? body?.code ?? "?" }));
  return { rows, destinations: body.destinations ?? [] };
}

async function marketDistances(dem, facilities) {
  const mode = val("m_dist");
  if (mode === "straight") return { D: C.distanceMatrix(dem, facilities), note: t("Distances are straight lines."), ring: 1, unit: KM, requests: 0 };
  if (mode === "factor") {
    const factor = Math.min(3, Math.max(1, numv("m_factor", 1.3)));
    return { D: C.distanceMatrix(dem, facilities, factor), note: t("Distances are straight lines × {{f}}.", { f: nf(factor, 2) }), ring: 1 / factor, unit: KM, requests: 0 };
  }
  const url = val("m_url").trim();
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new Error(t("Enter the address of an OSRM routing server, starting with https://."));
  const time = val("m_imp") === "time";
  const chunk = OSRM_COORDS - facilities.length;
  if (chunk < 1) throw new Error(t("Road distances handle up to {{n}} outlets per run.", { n: OSRM_COORDS - 1 }));
  const requests = Math.ceil(dem.length / chunk);
  if (requests > OSRM_REQUESTS) throw new Error(t("Road distances would need {{n}} requests; aggregate the demand into zones first.", { n: nf(requests) }));
  const D = [];
  let unreachable = 0;
  for (let start = 0, k = 1; start < dem.length; start += chunk, k++) {
    message(t("Asking the routing server: request {{k}} of {{n}}…", { k, n: requests }));
    const { rows } = await osrmTable(url, dem.slice(start, start + chunk).map((d) => d.xy), facilities.map((f) => f.xy), time ? "duration" : "distance");
    for (const row of rows) {
      D.push(Float64Array.from(row, (v) => (typeof v === "number" ? v : Infinity)));
      if (row.every((v) => typeof v !== "number")) unreachable++;
    }
  }
  message("");
  return { D, note: time ? t("Travel times follow the road network (OSRM).") : t("Distances follow the road network (OSRM)."), ring: 0, unit: time ? MIN : KM, unreachable, requests, url, time };
}

// Reach areas from the road network: the routing server times a grid of points around each outlet and the limits are contoured.
async function reachAreas(reach, fac, names, radii, run) {
  const perGrid = (n) => Math.ceil((n * n) / (OSRM_COORDS - 1));
  const n = [25, 21, 17, 13].find((size) => reach.requests + fac.length * perGrid(size) <= OSRM_REQUESTS);
  if (!n) return { features: [], skipped: true };
  // far enough for the largest limit: the road distance itself, or a minute at 60 km/h
  const half = radii[radii.length - 1] * 1000;
  const cell = (2 * half) / (n - 1);
  const total = fac.length * perGrid(n);
  const features = [];
  let k = 0;
  for (let j = 0; j < fac.length; j++) {
    const points = C.squareGrid(fac[j].xy, half, n);
    const values = [];
    for (let start = 0; start < points.length; start += OSRM_COORDS - 1) {
      message(t("Drawing reach areas: request {{k}} of {{n}}…", { k: ++k, n: total }));
      const part = points.slice(start, start + OSRM_COORDS - 1);
      const { rows, destinations } = await osrmTable(reach.url, [fac[j].xy], part, reach.time ? "duration" : "distance");
      if (run !== S.runId) return { features: [], stale: true };
      // a point the server had to move far to reach a road is in the sea or off the network, not reachable
      for (let i = 0; i < part.length; i++) values.push(typeof rows[0]?.[i] === "number" && !(destinations[i]?.distance > cell * 0.75) ? rows[0][i] : Infinity);
    }
    for (const r of radii) {
      const polygons = C.contourPolygons(values, points, n, r * reach.unit.per);
      if (polygons.length) features.push({ type: "Feature", properties: { sbi_outlet: names[j], [`limit_${reach.unit.label}`]: r }, geometry: { type: "MultiPolygon", coordinates: polygons } });
    }
  }
  message("");
  return { features, cellKm: cell / 1000 };
}

function marketInputs() {
  const facFeatures = feats(val("m_fac")), demFeatures = feats(val("m_dem"));
  if (!facFeatures.length || !demFeatures.length) throw new Error(t("Pick an outlet layer and a demand layer."));
  if (val("m_fac") === val("m_dem")) throw new Error(t("Outlets and demand must be two different layers."));
  if (!inWgs84(facFeatures) || !inWgs84(demFeatures)) throw new Error(t("Layers must be in WGS 84 (EPSG:4326)."));
  const huff = val("m_model") === "huff";
  const fac = weighted(facFeatures, huff ? val("m_a") : ""), dem = weighted(demFeatures, val("m_w"));
  if (!fac.list.length || !dem.list.length) throw new Error(t("No usable features in this layer."));
  if (fac.list.length * dem.list.length > PAIR_LIMIT) throw new Error(t("Too many outlet–demand pairs for one run ({{n}}); filter the layers first.", { n: nf(fac.list.length * dem.list.length) }));
  return { huff, fac, dem, demFeatures, facilities: fac.list.map((f) => ({ xy: f.xy, a: f.w })), names: fac.list.map((f, i) => labelOf(f.f, val("m_name"), i)) };
}

async function calibrate() {
  const run = ++S.runId;
  const field = val("m_obs");
  if (!field) throw new Error(t("Pick the outlet field that holds observed sales or visits."));
  const { fac, dem, facilities } = marketInputs();
  const observed = fac.list.map((f) => Math.max(0, C.toNumber(f.f.properties?.[field]) ?? 0));
  const reach = await marketDistances(dem.list, facilities);
  if (run !== S.runId) return;
  const max = numv("m_max", NaN);
  const fit = C.calibrateBeta(dem.list, facilities, observed, reach.D, { floorM: reach.unit.floor, maxM: max > 0 ? max * reach.unit.per : Infinity });
  if (!fit) throw new Error(t("The observed field needs positive values on at least two outlets."));
  el("m_beta").value = fit.beta;
  S.res.market = null;
  out("market").innerHTML = `<p class="sbi-hint">${esc(t(HINTS.market))}</p>`;
  message(
    t("β = {{b}} fits the observed shares best (R² {{r}}).", { b: nf(fit.beta, 2), r: nf(fit.r2, 2) }) +
      (fit.atEdge ? ` ${t("That is the edge of the search range, so the model may not suit this data.")}` : fit.r2 < 0.5 ? ` ${t("The fit is weak: distance and attractiveness explain little of these sales.")}` : ""),
  );
}

async function runMarket() {
  const run = ++S.runId;
  const { huff, fac, dem, demFeatures, facilities, names } = marketInputs();
  const reach = await marketDistances(dem.list, facilities);
  if (run !== S.runId) return;
  const D = reach.D, U = reach.unit;
  const near = C.nearest(dem.list, facilities, D);
  const max = numv("m_max", NaN), beta = numv("m_beta", 2);
  const model = huff ? C.huff(dem.list, facilities, { beta, floorM: U.floor, maxM: max > 0 ? max * U.per : Infinity }, D) : null;
  const radii = [...new Set(val("m_rings").split(/[,;\s]+/).map(parseFloat).filter((v) => v > 0))].sort((a, b) => a - b).slice(0, 6);
  const cover = C.coverage(near.dist, dem.list.map((d) => d.w), radii.map((r) => r * U.per));

  const rows = facilities.map((_, j) => ({
    name: names[j],
    demand: huff ? model.facilities[j].demand : near.facilities[j].demand,
    share: huff ? model.facilities[j].share : near.facilities[j].share,
    nearestN: near.facilities[j].n,
    mean: near.facilities[j].meanDist / U.per,
    rings: radii.map((r) => dem.list.reduce((a, d, i) => a + (D[i][j] <= r * U.per ? d.w : 0), 0)),
  }));
  const index = rows.reduce((a, r) => a + (r.share > 0 ? r.share : 0), 0) > 0 ? C.hhi(rows.map((r) => r.share)) : NaN;
  const tag = (r) => String(r).replace(".", "_") + U.label;

  const outletFeatures = fac.list.map((f, j) => copyFeature(f.f, {
    sbi_outlet: names[j], sbi_demand: r2(rows[j].demand), sbi_share_pct: r2(rows[j].share * 100), sbi_nearest_n: rows[j].nearestN, [`sbi_mean_${U.label}`]: r2(rows[j].mean, 3),
    ...Object.fromEntries(radii.map((r, k) => [`sbi_in_${tag(r)}`, r2(rows[j].rings[k])])),
  }));
  const demandFeatures = dem.list.map((d, i) => {
    const j = huff ? model.best[i] : near.assign[i];
    return copyFeature(d.f, {
      sbi_outlet: j >= 0 ? names[j] : "",
      [`sbi_to_outlet_${U.label}`]: r2((huff ? model.dist[i] : near.dist[i]) / U.per, 3),
      [`sbi_nearest_${U.label}`]: r2(near.dist[i] / U.per, 3),
      ...(huff ? { sbi_prob: r2(model.prob[i], 4) } : {}),
    });
  });
  let ringFeatures = [], areaNote = "";
  if (reach.ring) {
    // a ring is drawn where the chosen distance is reached in a straight line
    fac.list.forEach((f, j) => {
      for (const [k, r] of radii.entries()) ringFeatures.push({ type: "Feature", properties: { sbi_outlet: names[j], limit_km: r, sbi_demand: r2(rows[j].rings[k]) }, geometry: { type: "Polygon", coordinates: [C.circle(f.xy, r * 1000 * reach.ring)] } });
    });
  } else if (el("m_iso").checked && radii.length) {
    const areas = await reachAreas(reach, fac.list, names, radii, run);
    if (areas.stale || run !== S.runId) return;
    ringFeatures = areas.features;
    for (const f of ringFeatures) f.properties.sbi_demand = r2(rows[names.indexOf(f.properties.sbi_outlet)]?.rings[radii.indexOf(f.properties[`limit_${U.label}`])]);
    areaNote = areas.skipped ? t("Reach areas were left out: they would need more requests than one run allows.") : t("Reach areas are contoured from a grid with points {{km}} km apart, so their edges are approximate.", { km: nf(areas.cellKm, 2) });
  }

  const order = rows.map((_, j) => j).sort((a, b) => rows[b].demand - rows[a].demand);
  const meanLabel = U === MIN ? t("Mean min") : t("Mean km");
  const head = [t("Outlet"), t("Demand"), t("Share (%)"), meanLabel, ...radii.map((r) => `≤ ${r} ${U.label}`)];
  const raw = order.map((j) => [rows[j].name, r2(rows[j].demand), r2(rows[j].share * 100), r2(rows[j].mean, 3), ...rows[j].rings.map((v) => r2(v))]);
  S.res.market = { outletFeatures, demandFeatures, ringFeatures, areas: !reach.ring, names, order, kind: kindOf(demFeatures), csv: { head, rows: raw } };

  const unserved = huff ? model.total - model.allocated : 0;
  out("market").innerHTML =
    `<div class="sbi-kpis"><div class="sbi-kpi"><b>${nf(facilities.length)}</b><span>${esc(t("Outlets"))}</span></div><div class="sbi-kpi"><b>${esc(nc(near.total))}</b><span>${esc(t("Demand"))}</span></div><div class="sbi-kpi" title="${esc(t("Herfindahl–Hirschman index of the outlet shares: 10,000 means one outlet takes everything."))}"><b>${nf(index)}</b><span>HHI</span></div></div>` +
    (cover.length ? `<p class="sbi-note">${esc(t("Demand within reach of the nearest outlet:"))} ${cover.map((c, k) => `≤&nbsp;${nf(radii[k], Number.isInteger(radii[k]) ? 0 : 1)}&nbsp;${U.label}&nbsp;<b>${pct(c.share, 0)}</b>`).join(" · ")}</p>` : "") +
    (unserved > 0 ? `<p class="sbi-note">${esc(t("{{n}} of demand lies beyond the maximum of every outlet.", { n: nc(unserved) }))}</p>` : "") +
    (fac.skipped || dem.skipped ? `<p class="sbi-note">${esc(t("{{n}} features were skipped (no geometry, or no number in the chosen field).", { n: nf(fac.skipped + dem.skipped) }))}</p>` : "") +
    table([t("Outlet"), t("Demand"), t("Share (%)"), meanLabel], raw.map((r) => [r[0], nc(r[1]), nf(r[2], 1), nf(r[3], 2)]), 12) +
    `<p class="sbi-note">${esc(reach.note)}${reach.unreachable ? ` ${esc(t("{{n}} demand points cannot be reached by road.", { n: nf(reach.unreachable) }))}` : ""} ${esc(areaNote)}</p>`;
}

function addMarket() {
  const r = S.res.market;
  const base = t("Market");
  const top = r.order.slice(0, CATEGORY_COLORS.length).map((j, i) => [r.names[j], CATEGORY_COLORS[i]]);
  const byOutlet = matchExpr("sbi_outlet", top, OTHER_COLOR);
  const ids = [];
  if (r.ringFeatures.length) ids.push(addLayer(`${base} · ${r.areas ? t("reach areas") : t("rings")}`, r.ringFeatures, styleText("polygon", r.areas ? { color: byOutlet, opacity: 0.14, stroke: "#444444", width: 0.8 } : { color: "#444444", opacity: 0, stroke: "#444444", width: 1 })));
  ids.push(addLayer(`${base} · ${t("demand")}`, r.demandFeatures, styleText(r.kind ?? "point", { color: byOutlet, opacity: 0.75, radius: 3.5, stroke: r.kind === "point" ? "#ffffff" : "#5a5a5a" })));
  const shares = r.outletFeatures.map((f) => f.properties.sbi_share_pct ?? 0);
  const lo = Math.min(...shares), hi = Math.max(...shares);
  const radius = hi > lo ? ["interpolate", ["linear"], ["to-number", ["get", "sbi_share_pct"], lo], lo, 6, hi, 20] : 9;
  ids.push(addLayer(`${base} · ${t("outlets")}`, r.outletFeatures.map((f) => ({ ...f, geometry: { type: "Point", coordinates: C.centroid(f.geometry) } })), styleText("point", { color: byOutlet, opacity: 0.95, radius, stroke: "#1a1a1a" })));
  if (ids.length > 1) S.app.addLayerGroup?.(base, ids);
  refreshSources();
  message(t("Added {{n}} layers to the map.", { n: ids.length }));
}

// ---- trend ----------------------------------------------------------------

function lineChart(rows) {
  const W = 300, H = 96, L = 4, T = 8, B = 4;
  const values = rows.map((r) => r.value).filter(Number.isFinite);
  const lo = Math.min(0, ...values), hi = Math.max(...values, lo + 1e-9);
  const x = (i) => (rows.length > 1 ? L + (i * (W - 2 * L)) / (rows.length - 1) : W / 2);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const pts = rows.map((r, i) => (Number.isFinite(r.value) ? [x(i), y(r.value), r] : null)).filter(Boolean);
  const path = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${rows.length > 40 ? 1.2 : 2.2}"><title>${esc(p[2].label)}: ${esc(nc(p[2].value))}</title></circle>`).join("");
  return (
    `<svg class="sbi-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("Trend"))}">` +
    `<line x1="${L}" x2="${W - L}" y1="${y(lo).toFixed(1)}" y2="${y(lo).toFixed(1)}" class="sbi-line-base"/>` +
    (pts.length > 1 ? `<polygon class="sbi-line-area" points="${pts[0][0].toFixed(1)},${y(lo).toFixed(1)} ${path} ${pts[pts.length - 1][0].toFixed(1)},${y(lo).toFixed(1)}"/><polyline points="${path}"/>` : "") +
    `${dots}</svg><div class="sbi-axis"><span>${esc(rows[0].label)}</span><span>${esc(t("max {{v}}", { v: nc(hi) }))}</span><span>${esc(rows[rows.length - 1].label)}</span></div>`
  );
}

function runTrend() {
  const features = feats(val("t_src")), field = val("t_p"), measure = val("t_m"), agg = measure ? val("t_agg") : "count";
  const box = out("trend");
  S.res.trend = null;
  if (!features.length || !field) {
    box.innerHTML = `<p class="sbi-hint">${esc(t("Pick a layer and the field that holds the date or period."))}</p>`;
    return;
  }
  const r = C.trend(features, field, measure, agg, val("t_unit"));
  S.trendKind = r.kind;
  if (!r.rows.length) {
    box.innerHTML = `<p class="sbi-hint">${esc(t("This field has no usable dates or periods."))}</p>`;
    return;
  }
  const st = C.trendStats(r.rows);
  const last = r.rows[r.rows.length - 1];
  const total = r.rows.reduce((a, x) => a + (Number.isFinite(x.value) ? x.value : 0), 0);
  const signed = (v) => (Number.isFinite(v) ? (v > 0 ? "+" : "") + pct(v, 1) : "–");
  const kpi = (label, value, title = "") => `<div class="sbi-kpi"${title ? ` title="${esc(title)}"` : ""}><b>${esc(value)}</b><span>${esc(t(label))}</span></div>`;
  const aggLabel = agg === "count" ? t("Count") : `${agg === "mean" ? t("Mean") : t("Sum")} · ${measure}`;
  let html = `<div class="sbi-kpis">${kpi("Periods", nf(r.rows.length))}${agg === "mean" ? kpi("Mean per period", nc(total / r.rows.filter((x) => Number.isFinite(x.value)).length)) : kpi("Total", nc(total), nf(total, 2))}${kpi("Peak", st.peak ? st.peak.label : "–", st.peak ? nc(st.peak.value) : "")}</div>`;
  html += `<h4>${esc(aggLabel)} ${esc(t("by"))} ${esc(field)}</h4>${lineChart(r.rows)}`;
  if (r.rows.length > 1) {
    html += `<p class="sbi-note">${esc(t("Last period against the one before: {{a}}. First to last: {{b}}.", { a: signed(last.change), b: signed(st.firstToLast) }))} ${Number.isFinite(st.slope) ? esc(t("Linear trend: {{v}} per period ({{p}} of the mean).", { v: (st.slope > 0 ? "+" : "") + nc(st.slope), p: signed(st.slopePct) })) : ""}</p>`;
  }
  if (r.kind === "text") html += `<p class="sbi-note">${esc(t("The periods are read as text and sorted by name; empty periods cannot be shown."))}</p>`;
  if (r.skipped) html += `<p class="sbi-note">${esc(t("{{n}} features have no usable period and are left out.", { n: nf(r.skipped) }))}</p>`;
  const counted = agg === "count" ? [] : [t("Count")];
  html += table([t("Period"), aggLabel, ...counted, t("Change")], r.rows.slice().reverse().map((x) => [x.label, nc(x.value), ...counted.map(() => nf(x.n)), signed(x.change)]), 12);
  box.innerHTML = html;
  S.res.trend = { csv: { head: [field, "value", "count", "sum", "mean", "change"], rows: r.rows.map((x) => [x.label, x.value, x.n, measure ? x.sum : "", measure ? x.mean : "", x.change]) } };
}

// ---- sites ----------------------------------------------------------------

// Road distances or times from every demand point to every existing outlet and candidate, in blocks the table service accepts.
async function siteMatrices(dem, existing, candidates, time) {
  const url = val("s_url").trim() || val("m_url").trim();
  if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new Error(t("Enter the address of an OSRM routing server, starting with https://."));
  const targets = [...existing, ...candidates], block = OSRM_COORDS / 2;
  const requests = Math.ceil(dem.length / block) * Math.ceil(targets.length / block);
  if (requests > OSRM_REQUESTS) throw new Error(t("Road distances would need {{n}} requests; use wider hexagons or aggregate the demand into zones first.", { n: nf(requests) }));
  const M = dem.map(() => new Float64Array(targets.length).fill(Infinity));
  let k = 0;
  for (let a = 0; a < dem.length; a += block) {
    for (let b = 0; b < targets.length; b += block) {
      message(t("Asking the routing server: request {{k}} of {{n}}…", { k: ++k, n: requests }));
      const { rows } = await osrmTable(url, dem.slice(a, a + block).map((d) => d.xy), targets.slice(b, b + block).map((x) => x.xy), time ? "duration" : "distance");
      rows.forEach((row, i) => {
        for (let j = 0; j < row.length; j++) if (typeof row[j] === "number") M[a + i][b + j] = row[j];
      });
    }
  }
  message("");
  const E = existing.length;
  return { De: M.map((row) => row.subarray(0, E)), Dc: candidates.map((_, c) => Float64Array.from(M, (row) => row[E + c])) };
}

async function runSites() {
  const run = ++S.runId;
  const demFeatures = feats(val("s_dem"));
  if (!demFeatures.length) throw new Error(t("Pick a layer with features."));
  const hex = val("s_mode") === "hex";
  if (val("s_fac") && val("s_fac") === val("s_dem")) throw new Error(t("Outlets and demand must be two different layers."));
  if (!hex && val("s_cand") === val("s_dem")) throw new Error(t("Candidates and demand must be two different layers."));
  const facFeatures = val("s_fac") ? feats(val("s_fac")) : [];
  const candFeatures = hex ? [] : feats(val("s_cand"));
  if (!inWgs84(demFeatures) || !inWgs84(facFeatures) || !inWgs84(candFeatures)) throw new Error(t("Layers must be in WGS 84 (EPSG:4326)."));
  const dem = weighted(demFeatures, val("s_w"));
  if (!dem.list.length) throw new Error(t("No usable features in this layer."));
  const existing = weighted(facFeatures, val("s_goal") === "huff" ? val("s_a") : "").list.map((f) => ({ xy: f.xy, a: f.w }));
  const meanAttract = existing.length ? existing.reduce((a, f) => a + f.a, 0) / existing.length : 1;
  const attract = numv("s_new", NaN) > 0 ? numv("s_new", 1) : meanAttract > 0 ? meanAttract : 1;
  let candidates;
  if (hex) {
    const width = numv("s_hex", 1) * 1000;
    if (!(width > 0)) throw new Error(t("Hexagon width must be above zero."));
    candidates = C.hexBin(dem.list, width).cells.map((c) => ({ xy: c.center }));
  } else candidates = weighted(candFeatures, "").list.map((c) => ({ xy: c.xy, f: c.f }));
  if (!candidates.length) throw new Error(t("There are no candidate locations."));
  const p = Math.min(20, Math.max(1, Math.round(numv("s_p", 3))));
  if (candidates.length * dem.list.length * p > SITE_LIMIT) throw new Error(t("Too many candidates and demand points for one run; use wider hexagons or fewer sites."));
  const objective = val("s_goal"), limit = Math.max(0.05, numv("s_radius", 2));
  const road = val("s_dist") === "road", U = road && val("s_imp") === "time" ? MIN : KM;
  const factor = road ? 1 : Math.min(3, Math.max(1, numv("s_factor", 1)));
  const matrices = road ? await siteMatrices(dem.list, existing, candidates, U === MIN) : null;
  if (run !== S.runId) return;
  const r = C.selectSites(dem.list, candidates, { p, objective, radiusM: limit * U.per, beta: numv("s_beta", 2), floorM: U.floor, factor, existing, attract, matrices });
  const nameField = hex ? "" : (profileOf(val("s_cand")).find((f) => f.type === "category" && f.distinct === f.filled)?.name ?? "");
  const features = r.picks.map((pick, i) => {
    const c = candidates[pick.index];
    return {
      type: "Feature",
      properties: {
        ...(c.f?.properties ?? {}),
        sbi_rank: i + 1,
        sbi_site: c.f ? labelOf(c.f, nameField, pick.index) : `${t("Site")} ${i + 1}`,
        sbi_gain: objective === "coverage" ? r2(pick.gain) : null,
        sbi_coverage_pct: r2(pick.coverage * 100),
        [`sbi_mean_${U.label}`]: r2(pick.meanDist / U.per, 3),
        sbi_share_pct: existing.length ? r2(pick.share * 100) : null,
        lon: +c.xy[0].toFixed(6),
        lat: +c.xy[1].toFixed(6),
      },
      geometry: { type: "Point", coordinates: [+c.xy[0].toFixed(7), +c.xy[1].toFixed(7)] },
    };
  });
  // a service circle only means something for straight-line distances
  const circles = objective === "coverage" && !road ? features.map((f) => ({ type: "Feature", properties: { sbi_rank: f.properties.sbi_rank, sbi_site: f.properties.sbi_site, limit_km: limit }, geometry: { type: "Polygon", coordinates: [C.circle(f.geometry.coordinates, (limit * 1000) / factor)] } })) : [];
  const km = (m) => (Number.isFinite(m) ? nf(m / U.per, 2) : "–");
  const meanLabel = U === MIN ? t("Mean min") : t("Mean km");
  const reachNote = road ? (U === MIN ? t("Travel times follow the road network (OSRM).") : t("Distances follow the road network (OSRM).")) : factor > 1 ? t("Distances are straight lines × {{f}}.", { f: nf(factor, 2) }) : t("Distances are straight lines.");
  const arrow = (a, b) => `${a} → ${b}`;
  const head = ["#", t("Site"), t("Coverage (%)"), meanLabel, ...(existing.length ? [t("Share (%)")] : [])];
  const raw = features.map((f) => [f.properties.sbi_rank, f.properties.sbi_site, f.properties.sbi_coverage_pct, f.properties[`sbi_mean_${U.label}`], ...(existing.length ? [f.properties.sbi_share_pct] : [])]);
  S.res.sites = { features, circles, csv: { head: [...head, "lon", "lat"], rows: raw.map((row, i) => [...row, features[i].properties.lon, features[i].properties.lat]) } };
  out("sites").innerHTML =
    `<div class="sbi-kpis"><div class="sbi-kpi" title="${esc(t("Demand within {{v}} of an outlet, before → after", { v: `${nf(limit, 1)} ${U.label}` }))}"><b>${esc(arrow(pct(r.before.coverage, 0), pct(r.after.coverage, 0)))}</b><span>${esc(t("Covered"))}</span></div>` +
    `<div class="sbi-kpi" title="${esc(t("Demand-weighted mean distance to the nearest outlet, before → after"))}"><b>${esc(arrow(km(r.before.meanDist), km(r.after.meanDist)))}</b><span>${esc(meanLabel)}</span></div>` +
    `<div class="sbi-kpi" title="${esc(t("Share of demand the new sites win from the existing outlets (Huff model)"))}"><b>${existing.length ? pct(r.after.share, 0) : "–"}</b><span>${esc(t("New-site share"))}</span></div></div>` +
    `<p class="sbi-note">${esc(t("{{c}} candidates, {{d}} demand points, {{e}} existing outlets.", { c: nf(candidates.length), d: nf(dem.list.length), e: nf(existing.length) }))} ${esc(t("Sites are added one at a time, each the best given those before it; the set is good, not proven optimal."))} ${esc(reachNote)}</p>` +
    table(head, raw.map((row) => [row[0], row[1], nf(row[2], 1), nf(row[3], 2), ...(existing.length ? [nf(row[4], 1)] : [])]), 20);
}

function addSites() {
  const r = S.res.sites;
  const base = t("Sites");
  const ids = [];
  if (r.circles.length) ids.push(addLayer(`${base} · ${t("service areas")}`, r.circles, styleText("polygon", { color: "#d81b60", opacity: 0.08, stroke: "#d81b60", width: 1.2 })));
  ids.push(addLayer(`${base} · ${t("proposed")}`, r.features, styleText("point", { color: "#d81b60", opacity: 1, radius: 9, stroke: "#ffffff" })));
  if (ids.length > 1) S.app.addLayerGroup?.(base, ids);
  refreshSources();
  message(t("Added {{n}} layers to the map.", { n: ids.length }));
}

// ---- hot spots ------------------------------------------------------------

function runHot() {
  const features = feats(val("h_src")), field = val("h_f");
  if (!features.length || !field) throw new Error(t("Pick a layer and a numeric field."));
  if (!inWgs84(features)) throw new Error(t("Layers must be in WGS 84 (EPSG:4326)."));
  const usable = features.map((f) => ({ xy: C.centroid(f.geometry), f, v: C.toNumber(f.properties?.[field]) })).filter((p) => p.xy && p.v !== null);
  const skipped = features.length - usable.length;
  if (usable.length < 3) throw new Error(t("Hot spot analysis needs at least three features with a number."));
  if (usable.length > HOT_LIMIT) throw new Error(t("This layer has {{n}} features; hot spot analysis handles up to {{max}}. Aggregate it into zones first.", { n: nf(usable.length), max: nf(HOT_LIMIT) }));
  const pts = usable.map((p) => p.xy);
  const typed = numv("h_band", NaN);
  // a hair above the largest nearest-neighbour distance, so the neighbour that sets it stays inside the band
  const band = typed > 0 ? typed * 1000 : C.autoBand(pts) * 1.001;
  const g = C.giStar(pts, usable.map((p) => p.v), band);
  const counts = Object.fromEntries(Object.keys(GI_COLORS).map((k) => [k, 0]));
  const out_ = usable.map((p, i) => {
    const cls = C.giClass(g.z[i]);
    counts[cls]++;
    return { type: "Feature", properties: { ...(p.f.properties ?? {}), gi_z: r2(g.z[i], 4), gi_p: r2(g.p[i], 5), gi_class: cls, gi_neighbours: g.neighbours[i] }, geometry: p.f.geometry };
  });
  const lonely = g.neighbours.filter((n) => n === 0).length;
  const order = out_.map((_, i) => i).sort((a, b) => g.z[b] - g.z[a]);
  const nameField = profileOf(val("h_src")).find((f) => f.type === "category" && f.distinct === f.filled)?.name ?? "";
  S.res.hot = {
    features: out_, kind: kindOf(features), name: `${layerName(val("h_src"))} · ${t("hot spots")} (${field})`,
    csv: { head: [t("Feature"), field, "gi_z", "gi_p", "gi_class", "gi_neighbours"], rows: order.map((i) => [labelOf(out_[i], nameField, i), usable[i].v, out_[i].properties.gi_z, out_[i].properties.gi_p, out_[i].properties.gi_class, g.neighbours[i]]) },
  };
  out("hot").innerHTML =
    `<h4>Getis-Ord Gi* · ${esc(field)}</h4>` +
    legendHtml(Object.keys(GI_COLORS).map((k) => ({ color: GI_COLORS[k], label: t(k), n: counts[k] }))) +
    `<p class="sbi-note">${esc(t("Distance band {{km}} km; {{n}} features analysed.", { km: nf(band / 1000, 2), n: nf(usable.length) }))}` +
    (lonely ? ` ${esc(t("{{n}} features have no neighbour inside the band.", { n: nf(lonely) }))}` : "") +
    (skipped ? ` ${esc(t("{{n}} features were skipped (no geometry, or no number in the chosen field).", { n: nf(skipped) }))}` : "") +
    `</p><p class="sbi-note">${esc(t("Significance is per feature, without a correction for multiple testing."))}</p>`;
}

function addHot() {
  const r = S.res.hot;
  addLayer(r.name, r.features, styleText(r.kind ?? "polygon", { color: matchExpr("gi_class", Object.entries(GI_COLORS), GI_COLORS["Not significant"]), opacity: 0.85, radius: 6, stroke: r.kind === "point" ? "#ffffff" : "#5a5a5a" }));
  refreshSources();
  message(t('Added "{{name}}".', { name: r.name }));
}

// ---- wiring ---------------------------------------------------------------

function exportCsv() {
  let name, head, rows;
  if (S.tab === "summary") {
    const r = S.res.summary;
    if (!r) return;
    if (r.group) {
      name = `summary-${r.group}`;
      head = [r.group, "count", "sum", "mean", "value", "share", "cumulative_share", "abc"];
      rows = r.rows.map((x) => [x.key, x.n, r.measure ? x.sum : "", r.measure ? x.mean : "", x.value, x.share, x.cum, r.agg === "mean" ? "" : x.abc]);
    } else {
      name = "summary";
      head = ["statistic", r.measure || "features"];
      rows = [["count", r.features.length], ...(r.measure ? ["sum", "mean", "median", "min", "max", "sd", "q1", "q3"].map((k) => [k, r.s[k]]) : [])];
    }
  } else {
    const r = S.res[S.tab];
    if (!r?.csv) return;
    name = S.tab === "hot" ? "hot-spots" : S.tab;
    head = r.csv.head;
    rows = r.csv.rows;
  }
  const text = C.toCsv(head, rows);
  const file = `spatial-bi-${slug(name)}.csv`;
  if (S.app.exportTextFile) S.app.exportTextFile(file, text, { description: "CSV", extensions: ["csv"], mimeType: "text/csv" });
  else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}

const LIVE = { summary: runSummary, trend: runTrend, theme: runTheme };
const RUN = { zones: runZones, market: runMarket, sites: runSites, hot: runHot };
const ADD = { zones: addZones, market: addMarket, sites: addSites, hot: addHot };

async function guard(fn) {
  fail("");
  try {
    await fn();
  } catch (e) {
    if (!e?.message) console.warn("[Spatial BI]", e);
    fail(e?.message ?? String(e));
  }
}

function update() {
  if (!S.root) return;
  syncFields();
  if (LIVE[S.tab]) guard(LIVE[S.tab]);
  else if (!S.res[S.tab]) out(S.tab).innerHTML = `<p class="sbi-hint">${esc(t(HINTS[S.tab]))}</p>`;
  syncFields();
}
const HINTS = {
  zones: "Count or sum points inside a hexagon grid or the polygons of another layer, then press Run.",
  market: "Estimate how demand splits between outlets, by distance alone or with the Huff gravity model, then press Run.",
  sites: "Propose where to open new outlets from the demand they would serve, then press Run.",
  hot: "Find statistically significant clusters of high and low values (Getis-Ord Gi*), then press Run.",
};
function schedule() {
  clearTimeout(S.timer);
  S.timer = setTimeout(update, 200);
}

function build() {
  const root = document.createElement("form");
  root.className = "sbi";
  root.autocomplete = "off";
  root.innerHTML = template();
  S.root = root;
  root.addEventListener("submit", (e) => e.preventDefault());
  root.addEventListener("input", (e) => {
    const k = e.target.dataset?.k;
    if (!k) return;
    if (DEPENDS[k]) fillFields(k);
    if (k === "sum_src" || k === "sum_g") dropHighlight();
    if (RUN[S.tab]) S.res[S.tab] = null;
    S.runId++;
    fail("");
    message("");
    schedule();
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target.matches?.("select[data-layer]") && e.target.options.length !== layers().length) refreshSources();
  });
  root.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]")?.dataset.tab;
    if (tab) {
      S.tab = tab;
      fail("");
      message("");
      update();
      return;
    }
    const cat = e.target.closest("[data-cat]")?.dataset.cat;
    if (cat !== undefined) return guard(() => highlight(cat));
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    message("");
    if (a === "refresh") {
      S.profiles.clear();
      refreshSources();
      update();
    } else if (a === "clear") {
      dropHighlight();
      update();
    } else if (a === "csv") guard(exportCsv);
    else if (a === "th_apply" || a === "th_copy") guard(() => applyTheme(a === "th_copy"));
    else if (a === "run") {
      const tab = S.tab, button = e.target.closest("button");
      S.res[tab] = null;
      out(tab).innerHTML = "";
      button.disabled = true;
      guard(() => RUN[tab]()).finally(() => {
        button.disabled = false;
        if (S.root) syncFields();
      });
    } else if (a === "calib") {
      const button = e.target.closest("button");
      button.disabled = true;
      guard(calibrate).finally(() => {
        button.disabled = false;
        if (S.root) syncFields();
      });
    } else if (a === "add") guard(() => (S.res[S.tab] ? ADD[S.tab]() : message(t("Press Run first."))));
  });
  return root;
}

function mount(container) {
  if (!S.root) build();
  container.classList.add("sbi-host");
  container.append(S.root);
  refreshSources();
  if (S.pending) {
    if (TABS.some(([k]) => k === S.pending.tab)) S.tab = S.pending.tab;
    restore(S.pending.values ?? {});
    S.pending = null;
  }
  update();
  return () => {
    if (S.root?.parentElement === container) S.root.remove();
  };
}

function snapshot() {
  const values = {};
  for (const input of S.root.querySelectorAll("[data-k]")) values[input.dataset.k] = input.type === "checkbox" ? input.checked : input.value;
  return values;
}
// Layer selects go first, because each one decides which fields its dependants offer.
function restore(values) {
  const set = (k, v) => {
    const input = el(k);
    if (!input) return;
    if (input.type === "checkbox") input.checked = Boolean(v);
    else if (input.tagName !== "SELECT" || [...input.options].some((o) => o.value === v)) input.value = v;
  };
  for (const [k, v] of Object.entries(values)) {
    if (!el(k)?.hasAttribute("data-layer")) continue;
    set(k, v);
    fillFields(k);
  }
  for (const [k, v] of Object.entries(values)) if (!el(k)?.hasAttribute("data-layer")) set(k, v);
}

function relabel() {
  if (!S.root) return;
  const parent = S.root.parentElement;
  const values = snapshot();
  S.root.remove();
  S.res = {};
  build();
  refreshSources();
  restore(values);
  parent?.append(S.root);
  update();
}

function open() {
  const app = S.app;
  if (!(app.registerRightPanel && app.openRightPanel?.(PANEL))) {
    app.openFloatingPanel?.(PANEL);
    return;
  }
  // After a project load GeoLibre (3.8) reports the panel as open while it stays folded on its rail, and no API call
  // unfolds it. The rail's own expand button does, so it is pressed for the user when the panel has not appeared.
  setTimeout(() => {
    if (S.app !== app || S.root?.isConnected) return;
    const title = t("Spatial BI");
    for (const b of document.querySelectorAll("button[aria-label], button[title]")) {
      const label = b.getAttribute("aria-label") ?? b.title;
      if (label !== title && label.includes(title) && !b.closest("[role=menu]")) {
        b.click();
        if (S.root?.isConnected) return;
      }
    }
  }, 250);
}

export const plugin = {
  id: ID,
  name: "Spatial BI",
  version: VERSION,
  activate(app) {
    S.app = app;
    app.registerTranslations?.({ id: Object.fromEntries(Object.entries(ID_TEXT).map(([en, text]) => [keyOf(en), text])) });
    const keep = (off) => typeof off === "function" && S.dispose.push(off);
    const panel = { id: PANEL, title: () => t("Spatial BI"), icon: ICON, defaultWidth: 420, render: mount };
    keep(app.registerRightPanel?.(panel) ?? app.registerFloatingPanel?.({ ...panel, defaultHeight: 720, position: "top-right" }));
    const items = [{ id: "open", label: () => t("Open Spatial BI"), icon: ICON, onSelect: open }];
    keep(app.registerMenuContribution?.({ id: `${ID}-processing`, menu: "processing", items }));
    keep(app.registerToolbarMenu?.({ id: `${ID}-menu`, label: () => t("Spatial BI"), icon: ICON, items }));
    keep(app.onLocaleChange?.(relabel));
    keep(app.onSelectionChange?.(() => S.root && S.tab === "summary" && el("sum_sel").checked && schedule()));
  },
  // the panel settings travel with the project; results are recomputed, not stored
  getProjectState() {
    return S.root ? { v: 1, tab: S.tab, values: snapshot() } : (S.pending ?? undefined);
  },
  applyProjectState(_app, state) {
    try {
      if (state?.v !== 1 || typeof state.values !== "object") return;
      S.pending = { tab: state.tab, values: state.values };
      if (!S.root) return;
      S.res = {};
      refreshSources();
      if (TABS.some(([k]) => k === state.tab)) S.tab = state.tab;
      restore(state.values);
      S.pending = null;
      update();
    } catch (e) {
      console.warn("[Spatial BI] project state", e);
    }
  },
  deactivate(app) {
    clearTimeout(S.timer);
    dropHighlight();
    app?.closeRightPanel?.(PANEL);
    app?.closeFloatingPanel?.(PANEL);
    for (const off of S.dispose.splice(0)) {
      try {
        off();
      } catch (e) {
        console.warn("[Spatial BI] cleanup", e);
      }
    }
    S.root?.remove();
    S.root = null;
    S.res = {};
    S.runId++;
    S.pending = null;
    S.profiles.clear();
    S.app = null;
  },
};

export default plugin;
