const R = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Equirectangular plane around a reference point. Good to a fraction of a percent
// across a city or a regency, which is the scale these tools are used at.
export function projector(lon0, lat0) {
  const kx = R * Math.cos(lat0 * RAD) * RAD;
  const ky = R * RAD;
  return {
    fwd: (p) => [(p[0] - lon0) * kx, (p[1] - lat0) * ky],
    inv: (p) => [lon0 + p[0] / kx, lat0 + p[1] / ky],
  };
}

export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function eachCoord(geometry, fn) {
  const walk = (c) => {
    if (typeof c[0] === "number") fn(c);
    else for (const x of c) walk(x);
  };
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") for (const g of geometry.geometries ?? []) eachCoord(g, fn);
  else if (geometry.coordinates) walk(geometry.coordinates);
}

export function bboxOf(geometry) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  eachCoord(geometry, (c) => {
    if (c[0] < b[0]) b[0] = c[0];
    if (c[1] < b[1]) b[1] = c[1];
    if (c[0] > b[2]) b[2] = c[0];
    if (c[1] > b[3]) b[3] = c[1];
  });
  return b[0] === Infinity ? null : b;
}

export function bboxOfFeatures(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    const x = bboxOf(f?.geometry);
    if (!x) continue;
    b[0] = Math.min(b[0], x[0]);
    b[1] = Math.min(b[1], x[1]);
    b[2] = Math.max(b[2], x[2]);
    b[3] = Math.max(b[3], x[3]);
  }
  return b[0] === Infinity ? null : b;
}

function ringSigned(ring) {
  let s = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return s / 2;
}

