// המרת מטבע: השער היציג של בנק ישראל ליום החשבונית (ובגיבוי: שער ה-ECB)
const cache = {};
export const CUR_SIGN = { USD: "$", EUR: "€", GBP: "£", ILS: "₪" };
export const curSign = (c) => CUR_SIGN[c] || c || "";

function shiftDay(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function fromBOI(cur, date) {
  const url = `https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0/RER_${cur}_ILS?startperiod=${shiftDay(date, -10)}&endperiod=${date}&format=csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("BOI " + res.status);
  const lines = (await res.text()).trim().split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const ti = head.indexOf("TIME_PERIOD"), vi = head.indexOf("OBS_VALUE");
  if (ti < 0 || vi < 0) throw new Error("BOI format");
  const rows = lines.slice(1).map((l) => l.split(",")).filter((c) => c[ti] && c[ti] <= date && Number(c[vi]) > 0)
    .sort((a, b) => a[ti].localeCompare(b[ti]));
  const last = rows[rows.length - 1];
  if (!last) throw new Error("BOI empty");
  return { rate: Number(last[vi]), date: last[ti], source: "בנק ישראל" };
}

async function fromECB(cur, date) {
  for (const host of ["https://api.frankfurter.dev/v1", "https://api.frankfurter.app"]) {
    try {
      const res = await fetch(`${host}/${date}?base=${cur}&symbols=ILS`);
      if (!res.ok) continue;
      const j = await res.json();
      if (j?.rates?.ILS) return { rate: Number(j.rates.ILS), date: j.date || date, source: "ECB" };
    } catch (e) { /* הבא */ }
  }
  throw new Error("ECB");
}

// מחזיר {rate, date, source} או null אם אין חיבור
export async function getRate(cur, date) {
  if (!cur || cur === "ILS") return { rate: 1, date, source: "" };
  const d = date || new Date().toISOString().slice(0, 10);
  const key = cur + d;
  if (cache[key]) return cache[key];
  for (const fn of [fromBOI, fromECB]) {
    try { const r = await fn(cur, d); r.rate = Math.round(r.rate * 10000) / 10000; return (cache[key] = r); }
    catch (e) { console.warn("fx", e.message); }
  }
  return null;
}
