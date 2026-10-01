// הפקת קבצים: טבלה ב-PDF, קובץ מסמכים ב-PDF, אקסל, ושיתוף
import { loadImage } from "./images.js";

export const COLS = {
  invoice: [
    { key: "idx", label: "#", w: 44, color: "E8EEF3" },
    { key: "thumb", label: "תמונה", w: 64, color: "E4F4FA" },
    { key: "date", label: "תאריך", w: 104, color: "DDF1F7" },
    { key: "supplier", label: "ספק", w: 250, color: "D8F3F1" },
    { key: "invoiceNumber", label: "מס' חשבונית", w: 130, color: "E3EEFB" },
    { key: "net", label: "לפני מע\"מ", w: 118, color: "E0F2EC", money: true, sum: true },
    { key: "vat", label: "מע\"מ", w: 104, color: "FDF1DC", money: true, sum: true },
    { key: "total", label: "סכום כולל", w: 124, color: "CDEBF5", money: true, sum: true, strong: true },
    { key: "note", label: "הערה", w: 180, color: "F1F4F6" }
  ],
  other: [
    { key: "idx", label: "#", w: 44, color: "E8EEF3" },
    { key: "thumb", label: "תמונה", w: 64, color: "E4F4FA" },
    { key: "date", label: "תאריך", w: 110, color: "DDF1F7" },
    { key: "docType", label: "סוג מסמך", w: 170, color: "EAE8FA" },
    { key: "name", label: "שם", w: 280, color: "D8F3F1" },
    { key: "amount", label: "סכום", w: 140, color: "CDEBF5", money: true, sum: true, strong: true },
    { key: "note", label: "הערה", w: 250, color: "F1F4F6" }
  ]
};

export const KIND_LABEL = { invoice: "חשבוניות וקבלות", other: "ניירת אחרת" };

// ===== קטגוריות הוצאה =====
export const CATEGORIES = ["חומרים ותכשירים", "ציוד ומכשירים", "שיווק ופרסום", "שכירות ואחזקה", "חשמל, מים ועירייה", "תקשורת ומנויים", "השתלמויות", "נסיעות ורכב", "כיבוד ומשרד", "ביטוח", "משכורות", "אחר"];
// מהניירת האחרת נספרים רק תשלומים בפועל (תלושים, תעודות משלוח, דפי בנק וכו' לא נספרים)
export const OTHER_CAT = { "העברת משכורת": "משכורות", "דוח קופות גמל / פנסיה": "משכורות", "ביטוח לאומי": "משכורות", "ביטוח": "ביטוח" };
export const UNCAT = "לא מסווג";
export function categorySummary(sections, catOf) {
  const map = new Map();
  for (const { kind, rows } of sections) for (const r of rows) {
    let cat, amt;
    if (kind === "invoice") { cat = r.category || catOf(r) || UNCAT; amt = Number(r.total) || 0; }
    else { cat = OTHER_CAT[r.docType]; amt = Number(r.amount) || 0; if (!cat || !amt) continue; }
    const x = map.get(cat) || { cat, total: 0, count: 0, items: [] };
    x.total = Math.round((x.total + amt) * 100) / 100; x.count++; map.set(cat, x);
    x.items.push({ date: r.date || "", name: kind === "invoice" ? (r.supplier || "") : (r.name || ""), ref: kind === "invoice" ? (r.invoiceNumber || "") : (r.docType || ""), amount: amt });
  }
  const list = [...map.values()].sort((a, b) => b.total - a.total);
  return { list, total: Math.round(list.reduce((n, x) => n + x.total, 0) * 100) / 100 };
}