export function areaM2(geometry) {
  let total = 0;
  for (const poly of polygonsOf(geometry)) {
    const b = bboxOf({ type: "Polygon", coordinates: poly });
    if (!b) continue;
    const pr = projector((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    poly.forEach((ring, i) => {
      const a = Math.abs(ringSigned(ring.map(pr.fwd)));
      total += i === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

export function centroid(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point") return geometry.coordinates.slice(0, 2);
  const polys = polygonsOf(geometry);
  if (polys.length) {
    let ax = 0, ay = 0, aw = 0;
    for (const poly of polys) {
      const ring = poly[0];
      const a = ringSigned(ring);
      let cx = 0, cy = 0;
      for (let i = 0, n = ring.length - 1; i < n; i++) {
        const k = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        cx += (ring[i][0] + ring[i + 1][0]) * k;
        cy += (ring[i][1] + ring[i + 1][1]) * k;
      }
      if (a !== 0) {
        ax += cx / 6;
        ay += cy / 6;
        aw += a;
      }
    }
    if (aw !== 0) return [ax / aw, ay / aw];
  }
  let sx = 0, sy = 0, n = 0;
  eachCoord(geometry, (c) => {
    sx += c[0];
    sy += c[1];
    n++;
  });
  return n ? [sx / n, sy / n] : null;
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(p, geometry) {
  for (const poly of polygonsOf(geometry)) {
    if (!inRing(p, poly[0])) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) if (inRing(p, poly[i])) hole = true;
    if (!hole) return true;
  }
  return false;
}

export function circle(center, radiusM, steps = 64) {
  const lat1 = center[1] * RAD, lon1 = center[0] * RAD, d = radiusM / R;
  const ring = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(t));
    const lon2 = lon1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([+(lon2 / RAD).toFixed(7), +(lat2 / RAD).toFixed(7)]);
  }
  ring.push(ring[0]);
  return ring;
}

export function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const blank = (v) => v === null || v === undefined || v === "";

export function profile(features, limit = 3000) {
  const fields = new Map();
  const step = Math.max(1, Math.floor(features.length / limit));
  for (let i = 0; i < features.length; i += step) {
    const props = features[i]?.properties ?? {};
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith("__") || (v !== null && typeof v === "object")) continue;
      let f = fields.get(k);
      if (!f) {
        f = { name: k, filled: 0, numeric: 0, distinct: new Set() };
        fields.set(k, f);
      }
      if (blank(v)) continue;
      f.filled++;
      if (toNumber(v) !== null) f.numeric++;
      if (f.distinct.size <= 200) f.distinct.add(String(v));
    }
  }
  return [...fields.values()].map((f) => ({
    name: f.name,
    filled: f.filled,
    distinct: f.distinct.size,
    type: f.filled > 0 && f.numeric / f.filled >= 0.9 ? "number" : "category",
  }));
}

function quantileSorted(s, p) {
  if (!s.length) return NaN;
  const h = (s.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (s[hi] - s[lo]) * (h - lo);
}

export function summary(values) {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return { n: 0, sum: 0, mean: NaN, median: NaN, min: NaN, max: NaN, sd: NaN, q1: NaN, q3: NaN };
  let sum = 0;
  for (const v of s) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of s) ss += (v - mean) ** 2;
  return { n, sum, mean, median: quantileSorted(s, 0.5), min: s[0], max: s[n - 1], sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0, q1: quantileSorted(s, 0.25), q3: quantileSorted(s, 0.75) };
}

export function groupBy(features, by, measure, agg = "sum") {
  const groups = new Map();
  for (const f of features) {
    const props = f?.properties ?? {};
    const key = blank(props[by]) ? "(blank)" : String(props[by]);
    let g = groups.get(key);
    if (!g) {
      g = { key, n: 0, sum: 0, cnt: 0 };
      groups.set(key, g);
    }
    g.n++;
    const v = measure ? toNumber(props[measure]) : null;
    if (v !== null) {
      g.sum += v;
      g.cnt++;
    }
  }
  const rows = [...groups.values()].map((g) => ({
    key: g.key,
    n: g.n,
    sum: g.sum,
    mean: g.cnt ? g.sum / g.cnt : NaN,
    value: agg === "count" || !measure ? g.n : agg === "mean" ? (g.cnt ? g.sum / g.cnt : NaN) : g.sum,
  }));
  rows.sort((a, b) => (Number.isNaN(b.value) ? -1 : Number.isNaN(a.value) ? 1 : b.value - a.value) || a.key.localeCompare(b.key));
  const additive = agg !== "mean";
  let total = 0;
  for (const r of rows) if (r.value > 0) total += r.value;
  for (const r of rows) r.share = additive && total > 0 && r.value > 0 ? r.value / total : NaN;
  return rows;
}

// ABC classes on rows sorted by value, largest first: A carries the first 80% of the total, B the next 15%.
export function pareto(rows, a = 0.8, b = 0.95) {
  let total = 0;
  for (const r of rows) if (r.value > 0) total += r.value;
  let cum = 0;
  return rows.map((r) => {
    const before = total > 0 ? cum / total : 0;
    if (r.value > 0) cum += r.value;
    return { ...r, cum: total > 0 ? cum / total : NaN, abc: before < a ? "A" : before < b ? "B" : "C" };
  });
}

export function gini(values) {
  const s = values.filter((v) => typeof v === "number" && v >= 0).sort((x, y) => x - y);
  const n = s.length;
  let sum = 0, weighted = 0;
  s.forEach((v, i) => {
    sum += v;
    weighted += (i + 1) * v;
  });
  if (!n || sum === 0) return NaN;
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

export function histogram(values, bins) {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!s.length) return null;
  let min = Infinity, max = -Infinity;
  for (const v of s) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const k = min === max ? 1 : Math.min(20, Math.max(5, bins ?? Math.ceil(Math.log2(s.length)) + 1));
  const step = (max - min) / k || 1;
  const counts = new Array(k).fill(0);
  for (const v of s) counts[Math.min(k - 1, Math.floor((v - min) / step))]++;
  return { min, max, step, counts };
}

function jenks(sorted, k) {
  const n = sorted.length;
  const lower = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  const cost = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
  for (let j = 1; j <= k; j++) {
    lower[1][j] = 1;
    for (let i = 2; i <= n; i++) cost[i][j] = Infinity;
  }
  for (let l = 2; l <= n; l++) {
    let sum = 0, sumSq = 0, w = 0, v = 0;
    for (let m = 1; m <= l; m++) {
      const lo = l - m + 1, val = sorted[lo - 1];
      w++;
      sum += val;
      sumSq += val * val;
      v = sumSq - (sum * sum) / w;
      if (lo > 1) {
        for (let j = 2; j <= k; j++) {
          if (cost[l][j] >= v + cost[lo - 1][j - 1]) {
            lower[l][j] = lo;
            cost[l][j] = v + cost[lo - 1][j - 1];
          }
        }
      }
    }
    lower[l][1] = 1;
    cost[l][1] = v;
  }
  const breaks = new Array(k + 1);
  breaks[k] = sorted[n - 1];
  let end = n;
  for (let j = k; j >= 1; j--) {
    breaks[j - 1] = sorted[lower[end][j] - 1];
    end = lower[end][j] - 1;
  }
  return breaks;
}

// Class limits [lower_1, lower_2, ..., lower_k, max]; a value belongs to the last class whose lower limit it reaches.
export function classify(values, method = "quantile", k = 5) {
  const s = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return [];
  const distinct = new Set(s).size;
  k = Math.max(1, Math.min(k, distinct));
  const min = s[0], max = s[s.length - 1];
  if (k === 1) return [min, max];
  let breaks;
  if (method === "equal") breaks = Array.from({ length: k + 1 }, (_, i) => min + ((max - min) * i) / k);
  else if (method === "jenks") {
    // the exact algorithm is quadratic in the number of values, so long columns are thinned evenly first
    const cap = 1500;
    const data = s.length > cap ? Array.from({ length: cap }, (_, i) => s[Math.round((i * (s.length - 1)) / (cap - 1))]) : s;
    breaks = jenks(data, k);
  } else breaks = Array.from({ length: k + 1 }, (_, i) => quantileSorted(s, i / k));
  breaks[0] = min;
  breaks[breaks.length - 1] = max;
  const out = [breaks[0]];
  for (let i = 1; i < breaks.length - 1; i++) if (breaks[i] > out[out.length - 1] && breaks[i] < max) out.push(breaks[i]);
  out.push(max);
  return out;
}

export function classOf(v, breaks) {
  let c = 0;
  for (let i = 1; i < breaks.length - 1; i++) if (v >= breaks[i]) c = i;
  return c;
}

export function aggregate(points, zones) {
  const boxes = zones.map((z) => bboxOf(z.geometry));
  const stats = zones.map(() => ({ n: 0, sum: 0 }));
  const zoneOf = new Array(points.length).fill(-1);
  let outside = 0;
  points.forEach((p, pi) => {
    for (let i = 0; i < zones.length; i++) {
      const b = boxes[i];
      if (!b || p.xy[0] < b[0] || p.xy[0] > b[2] || p.xy[1] < b[1] || p.xy[1] > b[3]) continue;
      if (pointInGeometry(p.xy, zones[i].geometry)) {
        stats[i].n++;
        stats[i].sum += p.w;
        zoneOf[pi] = i;
        return;
      }
    }
    outside++;
  });
  return { stats, zoneOf, outside };
}

// Pointy-top hexagons; `widthM` is the distance between two opposite sides.
export function hexBin(points, widthM) {
  if (!points.length || !(widthM > 0)) return { cells: [], cellOf: [] };
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) b = [Math.min(b[0], p.xy[0]), Math.min(b[1], p.xy[1]), Math.max(b[2], p.xy[0]), Math.max(b[3], p.xy[1])];
  const pr = projector((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  const s = widthM / Math.sqrt(3);
  const cells = new Map();
  const cellOf = [];
  for (const p of points) {
    const [x, y] = pr.fwd(p.xy);
    const fq = ((Math.sqrt(3) / 3) * x - y / 3) / s, fr = ((2 / 3) * y) / s, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const t = Math.round(fs);
    const dq = Math.abs(q - fq), dr = Math.abs(r - fr), dt = Math.abs(t - fs);
    if (dq > dr && dq > dt) q = -r - t;
    else if (dr > dt) r = -q - t;
    const key = `${q},${r}`;
    let c = cells.get(key);
    if (!c) {
      c = { q, r, n: 0, sum: 0, index: cells.size };
      cells.set(key, c);
    }
    c.n++;
    c.sum += p.w;
    cellOf.push(c.index);
  }
  const out = [...cells.values()].map((c) => {
    const cx = s * Math.sqrt(3) * (c.q + c.r / 2), cy = s * 1.5 * c.r;
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const ll = pr.inv([cx + s * Math.cos(a), cy + s * Math.sin(a)]);
      ring.push([+ll[0].toFixed(7), +ll[1].toFixed(7)]);
    }
    ring.push(ring[0]);
    return { q: c.q, r: c.r, n: c.n, sum: c.sum, ring, center: pr.inv([cx, cy]), areaM2: (Math.sqrt(3) / 2) * widthM * widthM };
  });
  return { cells: out, cellOf };
}

// Straight-line distances in metres, one row per demand point. `factor` scales them to stand in for road distance.
export function distanceMatrix(demand, facilities, factor = 1) {
  return demand.map((d) => {
    const row = new Float64Array(facilities.length);
    for (let j = 0; j < facilities.length; j++) row[j] = haversine(d.xy, facilities[j].xy) * factor;
    return row;
  });
}

export function nearest(demand, facilities, D) {
  const assign = new Array(demand.length).fill(-1);
  const dist = new Array(demand.length).fill(Infinity);
  const per = facilities.map(() => ({ n: 0, w: 0, wd: 0, max: 0 }));
  demand.forEach((d, i) => {
    for (let j = 0; j < facilities.length; j++) {
      const m = D ? D[i][j] : haversine(d.xy, facilities[j].xy);
      if (m < dist[i]) {
        dist[i] = m;
        assign[i] = j;
      }
    }
    const f = per[assign[i]];
    if (!f) return;
    f.n++;
    f.w += d.w;
    f.wd += d.w * dist[i];
    if (dist[i] > f.max) f.max = dist[i];
  });
  let total = 0;
  for (const d of demand) total += d.w;
  return {
    assign,
    dist,
    total,
    facilities: per.map((f) => ({ n: f.n, demand: f.w, share: total > 0 ? f.w / total : NaN, meanDist: f.w > 0 ? f.wd / f.w : NaN, maxDist: f.max })),
  };
}

export function coverage(dist, weights, radiiM) {
  let total = 0;
  for (const w of weights) total += w;
  return radiiM.map((r) => {
    let inside = 0;
    dist.forEach((d, i) => {
      if (d <= r) inside += weights[i];
    });
    return { radius: r, demand: inside, share: total > 0 ? inside / total : NaN };
  });
}

// Huff (1963): P_ij = A_j^alpha * d_ij^-beta / sum_k(A_k^alpha * d_ik^-beta).
// Distances under `floorM` count as `floorM`, so a customer standing on an outlet does not divide by zero.
export function huff(demand, facilities, { alpha = 1, beta = 2, floorM = 50, maxM = Infinity } = {}, D) {
  const expected = facilities.map(() => 0);
  const best = new Array(demand.length).fill(-1);
  const prob = new Array(demand.length).fill(0);
  const dist = new Array(demand.length).fill(NaN);
  let total = 0, allocated = 0;
  const u = new Array(facilities.length);
  demand.forEach((d, i) => {
    total += d.w;
    let sum = 0;
    for (let j = 0; j < facilities.length; j++) {
      const m = D ? D[i][j] : haversine(d.xy, facilities[j].xy);
      const a = Math.max(0, facilities[j].a);
      u[j] = !(m <= maxM) || a === 0 ? 0 : a ** alpha / Math.max(m, floorM) ** beta;
      sum += u[j];
      if (best[i] < 0 || u[j] > u[best[i]]) {
        if (u[j] > 0) {
          best[i] = j;
          dist[i] = m;
        }
      }
    }
    if (sum === 0) return;
    allocated += d.w;
    for (let j = 0; j < facilities.length; j++) expected[j] += (d.w * u[j]) / sum;
    prob[i] = u[best[i]] / sum;
  });
  return {
    best,
    prob,
    dist,
    total,
    allocated,
    facilities: expected.map((e) => ({ demand: e, share: allocated > 0 ? e / allocated : NaN })),
  };
}

export function hhi(shares) {
  let s = 0;
  for (const v of shares) if (v > 0) s += (v * 100) ** 2;
  return s;
}

function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp((-z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export const pTwoSided = (z) => 2 * (1 - normalCdf(Math.abs(z)));

// Smallest distance band that leaves no feature without a neighbour.
export function autoBand(points) {
  let band = 0;
  for (let i = 0; i < points.length; i++) {
    let near = Infinity;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const d = haversine(points[i], points[j]);
      if (d < near) near = d;
    }
    if (near !== Infinity && near > band) band = near;
  }
  return band;
}

// Getis-Ord Gi* (Ord & Getis 1995, eq. 6) with binary weights inside a fixed distance band, the feature itself included.
export function giStar(points, x, bandM) {
  const n = points.length;
  let sum = 0, sumSq = 0;
  for (const v of x) {
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const s = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  const z = new Array(n).fill(0), neighbours = new Array(n).fill(0);
  if (n < 3 || s === 0) return { z, p: z.map(() => 1), neighbours, mean, s };
  for (let i = 0; i < n; i++) {
    let w = 0, wx = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j && haversine(points[i], points[j]) > bandM) continue;
      w++;
      wx += x[j];
    }
    neighbours[i] = w - 1;
    const denom = s * Math.sqrt((n * w - w * w) / (n - 1));
    z[i] = denom > 0 ? (wx - mean * w) / denom : 0;
  }
  return { z, p: z.map(pTwoSided), neighbours, mean, s };
}

export function giClass(z) {
  const a = Math.abs(z);
  const level = a >= 2.576 ? 99 : a >= 1.96 ? 95 : a >= 1.645 ? 90 : 0;
  if (!level) return "Not significant";
  return `${z > 0 ? "Hot" : "Cold"} spot ${level}%`;
}

export function toCsv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[columns.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n")}\r\n`;
}

// OSRM table request: sources first, then destinations, as the service expects them in one coordinate list.
export function osrmTableUrl(base, sources, destinations, annotations = "distance", profile = "driving") {
  const coords = [...sources, ...destinations].map((p) => `${+p[0].toFixed(6)},${+p[1].toFixed(6)}`).join(";");
  const src = sources.map((_, i) => i).join(";");
  const dst = destinations.map((_, i) => sources.length + i).join(";");
  return `${base.replace(/\/+$/, "")}/table/v1/${profile}/${coords}?sources=${src}&destinations=${dst}&annotations=${annotations}`;
}

const pad2 = (n) => String(n).padStart(2, "0");

function dateParts(v) {
  if (v instanceof Date) return Number.isNaN(+v) ? null : [v.getFullYear(), v.getMonth() + 1, v.getDate()];
  const s = String(v).trim();
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:$|[T\s])/.exec(s);
  if (m) return [+m[1], m[2] ? +m[2] : 1, m[3] ? +m[3] : 1, m[2] ? (m[3] ? "day" : "month") : "year"];
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  // day first, as written in Indonesia and most of the world
  if (m) return [+m[3], +m[2], +m[1], "day"];
  // Date.parse accepts almost anything ("Week 2" becomes February 2001), so it only sees text with a month name and a four-digit year
  if (!/[A-Za-z]{3}/.test(s) || !/\b\d{4}\b/.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), "day"];
}
const validDate = (p) => p && p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= 31;
const UNIT_KEY = {
  year: (p) => String(p[0]),
  quarter: (p) => `${p[0]}-Q${Math.ceil(p[1] / 3)}`,
  month: (p) => `${p[0]}-${pad2(p[1])}`,
  day: (p) => `${p[0]}-${pad2(p[1])}-${pad2(p[2])}`,
};
function nextKey(key, unit) {
  if (unit === "year") return String(+key + 1);
  if (unit === "quarter") {
    const y = +key.slice(0, 4), q = +key.slice(6);
    return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
  }
  if (unit === "month") {
    const y = +key.slice(0, 4), mo = +key.slice(5);
    return mo === 12 ? `${y + 1}-01` : `${y}-${pad2(mo + 1)}`;
  }
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8) + 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Values of `field` read as dates (year first, or day first), as plain numbers such as a year or month column, or as ordered text.
// Empty periods inside the range are kept, so a quiet month shows as a dip and not as a shorter axis.
export function trend(features, field, measure, agg = "sum", unit = "auto") {
  const raw = [];
  let skipped = 0;
  for (const f of features) {
    const v = f?.properties?.[field];
    if (blank(v)) skipped++;
    else raw.push({ v, m: measure ? toNumber(f.properties[measure]) : null });
  }
  let kind = "text";
  if (raw.length && raw.every((r) => toNumber(r.v) !== null)) kind = "number";
  else if (raw.length && raw.filter((r) => validDate(dateParts(r.v))).length >= raw.length * 0.8) kind = "date";

  let used = unit;
  if (kind === "date") {
    const parts = raw.map((r) => dateParts(r.v));
    if (unit === "auto") {
      const finest = parts.some((p) => validDate(p) && p[3] === "day") ? "day" : parts.some((p) => validDate(p) && p[3] === "month") ? "month" : "year";
      const order = ["day", "month", "quarter", "year"];
      used = order.slice(order.indexOf(finest)).find((u) => new Set(parts.filter(validDate).map(UNIT_KEY[u])).size <= 60) ?? "year";
    }
    raw.forEach((r, i) => {
      r.k = validDate(parts[i]) ? UNIT_KEY[used](parts[i]) : null;
    });
  } else {
    used = "";
    for (const r of raw) r.k = kind === "number" ? toNumber(r.v) : String(r.v);
  }
  const groups = new Map();
  for (const r of raw) {
    if (r.k === null) {
      skipped++;
      continue;
    }
    let g = groups.get(r.k);
    if (!g) {
      g = { key: r.k, n: 0, sum: 0, cnt: 0 };
      groups.set(r.k, g);
    }
    g.n++;
    if (r.m !== null) {
      g.sum += r.m;
      g.cnt++;
    }
  }
  let keys = [...groups.keys()].sort((a, b) => (kind === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })));
  if (keys.length > 1 && kind === "date") {
    const filled = [];
    for (let k = keys[0]; filled.length < 2000; k = nextKey(k, used)) {
      filled.push(k);
      if (k === keys[keys.length - 1]) break;
    }
    if (filled[filled.length - 1] === keys[keys.length - 1]) keys = filled;
  } else if (keys.length > 1 && kind === "number" && keys.every(Number.isInteger) && keys[keys.length - 1] - keys[0] < 2000) {
    keys = Array.from({ length: keys[keys.length - 1] - keys[0] + 1 }, (_, i) => keys[0] + i);
  }
  const rows = keys.map((k) => {
    const g = groups.get(k) ?? { n: 0, sum: 0, cnt: 0 };
    const value = agg === "count" || !measure ? g.n : agg === "mean" ? (g.cnt ? g.sum / g.cnt : NaN) : g.sum;
    return { key: k, label: String(k), n: g.n, sum: g.sum, mean: g.cnt ? g.sum / g.cnt : NaN, value };
  });
  rows.forEach((r, i) => {
    const prev = rows[i - 1]?.value;
    r.change = i > 0 && prev > 0 && Number.isFinite(r.value) ? r.value / prev - 1 : NaN;
  });
  return { kind, unit: used, rows, skipped };
}

