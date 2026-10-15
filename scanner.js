// סורק מסמכים מהמצלמה: מסגרת ירוקה סביב הדף, צילום, ואז חיתוך ויישור
import { compressCanvasSource } from "./images.js?v=20261016";

/* ---------- זיהוי הדף בתמונה קטנה ---------- */
// מחזיר 4 פינות [TL, TR, BR, BL] ביחס (0..1), או null
export function detectQuad(img) {
  const { width: w, height: h, data } = img;
  const n = w * h, g = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  // סף אוטומטי (Otsu): מפריד בין הדף הבהיר לרקע
  const hist = new Array(256).fill(0); for (let i = 0; i < n; i++) hist[g[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  // הרכיב הבהיר הגדול ביותר
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
  // פינות: הקצוות של x+y ו-x−y
  let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity];
  for (let i = 0; i < n; i++) {
    if (lab[i] !== bestLab) continue;
    const x = i % w, y = (i / w) | 0, s = x + y, d = x - y;
    if (s < tl[2]) tl = [x, y, s]; if (s > br[2]) br = [x, y, s];
    if (d > tr[2]) tr = [x, y, d]; if (d < bl[2]) bl = [x, y, d];
  }
  const q = [tl, tr, br, bl].map(([x, y]) => [x / (w - 1), y / (h - 1)]);
  if (polyArea(q) < 0.1) return null;
  return q;
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
  let quad = null, stableSince = 0, last = null, timer = 0, phase = "live", frame = null;

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
      const q = detectQuad(sctx.getImageData(0, 0, small.width, small.height));
      const moved = !q || !last || q.some((p, i) => Math.hypot(p[0] - last[i][0], p[1] - last[i][1]) > 0.025);
      if (moved) stableSince = Date.now();
      last = q; quad = q;
      const steady = q && Date.now() - stableSince > 1200;
      drawQuad(q, vw, vh, steady ? "#22C55E" : "#4ADE80", false);
      $("scHint").textContent = q ? (steady ? "מצלם…" : "מצאתי את הדף. מחזיקים יציב") : "מכוונים את המצלמה אל הדף";
      if (steady && $("scAuto").checked) return capture();
    }
    timer = setTimeout(tick, 140);
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
    stableSince = Date.now(); last = null; tick();
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
