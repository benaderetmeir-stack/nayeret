// סורק מסמכים מהמצלמה: מסגרת ירוקה סביב הדף, צילום, ואז חיתוך ויישור
import { compressCanvasSource } from "./images.js?v=20261021";

/* ---------- זיהוי הדף בתמונה קטנה ---------- */
// שתי שיטות, והטובה מנצחת:
// 1. קווים: מחפשים את ארבעת הקווים הישרים של קצות הדף (עובד גם על שולחן בהיר, עם צל וליד חפצים)
// 2. בהירות: המשטח הבהיר הגדול (הדרך הישנה, טובה כשהרקע כהה)
// כל מועמד מקבל ציון לפי כמה מארבע הצלעות שלו באמת יושבות על קצה בתמונה.
// מחזיר 4 פינות [TL, TR, BR, BL] ביחס (0..1), או null
export function detectQuad(img) { const r = detectQuadScored(img); return r ? r.quad : null; }
export function detectQuadScored(img) {
  const { width: w, height: h, data } = img;
  const n = w * h;
  // אפור + טשטוש קל
  let g = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  g = blur(blur(g, w, h), w, h);
  // שיפועים (Sobel)
  const mag = new Float32Array(n), ang = new Float32Array(n);
  let maxM = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
    const gy = (g[i + w - 1] + 2 * g[i + w] + g[i + w + 1]) - (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
    const m = Math.hypot(gx, gy); mag[i] = m; ang[i] = Math.atan2(gy, gx); if (m > maxM) maxM = m;
  }
  if (maxM < 8) return null;
  // סף קצוות: האחוזון העליון של העוצמה (מסתגל לתאורה)
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, (mag[i] / maxM * 255) | 0)]++;
  let acc = 0, cut = 255; for (let b = 255; b >= 0; b--) { acc += hist[b]; if (acc > n * 0.16) { cut = b; break; } }
  // סף נמוך מספיק כדי לתפוס גם דף לבן על שולחן לבן (קצה חלש), אבל מעל רעש התמונה
  const thr = Math.max(5, Math.min(cut / 255 * maxM, maxM * 0.12, 14));
  const edge = new Uint8Array(n); for (let i = 0; i < n; i++) if (mag[i] >= thr) edge[i] = 1;
  const ctx = { w, h, mag, ang, edge, thr };

  const cands = [];
  const lq = lineQuad(ctx); if (lq) cands.push(...lq);
  const bq = brightQuad(g, w, h); if (bq) cands.push(bq);
  let best = null;
  for (const q of cands) {
    if (!validQuad(q, w, h)) continue;
    const sc = support(q, ctx);
    if (sc.min < 0.6 || sc.avg < 0.78) continue;
    // "נראה כמו נייר": בהיר מהסביבה שלו ולא צבעוני (מסנן מקלדת, ספר, מחברת)
    const pa = paperLook(q, data, w, h);
    if (!pa || pa.contrast < 4 || pa.sat > 0.32) continue;
    const area = polyArea(q.map(([x, y]) => [x / w, y / h]));
    const score = sc.avg * 0.75 + sc.min * 0.25 + Math.min(area, 0.6) * 0.25 + Math.min(pa.contrast, 40) / 200;
    if (!best || score > best.score) best = { q, score };
  }
  if (!best) return null;
  return { quad: best.q.map(([x, y]) => [Math.min(1, Math.max(0, x / (w - 1))), Math.min(1, Math.max(0, y / (h - 1)))]), score: best.score };
}