export function trendStats(rows) {
  const pts = rows.map((r, i) => [i, r.value]).filter((p) => Number.isFinite(p[1]));
  if (!pts.length) return { peak: null, low: null, firstToLast: NaN, slope: NaN, slopePct: NaN };
  let peak = pts[0], low = pts[0], sx = 0, sy = 0;
  for (const p of pts) {
    if (p[1] > peak[1]) peak = p;
    if (p[1] < low[1]) low = p;
    sx += p[0];
    sy += p[1];
  }
  const mx = sx / pts.length, my = sy / pts.length;
  let sxx = 0, sxy = 0;
  for (const p of pts) {
    sxx += (p[0] - mx) ** 2;
    sxy += (p[0] - mx) * (p[1] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : NaN;
  const first = pts[0][1], last = pts[pts.length - 1][1];
  return { peak: rows[peak[0]], low: rows[low[0]], firstToLast: first > 0 ? last / first - 1 : NaN, slope, slopePct: my !== 0 ? slope / my : NaN };
}

// Greedy site selection: each step adds the candidate that improves the goal most, given the outlets already there.
//   coverage  demand within `radiusM` of any outlet (maximal covering, Church & ReVelle 1974)
//   pmedian   demand-weighted mean distance to the nearest outlet (p-median, greedy-add of Kuehn & Hamburger 1963)
//   huff      share of demand the new sites win from the existing outlets under the Huff model
export function selectSites(demand, candidates, { p = 3, objective = "coverage", radiusM = 2000, beta = 2, floorM = 50, factor = 1, existing = [], attract = 1, matrices = null } = {}) {
  const n = demand.length;
  let total = 0;
  for (const d of demand) total += d.w;
  // `matrices` carries road distances or times instead: De[i][j] to existing outlet j, Dc[c][i] from demand i to candidate c
  const De = matrices?.De ?? distanceMatrix(demand, existing, factor);
  const Dc =
    matrices?.Dc ??
    candidates.map((c) => {
      const col = new Float64Array(n);
      for (let i = 0; i < n; i++) col[i] = haversine(demand[i].xy, c.xy) * factor;
      return col;
    });
  const cur = new Float64Array(n).fill(Infinity);
  const base = new Float64Array(n);
  const won = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < existing.length; j++) {
      if (De[i][j] < cur[i]) cur[i] = De[i][j];
      base[i] += Math.max(0, existing[j].a ?? 1) / Math.max(De[i][j], floorM) ** beta;
    }
  }
  const util = (d) => attract / Math.max(d, floorM) ** beta;
  const measure = () => {
    let covered = 0, wd = 0, share = 0;
    for (let i = 0; i < n; i++) {
      const w = demand[i].w;
      if (cur[i] <= radiusM) covered += w;
      wd += w * cur[i];
      if (base[i] + won[i] > 0) share += (w * won[i]) / (base[i] + won[i]);
    }
    return { coverage: total > 0 ? covered / total : NaN, meanDist: total > 0 ? wd / total : NaN, share: total > 0 ? share / total : NaN };
  };
  const before = measure();
  const picks = [];
  const taken = new Set();
  for (let step = 0; step < Math.min(p, candidates.length); step++) {
    let best = -1, bestScore = -Infinity;
    for (let c = 0; c < candidates.length; c++) {
      if (taken.has(c)) continue;
      const col = Dc[c];
      let score = 0;
      for (let i = 0; i < n; i++) {
        const w = demand[i].w;
        if (objective === "coverage") {
          if (cur[i] > radiusM && col[i] <= radiusM) score += w;
        } else if (objective === "huff") {
          const s = won[i] + util(col[i]);
          score += (w * s) / (base[i] + s);
        } else score -= w * Math.min(cur[i], col[i]);
      }
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best < 0) break;
    taken.add(best);
    const col = Dc[best];
    let gain = 0;
    for (let i = 0; i < n; i++) {
      if (objective === "coverage" && cur[i] > radiusM && col[i] <= radiusM) gain += demand[i].w;
      if (col[i] < cur[i]) cur[i] = col[i];
      won[i] += util(col[i]);
    }
    picks.push({ index: best, gain: objective === "coverage" ? gain : NaN, ...measure() });
  }
  return { picks, before, after: picks.length ? picks[picks.length - 1] : before, total };
}

