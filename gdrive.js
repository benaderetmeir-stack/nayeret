// ניירת עסק בכניסה עם גוגל: כל המסמכים נשמרים בגוגל דרייב של המשתמש עצמו (תיקייה "ניירת עסק").
// הרשאה מצומצמת (drive.file): האפליקציה רואה רק קבצים שהיא עצמה יצרה, לא את שאר הדרייב.
// אותו ממשק כמו FirebaseStore / DemoStore ב-store.js, כך ששאר האפליקציה לא משתנה.
import { DEFAULT_SETTINGS, docBytes } from "./store.js?v=20261125";

export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file email";
const TOK_KEY = "nr_gtok", MAIL_KEY = "nr_gmail";
export const DRIVE_BYTES = 15 * 1024 ** 3;   // 15GB חינם בגוגל
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
// כתובת החזרה חייבת להיות בדיוק כמו שנרשמה בגוגל (בלי index.html)
export const appBaseUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

export function googleAuthUrl(clientId, { prompt = "", hint = "" } = {}) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: appBaseUrl(), response_type: "token", scope: GOOGLE_SCOPE, include_granted_scopes: "true" });
  if (prompt) p.set("prompt", prompt);
  if (hint) p.set("login_hint", hint);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
// אחרי החזרה מגוגל: #access_token=…&expires_in=…  או  #error=…
export function takeAuthFromHash() {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, "", location.pathname + location.search);
  if (p.get("error")) return { error: p.get("error") };
  ls.set(TOK_KEY, JSON.stringify({ t: p.get("access_token"), exp: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 }));
  return { ok: true };
}
export function googleToken() { try { const t = JSON.parse(ls.get(TOK_KEY) || "null"); return t && t.t ? t : null; } catch { return null; } }
export const tokenMinutesLeft = () => { const t = googleToken(); return t ? (t.exp - Date.now()) / 60000 : 0; };
export const googleEmail = () => ls.get(MAIL_KEY);
export function googleSignOut() { const t = googleToken(); ls.set(TOK_KEY, ""); ls.set(MAIL_KEY, ""); if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t.t), { method: "POST" }).catch(() => {}); }

