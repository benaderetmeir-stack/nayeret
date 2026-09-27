// עיבוד תמונות: דחיסה, תמונה ממוזערת, המרת PDF לדפים
const MAX_SIDE = 1700;        // הצד הארוך של דף שנשמר (פיקסלים)
const MAX_CHARS = 800_000;    // גבול בטוח לדף אחד ב-Firestore (עד 1MB)

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("לא הצלחתי לקרוא את התמונה"));
    img.src = src;
  });
}

function drawScaled(source, w, h, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

// דוחס עד שהקובץ קטן מהגבול: קודם איכות, אחר כך גודל
export function compressCanvasSource(source, w, h) {
  let side = MAX_SIDE, q = 0.72;
  for (let tries = 0; tries < 10; tries++) {
    const c = drawScaled(source, w, h, side);
    const url = c.toDataURL("image/jpeg", q);
    if (url.length <= MAX_CHARS) return url;
    if (q > 0.5) q -= 0.1; else side = Math.round(side * 0.85);
  }
  return drawScaled(source, w, h, 1000).toDataURL("image/jpeg", 0.5);
}

export async function makeThumb(dataUrl, side = 220) {
  const img = await loadImage(dataUrl);
  return drawScaled(img, img.naturalWidth, img.naturalHeight, side).toDataURL("image/jpeg", 0.7);
}

async function imageFileToPage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return compressCanvasSource(img, img.naturalWidth, img.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}

async function pdfFileToPages(file, onProgress) {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error("רכיב קריאת ה-PDF לא נטען. בדקי חיבור לאינטרנט ונסי שוב.");
  lib.GlobalWorkerOptions.workerSrc ||= "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress && onProgress(p, pdf.numPages);
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const scale = MAX_SIDE / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(compressCanvasSource(c, c.width, c.height));
  }
  return out;
}

export function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

// מחזיר מערך של דפים (data URL) מתוך קובץ אחד
export async function fileToPages(file, onProgress) {
  if (isPdf(file)) return pdfFileToPages(file, onProgress);
  if (file.type && !file.type.startsWith("image/")) throw new Error("סוג קובץ לא נתמך: " + file.name);
  return [await imageFileToPage(file)];
}

export function dataUrlBytes(url) { return Math.round((url.length - url.indexOf(",") - 1) * 0.75); }