// The beta whose Huff shares come closest to the observed shares of the outlets (least squares over a grid of values).
export function calibrateBeta(demand, facilities, observed, D, { lo = 0.2, hi = 4, step = 0.05, ...options } = {}) {
  let sum = 0;
  for (const v of observed) sum += v;
  if (!(sum > 0) || facilities.length < 2) return null;
  const target = observed.map((v) => v / sum);
  const mean = 1 / target.length;
  let sst = 0;
  for (const v of target) sst += (v - mean) ** 2;
  let best = null;
  for (let k = 0; lo + k * step <= hi + 1e-9; k++) {
    const beta = +(lo + k * step).toFixed(4);
    const shares = huff(demand, facilities, { ...options, beta }, D).facilities.map((f) => f.share);
    let sse = 0;
    shares.forEach((v, j) => {
      sse += ((Number.isFinite(v) ? v : 0) - target[j]) ** 2;
    });
    if (!best || sse < best.sse) best = { beta, sse, shares };
  }
  return { beta: best.beta, rmse: Math.sqrt(best.sse / target.length), r2: sst > 0 ? 1 - best.sse / sst : NaN, shares: best.shares, target, atEdge: best.beta <= lo || best.beta >= hi };
}

// n x n points on a square of half-width `radiusM` around `center`, row by row from the south-west corner.
export function squareGrid(center, radiusM, n) {
  const pr = projector(center[0], center[1]);
  const points = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) points.push(pr.inv([-radiusM + (2 * radiusM * i) / (n - 1), -radiusM + (2 * radiusM * j) / (n - 1)]));
  return points;
}

