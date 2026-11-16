import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../src/core.js";

const load = (name) => JSON.parse(readFileSync(new URL(`../sample/${name}.geojson`, import.meta.url), "utf8")).features;
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const square = (lon, lat, d) => [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]];

test("one degree of latitude is 111.2 km", () => {
  near(C.haversine([95, 5], [95, 6]), 111195, 5);
});

test("area of a 1 km square and of a square with a hole", () => {
  const d = 0.5 / 111.195;
  const k = 1 / Math.cos((5 * Math.PI) / 180);
  const ring = [[95 - d * k, 5 - d], [95 + d * k, 5 - d], [95 + d * k, 5 + d], [95 - d * k, 5 + d], [95 - d * k, 5 - d]];
  near(C.areaM2({ type: "Polygon", coordinates: [ring] }), 1e6, 2000);
  const outer = square(95, 5, 0.01), hole = square(95, 5, 0.005);
  const full = C.areaM2({ type: "Polygon", coordinates: [outer] });
  near(C.areaM2({ type: "Polygon", coordinates: [outer, hole] }) / full, 0.75, 1e-6);
});

test("point in polygon respects holes and multipolygons", () => {
  const g = { type: "MultiPolygon", coordinates: [[square(0, 0, 1), square(0, 0, 0.5)], [square(10, 10, 1)]] };
  assert.equal(C.pointInGeometry([0.75, 0], g), true);
  assert.equal(C.pointInGeometry([0, 0], g), false);
  assert.equal(C.pointInGeometry([10.2, 9.9], g), true);
  assert.equal(C.pointInGeometry([5, 5], g), false);
});

test("centroid of a polygon and of a point", () => {
  const c = C.centroid({ type: "Polygon", coordinates: [square(95, 5, 0.2)] });
  near(c[0], 95, 1e-9);
  near(c[1], 5, 1e-9);
  assert.deepEqual(C.centroid({ type: "Point", coordinates: [1, 2, 30] }), [1, 2]);
});

test("field profile tells numbers from categories", () => {
  const p = Object.fromEntries(C.profile(load("customers")).map((f) => [f.name, f.type]));
  assert.equal(p.spend_k, "number");
  assert.equal(p.segment, "category");
  assert.equal(p.customer, "category");
});

test("summary statistics", () => {
  const s = C.summary([4, 1, 3, 2, 10]);
  assert.equal(s.n, 5);
  assert.equal(s.sum, 20);
  assert.equal(s.mean, 4);
  assert.equal(s.median, 3);
  assert.equal(s.min, 1);
  assert.equal(s.max, 10);
  near(s.sd, Math.sqrt(50 / 4), 1e-12);
});

test("group by sums, shares and blanks", () => {
  const f = (k, v) => ({ properties: { k, v } });
  const rows = C.groupBy([f("a", 10), f("b", "30"), f("a", 20), f(null, 40), f("b", "x")], "k", "v", "sum");
  assert.deepEqual(rows.map((r) => [r.key, r.n, r.value]), [["(blank)", 1, 40], ["a", 2, 30], ["b", 2, 30]]);
  near(rows.reduce((s, r) => s + r.share, 0), 1, 1e-12);
  assert.equal(C.groupBy([f("a", 10), f("a", 20)], "k", "v", "mean")[0].value, 15);
  assert.equal(C.groupBy([f("a", 10), f("a", 20)], "k", "", "sum")[0].value, 2);
});

test("ABC classes follow the 80 / 95 rule", () => {
  const rows = [50, 30, 10, 6, 4].map((value, i) => ({ key: String(i), value }));
  assert.deepEqual(C.pareto(rows).map((r) => r.abc), ["A", "A", "B", "B", "C"]);
  near(C.pareto(rows)[1].cum, 0.8, 1e-12);
});

test("Gini is 0 for equal values and (n-1)/n for one holder", () => {
  near(C.gini([5, 5, 5, 5]), 0, 1e-12);
  near(C.gini([0, 0, 0, 8]), 0.75, 1e-12);
});

test("histogram keeps every value", () => {
  const h = C.histogram(load("customers").map((f) => f.properties.spend_k));
  assert.equal(h.counts.reduce((a, b) => a + b, 0), 900);
});