const DRIVE = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const qs = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
function dataUrlToBlob(url) {
  const [head, b64] = url.split(","); const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const clone = (o) => JSON.parse(JSON.stringify(o));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export class DriveStore {
  constructor({ onAuthNeeded } = {}) {
    this.demo = false; this.google = true; this.onAuthNeeded = onAuthNeeded;
    this.ids = {}; this.root = ""; this.files = ""; this._authCb = null;
  }
  /* ---------- גישה לדרייב ---------- */
  async req(url, opts = {}) {
    const tok = googleToken();
    if (!tok || tok.exp < Date.now()) { this.onAuthNeeded && this.onAuthNeeded(); const e = new Error("auth"); e.code = "auth"; throw e; }
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok.t}` } });
    if (res.status === 401) { this.onAuthNeeded && this.onAuthNeeded(); const e = new Error("auth"); e.code = "auth"; throw e; }
    if (!res.ok) { const e = new Error(`Drive ${res.status}`); e.status = res.status; e.body = await res.text().catch(() => ""); throw e; }
    return res;
  }
  async list(q) {
    const res = await this.req(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&spaces=drive`);
    return (await res.json()).files || [];
  }
  async folder(name, parent) {
    const found = await this.list(`name='${qs(name)}' and mimeType='${FOLDER}' and trashed=false${parent ? ` and '${parent}' in parents` : ""}`);
    if (found.length) return found[0].id;
    const res = await this.req(`${DRIVE}?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) });
    return (await res.json()).id;
  }
  async create(name, parent, content, mime) {
    const b = "nr" + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, content, `\r\n--${b}--`]);
    const res = await this.req(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
    return (await res.json()).id;
  }
  async readJson(name, def) {
    const id = this.ids[name]; if (!id) return def;
    try { return await (await this.req(`${DRIVE}/${id}?alt=media`)).json(); } catch (e) { if (e.code === "auth") throw e; return def; }
  }
  async writeJson(name, obj) {
    const text = JSON.stringify(obj);
    if (this.ids[name]) await this.req(`${UPLOAD}/${this.ids[name]}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: text });
    else this.ids[name] = await this.create(name, this.root, text, "application/json");
  }
  async trash(id) { await this.req(`${DRIVE}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch((e) => { if (e.code === "auth") throw e; }); }
  // כתיבות אחת אחרי השנייה, כדי ששתי שמירות לא ידרסו זו את זו
  serial(fn) { const run = (this.chain || Promise.resolve()).then(fn, fn); this.chain = run.catch(() => {}); return run; }

  /* ---------- פתיחה: הכול נטען פעם אחת לזיכרון ---------- */
  async init() {
    if (this.root) return;
    this.root = await this.folder("ניירת עסק");
    this.files = await this.folder("קבצים", this.root);
    for (const f of await this.list(`'${this.root}' in parents and trashed=false and mimeType!='${FOLDER}'`)) this.ids[f.name] = f.id;
    const [settings, docs, thumbs, prices, reports] = await Promise.all([
      this.readJson("settings.json", {}), this.readJson("index.json", []), this.readJson("thumbs.json", {}),
      this.readJson("prices.json", {}), this.readJson("reports.json", [])
    ]);
    this.settings = settings; this.docs = docs; this.thumbs = thumbs; this.prices = prices; this.reports = reports;
    if (!googleEmail() && googleToken()) {
      fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(googleToken().t)).then((r) => r.json()).then((j) => j.email && ls.set(MAIL_KEY, j.email)).catch(() => {});
    }
  }
  _saveIndex() {
    // התמונות הממוזערות בקובץ נפרד, כדי שרשימת המסמכים תישאר קלה
    const docs = this.docs.map(({ thumb, ...d }) => d);
    return this.writeJson("index.json", docs);
  }
  _row(d) { return { ...clone(d), thumb: this.thumbs[d.id] || d.thumb || "" }; }

  onAuth(cb) { this._authCb = cb; cb(!!googleToken()); }
  async signIn() { throw new Error("בכניסה עם גוגל אין סיסמה"); }
  async signOut() { googleSignOut(); ls.set("nr_mode", ""); this._authCb && this._authCb(false); location.reload(); }

  /* ---------- הגדרות ---------- */
  async getSettings() { await this.init(); return { ...DEFAULT_SETTINGS, businessName: "", ...clone(this.settings) }; }
  saveSettings(patch) { return this.serial(async () => { await this.init(); Object.assign(this.settings, clone(patch)); await this.writeJson("settings.json", this.settings); }); }

  /* ---------- מסמכים ---------- */
  async listByMonth(month) { await this.init(); return this.docs.filter((d) => d.month === month).map((d) => this._row(d)); }
  async listByRange(from, to) { await this.init(); return this.docs.filter((d) => (d.date || "") >= from && (d.date || "") <= to).map((d) => this._row(d)); }
  async findByInvoiceNumber(no) { await this.init(); return this.docs.filter((d) => d.invoiceNumber === no).map((d) => this._row(d)); }
  addDoc(meta, pages) {
    return this.serial(async () => {
      await this.init();
      const id = newId();
      // הדפים קודם, והרשומה אחרונה, כדי שמסמך חלקי לא יופיע בטבלה
      const pageFiles = [];
      for (let i = 0; i < pages.length; i++) pageFiles.push(await this.create(`${id}-${i + 1}.jpg`, this.files, dataUrlToBlob(pages[i]), "image/jpeg"));
      const { thumb, ...rest } = clone(meta);
      this.docs.push({ ...rest, id, pageFiles, pageCount: pages.length, sizeBytes: docBytes(meta, pages), createdAt: Date.now() });
      if (thumb) { this.thumbs[id] = thumb; await this.writeJson("thumbs.json", this.thumbs); }
      await this._saveIndex();
      return id;
    });
  }
  updateDoc(id, patch) {
    return this.serial(async () => {
      await this.init();
      const d = this.docs.find((x) => x.id === id); if (!d) return;
      const { thumb, ...rest } = clone(patch);
      for (const [k, v] of Object.entries(rest)) { if (v === undefined) delete d[k]; else d[k] = v; }
      if (thumb !== undefined) { this.thumbs[id] = thumb; await this.writeJson("thumbs.json", this.thumbs); }
      await this._saveIndex();
    });
  }
  deleteDoc(id) {
    return this.serial(async () => {
      await this.init();
      const d = this.docs.find((x) => x.id === id); if (!d) return;
      this.docs = this.docs.filter((x) => x.id !== id);
      await this._saveIndex();   // קודם הרשומה, כך שגם אם המחיקה נקטעת היא לא תופיע
      for (const fid of d.pageFiles || []) await this.trash(fid);
      if (this.thumbs[id]) { delete this.thumbs[id]; await this.writeJson("thumbs.json", this.thumbs); }
    });
  }
  async getPages(id) {
    await this.init();
    const d = this.docs.find((x) => x.id === id);
    const files = (d && d.pageFiles) || [];
    const out = await Promise.all(files.map(async (fid, i) => ({ id: fid, i, data: await blobToDataUrl(await (await this.req(`${DRIVE}/${fid}?alt=media`)).blob()) })));
    return out;
  }
  deletePage(docId, pageId) {
    return this.serial(async () => {
      await this.init();
      const d = this.docs.find((x) => x.id === docId); if (!d) return;
      d.pageFiles = (d.pageFiles || []).filter((f) => f !== pageId); d.pageCount = d.pageFiles.length;
      await this._saveIndex(); await this.trash(pageId);
    });
  }

  /* ---------- אחסון ---------- */
  async getUsage() {
    await this.init();
    const bytes = this.docs.reduce((n, d) => n + (d.sizeBytes || 0), 0);
    return { bytes, docs: this.docs.length, limit: DRIVE_BYTES };
  }

  /* ---------- ספקים קבועים ומחירים ---------- */
  async getSupplierStats(keyFn) {
    await this.init();
    const s = {};
    this.docs.filter((x) => x.kind === "invoice").forEach((x) => {
      const k = keyFn(x.supplier), m = (x.date || "").slice(0, 7);
      if (!k || !m) return;
      (s[k] ||= { name: x.supplier, m: [] });
      if (!s[k].m.includes(m)) s[k].m.push(m);
      if (x.category) s[k].cat = x.category;
    });
    for (const [k, c] of Object.entries(this.settings.supCats || {})) if (s[k]) s[k].cat = c;
    return s;
  }
  async addSupplierMonth(key, name, month, cat) {
    if (!key || !cat) return;
    await this.init();
    if ((this.settings.supCats || {})[key] === cat) return;
    await this.saveSettings({ supCats: { ...(this.settings.supCats || {}), [key]: cat } });
  }
  async getPrices() { await this.init(); return clone(this.prices); }
  savePrices(key, map) { return this.serial(async () => { await this.init(); this.prices[key] = clone(map); await this.writeJson("prices.json", this.prices); }); }

  /* ---------- "ממתינים לאישור" מהאייפון: לא קיים בכניסה עם גוגל ---------- */
  async listInbox() { return []; }
  async deleteInbox() {}

  /* ---------- היסטוריית דוחות ---------- */
  addReport(entry) {
    return this.serial(async () => {
      await this.init();
      this.reports.unshift({ ...clone(entry), id: "r" + newId(), createdAt: Date.now() });
      this.reports = this.reports.slice(0, 30);
      await this.writeJson("reports.json", this.reports);
    });
  }
  async listReports() { await this.init(); return clone(this.reports); }
}