// בהירות ורוויה בתוך הצורה, מול טבעת צרה מסביב לה
function paperLook(q, data, w, h) {
  const at = (x, y) => { const xi = Math.round(x), yi = Math.round(y); if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null; const p = (yi * w + xi) * 4; return [data[p], data[p + 1], data[p + 2]]; };
  const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
  const satOf = (c) => { const mx = Math.max(...c), mn = Math.min(...c); return mx ? (mx - mn) / mx : 0; };
  const pt = (u, v) => { const [a, b, c, d] = q; const top = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], bot = [d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u]; return [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v]; };
  let inL = [], inS = 0, k = 0;
  for (let u = 0.08; u < 0.95; u += 0.07) for (let v = 0.08; v < 0.95; v += 0.07) { const c = at(...pt(u, v)); if (!c) continue; inL.push(lum(c)); inS += satOf(c); k++; }
  if (k < 20) return null;
  // בהירות "הנייר": אחוזון 70 (טקסט כהה על הדף לא מוריד)
  inL.sort((a, b) => a - b); const paperL = inL[Math.floor(inL.length * 0.7)];
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4, off = Math.min(w, h) * 0.04;
  // השוואה ממש ליד הקצה: פס צר בפנים מול פס צר בחוץ (דף על מחברת: בפנים בהיר, בחוץ כהה; מחברת: הפוך)
  const outL = [], rimL = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, dx = x - cx, dy = y - cy, dl = Math.hypot(dx, dy) || 1;
      const c = at(x + dx / dl * off, y + dy / dl * off); if (c) outL.push(lum(c));
      const r = at(x - dx / dl * off, y - dy / dl * off); if (r) rimL.push(lum(r));
    }
  }
  const med = (arr) => { arr.sort((a, b) => a - b); return arr[Math.floor(arr.length * 0.5)]; };
  if (outL.length < 6) return { contrast: 20, sat: inS / k };   // הדף ממלא כמעט את כל התמונה
  const bgL = med(outL), rim = rimL.length ? med(rimL) : paperL;
  return { contrast: Math.min(paperL, rim) - bgL, sat: inS / k };
}

function blur(src, w, h) {
  const t = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i;
    t[i] = (src[l] + 2 * src[i] + src[r]) / 4;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, u = y > 0 ? i - w : i, d = y < h - 1 ? i + w : i;
    out[i] = (t[u] + 2 * t[i] + t[d]) / 4;
  }
  return out;
}

// הוף (Hough) מכוון: כל נקודת קצה מצביעה רק לקווים שמאונכים לכיוון השיפוע שלה
function lineQuad({ w, h, mag, ang, edge }) {
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = diag * 2 + 1;
  const cosT = new Float32Array(NT), sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cosT[t] = Math.cos(t * Math.PI / NT); sinT[t] = Math.sin(t * Math.PI / NT); }
  const H = new Float32Array(NT * NR);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x; if (!edge[i]) continue;
    let t0 = Math.round(((ang[i] % Math.PI) + Math.PI) % Math.PI / Math.PI * NT) % NT;
    for (let dt = -6; dt <= 6; dt++) {
      const t = (t0 + dt + NT) % NT;
      const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
      H[t * NR + r] += (1 - Math.abs(dt) / 8);
    }
  }
  // שיאים עם דיכוי שכנים
  const peaks = [];
  const work = H.slice();
  for (let k = 0; k < 24; k++) {
    let bi = -1, bv = 0;
    for (let i = 0; i < work.length; i++) if (work[i] > bv) { bv = work[i]; bi = i; }
    if (bi < 0 || bv <= 0) break;
    const t = (bi / NR) | 0, r = bi % NR;
    peaks.push({ t, r: r - diag, v: bv });
    for (let dt = -7; dt <= 7; dt++) for (let dr = -9; dr <= 9; dr++) {
      const tt = t + dt, rr = r + dr;
      // ליד 0°/180° הקו "מתהפך"
      const T = (tt + NT) % NT, R = tt < 0 || tt >= NT ? 2 * diag - rr : rr;
      if (R >= 0 && R < NR) work[T * NR + R] = 0;
    }
  }
  if (peaks.length < 4) return null;
  const top = peaks.slice(0, 16);
  const angDiff = (a, b) => { const d = Math.abs(a - b) % NT; return Math.min(d, NT - d); };
  const lineOf = (p) => ({ c: cosT[p.t], s: sinT[p.t], r: p.r });
  const inter = (a, b) => { const d = a.c * b.s - a.s * b.c; if (Math.abs(d) < 1e-6) return null; return [(a.r * b.s - b.r * a.s) / d, (a.c * b.r - b.c * a.r) / d]; };
  const out = [];
  // זוגות "כמעט מקבילים" (עד 30° בגלל פרספקטיבה), ושני הזוגות כמעט מאונכים זה לזה
  const pairs = [];
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) {
    if (angDiff(top[a].t, top[b].t) > 30) continue;
    const la = lineOf(top[a]), lb = lineOf(top[b]);
    // מרחק בין שני הקווים (ליד 0°/180° הכיוון מתהפך)
    const flip = Math.abs(top[a].t - top[b].t) > 90;
    const sep = Math.abs(top[a].r - (flip ? -top[b].r : top[b].r));
    if (sep < Math.min(w, h) * 0.18) continue;
    pairs.push([a, b]);
  }
  for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
    const [a, b] = pairs[i], [c, d] = pairs[j];
    if (a === c || a === d || b === c || b === d) continue;
    const meanA = top[a].t, meanC = top[c].t;
    const cross = angDiff(meanA, meanC);
    if (cross < 50) continue;
    const L = [lineOf(top[a]), lineOf(top[b]), lineOf(top[c]), lineOf(top[d])];
    const P = [inter(L[0], L[2]), inter(L[0], L[3]), inter(L[1], L[3]), inter(L[1], L[2])];
    if (P.some((p) => !p)) continue;
    const q = orderQuad(P);
    if (q) out.push(q);
  }
  return out.length ? out : null;
}