const CAT_COLORS = ["0FA3B1", "0E6A8C", "3BB273", "E1A33B", "E2461C", "7A5AE0", "2C8FD6", "C2549A", "6B8E23", "8A6D3B", "4A6B7C", "9AA9B2"];
async function renderSummaryPage(pdf, summary, meta) {
  if (!summary?.list?.length) return;
  await document.fonts?.ready;
  const W = TW, H = TH_, S = 2, M = 34;
  const c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
  const ctx = c.getContext("2d"); ctx.scale(S, S); ctx.direction = "rtl";
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(W, 0, 0, 0); g.addColorStop(0, TURQ); g.addColorStop(1, BLUE);
  ctx.fillStyle = g; roundRect(ctx, M, M, W - 2 * M, 58, 12); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.font = `700 22px ${FONT}`; ctx.fillText("סיכום הוצאות לפי קטגוריות", W - M - 18, M + 22);
  ctx.font = `500 13px ${FONT}`; ctx.fillText(meta.subtitle, W - M - 18, M + 44);
  ctx.textAlign = "left"; ctx.font = `600 14px ${FONT}`; ctx.fillText(meta.bizName, M + 18, M + 22);
  const rows = summary.list.slice(0, 14), max = Math.max(...rows.map((r) => r.total), 1);
  const RH = Math.min(38, (H - M - 120 - 70) / (rows.length + 1));
  const nameX = W - M - 10, barRight = W - M - 250, barMaxW = barRight - (M + 230);
  let y = M + 96;
  rows.forEach((r, i) => {
    if (i % 2) { ctx.fillStyle = "#F6FBFD"; ctx.fillRect(M, y, W - 2 * M, RH); }
    ctx.textBaseline = "middle"; ctx.textAlign = "right"; ctx.fillStyle = INK; ctx.font = `600 15px ${FONT}`;
    ctx.fillText(fitText(ctx, r.cat, 230), nameX, y + RH / 2);
    const bw = Math.max(3, barMaxW * r.total / max);
    ctx.fillStyle = "#" + CAT_COLORS[i % CAT_COLORS.length]; roundRect(ctx, barRight - bw, y + RH * 0.25, bw, RH * 0.5, 4); ctx.fill();
    ctx.textAlign = "left"; ctx.fillStyle = BLUE; ctx.font = `700 15px ${FONT}`;
    ctx.fillText("₪" + fmtMoney(r.total), M + 10, y + RH / 2);
    ctx.fillStyle = INK2; ctx.font = `400 12px ${FONT}`;
    ctx.fillText(`${r.count === 1 ? "מסמך אחד" : r.count + " מסמכים"} · ${Math.round(r.total / summary.total * 100)}%`, M + 120, y + RH / 2);
    y += RH;
  });
  ctx.fillStyle = TURQ; ctx.fillRect(M, y, W - 2 * M, 2);
  ctx.fillStyle = "#E4F4FA"; ctx.fillRect(M, y + 2, W - 2 * M, 40);
  ctx.textAlign = "right"; ctx.fillStyle = INK; ctx.font = `700 16px ${FONT}`; ctx.fillText('סה"כ הוצאות', nameX, y + 22);
  ctx.textAlign = "left"; ctx.fillStyle = BLUE; ctx.fillText("₪" + fmtMoney(summary.total), M + 10, y + 22);
  ctx.fillStyle = INK2; ctx.font = `400 11px ${FONT}`; ctx.textAlign = "right";
  ctx.fillText("כולל חשבוניות וקבלות, וכן תשלומים מהניירת האחרת (העברות משכורת, קופות גמל, ביטוח לאומי, ביטוח). תלושים, תעודות משלוח ודפי בנק לא נספרים.", W - M, H - M + 6);
  pdf.addPage([W, H], "landscape");
  pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, W, H, undefined, "FAST");
}

export const fmtMoney = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
export const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const sumOf = (rows, key) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;

const SIGNS = { USD: "$", EUR: "€", GBP: "£" };
export const isFx = (r) => !!r.currency && r.currency !== "ILS" && r.origAmount != null;
export function fxNote(r) { return isFx(r) ? `שער ${SIGNS[r.currency] || r.currency} ${r.fxRate}` : ""; }
// הסכום המקורי בסוגריים, למשל ($25.00). רק בעמודת הסכום הכולל
export function fxOrig(r, key) {
  if (!isFx(r) || key !== (r.kind === "other" ? "amount" : "total")) return "";
  return `(${SIGNS[r.currency] || r.currency}${fmtMoney(r.origAmount)})`;
}
export function cellText(row, key) {
  if (key === "date") return fmtDate(row.date);
  const col = [...COLS.invoice, ...COLS.other].find((c) => c.key === key);
  if (col?.money) return fmtMoney(row[key]);
  if (key === "note") return [fxNote(row), row.late ? `באיחור מ-${row.origMonth?.split("-").reverse().join("/")}` : "", row.note || ""].filter(Boolean).join(" · ");
  return row[key] == null ? "" : String(row[key]);
}

