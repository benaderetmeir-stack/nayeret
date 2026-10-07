// התאמה בין חשבוניות לאישורי תשלום: אותו סכום, שם ספק דומה, תאריכים קרובים
import { supplierKey } from "./recur.js?v=20261007h";

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
export function matchPayments(invoices, payments, ownName = "") {
  const own = new Set(supplierKey(ownName).split(" ").filter((t) => t.length > 2));
  // השם באישור תשלום יכול להיות של המשלם (העסק שלך) או של הבנק, אז בודקים גם את הפירוט
  const payNames = (p) => [p.name, p.details].filter((n) => n && !(own.size && supplierKey(n).split(" ").some((t) => own.has(t))));
  const pairs = [];
  for (const p of payments) {
    const amt = Number(p.amount); if (!(amt > 0) || !p.date) continue;
    for (const inv of invoices) {
      const tot = Number(inv.total); if (!(tot > 0) || !inv.date) continue;
      if (Math.abs(tot - amt) > 1) continue;
      const d = days(p.date, inv.date); if (d > MAX_DAYS) continue;
      const scores = payNames(p).map((n) => nameScore(n, inv.supplier)).filter((x) => x !== null);
      const ns = scores.length ? Math.max(...scores) : null;
      const exact = Math.abs(tot - amt) < 0.01;
      if (ns !== null && ns < 0.5 && !(exact && d <= 60)) continue;   // שם אחר: רק סכום מדויק ועד 60 יום
      if (ns === null && d > 60) continue;                            // בלי שם: עד 60 יום
      pairs.push({ p, inv, score: d - (ns || 0) * 30 + (ns !== null && ns < 0.5 ? 40 : 0) });
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
