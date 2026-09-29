// שכבת נתונים: Firebase (אמיתי) או תצוגה (נתונים לדוגמה בזיכרון)
const FB_VER = "10.12.2";
const fbUrl = (m) => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${m}.js`;

/* ---------------------------------------------------------------
 * ממשק אחיד:
 *  init(), onAuth(cb), signIn(password), signOut()
 *  getSettings(), saveSettings(patch)
 *  listByMonth(month), listByRange(from, to), findByInvoiceNumber(no)
 *  addDoc(meta, pagesDataUrls) → id, updateDoc(id, patch), deleteDoc(id)
 *  getPages(id) → [{id, i, data}], deletePage(docId, pageId)
 *  addReport(entry), listReports()
 * ------------------------------------------------------------- */

export const FREE_BYTES = 1024 ** 3; // 1GB במסלול החינמי של Firebase
const USAGE_V = 1;
// גודל משוער של מסמך באחסון: הדפים + התמונה הממוזערת + פרטים
export const docBytes = (meta, pages) => pages.reduce((n, p) => n + (p?.length || 0), 0) + (meta.thumb?.length || 0) + 1024;

export const DEFAULT_SETTINGS = {
  businessName: "INBAR Professional Cosmetic Center",
  vatRate: 18,
  geminiKey: "",
  geminiModel: "gemini-flash-latest",
  closedMonths: [],
  customDocTypes: [],
  reopenedMonths: [],
  autoClosedThrough: "",
  warnDay: 10,
  autoCloseDay: 16,
  recentEmails: []
};

/* ======================= Firebase ======================= */
export class FirebaseStore {
  constructor(cfg) { this.cfg = cfg; this.demo = false; }

  async init() {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(fbUrl("app")), import(fbUrl("auth")), import(fbUrl("firestore"))
    ]);
    this.A = auth; this.F = fs;
    this.app = initializeApp(this.cfg.firebase);
    if (this.cfg.appCheckSiteKey) {
      try {
        const ac = await import(fbUrl("app-check"));
        ac.initializeAppCheck(this.app, { provider: new ac.ReCaptchaEnterpriseProvider(this.cfg.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
      } catch (e) { console.warn("App Check", e); }
    }
    this.auth = auth.getAuth(this.app);
    await auth.setPersistence(this.auth, auth.browserLocalPersistence);
    this.db = fs.getFirestore(this.app);
    this.biz = this.cfg.businessId;
  }

  onAuth(cb) { return this.A.onAuthStateChanged(this.auth, (u) => cb(!!u)); }
  async signIn(password) { await this.A.signInWithEmailAndPassword(this.auth, this.cfg.sharedEmail, password); }
  async signOut() { await this.A.signOut(this.auth); }

  _col(name) { return this.F.collection(this.db, "businesses", this.biz, name); }
  _doc(...p) { return this.F.doc(this.db, "businesses", this.biz, ...p); }

  async getSettings() {
    const s = await this.F.getDoc(this._doc("settings", "main"));
    return { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
  }
  async saveSettings(patch) { await this.F.setDoc(this._doc("settings", "main"), patch, { merge: true }); }

  async _q(...conds) {
    const { query, getDocs } = this.F;
    const snap = await getDocs(query(this._col("docs"), ...conds));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  listByMonth(month) { return this._q(this.F.where("month", "==", month)); }
  listByRange(from, to) { return this._q(this.F.where("date", ">=", from), this.F.where("date", "<=", to)); }
  findByInvoiceNumber(no) { return this._q(this.F.where("invoiceNumber", "==", no)); }

  async addDoc(meta, pages) {
    const { doc, setDoc, collection } = this.F;
    const ref = doc(this._col("docs"));
    // הדפים נכתבים קודם, והרשומה אחרונה, כדי שמסמך חלקי לא יופיע בטבלה
    for (let i = 0; i < pages.length; i++) {
      await setDoc(doc(collection(ref, "pages"), String(i).padStart(3, "0")), { i, data: pages[i] });
    }
    const sizeBytes = docBytes(meta, pages);
    await setDoc(ref, { ...meta, pageCount: pages.length, sizeBytes, createdAt: Date.now() });
    await this._bump(sizeBytes, 1);
    return ref.id;
  }
  async updateDoc(id, patch) { await this.F.updateDoc(this._doc("docs", id), patch); }
  async deleteDoc(id) {
    const { getDoc, getDocs, collection, deleteDoc } = this.F;
    const ref = this._doc("docs", id);
    const snap = await getDoc(ref);
    await deleteDoc(ref); // קודם הרשומה, כך שגם אם המחיקה נקטעת היא לא תופיע
    const pages = await getDocs(collection(ref, "pages"));
    const size = snap.data()?.sizeBytes ?? docBytes(snap.data() || {}, pages.docs.map((p) => p.data().data));
    await Promise.all(pages.docs.map((p) => deleteDoc(p.ref)));
    await this._bump(-size, -1);
  }
  async getPages(id) {
    const { getDocs, collection } = this.F;
    const snap = await getDocs(collection(this._doc("docs", id), "pages"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.i - b.i);
  }
  async deletePage(docId, pageId) {
    const { getDoc, deleteDoc, updateDoc, increment } = this.F;
    const pref = this.F.doc(this._doc("docs", docId), "pages", pageId);
    const len = (await getDoc(pref)).data()?.data?.length || 0;
    await deleteDoc(pref);
    await updateDoc(this._doc("docs", docId), { sizeBytes: increment(-len) }).catch(() => {});
    await this._bump(-len, 0);
  }

  // מונה שימוש באחסון: נשמר בהגדרות ומתעדכן בכל העלאה ומחיקה
  async _bump(bytes, docs) {
    const { setDoc, increment } = this.F;
    await setDoc(this._doc("settings", "main"), { usage: { bytes: increment(bytes), docs: increment(docs) } }, { merge: true }).catch((e) => console.warn("usage", e));
  }
  async getUsage() {
    const s = await this.F.getDoc(this._doc("settings", "main"));
    const u = s.data()?.usage;
    if (u && u.v === USAGE_V) return { bytes: Math.max(0, u.bytes || 0), docs: Math.max(0, u.docs || 0) };
    // חישוב ראשוני: עובר פעם אחת על כל המסמכים
    const { getDocs, collection, updateDoc, setDoc } = this.F;
    const all = await getDocs(this._col("docs"));
    let bytes = 0;
    for (const d of all.docs) {
      let size = d.data().sizeBytes;
      if (size == null) {
        const pages = await getDocs(collection(d.ref, "pages"));
        size = docBytes(d.data(), pages.docs.map((p) => p.data().data));
        await updateDoc(d.ref, { sizeBytes: size }).catch(() => {});
      }
      bytes += size;
    }
    const usage = { v: USAGE_V, bytes, docs: all.size };
    await setDoc(this._doc("settings", "main"), { usage }, { merge: true });
    return { bytes, docs: all.size };
  }

  async addReport(entry) { await this.F.addDoc(this._col("reports"), { ...entry, createdAt: Date.now() }); }
  async listReports() {
    const { query, orderBy, limit, getDocs } = this.F;
    const snap = await getDocs(query(this._col("reports"), orderBy("createdAt", "desc"), limit(30)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

/* ======================= תצוגה ======================= */
export class DemoStore {
  constructor() { this.demo = true; this.docs = []; this.pages = {}; this.reports = []; this.settings = { ...DEFAULT_SETTINGS }; this._authCb = null; this._n = 0; }
  async init() {}
  onAuth(cb) { this._authCb = cb; cb(false); }
  async signIn() { this._authCb && this._authCb(true); }
  async signOut() { this._authCb && this._authCb(false); }
  async getSettings() { return structuredClone(this.settings); }
  async saveSettings(patch) { Object.assign(this.settings, structuredClone(patch)); }
  async listByMonth(month) { return this.docs.filter((d) => d.month === month).map((d) => ({ ...d })); }
  async listByRange(from, to) { return this.docs.filter((d) => d.date >= from && d.date <= to).map((d) => ({ ...d })); }
  async findByInvoiceNumber(no) { return this.docs.filter((d) => d.invoiceNumber === no).map((d) => ({ ...d })); }
  async addDoc(meta, pages) {
    const id = "d" + (++this._n);
    this.docs.push({ ...meta, id, pageCount: pages.length, sizeBytes: docBytes(meta, pages), createdAt: Date.now() + this._n });
    this.pages[id] = pages.map((data, i) => ({ id: String(i).padStart(3, "0"), i, data }));
    return id;
  }
  async updateDoc(id, patch) { const d = this.docs.find((x) => x.id === id); if (d) Object.assign(d, patch); }
  async deleteDoc(id) { this.docs = this.docs.filter((d) => d.id !== id); delete this.pages[id]; }
  async getPages(id) { return (this.pages[id] || []).slice(); }
  async deletePage(docId, pageId) { this.pages[docId] = (this.pages[docId] || []).filter((p) => p.id !== pageId); }
  async getUsage() {
    const bytes = this.docs.reduce((n, d) => n + docBytes(d, (this.pages[d.id] || []).map((p) => p.data)), 0);
    return { bytes, docs: this.docs.length };
  }
  async addReport(entry) { this.reports.unshift({ ...entry, id: "r" + Date.now(), createdAt: Date.now() }); }
  async listReports() { return this.reports.slice(0, 30); }
}