// Polygons where a field sampled on an n x n grid is at or under `threshold` (marching squares; cells are merged by
// cancelling the edges two neighbours share). `points` are the grid positions, in the order of squareGrid.
export function contourPolygons(values, points, n, threshold) {
  const at = (i, j) => {
    const v = values[j * n + i];
    return Number.isFinite(v) ? v : Infinity;
  };
  const xy = (i, j) => points[j * n + i];
  const vertex = new Map();
  const edges = new Map();
  const corner = (i, j) => {
    const key = `c${i},${j}`;
    if (!vertex.has(key)) vertex.set(key, xy(i, j));
    return key;
  };
  // the crossing on the grid edge from (i,j) to (i2,j2); unreachable ends count as twice the threshold
  const cross = (i, j, i2, j2) => {
    const key = i === i2 ? `v${i},${Math.min(j, j2)}` : `h${Math.min(i, i2)},${j}`;
    if (!vertex.has(key)) {
      const cap = Math.max(threshold * 2, 1e-9);
      const a = Math.min(at(i, j), cap), b = Math.min(at(i2, j2), cap);
      const f = b === a ? 0.5 : Math.min(1, Math.max(0, (threshold - a) / (b - a)));
      const p = xy(i, j), q = xy(i2, j2);
      vertex.set(key, [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
    }
    return key;
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      const inside = c.map(([a, b]) => at(a, b) <= threshold);
      const piece = [];
      for (let k = 0; k < 4; k++) {
        const m = (k + 1) % 4;
        if (inside[k]) piece.push(corner(c[k][0], c[k][1]));
        if (inside[k] !== inside[m]) piece.push(cross(c[k][0], c[k][1], c[m][0], c[m][1]));
      }
      if (piece.length < 3) continue;
      for (let k = 0; k < piece.length; k++) {
        const a = piece[k], b = piece[(k + 1) % piece.length];
        if (a === b) continue;
        if (edges.has(`${b}|${a}`)) edges.delete(`${b}|${a}`);
        else edges.set(`${a}|${b}`, [a, b]);
      }
    }
  }
  const next = new Map();
  for (const [a, b] of edges.values()) {
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const rings = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring = [start];
      let at_ = start;
      for (let guard = 0; guard < edges.size + 2; guard++) {
        const outs = next.get(at_);
        if (!outs?.length) break;
        at_ = outs.pop();
        if (at_ === start) break;
        ring.push(at_);
      }
      if (at_ === start && ring.length >= 3) {
        const coords = ring.map((k) => vertex.get(k).map((v) => +v.toFixed(7)));
        coords.push(coords[0]);
        rings.push(coords);
      }
    }
  }
  const outers = rings.filter((r) => ringSigned(r) > 0).map((r) => [r]);
  for (const hole of rings.filter((r) => ringSigned(r) < 0)) {
    const home = outers.find((poly) => inRing(hole[0], poly[0])) ?? outers.find((poly) => inRing(hole[1], poly[0]));
    if (home) home.push(hole);
  }
  return outers;
}