const FONT = '"Heebo", "Segoe UI", Arial, sans-serif';
const INK = "#0B3448", INK2 = "#4A6B7C", LINE = "#D3E8F0", TURQ = "#0FA3B1", BLUE = "#0E6A8C";

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/* ---------- טבלה ב-PDF (A4 לרוחב), מצוירת על canvas כדי שהעברית תוצג נכון ---------- */
const TW = 1123, TH_ = 794;   // A4 לרוחב ב-px
const PW_ = 794, PH_ = 1123;  // A4 לאורך ב-px

export async function buildTablePdf(rows, kind, meta) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [TW, TH_], compress: true });
  await renderTablePages(pdf, rows, kind, meta, {});
  await renderSummaryPage(pdf, meta.summary, meta);
  return pdf.output("blob");
}

// מוסיף את עמודי הטבלה ל-pdf. מחזיר את מיקום כל שורה (לקישורים) ואת מספר העמודים
async function renderTablePages(pdf, rows, kind, meta, { linked = false }) {
  await document.fonts?.ready;
  const cols = COLS[kind];
  const W = TW, H = TH_, S = 2, M = 34;
  const tableW = W - 2 * M;
  const baseW = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => c.w * tableW / baseW);
  const HEAD = 86, TH = 38, RH = 52, FOOT = 30, TOT = 42;
  const perPage = Math.floor((H - M - HEAD - TH - FOOT - TOT - M) / RH);
  const pagesCount = Math.max(1, Math.ceil(rows.length / perPage));
  const thumbs = await Promise.all(rows.map((r) => r.thumb ? loadImage(r.thumb).catch(() => null) : null));
  const startPage = pdf.getNumberOfPages() === 1 && !pdf.__used ? 1 : pdf.getNumberOfPages() + 1;
  const rowRects = [];

  for (let p = 0; p < pagesCount; p++) {
    const c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
    const ctx = c.getContext("2d"); ctx.scale(S, S); ctx.direction = "rtl";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);

    // כותרת
    const g = ctx.createLinearGradient(W, 0, 0, 0); g.addColorStop(0, TURQ); g.addColorStop(1, BLUE);
    ctx.fillStyle = g; roundRect(ctx, M, M, tableW, 58, 12); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.font = `700 22px ${FONT}`; ctx.fillText(meta.title, W - M - 18, M + 22);
    ctx.font = `500 13px ${FONT}`; ctx.fillText(meta.subtitle, W - M - 18, M + 44);
    ctx.textAlign = "left"; ctx.font = `600 14px ${FONT}`; ctx.fillText(meta.bizName, M + 18, M + 22);
    ctx.font = `400 12px ${FONT}`; ctx.fillText(`${rows.length} מסמכים`, M + 18, M + 44);

    // כותרות עמודות
    let y = M + HEAD;
    let x = W - M;
    cols.forEach((col, i) => {
      const w = widths[i]; x -= w;
      ctx.fillStyle = "#" + col.color; ctx.fillRect(x, y, w, TH);
      ctx.fillStyle = INK; ctx.font = `700 13px ${FONT}`; ctx.textAlign = col.money ? "left" : "right";
      ctx.fillText(col.label, col.money ? x + 10 : x + w - 10, y + TH / 2);
    });
    ctx.fillStyle = TURQ; ctx.fillRect(M, y + TH - 2, tableW, 2);
    y += TH;

    // שורות
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    slice.forEach((r, k) => {
      const ri = p * perPage + k;
      if (k % 2 === 1) { ctx.fillStyle = "#F6FBFD"; ctx.fillRect(M, y, tableW, RH); }
      rowRects.push({ ri, page: startPage + p, x: M, y, w: tableW, h: RH });
      x = W - M;
      cols.forEach((col, i) => {
        const w = widths[i]; x -= w;
        if (col.key === "thumb") {
          const im = thumbs[ri];
          if (im) {
            const th = RH - 10, tw = Math.min(w - 12, th * im.naturalWidth / im.naturalHeight);
            ctx.drawImage(im, x + (w - tw) / 2, y + 5, tw, th);
            ctx.strokeStyle = linked ? TURQ : LINE; ctx.lineWidth = linked ? 1.5 : 1; ctx.strokeRect(x + (w - tw) / 2, y + 5, tw, th);
          }
          return;
        }
        const t = col.key === "idx" ? String(ri + 1) : cellText(r, col.key);
        const orig = fxOrig(r, col.key);
        ctx.fillStyle = col.key === "idx" || col.key === "note" ? INK2 : (col.strong ? BLUE : INK);
        ctx.font = `${col.strong ? 700 : col.key === "supplier" || col.key === "name" ? 600 : 400} ${col.key === "note" ? 12 : 14}px ${FONT}`;
        ctx.textAlign = col.money ? "left" : "right";
        ctx.fillText(fitText(ctx, t, w - 18), col.money ? x + 10 : x + w - 10, y + RH / 2 - (orig ? 8 : 0));
        if (orig) { ctx.fillStyle = INK2; ctx.font = `500 12px ${FONT}`; ctx.fillText(fitText(ctx, orig, w - 18), x + 10, y + RH / 2 + 11); }
      });
      ctx.fillStyle = LINE; ctx.fillRect(M, y + RH - 1, tableW, 1);
      y += RH;
    });

    // סיכום בעמוד האחרון
    if (p === pagesCount - 1) {
      ctx.fillStyle = "#E4F4FA"; ctx.fillRect(M, y, tableW, TOT);
      ctx.fillStyle = TURQ; ctx.fillRect(M, y, tableW, 2);
      x = W - M;
      cols.forEach((col, i) => {
        const w = widths[i]; x -= w;
        ctx.fillStyle = col.strong ? BLUE : INK; ctx.font = `700 15px ${FONT}`;
        if (col.sum) { ctx.textAlign = "left"; ctx.fillText(fmtMoney(sumOf(rows, col.key)), x + 10, y + TOT / 2); }
        else if (i === 2) { ctx.textAlign = "right"; ctx.fillText('סה"כ', x + w - 10, y + TOT / 2); }
      });
    }

    // כותרת תחתונה
    ctx.fillStyle = INK2; ctx.font = `400 11px ${FONT}`;
    ctx.textAlign = "right"; ctx.fillText(`הופק ${fmtDate(localIso(new Date()))}`, W - M, H - M + 6);
    ctx.textAlign = "left"; ctx.fillText(`עמוד ${p + 1} מתוך ${pagesCount}`, M, H - M + 6);
    if (linked) { ctx.textAlign = "center"; ctx.fillStyle = BLUE; ctx.font = `600 12px ${FONT}`; ctx.fillText("לחיצה על שורה פותחת את המסמך שלה בגודל מלא", W / 2, H - M + 6); }

    if (startPage + p > 1) pdf.addPage([W, H], "landscape");
    pdf.__used = true;
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, W, H, undefined, "FAST");
  }
  return { rowRects, startPage, pagesCount };
}