test("class breaks: equal, quantile and natural breaks", () => {
  const v = [1, 2, 3, 10, 11, 12, 50, 51, 52];
  assert.deepEqual(C.classify(v, "jenks", 3), [1, 10, 50, 52]);
  assert.deepEqual(C.classify(v, "equal", 3), [1, 18, 35, 52]);
  assert.deepEqual(C.classify([1, 2, 3, 4, 5, 6, 7, 8, 9], "quantile", 4), [1, 3, 5, 7, 9]);
  assert.deepEqual(C.classify([7, 7, 7], "quantile", 5), [7, 7]);
  assert.deepEqual(C.classify([1, 1, 1, 1, 9], "quantile", 4), [1, 9]);
  const b = C.classify(v, "jenks", 3);
  assert.deepEqual(v.map((x) => C.classOf(x, b)), [0, 0, 0, 1, 1, 1, 2, 2, 2]);
});

test("zone aggregation counts every customer once", () => {
  const pts = load("customers").map((f) => ({ xy: f.geometry.coordinates, w: f.properties.spend_k }));
  const r = C.aggregate(pts, load("zones"));
  const n = r.stats.reduce((s, z) => s + z.n, 0);
  assert.equal(n + r.outside, 900);
  assert.ok(n > 800);
  near(r.stats.reduce((s, z) => s + z.sum, 0), pts.reduce((s, p, i) => s + (r.zoneOf[i] >= 0 ? p.w : 0), 0), 1e-6);
});

test("hexagon bins keep every point inside its own cell", () => {
  const pts = load("customers").map((f) => ({ xy: f.geometry.coordinates, w: 1 }));
  const { cells, cellOf } = C.hexBin(pts, 1000);
  assert.equal(cells.reduce((s, c) => s + c.n, 0), 900);
  near(cells[0].areaM2, 866025.4, 1);
  near(C.areaM2({ type: "Polygon", coordinates: [cells[0].ring] }), 866025.4, 2500);
  for (const [i, p] of pts.entries()) assert.ok(C.haversine(p.xy, cells[cellOf[i]].center) <= 1000 / Math.sqrt(3) + 1);
  const keys = new Set(cells.map((c) => `${c.q},${c.r}`));
  assert.equal(keys.size, cells.length);
});

test("nearest allocation and coverage", () => {
  const fac = [{ xy: [95, 5] }, { xy: [95.1, 5] }];
  const dem = [{ xy: [95.01, 5], w: 2 }, { xy: [95.02, 5], w: 3 }, { xy: [95.09, 5], w: 5 }];
  const r = C.nearest(dem, fac);
  assert.deepEqual(r.assign, [0, 0, 1]);
  assert.deepEqual(r.facilities.map((f) => f.demand), [5, 5]);
  near(r.facilities[0].meanDist, (2 * r.dist[0] + 3 * r.dist[1]) / 5, 1e-9);
  const cov = C.coverage(r.dist, dem.map((d) => d.w), [1500, 3000]);
  assert.deepEqual(cov.map((c) => c.share), [0.7, 1]);
});

test("Huff shares: symmetry, attraction, distance decay and cut-off", () => {
  const fac = [{ xy: [95, 5], a: 1 }, { xy: [95.1, 5], a: 1 }];
  const mid = [{ xy: [95.05, 5], w: 10 }];
  const even = C.huff(mid, fac);
  near(even.facilities[0].share, 0.5, 1e-9);
  const big = C.huff(mid, [{ ...fac[0], a: 3 }, fac[1]]);
  near(big.facilities[0].share, 0.75, 1e-9);
  const close = [{ xy: [95.025, 5], w: 10 }];
  near(C.huff(close, fac, { beta: 2 }).facilities[0].share, 0.9, 1e-6);
  near(C.huff(close, fac, { beta: 1 }).facilities[0].share, 0.75, 1e-6);
  const cut = C.huff([...mid, { xy: [96, 5], w: 5 }], fac, { maxM: 20000 });
  assert.equal(cut.total, 15);
  assert.equal(cut.allocated, 10);
  assert.equal(cut.best[1], -1);
  near(cut.facilities[0].demand + cut.facilities[1].demand, 10, 1e-9);
  const all = C.huff(load("customers").map((f) => ({ xy: f.geometry.coordinates, w: f.properties.spend_k })), load("outlets").map((f) => ({ xy: f.geometry.coordinates, a: f.properties.floor_m2 })));
  near(all.facilities.reduce((s, f) => s + f.share, 0), 1, 1e-9);
});