// הדרך הישנה: המשטח הבהיר הגדול ביותר
function brightQuad(g, w, h) {
  const n = w * h, hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  const lab = new Int32Array(n), stack = new Int32Array(n);
  let bestLab = 0, bestSize = 0, cur = 0;
  for (let s = 0; s < n; s++) {
    if (lab[s] || g[s] <= thr) continue;
    cur++; let size = 0, sp = 0; stack[sp++] = s; lab[s] = cur;
    while (sp) {
      const i = stack[--sp]; size++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !lab[i - 1] && g[i - 1] > thr) { lab[i - 1] = cur; stack[sp++] = i - 1; }
      if (x < w - 1 && !lab[i + 1] && g[i + 1] > thr) { lab[i + 1] = cur; stack[sp++] = i + 1; }
      if (y > 0 && !lab[i - w] && g[i - w] > thr) { lab[i - w] = cur; stack[sp++] = i - w; }
      if (y < h - 1 && !lab[i + w] && g[i + w] > thr) { lab[i + w] = cur; stack[sp++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; bestLab = cur; }
  }
  if (bestSize < n * 0.12 || bestSize > n * 0.97) return null;
  let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity];
  for (let i = 0; i < n; i++) {
    if (lab[i] !== bestLab) continue;
    const x = i % w, y = (i / w) | 0, s = x + y, d = x - y;
    if (s < tl[2]) tl = [x, y, s]; if (s > br[2]) br = [x, y, s];
    if (d > tr[2]) tr = [x, y, d]; if (d < bl[2]) bl = [x, y, d];
  }
  return [tl, tr, br, bl].map(([x, y]) => [x, y]);
}