/* ---------- חותמת לעמוד מסמך: מספר שורה + פרטים, בעברית ---------- */
function stampImage(text, num) {
  const S = 3, h = 30;
  const c = document.createElement("canvas");
  const ctx0 = c.getContext("2d"); ctx0.font = `600 13px ${FONT}`;
  const tw = Math.min(520, ctx0.measureText(text).width);
  const w = Math.ceil(tw + 70);
  c.width = w * S; c.height = h * S;
  const ctx = c.getContext("2d"); ctx.scale(S, S); ctx.direction = "rtl";
  ctx.fillStyle = "#fff"; roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8); ctx.fill();
  ctx.strokeStyle = TURQ; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = TURQ; roundRect(ctx, w - 44, 3, 41, h - 6, 6); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `700 14px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("#" + num, w - 23.5, h / 2 + 1);
  ctx.fillStyle = INK; ctx.font = `600 13px ${FONT}`; ctx.textAlign = "right";
  ctx.fillText(fitText(ctx, text, w - 64), w - 54, h / 2 + 1);
  return { url: c.toDataURL("image/png"), w, h };
}

/* ---------- קובץ המסמכים ב-PDF (A4 לאורך), באותו סדר ומספור של הטבלה ---------- */
export async function buildDocsPdf(rows, kind, getPages, onProgress, opts = {}) {
  const stamp = opts.stamp !== false;
  const { jsPDF } = window.jspdf;
  await document.fonts?.ready;
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const PW = 210, PH = 297, M = 8, TOP = 16;
  let first = true;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    onProgress && onProgress(i + 1, rows.length);
    const pages = await getPages(r.id);
    const who = kind === "invoice" ? r.supplier : [r.docType, r.name].filter(Boolean).join(" · ");
    const amt = kind === "invoice" ? r.total : r.amount;
    for (let j = 0; j < pages.length; j++) {
      if (!first) pdf.addPage("a4", "portrait");
      first = false;
      const im = await loadImage(pages[j].data);
      const top = stamp ? TOP : M;
      const aw = PW - 2 * M, ah = PH - top - M;
      const sc = Math.min(aw / im.naturalWidth, ah / im.naturalHeight);
      const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
      pdf.addImage(pages[j].data, "JPEG", (PW - w) / 2, top + (ah - h) / 2, w, h, undefined, "FAST");
      if (stamp) {
        const parts = [who, fmtDate(r.date), amt != null ? "₪" + fmtMoney(amt) : "", kind === "invoice" && r.invoiceNumber ? "מס' " + r.invoiceNumber : "", pages.length > 1 ? `דף ${j + 1}/${pages.length}` : ""];
        const st = stampImage(parts.filter(Boolean).join("  ·  "), i + 1);
        const sw = st.w * 0.26, sh = st.h * 0.26; // px → מ"מ בערך
        pdf.addImage(st.url, "PNG", PW - M - sw, 4, sw, sh);
      }
    }
  }
  if (first) { pdf.setFontSize(14); pdf.text("No documents", 20, 30); }
  return pdf.output("blob");
}

/* ---------- כפתור "חזרה לטבלה" לעמודי המסמכים ---------- */
function backButtonImage() {
  const S = 3, h = 30, text = "חזרה לטבלה ↩";
  const c0 = document.createElement("canvas").getContext("2d"); c0.font = `700 13px ${FONT}`;
  const w = Math.ceil(c0.measureText(text).width + 28);
  const c = document.createElement("canvas"); c.width = w * S; c.height = h * S;
  const ctx = c.getContext("2d"); ctx.scale(S, S); ctx.direction = "rtl";
  ctx.fillStyle = BLUE; roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = `700 13px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2 + 1);
  return { url: c.toDataURL("image/png"), w, h };
}