test("HHI of four equal shares is 2,500", () => {
  near(C.hhi([0.25, 0.25, 0.25, 0.25]), 2500, 1e-9);
});

test("two-sided p-values of the normal distribution", () => {
  near(C.pTwoSided(1.96), 0.05, 1e-4);
  near(C.pTwoSided(-2.576), 0.01, 1e-4);
  near(C.pTwoSided(0), 1, 1e-6);
});

test("Gi* finds a cluster of high values and its mirror", () => {
  const pts = [], x = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      pts.push([95 + c * 0.01, 5 + r * 0.01]);
      x.push(r < 3 && c < 3 ? 100 : r > 6 && c > 6 ? 0 : 50);
    }
  }
  const band = C.autoBand(pts);
  near(band, 1112, 10);
  const g = C.giStar(pts, x, band * 1.5);
  assert.equal(g.neighbours[11], 8);
  assert.equal(C.giClass(g.z[11]), "Hot spot 99%");
  assert.equal(C.giClass(g.z[88]), "Cold spot 99%");
  assert.equal(C.giClass(g.z[55]), "Not significant");
  near(g.z[11], -g.z[88], 1e-9);
  assert.deepEqual(C.giStar(pts, pts.map(() => 5), band).z[0], 0);
});

test("Gi* matches a hand calculation", () => {
  // five points on a line 1 km apart, band 1.2 km, x = 1..5: for the last point W = 2, sum = 9, mean = 3, S = sqrt(2)
  const pts = [0, 1, 2, 3, 4].map((i) => [95, 5 + i / 111.195]);
  const g = C.giStar(pts, [1, 2, 3, 4, 5], 1200);
  near(g.z[4], (9 - 3 * 2) / (Math.SQRT2 * Math.sqrt((5 * 2 - 4) / 4)), 1e-9);
  near(g.z[2], 0, 1e-12);
});

test("CSV quoting", () => {
  assert.equal(C.toCsv(["a", "b"], [["x,y", 1], ['say "hi"', NaN]]), 'a,b\r\n"x,y",1\r\n"say ""hi""",\r\n');
});

test("a distance matrix gives the same answers as straight lines, and a factor scales them", () => {
  const fac = [{ xy: [95, 5], a: 1 }, { xy: [95.1, 5], a: 2 }];
  const dem = [{ xy: [95.01, 5], w: 2 }, { xy: [95.06, 5], w: 3 }, { xy: [95.09, 5], w: 5 }];
  const D = C.distanceMatrix(dem, fac);
  assert.deepEqual(C.nearest(dem, fac, D), C.nearest(dem, fac));
  assert.deepEqual(C.huff(dem, fac, { beta: 1.5 }, D), C.huff(dem, fac, { beta: 1.5 }));
  const D2 = C.distanceMatrix(dem, fac, 1.3);
  near(D2[0][1] / D[0][1], 1.3, 1e-12);
  near(C.huff(dem, fac, {}, D2).facilities[0].share, C.huff(dem, fac).facilities[0].share, 1e-9);
  // a road matrix can disagree with the map: here the far outlet is the short drive
  const road = [new Float64Array([9000, 1000]), new Float64Array([9000, 1000]), new Float64Array([9000, 1000])];
  assert.deepEqual(C.nearest(dem, fac, road).assign, [1, 1, 1]);
  const cut = C.huff(dem, fac, { maxM: 5000 }, [new Float64Array([Infinity, Infinity]), road[1], road[2]]);
  assert.equal(cut.best[0], -1);
  near(cut.facilities[1].share, 1, 1e-12);
});

test("OSRM table URL lists sources, then destinations", () => {
  assert.equal(
    C.osrmTableUrl("https://router.example/", [[95.1234567, 5.5]], [[95.2, 5.6], [95.3, 5.7]]),
    "https://router.example/table/v1/driving/95.123457,5.5;95.2,5.6;95.3,5.7?sources=0&destinations=1;2&annotations=distance",
  );
});

