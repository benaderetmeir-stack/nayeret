// זיהוי מסמכים עם Google Gemini (מכסה חינמית)
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash"];

const PROMPT = `You read Israeli business paperwork (Hebrew or English) for an accountant.
Look at the page images (all pages belong to ONE document) and return ONLY a JSON object:
{
  "kind": "invoice" | "other",
  "docType": string,          // for "other" choose the closest from: "תלוש שכר", "דוח קופות גמל / פנסיה", "העברת משכורת", "דף בנק", "דף כרטיס אשראי", "תעודת משלוח", "אישור תשלום", "ביטוח לאומי", "מס הכנסה", "מע\"מ", "הסכם / חוזה", "ביטוח"; if none fits, a short Hebrew label. For invoices: "חשבונית מס", "חשבונית מס קבלה", "קבלה"
  "supplier": string,         // for invoices/receipts: issuing business name as printed
  "name": string,             // for other paperwork: the main person/company name (employee, bank, supplier)
  "invoiceNumber": string,    // invoice/receipt number only, digits and dashes, "" if none
  "date": "YYYY-MM-DD",       // document date (not print date); "" if unreadable
  "currency": string,         // ISO code of the amounts as printed: "ILS" (₪, ש"ח, NIS), "USD" ($), "EUR" (€), "GBP" (£)...
  "total": number | null,     // total including VAT, in the document's currency
  "vat": number | null,       // VAT amount
  "net": number | null,       // amount before VAT
  "exempt": boolean,          // true if issued by "עוסק פטור" or no VAT charged
  "amount": number | null,    // for other paperwork: the main amount (net salary, transfer amount, statement balance change) or null
  "category": string,         // for invoices only, one of: "חומרים ותכשירים", "ציוד ומכשירים", "שיווק ופרסום", "שכירות ואחזקה", "חשמל, מים ועירייה", "תקשורת ומנויים", "השתלמויות", "נסיעות ורכב", "כיבוד ומשרד", "ביטוח", "משכורות", "אחר". The business is a medical-cosmetics clinic.
"details": string,          // short Hebrew summary (max ~70 chars). Invoice: what was bought / which service, e.g. "סרום היאלורוני x12, מסכות אלגינט x20" or "ניקיון חודשי". Salary/money transfer: "הועבר ל<recipient> סך של ₪<amount>" (+ purpose if shown). Bank / credit-card statement: the main payees. Other: what the document is about.
  "note": string              // very short Hebrew note if something important is unclear, else ""
}
Rules:
- "invoice" = supplier invoices and receipts the business RECEIVED (חשבונית, חשבונית מס, קבלה, חשבונית מס קבלה, חשבונית זיכוי), including a plain receipt (קבלה) from a VAT-exempt dealer (עוסק פטור), which is the only document such a dealer issues.
- Any document issued by a business that shows an amount paid for goods or services counts as "invoice". When unsure between the two, choose "invoice".
- A pension / provident fund report (דוח קופות גמל, פנסיה, קרן השתלמות, הפרשות מעסיק) is "דוח קופות גמל / פנסיה", NOT a payslip. A payslip (תלוש שכר) is for one employee for one month with gross/net salary.
- "other" = payslips, bank statements, salary transfers, delivery notes without payment, payment confirmations and anything else.
- Numbers as plain numbers without currency signs or thousands separators. Credit notes (זיכוי) as negative totals.
- Dates in Israel are written day/month/year.
- Never invent values; use "" or null when unsure.`;

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function normCur(c) {
  const s = String(c || "").trim().toUpperCase();
  if (!s || /ILS|NIS|₪|ש"?ח|שקל/.test(s)) return "ILS";
  if (/USD|\$|US ?DOLLAR|דולר/.test(s)) return "USD";
  if (/EUR|€|יורו/.test(s)) return "EUR";
  if (/GBP|£/.test(s)) return "GBP";
  return /^[A-Z]{3}$/.test(s) ? s : "ILS";
}
function isoDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
}

export function normalizeResult(r) {
  r = r || {};
  const out = {
    kind: r.kind === "other" ? "other" : "invoice",
    docType: String(r.docType || "").trim(),
    supplier: String(r.supplier || "").trim(),
    name: String(r.name || "").trim(),
    invoiceNumber: String(r.invoiceNumber || "").replace(/\s+/g, "").trim(),
    date: isoDate(r.date),
    total: num(r.total), vat: num(r.vat), net: num(r.net),
    exempt: !!r.exempt,
    amount: num(r.amount),
    currency: normCur(r.currency),
    category: String(r.category || "").trim(),
    details: String(r.details || "").replace(/\s+/g, " ").trim().slice(0, 160),
    note: String(r.note || "").trim()
  };
  if (out.currency !== "ILS") { out.vat = 0; out.net = out.total; out.exempt = false; }
  if (out.exempt) { out.vat = 0; if (out.total != null) out.net = out.total; }
  if (out.total != null && out.vat != null && out.net == null) out.net = Math.round((out.total - out.vat) * 100) / 100;
  if (out.kind === "other" && !out.name) out.name = out.supplier;
  return out;
}

function safeMsg(body) { try { return (JSON.parse(body).error?.message || "").slice(0, 160); } catch { return String(body).slice(0, 160); } }

async function callModel(model, key, pages) {
  const parts = [{ text: PROMPT }];
  for (const p of pages.slice(0, 4)) parts.push({ inline_data: { mime_type: "image/jpeg", data: p.slice(p.indexOf(",") + 1) } });
  const res = await fetch(API + encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Gemini ${res.status}`); err.status = res.status; err.body = body; throw err;
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// מחזיר {ok, result, message}
export async function recognize(pages, settings) {
  const key = (settings.geminiKey || "").trim();
  if (!key) return { ok: false, message: "לא הוגדר מפתח זיהוי, אז ממלאים ידנית. אפשר להוסיף מפתח בהגדרות." };
  const models = [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let last, hitQuota = false;
  for (const m of models) {
    try {
      return { ok: true, result: normalizeResult(await callModel(m, key, pages)), model: m };
    } catch (e) {
      last = e;
      // דגם לא קיים / לא נתמך / עמוס → מנסים את הבא
      // מכסה נגמרה (429) → לכל דגם מכסה חינמית נפרדת, אז עוברים לבא
      if (e.status === 429) { hitQuota = true; continue; }
      if ([404, 500, 503].includes(e.status) || (e.status === 400 && /model|not found|not supported/i.test(e.body || ""))) continue;
      break;
    }
  }
  const detail = last ? ` (קוד: ${last.status || last.name || "?"}${last.body ? " · " + (safeMsg(last.body)) : ""})` : "";
  let message = "הזיהוי לא הצליח, אז ממלאים ידנית." + detail;
  if (hitQuota || last?.status === 429) message = "נגמרה לעכשיו מכסת הזיהוי החינמית. ממלאים ידנית, או מנסים שוב בעוד כמה דקות. המכסה היומית מתאפסת כל יום ב-10:00 בבוקר.";
  else if (last?.status === 400 || last?.status === 403) message = "מפתח הזיהוי לא תקין או חסום. בדקי אותו בהגדרות. בינתיים ממלאים ידנית." + detail;
  else if (last instanceof SyntaxError) message = "התשובה מהזיהוי לא הייתה ברורה, אז ממלאים ידנית.";
  return { ok: false, message };
}