/* ---------- קובץ משולב: טבלה עם קישורים + כל המסמכים בגודל מלא ---------- */
export async function buildCombinedPdf(rows, kind, meta, getPages, onProgress) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [TW, TH_], compress: true });
  const { rowRects } = await renderTablePages(pdf, rows, kind, meta, { linked: true });
  await renderSummaryPage(pdf, meta.summary, meta);
  const back = backButtonImage();
  const M = 30, TOP = 60;
  const firstPageOf = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    onProgress && onProgress(i + 1, rows.length);
    const pages = await getPages(r.id);
    const who = kind === "invoice" ? r.supplier : [r.docType, r.name].filter(Boolean).join(" · ");
    const amt = kind === "invoice" ? r.total : r.amount;
    const tablePage = rowRects.find((x) => x.ri === i)?.page || 1;
    for (let j = 0; j < pages.length; j++) {
      pdf.addPage([PW_, PH_], "portrait");
      const pageNo = pdf.getNumberOfPages();
      if (j === 0) firstPageOf[i] = pageNo;
      const im = await loadImage(pages[j].data);
      const aw = PW_ - 2 * M, ah = PH_ - TOP - M;
      const sc = Math.min(aw / im.naturalWidth, ah / im.naturalHeight);
      const w = im.naturalWidth * sc, h = im.naturalHeight * sc;
      pdf.addImage(pages[j].data, "JPEG", (PW_ - w) / 2, TOP + (ah - h) / 2, w, h, undefined, "FAST");
      const parts = [who, fmtDate(r.date), amt != null ? "₪" + fmtMoney(amt) : "", kind === "invoice" && r.invoiceNumber ? "מס' " + r.invoiceNumber : "", pages.length > 1 ? `דף ${j + 1}/${pages.length}` : ""];
      const st = stampImage(parts.filter(Boolean).join("  ·  "), i + 1);
      pdf.addImage(st.url, "PNG", PW_ - M - st.w, 16, st.w, st.h);
      pdf.addImage(back.url, "PNG", M, 16, back.w, back.h);
      pdf.link(M, 16, back.w, back.h, { pageNumber: tablePage });
    }
    if (!pages.length) firstPageOf[i] = null;
  }
  // קישורים מכל שורה בטבלה לעמוד המסמך שלה
  for (const rr of rowRects) {
    const target = firstPageOf[rr.ri];
    if (!target) continue;
    pdf.setPage(rr.page);
    pdf.link(rr.x, rr.y, rr.w, rr.h, { pageNumber: target });
  }
  return pdf.output("blob");
}

