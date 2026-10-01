// זיהוי חשבוניות קבועות (כל חודש / כל חודשיים / כל שנה) ואיתור חסרות
const SUFFIXES = new Set(["בעמ", "ltd", "inc", "llc", "co", "corp", "limited", "gmbh", "חברה"]);
export function supplierKey(name) {
  return String(name || "").toLowerCase()
    .replace(/["'״׳`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/)
    .filter((w) => w && !SUFFIXES.has(w)).join(" ");
}
function shift(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

// stats: { key: {name, m:[months]} } → מאחד שמות דומים ("פלאפון" ו"פלאפון תקשורת")
function merge(stats) {
  const keys = Object.keys(stats).filter((k) => k).sort((a, b) => a.length - b.length);
  const groups = [];
  for (const k of keys) {
    const g = groups.find((x) => k === x.key || k.startsWith(x.key + " "));
    if (g) { stats[k].m.forEach((m) => g.months.add(m)); g.keys.push(k); }
    else groups.push({ key: k, keys: [k], name: stats[k].name || k, months: new Set(stats[k].m || []) });
  }
  return groups;
}

const FREQ_LABEL = { 1: "כל חודש", 2: "כל חודשיים", 12: "פעם בשנה" };

// מחזיר את הספקים הקבועים שצפויים בחודש month ועדיין אין מהם חשבונית עם תאריך באותו חודש
export function missingRecurring(stats, month, ignore = {}) {
  const out = [];
  for (const g of merge(stats || {})) {
    const has = (m) => g.months.has(m);
    const ign = g.keys.map((k) => ignore[k]).filter(Boolean).sort().pop();
    if (ign) { const after = [...g.months].some((m) => m > ign); if (!after) continue; }
    if (has(month)) continue;
    const b = (n) => has(shift(month, -n));
    let freq = 0;
    if ([1, 2, 3, 4].filter(b).length >= 3 && b(1)) freq = 1;
    else if (b(2) && b(4) && !b(1) && !b(3)) freq = 2;
    else if (b(12) && !b(1) && [...g.months].filter((m) => m > shift(month, -12) && m < month).length <= 1 && !has(shift(month, 1))) freq = 12;
    if (freq) out.push({ key: g.key, keys: g.keys, name: g.name, freq, label: FREQ_LABEL[freq] });
  }
  return out.sort((a, b) => a.freq - b.freq || a.name.localeCompare(b.name, "he"));
}

// רשימת כל הספקים הקבועים שזוהו (להגדרות)
export function recurringList(stats, refMonth) {
  return merge(stats || {}).map((g) => {
    const ms = [...g.months].filter((m) => m <= refMonth && m > shift(refMonth, -13)).sort();
    let freq = 0;
    const last4 = [0, 1, 2, 3].map((n) => g.months.has(shift(refMonth, -n))).filter(Boolean).length;
    if (last4 >= 3) freq = 1;
    else if (ms.length >= 3 && ms.every((m, i) => i === 0 || monthsBetween(ms[i - 1], m) === 2)) freq = 2;
    else if (ms.length >= 1 && [...g.months].some((m) => monthsBetween(m, refMonth) >= 11 && monthsBetween(m, refMonth) <= 13) && ms.length <= 2) freq = 12;
    return freq ? { key: g.key, keys: g.keys, name: g.name, freq, label: FREQ_LABEL[freq] } : null;
  }).filter(Boolean).sort((a, b) => a.freq - b.freq || a.name.localeCompare(b.name, "he"));
}
function monthsBetween(a, b) { const [y1, m1] = a.split("-").map(Number), [y2, m2] = b.split("-").map(Number); return (y2 - y1) * 12 + (m2 - m1); }
