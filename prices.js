// מעקב מחירים: זוכר לכל ספק את המחיר האחרון ליחידה של כל מוצר, ומתריע על התייקרות
export const PRICE_THRESHOLD = 5; // אחוז

export function itemKey(name) {
  return String(name || "").toLowerCase()
    .replace(/["'״׳`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const tokens = (k) => new Set(k.split(" ").filter(Boolean));
function similar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let both = 0; for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}
// המחיר הקודם של מוצר אצל הספק: התאמה מדויקת, ואם אין, השם הכי דומה (לפחות 60% מילים משותפות)
export function findPrev(map, name) {
  const k = itemKey(name); if (!k || !map) return null;
  if (map[k]) return map[k];
  let best = null, score = 0;
  for (const [key, v] of Object.entries(map)) { const s = similar(k, key); if (s > score) { score = s; best = v; } }
  return score >= 0.6 ? best : null;
}
// התייקרויות בחשבונית לעומת המחיר האחרון (רק מול חשבונית מוקדמת יותר)
export function priceAlerts(map, items, date, threshold = PRICE_THRESHOLD) {
  const out = [];
  for (const it of items || []) {
    const u = Number(it.unitPrice); if (!(u > 0)) continue;
    const prev = findPrev(map, it.name);
    if (!prev || !(prev.u > 0) || (date && prev.d && prev.d > date)) continue;
    const pct = (u / prev.u - 1) * 100;
    if (pct >= threshold) out.push({ name: it.name, from: prev.u, to: u, pct: Math.round(pct * 10) / 10, d: prev.d || "" });
  }
  return out;
}
// עדכון הזיכרון: חשבונית ישנה יותר לא דורסת מחיר חדש יותר
export function mergePrices(map, items, date) {
  const next = { ...(map || {}) };
  for (const it of items || []) {
    const u = Number(it.unitPrice), k = itemKey(it.name);
    if (!(u > 0) || !k) continue;
    const cur = next[k];
    if (cur && date && cur.d && cur.d > date) continue;
    next[k] = { n: String(it.name).slice(0, 80), u: Math.round(u * 100) / 100, d: date || "" };
  }
  const keys = Object.keys(next);
  if (keys.length > 80) keys.sort((a, b) => (next[a].d || "").localeCompare(next[b].d || "")).slice(0, keys.length - 80).forEach((k) => delete next[k]);
  return next;
}