/* ---------- אקסל ---------- */
// sections: [{kind, rows}] → קובץ אקסל אחד, גיליון לכל סוג
export async function buildExcel(sections, meta) {
  const ExcelJS = window.ExcelJS;
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.bizName;
  for (const sec of sections) addSheet(wb, sec.rows, sec.kind, { ...meta, title: KIND_LABEL[sec.kind] });
  if (meta.summary?.list?.length) addSummarySheet(wb, meta.summary, meta);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function addSummarySheet(wb, summary, meta) {
  const ws = wb.addWorksheet("סיכום קטגוריות", { views: [{ rightToLeft: true }] });
  ws.mergeCells(1, 1, 1, 4);
  const t = ws.getCell(1, 1); t.value = "סיכום הוצאות לפי קטגוריות";
  t.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0FA3B1" } }; ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, 4); ws.getCell(2, 1).value = `${meta.bizName} · ${meta.subtitle}`;
  ws.getCell(2, 1).font = { name: "Arial", color: { argb: "FF4A6B7C" } };
  const head = ["קטגוריה", "מסמכים", "סכום", "אחוז"];
  head.forEach((h, i) => { const c = ws.getRow(3).getCell(i + 1); c.value = h; c.font = { name: "Arial", bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCDEBF5" } }; });
  summary.list.forEach((r, i) => {
    const row = ws.getRow(4 + i);
    row.getCell(1).value = r.cat; row.getCell(2).value = r.count;
    row.getCell(3).value = r.total; row.getCell(3).numFmt = '#,##0.00 "₪"';
    row.getCell(4).value = { formula: `C${4 + i}/C${4 + summary.list.length}`, result: r.total / summary.total }; row.getCell(4).numFmt = "0%";
  });
  const tr = ws.getRow(4 + summary.list.length);
  tr.getCell(1).value = 'סה"כ'; tr.getCell(3).value = { formula: `SUM(C4:C${3 + summary.list.length})`, result: summary.total }; tr.getCell(3).numFmt = '#,##0.00 "₪"';
  [1, 2, 3, 4].forEach((i) => { tr.getCell(i).font = { name: "Arial", bold: true, color: { argb: "FF0E6A8C" } }; tr.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F4FA" } }; });
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 12; ws.getColumn(3).width = 18; ws.getColumn(4).width = 18;
  // פס צבעוני בתוך תא הסכום, באורך יחסי לגודל הקטגוריה
  if (summary.list.length) ws.addConditionalFormatting({ ref: `C4:C${3 + summary.list.length}`, rules: [{ type: "dataBar", minLength: 0, maxLength: 100, gradient: false, color: { argb: "FF5CCFD8" }, cfvo: [{ type: "num", value: 0 }, { type: "max" }] }] });

  // פירוט: כל המסמכים בכל קטגוריה, עם סיכום ביניים
  let y = 6 + summary.list.length;
  ws.mergeCells(y, 1, y, 4); const dt = ws.getCell(y, 1); dt.value = "פירוט לפי קטגוריות";
  dt.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  dt.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E6A8C" } }; ws.getRow(y).height = 24; y += 2;
  summary.list.forEach((r, ci) => {
    const color = "FF" + CAT_COLORS[ci % CAT_COLORS.length];
    ws.mergeCells(y, 1, y, 4); const h = ws.getCell(y, 1);
    h.value = `${r.cat} · ${r.count === 1 ? "מסמך אחד" : r.count + " מסמכים"}`;
    h.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }; ws.getRow(y).height = 20; y++;
    ["ספק / שם", "תאריך", "סכום", "מס' חשבונית / סוג"].forEach((t, i) => { const c = ws.getRow(y).getCell(i + 1); c.value = t; c.font = { name: "Arial", bold: true, color: { argb: "FF0B3448" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF6FA" } }; });
    y++;
    const first = y;
    [...r.items].sort((a, b) => a.date.localeCompare(b.date)).forEach((it) => {
      const row = ws.getRow(y);
      row.getCell(1).value = it.name;
      row.getCell(2).value = it.date ? fmtDate(it.date) : "";
      row.getCell(3).value = it.amount; row.getCell(3).numFmt = '#,##0.00 "₪"';
      row.getCell(4).value = it.ref; row.getCell(4).alignment = { horizontal: "right" };
      [1, 2, 3, 4].forEach((i) => { row.getCell(i).font = { name: "Arial" }; row.getCell(i).border = { bottom: { style: "hair", color: { argb: "FFCDE3EA" } } }; });
      y++;
    });
    const st = ws.getRow(y);
    st.getCell(1).value = `סה"כ ${r.cat}`;
    st.getCell(3).value = { formula: `SUM(C${first}:C${y - 1})`, result: r.total }; st.getCell(3).numFmt = '#,##0.00 "₪"';
    [1, 2, 3, 4].forEach((i) => { st.getCell(i).font = { name: "Arial", bold: true, color: { argb: "FF0E6A8C" } }; st.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F4FA" } }; });
    y += 2;
  });
}

function addSheet(wb, rows, kind, meta) {
  const cols = COLS[kind].filter((c) => c.key !== "thumb");
  const ws = wb.addWorksheet(KIND_LABEL[kind], { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
  const n = cols.length;
  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = meta.title; t.font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0FA3B1" } };
  t.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, n);
  const st = ws.getCell(2, 1);
  st.value = `${meta.bizName} · ${meta.subtitle}`; st.font = { name: "Arial", size: 11, color: { argb: "FF4A6B7C" } };
  st.alignment = { horizontal: "right" };

  const head = ws.getRow(3);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.label;
    cell.font = { name: "Arial", bold: true, color: { argb: "FF0B3448" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.color } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "medium", color: { argb: "FF0FA3B1" } } };
    ws.getColumn(i + 1).width = c.key === "idx" ? 6 : c.key === "note" ? 30 : c.money ? 15 : c.key === "date" ? 12 : 26;
  });
  head.height = 22;

  rows.forEach((r, ri) => {
    const row = ws.getRow(4 + ri);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.key === "idx") cell.value = ri + 1;
      else if (c.money) {
        cell.value = r[c.key] == null ? null : Number(r[c.key]);
        const orig = fxOrig(r, c.key);
        cell.numFmt = orig ? `#,##0.00 "₪ ${orig}"` : '#,##0.00 "₪"';
      }
      else if (c.key === "date") { if (r.date) { const [y, m, d] = r.date.split("-").map(Number); cell.value = new Date(Date.UTC(y, m - 1, d)); cell.numFmt = "dd/mm/yyyy"; } }
      else cell.value = cellText(r, c.key);
      cell.font = { name: "Arial", bold: !!c.strong, color: { argb: c.strong ? "FF0E6A8C" : "FF0B3448" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFD3E8F0" } } };
      if (ri % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6FBFD" } };
    });
  });

  const tr = ws.getRow(4 + rows.length);
  cols.forEach((c, i) => {
    const cell = tr.getCell(i + 1);
    const colL = ws.getColumn(i + 1).letter;
    if (c.sum && rows.length) cell.value = { formula: `SUM(${colL}4:${colL}${3 + rows.length})`, result: sumOf(rows, c.key) };
    else if (i === 1) cell.value = 'סה"כ';
    if (c.money) cell.numFmt = '#,##0.00 "₪"';
    cell.font = { name: "Arial", bold: true, size: 12, color: { argb: "FF0E6A8C" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4F4FA" } };
    cell.border = { top: { style: "medium", color: { argb: "FF0FA3B1" } } };
  });
  if (rows.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: n } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

/* ---------- הורדה ושיתוף ---------- */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// מנסה את חלון השיתוף של המכשיר (בטלפון: מייל, וואטסאפ וכו'). מחזיר true אם נפתח.
export async function tryShare(files, title) {
  const fs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
  if (navigator.canShare && navigator.canShare({ files: fs })) {
    try { await navigator.share({ files: fs, title, text: title }); return true; }
    catch (e) { if (e.name === "AbortError") return true; }
  }
  return false;
}

export function fmtSize(bytes) { return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB"; }
