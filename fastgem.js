// זיהוי מהיר עם Gemini: בלי "חשיבה", תמונות מוקטנות, ו"מירוץ" בין שני דגמים כשהראשון מתעכב
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const HEDGE_AFTER = 11000;   // אם אין תשובה תוך 11 שניות, מתחילים במקביל דגם נוסף
const CALL_TIMEOUT = 30000;  // ניסיון בודד לא יותר מ-30 שניות
const noThink = new Set();   // דגמים שלא מקבלים את ההגדרה "בלי חשיבה"

// מקטין את הדפים לזיהוי בלבד (המקור נשמר באיכות מלאה)
export async function shrinkPages(pages, maxSide = 1280, maxPages = 3) {
  const out = [];
  for (const p of pages.slice(0, maxPages)) {
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = p; });
      const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      if (s >= 1) { out.push(p); continue; }
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      out.push(c.toDataURL("image/jpeg", 0.8));
    } catch { out.push(p); }
  }
  return out;
}

function thinkingFor(model) {
  if (noThink.has(model)) return null;
  return /gemini-3/.test(model) ? { thinkingLevel: "minimal" } : { thinkingBudget: 0 };
}
async function callOnce(model, key, parts, signal, plain = false) {
  const gen = { responseMimeType: "application/json", temperature: 0 };
  const think = plain ? null : thinkingFor(model); if (think) gen.thinkingConfig = think;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), CALL_TIMEOUT);
  const stop = () => ctl.abort(); signal?.addEventListener("abort", stop);
  let res;
  try {
    res = await fetch(API + encodeURIComponent(model) + ":generateContent", {
      signal: ctl.signal, method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: gen })
    });
  } catch (e) {
    const err = new Error(signal?.aborted ? "skipped" : "timeout"); err.status = signal?.aborted ? "skip" : "timeout"; throw err;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", stop); }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // כל שגיאת 400 כשביקשנו "בלי חשיבה": מנסים שוב מיד בדיוק כמו פעם (בלי ההגדרה), וזוכרים לא לבקש אותה שוב מהדגם הזה
    if (res.status === 400 && think && !/API.?KEY|api key/i.test(body)) { noThink.add(model); return callOnce(model, key, parts, signal, true); }
    const err = new Error(`Gemini ${res.status}`); err.status = res.status; err.body = body; throw err;
  }
  const data = await res.json();
  const reply = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || "").join("");
  return JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
}
// מפתח לא תקין: אין טעם לנסות דגם אחר. כל שגיאה אחרת: מנסים את הדגם הבא
const retryable = (e) => !((e.status === 400 || e.status === 403) && /API.?KEY|api key|permission|PERMISSION_DENIED/i.test(e.body || ""));

// מחזיר {json, model}. בכישלון זורק {last, hitQuota, skipped}
export function askGemini({ key, models, text, pages = [], signal }) {
  const parts = [{ text }];
  for (const p of pages) parts.push({ inline_data: { mime_type: "image/jpeg", data: p.slice(p.indexOf(",") + 1) } });
  const queue = models.slice(), st = { last: null, hitQuota: false, skipped: false };
  return new Promise((resolve, reject) => {
    let running = 0, done = false, timeouts = 0;
    const ctls = [];
    const finish = (ok, val) => { if (done) return; done = true; ctls.forEach((c) => c.abort()); ok ? resolve(val) : reject(val); };
    if (signal) signal.addEventListener("abort", () => finish(false, { ...st, skipped: true }), { once: true });
    const launch = () => {
      if (done) return;
      const m = queue.shift();
      if (!m) { if (!running) finish(false, st); return; }
      running++;
      const ctl = new AbortController(); ctls.push(ctl);
      const hedge = setTimeout(() => { if (!done && running < 2) launch(); }, HEDGE_AFTER);
      callOnce(m, key, parts, ctl.signal)
        .then((json) => { clearTimeout(hedge); finish(true, { json, model: m }); })
        .catch((e) => {
          clearTimeout(hedge); running--;
          if (done) return;
          if (signal?.aborted) return finish(false, { ...st, skipped: true });
          if (e.status === "skip") { if (!running) launch(); return; }   // בוטל ע"י המירוץ
          st.last = e; if (e.status === 429) st.hitQuota = true; if (e.status === "timeout") timeouts++;
          if (!retryable(e) || timeouts >= 3) queue.length = 0;
          launch();
        });
    };
    launch();
  });
}
