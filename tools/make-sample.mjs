// Writes the synthetic demo layers in sample/. Every value is generated; none describes a real business.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { huff } from "../src/core.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "sample");
mkdirSync(out, { recursive: true });

let seed = 20261115;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const pick = (list) => list[Math.floor(rnd() * list.length)];
const r6 = (v) => +v.toFixed(6);

const lon0 = 95.32, lat0 = 5.55;
const kmLon = 1 / (111.195 * Math.cos((lat0 * Math.PI) / 180)), kmLat = 1 / 111.195;
const at = (xKm, yKm) => [r6(lon0 + xKm * kmLon), r6(lat0 + yKm * kmLat)];
const fc = (features) => ({ type: "FeatureCollection", features });
const point = (xy, properties) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: xy } });

// its own generator, so adding the date column left the other sample values as they were
let seed2 = 7;
const rnd2 = () => {
  seed2 = (seed2 * 1664525 + 1013904223) >>> 0;
  return seed2 / 4294967296;
};
// 18 months of orders that grow over time, with a dip every February
function orderDate() {
  for (;;) {
    const m = Math.floor(rnd2() * 18);
    const month = m % 12;
    if (rnd2() > (0.35 + (0.65 * m) / 17) * (month === 1 ? 0.45 : 1)) continue;
    const d = new Date(Date.UTC(2025, m, 1 + Math.floor(rnd2() * 28)));
    return d.toISOString().slice(0, 10);
  }
}

const formats = ["Flagship", "Express", "Kiosk"];
const outletSites = [[0, 0], [2.6, 1.4], [-2.8, 1.9], [1.2, -2.7], [-1.6, -2.2], [4.4, -0.8], [-4.2, -0.6], [0.4, 3.6], [3.4, 3.8], [-3.4, 4.2], [5.2, 2.6], [-0.8, -4.6]];
const outlets = outletSites.map(([x, y], i) => {
  const format = i === 0 ? "Flagship" : formats[1 + (i % 2)];
  const floor = format === "Flagship" ? 420 : format === "Express" ? 140 + Math.round(rnd() * 80) : 40 + Math.round(rnd() * 30);
  return point(at(x + gauss() * 0.15, y + gauss() * 0.15), {
    outlet: `Outlet ${String(i + 1).padStart(2, "0")}`,
    format,
    floor_m2: floor,
    staff: Math.max(2, Math.round(floor / 35)),
    revenue_m: Math.round(floor * (2.2 + rnd() * 1.6)),
  });
});

const clusters = [[0, 0, 1.3, 0.34], [2.8, 1.6, 1.0, 0.2], [-2.6, 2.0, 1.1, 0.16], [1.0, -2.8, 0.9, 0.12], [-4.0, -0.8, 1.2, 0.08], [3.8, 3.6, 1.4, 0.1]];
const segments = ["Household", "Office", "Student", "Reseller"];
const customers = [];
for (let i = 0; i < 900; i++) {
  let u = rnd(), c = clusters[0];
  for (const k of clusters) {
    if (u < k[3]) {
      c = k;
      break;
    }
    u -= k[3];
  }
  const segment = pick(segments);
  const base = segment === "Reseller" ? 900 : segment === "Office" ? 420 : segment === "Household" ? 260 : 120;
  customers.push(
    point(at(c[0] + gauss() * c[2], c[1] + gauss() * c[2]), {
      customer: `C${String(i + 1).padStart(4, "0")}`,
      segment,
      spend_k: Math.max(20, Math.round(base * Math.exp(gauss() * 0.45))),
      visits: 1 + Math.floor(rnd() * 11),
      month: 1 + Math.floor(rnd() * 12),
      date: orderDate(),
    }),
  );
}

const zones = [];
const size = 2.4, half = 3;
for (let r = -half; r < half; r++) {
  for (let c = -half; c < half; c++) {
    const x = c * size, y = r * size;
    const cx = x + size / 2, cy = y + size / 2;
    const density = 900 + 5200 * Math.exp(-(cx * cx + cy * cy) / 18) + rnd() * 600;
    const population = Math.round(density * size * size);
    zones.push({
      type: "Feature",
      properties: {
        zone: `Z${String.fromCharCode(65 + r + half)}${c + half + 1}`,
        population,
        households: Math.round(population / (3.6 + rnd() * 0.8)),
        income_idx: Math.round(70 + rnd() * 60),
      },
      geometry: { type: "Polygon", coordinates: [[at(x, y), at(x + size, y), at(x + size, y + size), at(x, y + size), at(x, y)]] },
    });
  }
}

// revenue follows a Huff split of customer spend (beta 1.6, floor area as attractiveness) with ±10% noise, so calibration has something to find
const split = huff(customers.map((f) => ({ xy: f.geometry.coordinates, w: f.properties.spend_k })), outlets.map((f) => ({ xy: f.geometry.coordinates, a: f.properties.floor_m2 })), { beta: 1.6 });
outlets.forEach((f, j) => {
  f.properties.revenue_m = Math.round((split.facilities[j].demand / 10) * (0.9 + rnd2() * 0.2));
});

writeFileSync(join(out, "outlets.geojson"), JSON.stringify(fc(outlets)));
writeFileSync(join(out, "customers.geojson"), JSON.stringify(fc(customers)));
writeFileSync(join(out, "zones.geojson"), JSON.stringify(fc(zones)));
console.log(`outlets ${outlets.length}, customers ${customers.length}, zones ${zones.length}`);