// סידור 4 נקודות: שמאל-עליון, ימין-עליון, ימין-תחתון, שמאל-תחתון
function orderQuad(P) {
  const cx = P.reduce((s, p) => s + p[0], 0) / 4, cy = P.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = P.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // מתחילים מהנקודה עם x+y הקטן
  let k = 0; for (let i = 1; i < 4; i++) if (sorted[i][0] + sorted[i][1] < sorted[k][0] + sorted[k][1]) k = i;
  return [0, 1, 2, 3].map((i) => sorted[(k + i) % 4]);
}
function validQuad(q, w, h) {
  const m = Math.min(w, h) * 0.04;
  if (q.some(([x, y]) => x < -m || y < -m || x > w - 1 + m || y > h - 1 + m)) return false;
  const area = polyArea(q.map(([x, y]) => [x / w, y / h]));
  if (area < 0.12 || area > 0.97) return false;
  // קמור, וזוויות סבירות (45°–135°)
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
    const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
    const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
    if (Math.abs(cos) > 0.72) return false;
  }
  return true;
}
// כמה מכל צלע יושבת על קצה אמיתי בתמונה (0..1)
function support(q, { w, h, edge, ang }) {
  const covs = [], ends = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(12, Math.round(len / 2));
    const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
    let hit = 0, tot = 0, endHit = [0, 0], endTot = [0, 0];
    for (let k = 1; k < steps; k++) {
      const t = k / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (x < 1 || y < 1 || x > w - 2 || y > h - 2) continue;   // מחוץ לתמונה: לא נחשב
      tot++;
      const end = t < 0.18 ? 0 : t > 0.82 ? 1 : -1;
      if (end >= 0) endTot[end]++;
      let ok = false;
      for (let o = -2; o <= 2 && !ok; o++) {
        const xx = Math.round(x + nx * o), yy = Math.round(y + ny * o), i = yy * w + xx;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !edge[i]) continue;
        // כיוון השיפוע צריך להיות בערך מאונך לצלע
        const ga = ang[i], dot = Math.abs(Math.cos(ga) * nx + Math.sin(ga) * ny);
        if (dot > 0.8) ok = true;
      }
      if (ok) { hit++; if (end >= 0) endHit[end]++; }
    }
    covs.push(tot >= 6 ? hit / tot : 0.5);
    // ליד הפינות הקצה חייב להיות קיים (מונע צורה "מעורבבת" מקווים של שני חפצים)
    for (const e of [0, 1]) if (endTot[e] >= 3) ends.push(endHit[e] / endTot[e]);
  }
  return { avg: covs.reduce((s, c) => s + c, 0) / 4, min: Math.min(...covs, ...ends.map((e) => e + 0.1)) };
}
function polyArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }

/* ---------- חיתוך ויישור (פרספקטיבה) ---------- */
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
// מטריצה שממפה נקודה ביעד (מלבן) לנקודה במקור (הדף המצולם)
function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  return solve(A, b);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// source: canvas/img בגודל מלא. quad: פינות ביחס (0..1). מחזיר canvas מיושר
export function warpQuad(source, sw, sh, quad, maxSide = 1700) {
  const P = quad.map(([x, y]) => [x * sw, y * sh]);
  let W = Math.max(dist(P[0], P[1]), dist(P[3], P[2])), H = Math.max(dist(P[0], P[3]), dist(P[1], P[2]));
  const s = Math.min(1, maxSide / Math.max(W, H)); W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));
  const m = homography([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], P);
  const sc = document.createElement("canvas"); sc.width = sw; sc.height = sh;
  const sctx = sc.getContext("2d"); sctx.drawImage(source, 0, 0, sw, sh);
  const src = sctx.getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const octx = out.getContext("2d"), od = octx.createImageData(W, H), o = od.data;
  for (let y = 0, p = 0; y < H; y++) {
    for (let x = 0; x < W; x++, p += 4) {
      const z = m[6] * x + m[7] * y + 1;
      const u = (m[0] * x + m[1] * y + m[2]) / z, v = (m[3] * x + m[4] * y + m[5]) / z;
      const x0 = Math.max(0, Math.min(sw - 2, u | 0)), y0 = Math.max(0, Math.min(sh - 2, v | 0));
      const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        o[p + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
      o[p + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* ---------- המסך של הסורק ---------- */
export const scannerSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

const SMALL = 320;
let ui = null;
function buildUi() {
  // dialog: כדי להופיע מעל חלון ההעלאה (שגם הוא dialog)
  const el = document.createElement("dialog");
  el.className = "scanner";
  el.innerHTML = `
    <div class="sc-stage" id="scStage">
      <video id="scVideo" playsinline muted autoplay></video>
      <canvas id="scOverlay"></canvas>
      <canvas id="scStill" hidden></canvas>
    </div>
    <p class="sc-hint" id="scHint">מכוונים את המצלמה אל הדף</p>
    <div class="sc-bar" id="scLive">
      <button type="button" class="sc-btn" id="scCancel">ביטול</button>
      <button type="button" class="sc-shoot" id="scShoot" aria-label="צילום"></button>
      <span class="sc-side"><label class="sc-auto"><input type="checkbox" id="scAuto" checked> צילום אוטומטי</label><button type="button" class="sc-link" id="scNative">צילום רגיל</button></span>
    </div>
    <div class="sc-bar" id="scEdit" hidden>
      <button type="button" class="sc-btn" id="scRetake">צילום מחדש</button>
      <button type="button" class="sc-btn" id="scFull">בלי חיתוך</button>
      <button type="button" class="sc-btn sc-ok" id="scOk">אישור</button>
    </div>`;
  document.body.appendChild(el);
  const $ = (id) => el.querySelector("#" + id);
  return { el, $, video: $("scVideo"), overlay: $("scOverlay"), still: $("scStill"), stage: $("scStage") };
}

// פותח את הסורק. מחזיר data URL של הדף, או null אם בוטל. fallback() נקרא אם אין גישה למצלמה
// onNative: נקרא מיד בלחיצה על "צילום רגיל" (בתוך הלחיצה, כדי שהטלפון יפתח את המצלמה הרגילה)
export async function scanPage({ onNative } = {}) {
  ui ||= buildUi();
  const { el, $, video, overlay, still, stage } = ui;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
  } catch (e) { const err = new Error("no-camera"); err.cause = e; throw err; }
  // איפוס המסך (אם הסורק כבר נפתח קודם)
  $("scLive").hidden = false; $("scEdit").hidden = true; still.hidden = true; video.style.visibility = "";
  $("scHint").textContent = "מכוונים את המצלמה אל הדף";
  overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height);
  if (!el.open) el.showModal();
  video.srcObject = stream; await video.play().catch(() => {});
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener("loadedmetadata", r, { once: true })));

  const small = document.createElement("canvas"), sctx = small.getContext("2d", { willReadFrequently: true });
  let quad = null, stableSince = 0, last = null, lastSeen = 0, timer = 0, phase = "live", frame = null;

  // מיקום התמונה בתוך המסך (object-fit: contain)
  const box = (vw, vh) => {
    const r = stage.getBoundingClientRect(), s = Math.min(r.width / vw, r.height / vh);
    return { s, ox: (r.width - vw * s) / 2, oy: (r.height - vh * s) / 2, w: r.width, h: r.height };
  };
  const drawQuad = (q, vw, vh, color, handles) => {
    const b = box(vw, vh), dpr = devicePixelRatio || 1;
    overlay.width = b.w * dpr; overlay.height = b.h * dpr; overlay.style.width = b.w + "px"; overlay.style.height = b.h + "px";
    const c = overlay.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, b.w, b.h);
    if (!q) return;
    const pts = q.map(([x, y]) => [b.ox + x * vw * b.s, b.oy + y * vh * b.s]);
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
    c.fillStyle = color + "33"; c.fill(); c.lineWidth = 4; c.strokeStyle = color; c.stroke();
    if (handles) pts.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 4; c.strokeStyle = color; c.stroke(); });
  };

  const tick = () => {
    if (phase !== "live") return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw) {
      const s = SMALL / Math.max(vw, vh); small.width = Math.round(vw * s); small.height = Math.round(vh * s);
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const raw = detectQuad(sctx.getImageData(0, 0, small.width, small.height));
      const now = Date.now();
      // החלקה: המסגרת לא קופצת. אם הדף זז מעט, ממצעים; אם זז הרבה, מתחילים מחדש
      if (raw) {
        lastSeen = now;
        const jump = !last || raw.some((p, i) => Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) > 0.06);
        const smooth = jump ? raw : raw.map((p, i) => [last[i][0] * 0.6 + p[0] * 0.4, last[i][1] * 0.6 + p[1] * 0.4]);
        const moved = jump || smooth.some((p, i) => Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) > 0.012);
        if (moved) stableSince = now;
        last = smooth;
      } else if (now - lastSeen > 450) { last = null; stableSince = now; }   // פספוס רגעי לא מעלים את המסגרת
      const q = last; quad = q;
      const steady = q && now - stableSince > 900;
      drawQuad(q, vw, vh, steady ? "#22C55E" : "#4ADE80", false);
      $("scHint").textContent = q ? (steady ? "מצלם…" : "מצאתי את הדף. מחזיקים יציב") : "מכוונים את המצלמה אל הדף. עדיף על משטח כהה מהדף";
      if (steady && $("scAuto").checked) return capture();
    }
    timer = setTimeout(tick, 110);
  };

  let resolveFn;
  const result = new Promise((r) => (resolveFn = r));
  const stop = () => { clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
  const finish = (val) => { phase = "done"; stop(); if (el.open) el.close(); resolveFn(val); };
  el.oncancel = (e) => { e.preventDefault(); finish(null); };

  // אחרי הצילום: תמונה קפואה עם פינות שאפשר לגרור
  let editQuad = null;
  const capture = () => {
    phase = "edit"; clearTimeout(timer);
    const vw = video.videoWidth, vh = video.videoHeight;
    frame = document.createElement("canvas"); frame.width = vw; frame.height = vh;
    frame.getContext("2d").drawImage(video, 0, 0, vw, vh);
    const b = box(vw, vh);
    still.width = vw; still.height = vh; still.getContext("2d").drawImage(frame, 0, 0);
    Object.assign(still.style, { width: vw * b.s + "px", height: vh * b.s + "px", left: b.ox + "px", top: b.oy + "px" });
    still.hidden = false; video.style.visibility = "hidden";
    editQuad = (quad || [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]]).map((p) => p.slice());
    drawQuad(editQuad, vw, vh, "#22C55E", true);
    $("scLive").hidden = true; $("scEdit").hidden = false;
    $("scHint").textContent = quad ? "אפשר לגרור את הפינות. לחצי אישור" : "לא זיהיתי את הדף. גררי את הפינות לקצוות הדף";
  };
  let drag = -1;
  const toRel = (e) => { const r = stage.getBoundingClientRect(), b = box(frame.width, frame.height); return [Math.min(1, Math.max(0, (e.clientX - r.left - b.ox) / (frame.width * b.s))), Math.min(1, Math.max(0, (e.clientY - r.top - b.oy) / (frame.height * b.s)))]; };
  overlay.onpointerdown = (e) => {
    if (phase !== "edit") return;
    const p = toRel(e), b = box(frame.width, frame.height);
    let bi = -1, bd = 40 / (frame.width * b.s);
    editQuad.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], (q[1] - p[1]) * frame.height / frame.width); if (d < bd) { bd = d; bi = i; } });
    drag = bi; if (bi >= 0) overlay.setPointerCapture(e.pointerId);
  };
  overlay.onpointermove = (e) => { if (drag < 0) return; editQuad[drag] = toRel(e); drawQuad(editQuad, frame.width, frame.height, "#22C55E", true); };
  overlay.onpointerup = () => (drag = -1);

  const backToLive = () => {
    phase = "live"; still.hidden = true; video.style.visibility = ""; $("scLive").hidden = false; $("scEdit").hidden = true;
    stableSince = Date.now(); last = null; lastSeen = 0; tick();
  };
  $("scCancel").onclick = () => finish(null);
  $("scNative").onclick = () => { finish(null); onNative && onNative(); };
  $("scShoot").onclick = () => capture();
  $("scRetake").onclick = backToLive;
  $("scFull").onclick = () => finish(compressCanvasSource(frame, frame.width, frame.height));
  $("scOk").onclick = () => {
    $("scHint").textContent = "מיישר את הדף…";
    setTimeout(() => {
      const out = warpQuad(frame, frame.width, frame.height, editQuad);
      finish(compressCanvasSource(out, out.width, out.height));
    }, 30);
  };
  tick();
  return result;
}
