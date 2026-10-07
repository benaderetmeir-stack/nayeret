// התאמה בין חשבוניות לאישורי תשלום: אותו סכום, שם ספק דומה, תאריכים קרובים
import { supplierKey } from "./recur.js?v=20261007f";

// אישור תשלום לספק (לא משכורת, לא דף בנק)
export const isPayment = (r) => r.kind === "other" && /אישור תשלום|העברה בנקאית|העברת כספים/.test(r.docType || "") && !/משכורת|שכר/.test(r.docType || "");

const MAX_DAYS = 75;
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
function nameScore(a, b) {
  const A = new Set(supplierKey(a).split(" ").filter(Boolean)), B = new Set(supplierKey(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return null;   // אין שם להשוואה
  let both = 0; for (const t of A) if (B.has(t)) both++;
  return both / Math.min(A.size, B.size);
}

// מחזיר Map: מזהה מסמך ← המסמך שהותאם לו (בשני הכיוונים)
export function matchPayments(invoices, payments) {
  const pairs = [];
  for (const p of payments) {
    const amt = Number(p.amount); if (!(amt > 0) || !p.date) continue;
    for (const inv of invoices) {
      const tot = Number(inv.total); if (!(tot > 0) || !inv.date) continue;
      if (Math.abs(tot - amt) > 1) continue;
      const d = days(p.date, inv.date); if (d > MAX_DAYS) continue;
      const ns = nameScore(p.name || p.details, inv.supplier);
      if (ns !== null && ns < 0.5) continue;            // שמות שונים: לא אותו ספק
      if (ns === null && d > 31) continue;              // בלי שם: רק אם קרוב בזמן
      pairs.push({ p, inv, score: d - (ns || 0) * 30 });
    }
  }
  pairs.sort((a, b) => a.score - b.score);
  const out = new Map();
  for (const { p, inv } of pairs) {
    if (out.has(p.id) || out.has(inv.id)) continue;
    out.set(p.id, inv); out.set(inv.id, p);
  }
  return out;
}