test("trend: dates grouped by month with empty months kept", () => {
  const f = (date, v) => ({ properties: { date, v } });
  const r = C.trend([f("2025-01-15", 10), f("2025-01-20", 5), f("2025-04-02", 30), f("03/04/2025", 6), f("", 1), f("n/a", 1)], "date", "v", "sum", "month");
  assert.equal(r.kind, "date");
  assert.deepEqual(r.rows.map((x) => [x.key, x.value]), [["2025-01", 15], ["2025-02", 0], ["2025-03", 0], ["2025-04", 36]]);
  assert.equal(r.skipped, 2);
  assert.deepEqual(C.trend([f("15 Jan 2025", 1), f("March 3, 2025", 1)], "date", "", "count", "month").rows.map((x) => x.key), ["2025-01", "2025-02", "2025-03"]);
  assert.deepEqual(C.trend([f("2025-11-30", 1), f("2026-02-01", 1)], "date", "", "count", "quarter").rows.map((x) => x.key), ["2025-Q4", "2026-Q1"]);
  assert.deepEqual(C.trend([f("2024-02-28", 1), f("2024-03-01", 1)], "date", "", "count", "day").rows.map((x) => x.key), ["2024-02-28", "2024-02-29", "2024-03-01"]);
});

test("trend: unit chosen from the data, numeric and text periods", () => {
  const customers = load("customers");
  const auto = C.trend(customers, "date", "spend_k", "sum");
  assert.equal(auto.unit, "month");
  assert.equal(auto.rows.length, 18);
  assert.equal(auto.rows.reduce((s, r) => s + r.n, 0), 900);
  const byMonth = C.trend(customers, "month", "", "count");
  assert.equal(byMonth.kind, "number");
  assert.deepEqual(byMonth.rows.map((r) => r.key), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const years = C.trend([{ properties: { y: 2020 } }, { properties: { y: 2023 } }], "y", "", "count");
  assert.deepEqual(years.rows.map((r) => [r.key, r.value]), [[2020, 1], [2021, 0], [2022, 0], [2023, 1]]);
  const text = C.trend([{ properties: { w: "Week 10" } }, { properties: { w: "Week 2" } }], "w", "", "count");
  assert.deepEqual(text.rows.map((r) => r.key), ["Week 2", "Week 10"]);
});

test("trend statistics: change, peak and slope", () => {
  const rows = [10, 20, 15, 40].map((value, i) => ({ key: i, value }));
  const s = C.trendStats(rows);
  assert.equal(s.peak.value, 40);
  assert.equal(s.low.value, 10);
  near(s.firstToLast, 3, 1e-12);
  near(s.slope, 8.5, 1e-12);
  const t2 = C.trend([{ properties: { y: 1, v: 10 } }, { properties: { y: 2, v: 15 } }], "y", "v");
  near(t2.rows[1].change, 0.5, 1e-12);
});

test("site selection: coverage, mean distance and Huff share", () => {
  const cluster = (lon, lat, n, w) => Array.from({ length: n }, (_, i) => ({ xy: [lon + (i % 5) * 0.001, lat + Math.floor(i / 5) * 0.001], w }));
  const dem = [...cluster(95, 5, 20, 1), ...cluster(95.2, 5, 10, 1), ...cluster(95.4, 5, 5, 1)];
  const cand = [{ xy: [95.1, 5] }, { xy: [95.002, 5.002] }, { xy: [95.202, 5.001] }, { xy: [95.402, 5] }];
  const cov = C.selectSites(dem, cand, { p: 2, objective: "coverage", radiusM: 2000 });
  assert.deepEqual(cov.picks.map((x) => x.index), [1, 2]);
  assert.deepEqual(cov.picks.map((x) => x.gain), [20, 10]);
  near(cov.after.coverage, 30 / 35, 1e-12);
  assert.equal(cov.before.coverage, 0);
  const withShop = C.selectSites(dem, cand, { p: 1, objective: "coverage", radiusM: 2000, existing: [{ xy: [95.002, 5.002], a: 1 }] });
  assert.deepEqual(withShop.picks.map((x) => x.index), [2]);
  near(withShop.before.coverage, 20 / 35, 1e-12);
  const med = C.selectSites(dem, cand, { p: 3, objective: "pmedian" });
  assert.deepEqual(med.picks.map((x) => x.index).slice().sort(), [1, 2, 3]);
  assert.ok(med.picks[0].meanDist > med.picks[1].meanDist && med.picks[1].meanDist > med.picks[2].meanDist);
  assert.ok(med.after.meanDist < 400);
  const huff = C.selectSites(dem, cand, { p: 1, objective: "huff", existing: [{ xy: [95.002, 5.002], a: 5 }] });
  // beside a strong incumbent the new site would win a sixth of that cluster; the unserved cluster is worth more
  assert.deepEqual(huff.picks.map((x) => x.index), [2]);
  assert.ok(huff.after.share > 0.25 && huff.after.share < 0.6);
  assert.equal(huff.before.share, 0);
  assert.equal(C.selectSites(dem, cand.slice(0, 2), { p: 5 }).picks.length, 2);
  const shop = [{ xy: [95.002, 5.002], a: 1 }];
  const De = C.distanceMatrix(dem, shop), Dc = cand.map((c) => Float64Array.from(dem, (d) => C.haversine(d.xy, c.xy)));
  assert.deepEqual(C.selectSites(dem, cand, { p: 2, radiusM: 2000, existing: shop, matrices: { De, Dc } }), C.selectSites(dem, cand, { p: 2, radiusM: 2000, existing: shop }));
  // by road the middle candidate is a minute from everyone, the others ten
  const fast = cand.map((_, c) => new Float64Array(dem.length).fill(c === 0 ? 60 : 600));
  assert.deepEqual(C.selectSites(dem, cand, { p: 1, objective: "pmedian", matrices: { De: dem.map(() => new Float64Array(0)), Dc: fast } }).picks.map((x) => x.index), [0]);
});

test("beta calibration recovers the decay that produced the shares", () => {
  const dem = load("customers").map((f) => ({ xy: f.geometry.coordinates, w: f.properties.spend_k }));
  const fac = load("outlets").map((f) => ({ xy: f.geometry.coordinates, a: f.properties.floor_m2 }));
  const D = C.distanceMatrix(dem, fac);
  const truth = C.huff(dem, fac, { beta: 1.7 }, D).facilities.map((f) => f.demand);
  const fit = C.calibrateBeta(dem, fac, truth, D);
  near(fit.beta, 1.7, 1e-9);
  near(fit.r2, 1, 1e-9);
  assert.equal(fit.atEdge, false);
  const noisy = C.calibrateBeta(dem, fac, truth.map((v, j) => v * (j % 2 ? 1.15 : 0.85)), D);
  assert.ok(Math.abs(noisy.beta - 1.7) <= 0.8 && noisy.r2 > 0.8 && noisy.r2 < 1);
  assert.equal(C.calibrateBeta(dem, fac, fac.map(() => 0), D), null);
});

test("OSRM table URL can ask for durations", () => {
  assert.ok(C.osrmTableUrl("https://r.example", [[1, 2]], [[3, 4]], "duration").endsWith("?sources=0&destinations=1&annotations=duration"));
});

test("contours: a disc, a ring with a hole, and unreachable points", () => {
  const n = 41, R = 2000;
  const pts = C.squareGrid([95.3, 5.5], R, n);
  assert.equal(pts.length, n * n);
  near(C.haversine(pts[0], pts[n - 1]), 2 * R, 2);
  const dist = pts.map((p) => C.haversine(p, [95.3, 5.5]));
  const disc = C.contourPolygons(dist, pts, n, 1200);
  assert.equal(disc.length, 1);
  assert.equal(disc[0].length, 1);
  near(C.areaM2({ type: "Polygon", coordinates: disc[0] }) / (Math.PI * 1200 ** 2), 1, 0.02);
  const first = disc[0][0][0], last = disc[0][0][disc[0][0].length - 1];
  assert.deepEqual(first, last);
  const ring = C.contourPolygons(dist.map((d) => Math.abs(d - 1200)), pts, n, 300);
  assert.equal(ring.length, 1);
  assert.equal(ring[0].length, 2);
  near(C.areaM2({ type: "Polygon", coordinates: ring[0] }) / (Math.PI * (1500 ** 2 - 900 ** 2)), 1, 0.03);
  const blocked = C.contourPolygons(dist.map((d, k) => (pts[k][0] > 95.3 ? Infinity : d)), pts, n, 1200);
  near(C.areaM2({ type: "MultiPolygon", coordinates: blocked }) / (Math.PI * 1200 ** 2), 0.5, 0.06);
  assert.deepEqual(C.contourPolygons(dist, pts, n, -1), []);
  const two = C.contourPolygons(pts.map((p) => Math.min(C.haversine(p, pts[n * 10 + 10]), C.haversine(p, pts[n * 30 + 30]))), pts, n, 400);
  assert.equal(two.length, 2);
});
