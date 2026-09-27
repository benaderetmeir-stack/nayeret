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

export const fmtMoney = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
export const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const sumOf = (rows, key) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;

export function cellText(row, key) {
  if (key === "date") return fmtDate(row.date);
  const col = [...COLS.invoice, ...COLS.other].find((c) => c.key === key);
  if (col?.money) return fmtMoney(row[key]);
  if (key === "note") return [row.late ? `באיחור מ-${row.origMonth?.split("-").reverse().join("/")}` : "", row.note || ""].filter(Boolean).join(" · ");
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
export async function buildTablePdf(rows, kind, meta) {
  const { jsPDF } = window.jspdf;
  await document.fonts?.ready;
  const cols = COLS[kind];
  const W = 1123, H = 794, S = 2, M = 34;          // A4 לרוחב ב-96dpi, רזולוציה כפולה
  const tableW = W - 2 * M;
  const baseW = cols.reduce((s, c) => s + c.w, 0);
  const widths = cols.map((c) => c.w * tableW / baseW);
  const HEAD = 86, TH = 38, RH = 52, FOOT = 30, TOT = 42;
  const perPage = Math.floor((H - M - HEAD - TH - FOOT - TOT - M) / RH);
  const pagesCount = Math.max(1, Math.ceil(rows.length / perPage));
  const thumbs = await Promise.all(rows.map((r) => r.thumb ? loadImage(r.thumb).catch(() => null) : null));
  const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [W, H], compress: true });

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
      x = W - M;
      cols.forEach((col, i) => {
        const w = widths[i]; x -= w;
        if (col.key === "thumb") {
          const im = thumbs[ri];
          if (im) {
            const th = RH - 10, tw = Math.min(w - 12, th * im.naturalWidth / im.naturalHeight);
            ctx.drawImage(im, x + (w - tw) / 2, y + 5, tw, th);
            ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.strokeRect(x + (w - tw) / 2, y + 5, tw, th);
          }
          return;
        }
        const t = col.key === "idx" ? String(ri + 1) : cellText(r, col.key);
        ctx.fillStyle = col.key === "idx" || col.key === "note" ? INK2 : (col.strong ? BLUE : INK);
        ctx.font = `${col.strong ? 700 : col.key === "supplier" || col.key === "name" ? 600 : 400} ${col.key === "note" ? 12 : 14}px ${FONT}`;
        ctx.textAlign = col.money ? "left" : "right";
        ctx.fillText(fitText(ctx, t, w - 18), col.money ? x + 10 : x + w - 10, y + RH / 2);
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

    if (p > 0) pdf.addPage([W, H], "landscape");
    pdf.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, W, H, undefined, "FAST");
  }
  return pdf.output("blob");
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

/* ---------- אקסל ---------- */
export async function buildExcel(rows, kind, meta) {
  const ExcelJS = window.ExcelJS;
  const cols = COLS[kind].filter((c) => c.key !== "thumb");
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.bizName;
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
      else if (c.money) { cell.value = r[c.key] == null ? null : Number(r[c.key]); cell.numFmt = '#,##0.00 "₪"'; }
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

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
