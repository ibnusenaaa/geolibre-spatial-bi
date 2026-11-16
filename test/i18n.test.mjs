import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ID_TEXT } from "../src/i18n.js";

const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const found = new Set();
const grab = (re) => {
  for (const m of src.matchAll(re)) found.add(m[1].replace(/\\(.)/g, "$1"));
};
grab(/\bt\("((?:[^"\\]|\\.)+)"/g);
grab(/\bt\('((?:[^'\\]|\\.)+)'/g);
grab(/\bfld\("((?:[^"\\]|\\.)+)"/g);
grab(/\bcheck\("[^"]+", "((?:[^"\\]|\\.)+)"/g);
grab(/\bbtn\("[^"]+", "((?:[^"\\]|\\.)+)"/g);
grab(/\bkpi\("((?:[^"\\]|\\.)+)"/g);
grab(/\["[A-Za-z0-9_]*", "([A-Z][^"]*)"\]/g);
grab(/, "(\([a-z ]+\))"\]/g);
grab(/"((?:Hot|Cold) spot \d+%|Not significant)"/g);
grab(/^\s+(?:zones|market|sites|hot): "([^"]+)",$/gm);
for (const ramp of ["Blues", "Greens", "Oranges", "Purples", "Yellow–Red", "Viridis", "Red–Green"]) found.add(ramp);

test("every panel string has Indonesian text", () => {
  assert.ok(found.size > 100, `only ${found.size} strings found; the patterns no longer match main.js`);
  assert.deepEqual([...found].filter((s) => !(s in ID_TEXT)), []);
});

test("no Indonesian entry is left over from removed strings", () => {
  assert.deepEqual(Object.keys(ID_TEXT).filter((s) => !found.has(s)), []);
});

test("placeholders survive translation", () => {
  const holes = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
  for (const [en, id] of Object.entries(ID_TEXT)) assert.equal(holes(id), holes(en), en);
});

test("translation keys do not collide", () => {
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 70);
  const seen = new Map();
  for (const en of Object.keys(ID_TEXT)) {
    const k = (/^[a-z]/.test(en) ? "lc_" : "") + slug(en);
    assert.ok(k, `"${en}" has no key`);
    assert.ok(!seen.has(k), `"${en}" and "${seen.get(k)}" share the key ${k}`);
    seen.set(k, en);
  }
});
