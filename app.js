// ניירת INBAR — לוגיקת האפליקציה
import { FirebaseStore, DemoStore, FREE_BYTES } from "./store.js?v=20261004";
import { fileToPages, makeThumb, isPdf, loadImage, compressCanvasSource } from "./images.js?v=20261004";
import { recognize } from "./ocr.js?v=20261004";
import { getRate, curSign } from "./fx.js?v=20261004";
import { supplierKey, missingRecurring, recurringList } from "./recur.js?v=20261004";
import { COLS, KIND_LABEL, fmtMoney, fmtDate, sumOf, cellText, buildTablePdf, buildDocsPdf, buildCombinedPdf, buildExcel, downloadBlob, tryShare, fmtSize, localIso, fxNote, fxOrig, CATEGORIES, categorySummary, UNCAT } from "./reports.js?v=20261004";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cfg = window.NAYERET_CONFIG || {};

const state = {
  store: null, settings: null,
  view: "invoice", month: ymOf(new Date()),
  rows: [], selected: new Set(),
  search: null,            // {text, from, to, amtFrom, amtTo}
  lastFiles: [], lastTitle: ""
};

/* ======================= עזרים ======================= */
function ymOf(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function monthName(ym) { const [y, m] = ym.split("-").map(Number); return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1)); }
function shiftMonth(ym, n) { const [y, m] = ym.split("-").map(Number); return ymOf(new Date(y, m - 1 + n, 1)); }
function monthBounds(ym) { const [y, m] = ym.split("-").map(Number); const last = new Date(y, m, 0).getDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`]; }
const shortMonth = (ym) => ym ? ym.split("-").reverse().join("/") : "";
// חודש סגור = נסגר ידנית, או נסגר אוטומטית (עד autoClosedThrough) ולא נפתח מחדש
function isClosed(ym) {
  const st = state.settings || {};
  if ((st.closedMonths || []).includes(ym)) return true;
  return !!st.autoClosedThrough && ym <= st.autoClosedThrough && !(st.reopenedMonths || []).includes(ym);
}
const warnDay = () => Number(state.settings?.warnDay) || 10;
const autoCloseDay = () => Number(state.settings?.autoCloseDay) || 16;
// ===== חשבוניות קבועות =====
const ignoreMap = () => Object.fromEntries((state.settings?.recurIgnore || []).map((x) => x.split("|")));
const missingFor = (m) => state.recur ? missingRecurring(state.recur, m, ignoreMap()) : [];
function missingText(months) {
  const items = [].concat(months).flatMap((m) => missingFor(m).map((x) => `${x.name} (${x.label}${[].concat(months).length > 1 ? `, ${shortMonth(m)}` : ""})`));
  return items.length ? `\n\nייתכן שחסרות חשבוניות קבועות:\n${items.map((t) => "• " + t).join("\n")}` : "";
}
async function loadRecur() {
  try { state.recur = await state.store.getSupplierStats(supplierKey); } catch (e) { console.warn("recur", e); state.recur = null; }
  renderMonthBar(); if (state.view === "settings") renderRecurSettings();
}
function noteSupplier(meta) {
  if (meta.kind !== "invoice" || !meta.supplier || !meta.date) return;
  const k = supplierKey(meta.supplier), m = meta.date.slice(0, 7);
  if (!k) return;
  if (state.recur) { (state.recur[k] ||= { name: meta.supplier, m: [] }); if (!state.recur[k].m.includes(m)) state.recur[k].m.push(m); if (meta.category) state.recur[k].cat = meta.category; }
  state.store.addSupplierMonth(k, meta.supplier, m, meta.category || "").catch((e) => console.warn(e));
}
async function setIgnore(keys, on) {
  const list = (state.settings.recurIgnore || []).filter((x) => !keys.includes(x.split("|")[0]));
  if (on) keys.forEach((k) => list.push(`${k}|${ymOf(new Date())}`));
  state.settings.recurIgnore = list;
  await state.store.saveSettings({ recurIgnore: list });
}
function renderRecurLine() {
  const el = $("recurLine");
  const show = state.view === "invoice" && !state.search && state.month < ymOf(new Date()) && !isClosed(state.month);
  const miss = show ? missingFor(state.month) : [];
  el.hidden = !miss.length;
  if (miss.length) el.innerHTML = `ייתכן שחסרות: <b>${miss.map((x) => esc(x.name)).join(" · ")}</b> <button type="button" class="link-btn" id="recurMore">פרטים</button>`;
}
function openRecurDlg(month) {
  const miss = missingFor(month);
  $("recurTitle").textContent = `חשבוניות קבועות שעוד לא הגיעו · ${monthName(month)}`;
  $("recurList").innerHTML = miss.map((x, i) => `<li><div><b>${esc(x.name)}</b><div class="rl-freq">מגיעה בדרך כלל ${esc(x.label)}</div></div><button type="button" class="btn btn-ghost btn-sm" data-rc-ign="${i}">לא להזכיר</button></li>`).join("") || `<li class="hint">הכול הגיע 👍</li>`;
  $("recurList").onclick = async (e) => {
    const b = e.target.closest("[data-rc-ign]"); if (!b) return;
    await setIgnore(miss[Number(b.dataset.rcIgn)].keys, true);
    toast("לא נזכיר יותר על הספק הזה"); openRecurDlg(month); renderMonthBar();
  };
  if (!$("recurDlg").open) $("recurDlg").showModal();
}
document.addEventListener("click", (e) => { if (e.target.id === "recurMore") openRecurDlg(state.month); });
function renderRecurSettings() {
  const el = $("recurSettings"); if (!el) return;
  if (!state.recur) { el.innerHTML = `<li class="hint">טוען…</li>`; return; }
  const ign = ignoreMap();
  const list = recurringList(state.recur, shiftMonth(ymOf(new Date()), -1));
  el.innerHTML = list.length ? list.map((x, i) => {
    const muted = x.keys.some((k) => ign[k]);
    return `<li class="${muted ? "is-muted" : ""}"><div><b>${esc(x.name)}</b> <span class="rl-freq">· ${esc(x.label)}${muted ? " · לא מזכירים" : ""}</span></div><button type="button" class="btn btn-ghost btn-sm" data-rs="${i}">${muted ? "להזכיר שוב" : "לא להזכיר"}</button></li>`;
  }).join("") : `<li class="hint">עדיין אין מספיק היסטוריה. אחרי כ-3 חודשים של חשבוניות יופיעו כאן הספקים הקבועים.</li>`;
  el.onclick = async (e) => {
    const b = e.target.closest("[data-rs]"); if (!b) return;
    const x = list[Number(b.dataset.rs)], muted = x.keys.some((k) => ign[k]);
    await setIgnore(x.keys, !muted); renderRecurSettings();
  };
}
async function setClosed(months, closed) {
  const st = state.settings;
  const c = new Set(st.closedMonths || []), r = new Set(st.reopenedMonths || []);
  for (const m of [].concat(months)) {
    if (closed) { c.add(m); r.delete(m); }
    else { c.delete(m); if (st.autoClosedThrough && m <= st.autoClosedThrough) r.add(m); }
  }
  st.closedMonths = [...c].sort(); st.reopenedMonths = [...r].sort();
  await state.store.saveSettings({ closedMonths: st.closedMonths, reopenedMonths: st.reopenedMonths });
}
// סגירה אוטומטית: מה-16 לחודש (ברירת מחדל), החודש הקודם נסגר
async function autoCloseMonths() {
  const now = new Date(), cur = ymOf(now);
  const target = shiftMonth(cur, now.getDate() >= autoCloseDay() ? -1 : -2);
  const prevThrough = state.settings.autoClosedThrough || "";
  if (prevThrough >= target) return;
  const newly = [];
  for (let m = target, i = 0; i < 3 && m > prevThrough; m = shiftMonth(m, -1), i++) if (!isClosed(m)) newly.push(m);
  state.settings.autoClosedThrough = target;
  try { await state.store.saveSettings({ autoClosedThrough: target }); } catch (e) { console.warn(e); return; }
  if (newly.length && prevThrough) toast(`${newly.map(monthName).join(", ")} נסגר אוטומטית (ה-${autoCloseDay()} לחודש עבר)`, 5000);
}
// חודשים שעברו ועדיין פתוחים, שצריך להזכיר עליהם
function pendingMonths() {
  const now = new Date(), cur = ymOf(now), prev = shiftMonth(cur, -1), out = [];
  for (let i = 3; i >= 1; i--) {
    const m = shiftMonth(cur, -i);
    if (isClosed(m)) continue;
    if (m === prev && now.getDate() < warnDay()) continue;
    out.push(m);
  }
  return out;
}
function firstOpenMonthFrom(ym) { let m = ym; for (let i = 0; i < 36 && isClosed(m); i++) m = shiftMonth(m, 1); return m; }
const amountOf = (r) => r.kind === "invoice" ? r.total : r.amount;
const r2 = (n) => Math.round(n * 100) / 100;
const numVal = (el) => el.value === "" ? null : r2(parseFloat(el.value));

let toastT;
function toast(msg, ms = 2600) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }

function confirmBox(text, yes = "כן", danger = true) {
  return new Promise((res) => {
    const d = $("confirmDlg"); $("cfText").textContent = text;
    const y = $("cfYes"); y.textContent = yes; y.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    const done = (v) => { d.close(); y.onclick = $("cfNo").onclick = null; res(v); };
    y.onclick = () => done(true); $("cfNo").onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    d.showModal();
  });
}

document.addEventListener("click", (e) => { const b = e.target.closest("[data-close]"); if (b) b.closest("dialog").close(); });

/* ======================= הפעלה ======================= */
async function boot() {
  state.store = cfg.firebase ? new FirebaseStore(cfg) : new DemoStore();
  try { await state.store.init(); }
  catch (e) { console.error(e); $("loginView").hidden = false; showLoginError("אין חיבור לשרת. בדקי את האינטרנט ורענני."); return; }
  if (state.store.demo) {
    $("demoBanner").hidden = false;
    $("loginPassword").placeholder = "בתצוגה: כל סיסמה";
    const { seedDemo } = await import("./demo.js?v=20261004");
    await seedDemo(state.store);
  }
  state.store.onAuth((signed) => signed ? enterApp() : showLogin());
}

function showLogin() { $("appView").hidden = true; $("loginView").hidden = false; $("loginPassword").value = ""; setTimeout(() => $("loginPassword").focus(), 50); }
function showLoginError(msg) { const e = $("loginError"); e.textContent = msg; e.hidden = !msg; }

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault(); showLoginError("");
  const btn = $("loginBtn"); btn.disabled = true; btn.textContent = "נכנסת…";
  try { await state.store.signIn($("loginPassword").value); }
  catch (err) {
    const code = err.code || "";
    showLoginError(code.includes("too-many") ? "יותר מדי ניסיונות. נסי שוב בעוד כמה דקות." : code.includes("network") ? "אין חיבור לאינטרנט." : "הסיסמה שגויה. נסי שוב.");
  } finally { btn.disabled = false; btn.textContent = "כניסה"; }
});

async function enterApp() {
  $("loginView").hidden = true; $("appView").hidden = false;
  try { state.settings = await state.store.getSettings(); }
  catch (e) { console.error(e); toast("לא הצלחתי לטעון הגדרות. ייתכן שחסרה הרשאה למשתמש.", 6000); state.settings = { closedMonths: [], recentEmails: [], vatRate: 18 }; }
  $("bizName").textContent = state.settings.businessName || "";
  await autoCloseMonths();
  loadRecur();
  setView(location.hash.replace("#", "") || "invoice");
  refreshUsage();
  refreshInbox();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshInbox(); });
}

/* ======================= ניווט ======================= */
$("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) setView(t.dataset.view); });
function setView(v) {
  if (!["invoice", "other", "reports", "settings"].includes(v)) v = "invoice";
  state.view = v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === v));
  $("tableView").hidden = !(v === "invoice" || v === "other");
  $("reportsView").hidden = v !== "reports";
  $("settingsView").hidden = v !== "settings";
  history.replaceState(null, "", "#" + v);
  if (v === "invoice" || v === "other") { state.selected.clear(); loadRows(); }
  if (v === "reports") initReports();
  if (v === "settings") { fillSettings(); refreshUsage(); renderRecurSettings(); }
}

/* ======================= טבלאות ======================= */
$("monthPrev").onclick = () => { state.month = shiftMonth(state.month, -1); loadRows(); };
$("monthNext").onclick = () => { state.month = shiftMonth(state.month, 1); loadRows(); };
// בחירת חודש: חלון עם שנה ו-12 חודשים (עובד גם באייפון)
let mpYear = 0;
$("monthLabel").onclick = () => { mpYear = Number(state.month.slice(0, 4)); renderMonthPicker(); $("monthDlg").showModal(); };
function renderMonthPicker() {
  $("mpYear").textContent = mpYear;
  const names = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("he-IL", { month: "long" }).format(new Date(2000, i, 1)));
  $("mpGrid").innerHTML = names.map((n, i) => {
    const ym = `${mpYear}-${String(i + 1).padStart(2, "0")}`;
    return `<button type="button" data-ym="${ym}" class="${ym === state.month ? "is-current" : ""}${isClosed(ym) ? " is-closed" : ""}">${n}</button>`;
  }).join("");
}
$("mpYearPrev").onclick = () => { mpYear--; renderMonthPicker(); };
$("mpYearNext").onclick = () => { mpYear++; renderMonthPicker(); };
$("mpGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-ym]"); if (!b) return; state.month = b.dataset.ym; $("monthDlg").close(); loadRows(); });
$("mpToday").onclick = () => { state.month = ymOf(new Date()); $("monthDlg").close(); loadRows(); };

$("closeMonthBtn").onclick = async () => {
  const m = state.month, closed = isClosed(m);
  const ok = await confirmBox(closed
    ? `לפתוח מחדש את ${monthName(m)}? מסמכים חדשים מהחודש הזה ייכנסו אליו ולא לחודש הנוכחי. הוא יישאר פתוח עד שתסגרי אותו שוב.`
    : `לסגור את ${monthName(m)} כנשלח לרואה החשבון? מסמך שיגיע מעכשיו עם תאריך מהחודש הזה ייכנס לחודש הפתוח הנוכחי, עם סימון איחור.${missingText(m)}`,
    closed ? "פתח מחדש" : "סגור חודש", false);
  if (!ok) return;
  await setClosed(m, !closed);
  toast(closed ? "החודש נפתח מחדש" : "החודש סומן כנשלח לרואה החשבון");
  renderMonthBar();
};

function renderMonthBar() {
  const searching = !!state.search;
  document.querySelector(".month-bar").hidden = searching;
  $("monthText").textContent = monthName(state.month);
  const closed = isClosed(state.month);
  $("monthClosedPill").hidden = !closed;
  $("closeMonthBtn").textContent = closed ? "פתח חודש" : "סגור חודש";
  const pend = pendingMonths();
  $("closeMonthBtn").classList.toggle("is-alert", pend.includes(state.month));
  const w = $("closeWarn");
  w.hidden = !pend.length;
  if (pend.length) {
    const prev = shiftMonth(ymOf(new Date()), -1);
    const auto = pend.includes(prev) ? ` · ייסגר אוטומטית ב-${autoCloseDay()}/${String(new Date().getMonth() + 1).padStart(2, "0")}` : "";
    const nMiss = pend.reduce((n, m) => n + missingFor(m).length, 0);
    w.textContent = `⚠ ${pend.map((m) => monthName(m)).join(", ")} עדיין לא ${pend.length > 1 ? "נסגרו" : "נסגר"}${auto}${nMiss ? ` · ${nMiss === 1 ? "חשבונית קבועה אחת חסרה" : `${nMiss} חשבוניות קבועות חסרות`}` : ""} · לסגירה`;
  }
  renderRecurLine();
}
$("closeWarn").onclick = async () => {
  const pend = pendingMonths(); if (!pend.length) return;
  const names = pend.map(monthName).join(", ");
  if (!(await confirmBox(`לסגור את ${names} כנשלח לרואה החשבון?${missingText(pend)}`, "כן, סגור", false))) return;
  await setClosed(pend, true);
  toast(`${names} סומן כנשלח לרואה החשבון`);
  renderMonthBar();
};

async function loadRows() {
  renderMonthBar();
  const kind = state.view;
  let rows;
  try {
    if (state.search) {
      const s = state.search;
      rows = await state.store.listByRange(s.from || "2000-01-01", s.to || "2999-12-31");
      rows = rows.filter((r) => r.kind === kind);
      if (s.text) {
        const q = s.text.toLowerCase();
        rows = rows.filter((r) => [r.supplier, r.name, r.invoiceNumber, r.docType, r.note, r.details].some((v) => String(v || "").toLowerCase().includes(q)));
      }
      if (s.amtFrom != null) rows = rows.filter((r) => (amountOf(r) ?? -Infinity) >= s.amtFrom);
      if (s.amtTo != null) rows = rows.filter((r) => (amountOf(r) ?? Infinity) <= s.amtTo);
    } else {
      rows = (await state.store.listByMonth(state.month)).filter((r) => r.kind === kind);
    }
  } catch (e) { console.error(e); toast("שגיאה בטעינת הנתונים", 4000); rows = []; }
  rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));
  state.rows = rows;
  for (const id of [...state.selected]) if (!rows.some((r) => r.id === id)) state.selected.delete(id);
  renderTable();
}

function renderTable() {
  const kind = state.view, cols = COLS[kind], rows = state.rows;
  const thClass = { idx: "th-num", thumb: "th-img", date: "th-date", supplier: "th-name", name: "th-name", invoiceNumber: "th-invno", net: "th-net", vat: "th-vat", total: "th-total", docType: "th-type", note: "th-note", amount: "th-amount" };
  const allSel = rows.length && rows.every((r) => state.selected.has(r.id));
  $("docThead").innerHTML = `<tr><th class="th-num col-sel"><input type="checkbox" id="selAll" aria-label="בחר הכול" ${allSel ? "checked" : ""}></th>` +
    cols.map((c) => `<th class="${thClass[c.key]}${c.money ? " num" : ""}">${esc(c.label)}</th>`).join("") + `<th class="th-act" aria-label="פעולות"></th></tr>`;

  $("docTbody").innerHTML = rows.map((r, i) => `<tr data-id="${r.id}" class="${state.selected.has(r.id) ? "is-selected" : ""}">
    <td class="col-sel"><input type="checkbox" class="rowSel" ${state.selected.has(r.id) ? "checked" : ""} aria-label="בחירה"></td>
    ${cols.map((c) => {
      if (c.key === "idx") return `<td class="col-idx">${i + 1}</td>`;
      if (c.key === "thumb") return `<td><button class="thumb-btn" data-open aria-label="הגדלת המסמך">${r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : `<span class="thumb"></span>`}${r.pageCount > 1 ? `<span class="thumb-badge">${r.pageCount}</span>` : ""}</button></td>`;
      if (c.key === "note") return `<td class="note-cell">${fxNote(r) ? `<span class="pill fx-pill">${esc(fxNote(r))}</span> ` : ""}${r.late ? `<span class="pill pill-late">באיחור מ-${shortMonth(r.origMonth)}</span> ` : ""}${esc(r.note)}${r.details ? `<span class="details-line" title="${esc(r.details)}">${esc(r.details)}</span>` : ""}</td>`;
      if (c.key === "supplier" || c.key === "name") return `<td class="name-cell">${esc(r[c.key])}</td>`;
      const orig = fxOrig(r, c.key);
      return `<td class="${c.money ? "num" : ""}${c.strong ? " total-cell" : ""}">${esc(cellText(r, c.key))}${orig ? `<small class="fx-orig">${esc(orig)}</small>` : ""}</td>`;
    }).join("")}
    <td><button class="row-btn" data-del aria-label="מחיקת שורה" title="מחיקה">🗑</button></td></tr>`).join("");

  $("docTfoot").innerHTML = rows.length ? `<tr><td></td>${cols.map((c, i) => c.sum ? `<td class="num${c.strong ? " total-cell" : ""}">${fmtMoney(sumOf(rows, c.key))}</td>` : `<td>${i === 2 ? 'סה"כ' : i === 3 ? `${rows.length} מסמכים` : ""}</td>`).join("")}<td></td></tr>` : "";

  const emptyText = state.search ? "לא נמצאו מסמכים שמתאימים לחיפוש" : `אין ${kind === "invoice" ? "חשבוניות" : "ניירת"} בתיקיית ${monthName(state.month)}`;
  $("emptyState").hidden = rows.length > 0; $("emptyText").textContent = emptyText;
  $("docTable").hidden = rows.length === 0;

  // כרטיסים לטלפון
  const sums = cols.filter((c) => c.sum);
  $("docCards").innerHTML = (rows.length ? `<div class="card-summary">${sums.map((c) => `<div><span>${esc(c.label)}</span><strong>${fmtMoney(sumOf(rows, c.key))}</strong></div>`).join("")}<div><span>מסמכים</span><strong>${rows.length}</strong></div></div>` : `<div class="empty"><p>${esc(emptyText)}</p></div>`) +
    rows.map((r, i) => `<div class="card ${state.selected.has(r.id) ? "is-selected" : ""}" data-id="${r.id}">
      <button class="thumb-btn" data-open aria-label="הגדלת המסמך">${r.thumb ? `<img class="thumb" src="${r.thumb}" alt="">` : `<span class="thumb"></span>`}${r.pageCount > 1 ? `<span class="thumb-badge">${r.pageCount}</span>` : ""}</button>
      <div class="card-main" data-open>
        <div class="card-title">${i + 1}. ${esc(kind === "invoice" ? r.supplier : `${r.docType || ""}${r.name ? " · " + r.name : ""}`)}</div>
        <div class="card-sub"><span>${fmtDate(r.date)}</span>${kind === "invoice" && r.invoiceNumber ? `<span>מס' ${esc(r.invoiceNumber)}</span>` : ""}${r.late ? `<span class="pill pill-late">באיחור מ-${shortMonth(r.origMonth)}</span>` : ""}</div>
      </div>
      <div class="card-amt">${amountOf(r) != null ? "₪" + fmtMoney(amountOf(r)) : ""}${fxOrig(r, kind === "invoice" ? "total" : "amount") ? `<small class="fx-orig">${esc(fxOrig(r, kind === "invoice" ? "total" : "amount"))}</small>` : ""}${kind === "invoice" ? `<small>מע"מ ${fmtMoney(r.vat)}</small>` : ""}
        <label class="check" style="justify-content:flex-end;margin-top:4px"><input type="checkbox" class="rowSel" ${state.selected.has(r.id) ? "checked" : ""} aria-label="בחירה"></label></div>
    </div>`).join("");
  renderSelection();
}

function rowById(id) { return state.rows.find((r) => r.id === id); }
function onListClick(e) {
  const host = e.target.closest("[data-id]"); if (!host) return;
  const row = rowById(host.dataset.id); if (!row) return;
  if (e.target.classList.contains("rowSel")) { e.target.checked ? state.selected.add(row.id) : state.selected.delete(row.id); host.classList.toggle("is-selected", e.target.checked); renderSelection(); return; }
  if (e.target.closest("[data-del]")) { deleteRow(row); return; }
  if (e.target.closest("[data-open]")) openViewer(row);
}
$("docTbody").addEventListener("click", onListClick);
$("docCards").addEventListener("click", onListClick);
$("docThead").addEventListener("change", (e) => {
  if (e.target.id !== "selAll") return;
  state.rows.forEach((r) => e.target.checked ? state.selected.add(r.id) : state.selected.delete(r.id));
  renderTable();
});

function renderSelection() {
  const n = state.selected.size;
  $("selectionBar").hidden = n === 0;
  $("selectionCount").textContent = n === 1 ? "מסמך אחד נבחר" : `${n} מסמכים נבחרו`;
}
$("selClear").onclick = () => { state.selected.clear(); renderTable(); };
$("selDelete").onclick = async () => {
  const rows = state.rows.filter((r) => state.selected.has(r.id));
  if (!rows.length) return;
  if (!(await confirmBox(`למחוק ${rows.length === 1 ? "מסמך אחד" : `${rows.length} מסמכים`} לצמיתות, כולל התמונות?`, "מחק"))) return;
  const done = await deleteMany(rows, (i, n) => toast(`מוחק ${i} מתוך ${n}…`, 1500));
  state.selected.clear();
  toast(done === rows.length ? `נמחקו ${done} מסמכים` : `נמחקו ${done} מתוך ${rows.length}. נסי שוב את השאר.`, 4000);
  refreshUsage(); await loadRows();
};
async function deleteMany(rows, onProgress) {
  let done = 0;
  for (const r of rows) {
    onProgress && onProgress(done + 1, rows.length);
    try { await state.store.deleteDoc(r.id); done++; } catch (e) { console.error(e); }
  }
  return done;
}
$("selMakeFile").onclick = async () => {
  const rows = state.rows.filter((r) => state.selected.has(r.id));
  const kind = state.view;
  setView("reports");
  await generate([{ kind, rows }], { period: `${rows.length} מסמכים שנבחרו`, fileTag: "נבחרים", outputs: { combined: true, table: false, docs: false, excel: true } });
};

async function deleteRow(row) {
  const ok = await confirmBox(`למחוק את ${row.kind === "invoice" ? "החשבונית של " + (row.supplier || "") : row.docType || "המסמך"} מ-${fmtDate(row.date)}? המסמך והתמונות יימחקו לצמיתות.`, "מחק");
  if (!ok) return;
  await state.store.deleteDoc(row.id);
  state.selected.delete(row.id);
  refreshUsage();
  toast("נמחק");
  await loadRows();
}

/* ---------- חיפוש ---------- */
let searchT;
$("searchText").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 350); });
$("searchToggle").onclick = () => { const a = $("searchAdv"); a.hidden = !a.hidden; $("searchToggle").setAttribute("aria-expanded", String(!a.hidden)); };
$("searchRun").onclick = () => runSearch(true);
$("searchClear").onclick = () => { ["searchText", "fDateFrom", "fDateTo", "fAmtFrom", "fAmtTo"].forEach((id) => ($(id).value = "")); state.search = null; $("searchState").hidden = true; loadRows(); };

function runSearch(force) {
  const text = $("searchText").value.trim();
  const from = $("fDateFrom").value, to = $("fDateTo").value;
  const amtFrom = numVal($("fAmtFrom")), amtTo = numVal($("fAmtTo"));
  const any = text.length >= 2 || from || to || amtFrom != null || amtTo != null;
  if (!any && !force) { if (state.search) { state.search = null; $("searchState").hidden = true; loadRows(); } return; }
  if (!any) return;
  state.search = { text: text.length >= 2 ? text : "", from, to, amtFrom, amtTo };
  const parts = [];
  if (state.search.text) parts.push(`"${state.search.text}"`);
  if (from || to) parts.push(`תאריכים ${from ? fmtDate(from) : "…"} עד ${to ? fmtDate(to) : "…"}`);
  if (amtFrom != null || amtTo != null) parts.push(`סכום ${amtFrom ?? "…"} עד ${amtTo ?? "…"} ₪`);
  const st = $("searchState"); st.hidden = false;
  st.innerHTML = `<span>חיפוש בכל החודשים: ${esc(parts.join(" · "))}</span><button type="button" id="searchBack">חזרה לתיקיית החודש</button>`;
  $("searchBack").onclick = () => $("searchClear").click();
  state.selected.clear();
  loadRows();
}

/* ======================= צפייה במסמך ======================= */
const view = { row: null, pages: [], zoom: 1 };
async function openViewer(row) {
  view.row = row; view.zoom = 1;
  $("vwTitle").textContent = row.kind === "invoice" ? (row.supplier || "חשבונית") : `${row.docType || "מסמך"}${row.name ? " · " + row.name : ""}`;
  $("vwMeta").innerHTML = [
    `<span>תאריך: <b>${fmtDate(row.date)}</b></span>`,
    row.invoiceNumber ? `<span>מס' חשבונית: <b>${esc(row.invoiceNumber)}</b></span>` : "",
    row.kind === "invoice" ? `<span>לפני מע"מ: <b>${fmtMoney(row.net)}</b></span><span>מע"מ: <b>${fmtMoney(row.vat)}</b></span><span>סה"כ: <b>₪${fmtMoney(row.total)}</b></span>` : (row.amount != null ? `<span>סכום: <b>₪${fmtMoney(row.amount)}</b></span>` : ""),
    `<span>תיקייה: <b>${shortMonth(row.month)}</b></span>`,
    row.late ? `<span class="pill pill-late">באיחור מ-${shortMonth(row.origMonth)}</span>` : "",
    row.note ? `<span>הערה: <b>${esc(row.note)}</b></span>` : "",
    row.details ? `<span class="vw-details">פירוט: <b>${esc(row.details)}</b></span>` : ""
  ].join("");
  $("vwBody").innerHTML = `<div class="busy"><span class="spinner"></span>טוען…</div>`;
  $("viewDlg").showModal();
  view.pages = await state.store.getPages(row.id);
  renderViewerPages();
}
function renderViewerPages() {
  const many = view.pages.length > 1;
  $("vwBody").style.setProperty("--zoom", Math.round(view.zoom * 100) + "%");
  $("vwBody").innerHTML = view.pages.map((p, i) => `<div class="vw-page" style="width:min(100%, ${Math.round(820 * view.zoom)}px)">
    ${many ? `<div class="vw-page-bar"><span>דף ${i + 1} מתוך ${view.pages.length}</span><button class="btn btn-danger btn-sm" data-delpage="${p.id}">מחק דף</button></div>` : ""}
    <img src="${p.data}" alt="דף ${i + 1}" style="width:100%"></div>`).join("") || `<p class="hint">לא נמצאו תמונות למסמך הזה.</p>`;
}
$("vwZoomIn").onclick = () => { view.zoom = Math.min(4, view.zoom * 1.5); renderViewerPages(); };
$("vwZoomOut").onclick = () => { view.zoom = Math.max(0.5, view.zoom / 1.5); renderViewerPages(); };
$("vwBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-delpage]"); if (!b) return;
  if (!(await confirmBox("למחוק את הדף הזה מהמסמך?", "מחק דף"))) return;
  const wasFirst = view.pages[0]?.id === b.dataset.delpage;
  await state.store.deletePage(view.row.id, b.dataset.delpage);
  view.pages = view.pages.filter((p) => p.id !== b.dataset.delpage);
  const patch = { pageCount: view.pages.length };
  if (wasFirst && view.pages[0]) patch.thumb = await makeThumb(view.pages[0].data);
  await state.store.updateDoc(view.row.id, patch);
  Object.assign(view.row, patch);
  renderViewerPages(); toast("הדף נמחק"); loadRows();
});
$("vwPrint").onclick = () => printImages(view.pages.map((p) => p.data));
$("vwDownload").onclick = async () => { const f = await singleDocFile(view.row); downloadBlob(f.blob, f.name); };
$("vwShare").onclick = async () => { const f = await singleDocFile(view.row); await shareFiles([f], f.name); };
$("vwEdit").onclick = () => { $("viewDlg").close(); openUpload({ edit: view.row, pages: view.pages.map((p) => p.data) }); };
$("vwDelete").onclick = async () => { $("viewDlg").close(); await deleteRow(view.row); };

async function singleDocFile(row) {
  const blob = await buildDocsPdf([row], row.kind, async () => view.pages, null, { stamp: false });
  const who = (row.kind === "invoice" ? row.supplier : row.docType) || "מסמך";
  return { blob, name: safeName(`${who}-${row.date || ""}${row.invoiceNumber ? "-" + row.invoiceNumber : ""}.pdf`) };
}
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();

function printImages(urls) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;left:-9999px";
  f.srcdoc = `<!doctype html><html><head><style>@page{margin:8mm}body{margin:0}img{display:block;max-width:100%;max-height:277mm;margin:0 auto;page-break-after:always}img:last-child{page-break-after:auto}</style></head><body>${urls.map((u) => `<img src="${u}">`).join("")}</body></html>`;
  f.onload = () => { setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60_000); }, 250); };
  document.body.appendChild(f);
}

/* ======================= העלאה ואישור ======================= */
const up = { inboxIds: null, inboxQueue: [], pages: [], queue: [], edit: null, pendingFiles: null, manualMonth: false, dupTimer: 0, dupFound: null, pageIdx: 0 };

$("fab").onclick = () => openUpload();
function showStep(id) { ["upCollect", "upMulti", "upReview"].forEach((s) => ($(s).hidden = s !== id)); }
function openUpload(opts = {}) {
  up.inboxIds = opts.inboxIds || null; if (!opts.inboxIds) up.inboxQueue = [];
  up.pages = opts.pages ? opts.pages.slice() : []; up.queue = []; up.edit = opts.edit || null; up.dupFound = null;
  $("upTitle").textContent = up.edit ? "עריכת פרטי מסמך" : "מסמך חדש";
  if (up.edit) { showStep("upReview"); fillReview(up.edit, null); }
  else { showStep("upCollect"); $("upStart").hidden = false; $("upPagesBox").hidden = true; $("upBusy").hidden = true; }
  if (!$("uploadDlg").open) $("uploadDlg").showModal();
}
$("uploadDlg").addEventListener("close", () => { ["inCamera", "inFile", "inCameraMore", "inFileMore"].forEach((id) => ($(id).value = "")); });

function bindInput(id, more) {
  $(id).addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) handleFiles(files, more); });
}
bindInput("inCamera", false); bindInput("inFile", false); bindInput("inCameraMore", true); bindInput("inFileMore", true);

function handleFiles(files, more) {
  if (!more && files.length > 1) {
    up.pendingFiles = files;
    $("upMultiQ").textContent = `נבחרו ${files.length} קבצים. מה הם?`;
    showStep("upMulti");
    return;
  }
  addFiles(files);
}
$("upMultiSame").onclick = () => { showStep("upCollect"); addFiles(up.pendingFiles); };
$("upMultiSep").onclick = () => { up.queue = up.pendingFiles.slice(1); showStep("upCollect"); addFiles([up.pendingFiles[0]], true); };

async function addFiles(files, directToReview = false) {
  $("upStart").hidden = true; $("upPagesBox").hidden = true; $("upBusy").hidden = false;
  try {
    for (const f of files) {
      $("upBusyText").textContent = isPdf(f) ? "קורא את ה-PDF…" : "מכין את התמונה…";
      const pages = await fileToPages(f, (p, n) => ($("upBusyText").textContent = `קורא דף ${p} מתוך ${n}…`));
      up.pages.push(...pages);
    }
  } catch (e) { console.error(e); toast(e.message || "לא הצלחתי לקרוא את הקובץ", 4000); }
  $("upBusy").hidden = true;
  if (!up.pages.length) { $("upStart").hidden = false; return; }
  if (directToReview) return runRecognition();
  renderPageStrip();
}
function renderPageStrip() {
  $("upPagesBox").hidden = false;
  $("upPages").innerHTML = up.pages.map((p, i) => `<li><img src="${p}" alt="דף ${i + 1}"><span class="pg-num">${i + 1}</span><button type="button" class="pg-del" data-i="${i}" aria-label="הסרת דף">✕</button></li>`).join("");
}
$("upPages").addEventListener("click", (e) => {
  const b = e.target.closest(".pg-del"); if (!b) return;
  up.pages.splice(Number(b.dataset.i), 1);
  if (!up.pages.length) { $("upPagesBox").hidden = true; $("upStart").hidden = false; } else renderPageStrip();
});
$("upDone").onclick = runRecognition;

async function runRecognition() {
  showStep("upCollect"); $("upStart").hidden = true; $("upPagesBox").hidden = true; $("upBusy").hidden = false;
  $("upBusyText").textContent = "מזהה את המסמך…";
  let rec;
  if (state.store.demo && !state.settings.geminiKey) rec = { ok: false, message: "בתצוגה אין זיהוי אוטומטי. באתר האמיתי, אחרי הוספת מפתח, השדות יתמלאו לבד." };
  else rec = await recognize(up.pages, state.settings);
  $("upBusy").hidden = true;
  showStep("upReview");
  fillReview(rec.ok ? rec.result : {}, rec);
}

function setKind(kind) {
  document.querySelector(`input[name="rvKind"][value="${kind}"]`).checked = true;
  $("rvInvoiceFields").hidden = kind !== "invoice";
  $("rvOtherFields").hidden = kind !== "other";
  checkDup();
}
document.querySelectorAll('input[name="rvKind"]').forEach((r) => r.addEventListener("change", () => { carryOver(r.value); setKind(r.value); syncDate(); }));

// סוגי ניירת אחרת: רשימה קבועה + סוגים שהוקלדו בעבר + "אחר"
const BASE_DOC_TYPES = ["תלוש שכר", "דוח קופות גמל / פנסיה", "העברת משכורת", "דף בנק", "דף כרטיס אשראי", "תעודת משלוח", "אישור תשלום", "ביטוח לאומי", "מס הכנסה", "מע\"מ", "הסכם / חוזה", "ביטוח"];
const OTHER = "__other__";
function docTypeList() {
  const custom = (state.settings.customDocTypes || []).filter((t) => !BASE_DOC_TYPES.includes(t));
  return [...BASE_DOC_TYPES, ...custom];
}
function setDocType(value) {
  const sel = $("rvDocTypeSel"), list = docTypeList();
  const v = (value || "").trim();
  const extra = v && !list.includes(v) ? [v] : [];
  sel.innerHTML = `<option value="">בחרי סוג מסמך…</option>` + [...list, ...extra].map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("") + `<option value="${OTHER}">אחר (לכתוב בעצמי)…</option>`;
  sel.value = v;
  $("rvDocType").value = v;
  $("rvDocTypeOtherBox").hidden = true;
}
function currentDocType() { return $("rvDocTypeSel").value === OTHER ? $("rvDocType").value.trim() : $("rvDocTypeSel").value; }
$("rvDocTypeSel").addEventListener("change", () => {
  const other = $("rvDocTypeSel").value === OTHER;
  $("rvDocTypeOtherBox").hidden = !other;
  if (other) { $("rvDocType").value = ""; setTimeout(() => $("rvDocType").focus(), 30); }
});

// מעבר בין חשבונית לניירת אחרת: הפרטים עוברים איתו, לא ממלאים מחדש
function carryOver(toKind) {
  const src = up.src || {};
  const setIfEmpty = (el, v) => { if (el.value === "" && v != null && v !== "") el.value = v; };
  if (toKind === "invoice") {
    setIfEmpty($("rvSupplier"), $("rvName").value || src.supplier || src.name);
    setIfEmpty($("rvInvNo"), src.invoiceNumber);
    setIfEmpty($("rvTotal"), $("rvAmount").value || src.total || src.amount);
    setIfEmpty($("rvVat"), src.vat);
    setIfEmpty($("rvNet"), src.net);
    $("rvDateI").value = $("rvDateO").value || $("rvDateI").value;
    if (src.exempt) $("rvExempt").checked = true;
    applyExempt();
  } else {
    setIfEmpty($("rvName"), $("rvSupplier").value || src.name || src.supplier);
    setIfEmpty($("rvAmount"), $("rvTotal").value || src.amount || src.total);
    if (!currentDocType() && src.kind === "other" && src.docType) setDocType(src.docType);
    $("rvDateO").value = $("rvDateI").value || $("rvDateO").value;
  }
}
const curKind = () => document.querySelector('input[name="rvKind"]:checked').value;
const dateEl = () => curKind() === "invoice" ? $("rvDateI") : $("rvDateO");

function fillReview(d, rec) {
  up.pageIdx = 0; up.manualMonth = !!up.edit; up.src = { ...d };
  renderReviewImg();
  const r = $("rvRecog");
  if (rec) { r.hidden = false; r.textContent = rec.ok ? "זיהיתי את הפרטים הבאים. בדקי, תקני במידת הצורך ואשרי." : rec.message; }
  else r.hidden = true;
  setKind(d.kind === "other" ? "other" : "invoice");
  $("rvSupplier").value = d.supplier || ""; $("rvInvNo").value = d.invoiceNumber || "";
  $("rvDateI").value = d.date || ""; $("rvDateO").value = d.date || "";
  $("rvExempt").checked = !!d.exempt;
  $("rvTotal").value = d.total ?? ""; $("rvVat").value = d.vat ?? ""; $("rvNet").value = d.net ?? "";
  setDocType(d.docType && d.kind === "other" ? d.docType : "");
  $("rvName").value = d.name || ""; $("rvAmount").value = d.amount ?? "";
  $("rvNote").value = d.note || "";
  $("rvDetails").value = d.details || "";
  catTouched = false;
  // עריכה: מה שנשמר. חדש: מה שנלמד על הספק קודם, ורק אחר כך הניחוש של הזיהוי
  setCat(up.edit ? (d.category || catMemory(d.supplier)) : (catMemory(d.supplier) || d.category || (d.kind !== "other" && rec?.ok ? (rec.result.category || "") : "")));
  applyExempt();
  fx.on = false; $("rvFx").hidden = true; $("rvFxLinkRow").hidden = false;
  if (d.currency && d.currency !== "ILS") {
    const orig = d.origAmount ?? (d.kind === "other" ? d.amount : d.total);
    startFx(d.currency, orig, d.fxRate || null, d.fxDate);
  }
  if (up.edit) { $("rvMonth").value = d.month; updateMonthHint(); }
  else syncDate();
  $("rvDup").hidden = true; up.dupFound = null;
  checkDup();
  setTimeout(() => (d.supplier ? $("rvSave") : (curKind() === "invoice" ? $("rvSupplier") : $("rvDocTypeSel"))).focus({ preventScroll: true }), 60);
}
function renderReviewImg() {
  $("rvImg").src = up.pages[up.pageIdx] || "";
  $("rvImgFrame").hidden = !up.pages.length;
  $("rvImgNav").innerHTML = up.pages.length > 1 ? up.pages.map((_, i) => `<button type="button" data-pi="${i}" class="${i === up.pageIdx ? "is-active" : ""}">דף ${i + 1}</button>`).join("") : "";
}
$("rvImgNav").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (b) { up.pageIdx = Number(b.dataset.pi); renderReviewImg(); } });
$("rvImg").addEventListener("click", () => $("rvImg").classList.toggle("zoomed"));

// ===== קטגוריית הוצאה (רק לחשבוניות): ממולאת לבד, נלמדת לפי ספק =====
const CAT_OTHER = "__catother__";
const catList = () => [...CATEGORIES.filter((c) => c !== "אחר"), ...(state.settings.customCats || []).filter((c) => !CATEGORIES.includes(c)), "אחר"];
function catMemory(supplier) {
  const k = supplierKey(supplier); if (!k || !state.recur) return "";
  if (state.recur[k]?.cat) return state.recur[k].cat;
  const hit = Object.entries(state.recur).find(([key, v]) => v.cat && (k.startsWith(key + " ") || key.startsWith(k + " ")));
  return hit ? hit[1].cat : "";
}
let catTouched = false;
function setCat(value) {
  const v = (value || "").trim(), list = catList();
  const extra = v && !list.includes(v) ? [v] : [];
  $("rvCat").innerHTML = `<option value="">בחרי קטגוריה…</option>` + [...list, ...extra].map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="${CAT_OTHER}">קטגוריה חדשה (לכתוב בעצמי)…</option>`;
  $("rvCat").value = v; $("rvCatOther").value = ""; $("rvCatOtherBox").hidden = true;
}
const currentCat = () => $("rvCat").value === CAT_OTHER ? $("rvCatOther").value.trim() : $("rvCat").value;
$("rvCat").addEventListener("change", () => { catTouched = true; const o = $("rvCat").value === CAT_OTHER; $("rvCatOtherBox").hidden = !o; if (o) setTimeout(() => $("rvCatOther").focus(), 30); });
$("rvSupplier").addEventListener("change", () => { if (!catTouched) { const m = catMemory($("rvSupplier").value); if (m) setCat(m); } });

// ===== מטבע זר: הסכום מומר לשקלים לפי השער היציג ביום החשבונית =====
const fx = { on: false, reqId: 0, date: "", source: "" };
const fxTarget = () => (curKind() === "invoice" ? $("rvTotal") : $("rvAmount"));
function startFx(cur, orig, rate, rateDate) {
  fx.on = true;
  $("rvFx").hidden = false; $("rvFxLinkRow").hidden = true;
  $("rvFxCur").value = ["USD", "EUR", "GBP"].includes(cur) ? cur : "USD";
  $("rvFxOrig").value = orig ?? "";
  $("rvFxTitle").textContent = `זוהה סכום ב${{ USD: "דולר", EUR: "יורו", GBP: "ליש\"ט" }[$("rvFxCur").value]}. הסכום הומר לשקלים`;
  if (rate) { $("rvFxRate").value = rate; fx.date = rateDate || ""; fx.source = ""; applyFx(); }
  else loadFxRate();
}
async function loadFxRate() {
  const id = ++fx.reqId, cur = $("rvFxCur").value, date = dateEl().value;
  $("rvFxHint").textContent = "מביא את השער היציג…";
  const r = await getRate(cur, date);
  if (id !== fx.reqId || !fx.on) return;
  if (!r) { $("rvFxHint").textContent = "לא הצלחתי להביא שער אוטומטית. הקלידי את השער ידנית."; return; }
  $("rvFxRate").value = r.rate; fx.date = r.date; fx.source = r.source;
  applyFx();
}
function applyFx() {
  if (!fx.on) return;
  const orig = numVal($("rvFxOrig")), rate = numVal4($("rvFxRate")), cur = $("rvFxCur").value;
  if (orig == null || !rate) { $("rvFxHint").textContent = "ממלאים סכום במקור ושער, והסכום בשקלים יחושב לבד."; return; }
  const ils = r2(orig * rate);
  fxTarget().value = ils;
  if (curKind() === "invoice") { $("rvVat").value = 0; $("rvNet").value = ils; }
  $("rvFxHint").textContent = `${curSign(cur)}${fmtMoney(orig)} × ${rate} = ₪${fmtMoney(ils)}${fx.source ? ` · שער יציג ${fx.source}${fx.date ? " ל-" + fmtDate(fx.date) : ""}` : ""}`;
  checkDup();
}
const numVal4 = (el) => el.value === "" ? null : Math.round(parseFloat(el.value) * 10000) / 10000;
$("rvFxOn").onclick = () => { const t = numVal(fxTarget()); startFx("USD", t, null); };
$("rvFxOff").onclick = () => {
  fx.on = false; fx.reqId++; $("rvFx").hidden = true; $("rvFxLinkRow").hidden = false;
  const orig = $("rvFxOrig").value; fxTarget().value = orig;
  if (curKind() === "invoice") { $("rvNet").value = orig; }
};
$("rvFxCur").addEventListener("change", () => { $("rvFxRate").value = ""; startFx($("rvFxCur").value, numVal($("rvFxOrig")), null); });
$("rvFxOrig").addEventListener("input", applyFx);
$("rvFxRate").addEventListener("input", () => { fx.source = ""; fx.date = ""; applyFx(); });
$("rvDateI").addEventListener("change", () => { if (fx.on && fx.source) loadFxRate(); });
$("rvDateO").addEventListener("change", () => { if (fx.on && fx.source) loadFxRate(); });

// שיוך לחודש
function syncDate() {
  const other = curKind() === "invoice" ? $("rvDateO") : $("rvDateI");
  other.value = dateEl().value;
  if (up.manualMonth) { updateMonthHint(); return; }
  const date = dateEl().value;
  const orig = date ? date.slice(0, 7) : ymOf(new Date());
  $("rvMonth").value = isClosed(orig) ? firstOpenMonthFrom(ymOf(new Date()) > orig ? ymOf(new Date()) : orig) : orig;
  updateMonthHint();
}
function updateMonthHint() {
  const date = dateEl().value, orig = date ? date.slice(0, 7) : "", m = $("rvMonth").value, h = $("rvMonthHint");
  if (orig && m && orig !== m && isClosed(orig)) { h.hidden = false; h.textContent = `${monthName(orig)} כבר נשלח לרואה החשבון, אז המסמך ייכנס ל${monthName(m)} עם סימון "באיחור".`; }
  else if (m && isClosed(m)) { h.hidden = false; h.textContent = `שימי לב: ${monthName(m)} כבר סגור ונשלח לרואה החשבון.`; }
  else if (orig && m && orig !== m) { h.hidden = false; h.textContent = `המסמך מ-${shortMonth(orig)} ישויך ידנית ל-${shortMonth(m)}.`; }
  else h.hidden = true;
}
$("rvDateI").addEventListener("change", syncDate); $("rvDateO").addEventListener("change", syncDate);
$("rvMonth").addEventListener("change", () => { up.manualMonth = true; updateMonthHint(); });

// מע"מ
function applyExempt() {
  const ex = $("rvExempt").checked;
  $("rvVat").disabled = ex;
  if (ex) { $("rvVat").value = 0; if ($("rvTotal").value !== "") $("rvNet").value = $("rvTotal").value; }
}
$("rvExempt").addEventListener("change", applyExempt);
$("rvTotal").addEventListener("input", () => {
  if ($("rvExempt").checked) $("rvNet").value = $("rvTotal").value;
  else if ($("rvVat").value !== "" && $("rvTotal").value !== "") $("rvNet").value = r2(parseFloat($("rvTotal").value) - parseFloat($("rvVat").value));
  checkDup();
});
$("rvVat").addEventListener("input", () => { if ($("rvTotal").value !== "" && $("rvVat").value !== "") $("rvNet").value = r2(parseFloat($("rvTotal").value) - parseFloat($("rvVat").value)); });
$("rvCalcVat").onclick = () => {
  const t = numVal($("rvTotal")); if (t == null) { toast("קודם ממלאים סכום כולל"); $("rvTotal").focus(); return; }
  if ($("rvExempt").checked) return applyExempt();
  const rate = Number(state.settings.vatRate || 18) / 100;
  const vat = r2(t - t / (1 + rate));
  $("rvVat").value = vat; $("rvNet").value = r2(t - vat);
};
$("rvInvNo").addEventListener("input", checkDup);

// כפילות: אותו מספר חשבונית ואותו סכום
function checkDup() {
  clearTimeout(up.dupTimer);
  up.dupTimer = setTimeout(async () => {
    const no = $("rvInvNo").value.trim(), total = numVal($("rvTotal"));
    const box = $("rvDup");
    if (curKind() !== "invoice" || !no || total == null) { box.hidden = true; up.dupFound = null; return; }
    try {
      const found = (await state.store.findByInvoiceNumber(no)).filter((r) => r.id !== up.edit?.id && r.kind === "invoice" && Math.abs((r.total || 0) - total) < 0.01);
      up.dupFound = found[0] || null;
      if (up.dupFound) {
        const d = up.dupFound;
        box.hidden = false;
        box.textContent = `כפילות אפשרית: חשבונית ${d.invoiceNumber} של ${d.supplier || "ספק"} על ₪${fmtMoney(d.total)} מ-${fmtDate(d.date)} כבר שמורה בתיקיית ${shortMonth(d.month)}.`;
      } else box.hidden = true;
    } catch (e) { console.warn(e); }
  }, 300);
}

$("rvCancel").onclick = async () => {
  up.inboxQueue = [];
  if (up.queue.length && !(await confirmBox(`לבטל גם את ${up.queue.length} הקבצים שנשארו בתור?`, "בטל הכול"))) { return nextInQueue(); }
  $("uploadDlg").close();
};

$("upReview").addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = curKind();
  const date = dateEl().value;
  const month = $("rvMonth").value || (date ? date.slice(0, 7) : ymOf(new Date()));
  const origMonth = date ? date.slice(0, 7) : month;
  const meta = { kind, date, month, origMonth, late: origMonth !== month && isClosed(origMonth), note: $("rvNote").value.trim(), details: $("rvDetails").value.trim() };
  if (kind === "invoice") {
    Object.assign(meta, {
      supplier: $("rvSupplier").value.trim(), invoiceNumber: $("rvInvNo").value.trim(), exempt: $("rvExempt").checked,
      total: numVal($("rvTotal")), vat: $("rvExempt").checked ? 0 : numVal($("rvVat")), net: numVal($("rvNet")),
      docType: "", name: "", amount: null, category: currentCat()
    });
    if (meta.category && !catList().includes(meta.category)) {
      state.settings.customCats = [...(state.settings.customCats || []), meta.category].slice(-20);
      state.store.saveSettings({ customCats: state.settings.customCats }).catch(() => {});
    }
    if (meta.net == null && meta.total != null && meta.vat != null) meta.net = r2(meta.total - meta.vat);
    if (!meta.supplier) return fieldError("rvSupplier", "חסר שם ספק");
    if (!date) return fieldError("rvDateI", "חסר תאריך");
    if (meta.total == null) return fieldError("rvTotal", "חסר סכום כולל");
  } else {
    Object.assign(meta, { docType: currentDocType(), name: $("rvName").value.trim(), amount: numVal($("rvAmount")), supplier: "", invoiceNumber: "", total: null, vat: null, net: null, exempt: false });
    if (!meta.docType) return fieldError($("rvDocTypeSel").value === OTHER ? "rvDocType" : "rvDocTypeSel", "חסר סוג מסמך");
    if (!docTypeList().includes(meta.docType)) {
      const custom = [...(state.settings.customDocTypes || []), meta.docType].slice(-30);
      state.settings.customDocTypes = custom;
      state.store.saveSettings({ customDocTypes: custom }).catch(() => {});
    }
    if (!date) return fieldError("rvDateO", "חסר תאריך");
  }
  if (fx.on) {
    const orig = numVal($("rvFxOrig")), rate = numVal4($("rvFxRate"));
    if (orig == null || !rate) return fieldError(orig == null ? "rvFxOrig" : "rvFxRate", "חסר סכום במקור או שער");
    Object.assign(meta, { currency: $("rvFxCur").value, origAmount: orig, fxRate: rate, fxDate: fx.date || date });
  } else Object.assign(meta, { currency: "ILS", origAmount: null, fxRate: null, fxDate: "" });
  if (up.dupFound && !(await confirmBox("נראה שהחשבונית הזו כבר שמורה במערכת (אותו מספר ואותו סכום). לשמור בכל זאת?", "שמור בכל זאת", false))) return;

  const btn = $("rvSave"); btn.disabled = true; btn.textContent = "שומר…";
  try {
    noteSupplier(meta);
    if (up.edit) {
      await state.store.updateDoc(up.edit.id, meta);
      toast("הפרטים עודכנו");
    } else {
      meta.thumb = await makeThumb(up.pages[0]);
      await state.store.addDoc(meta, up.pages);
      refreshUsage();
      toast(`נשמר בתיקיית ${monthName(month)}${meta.late ? " (באיחור)" : ""}`);
    }
    state.month = month;
    if (state.view !== kind && !up.queue.length) setView(kind); else loadRows();
    if (up.inboxIds) { await state.store.deleteInbox(up.inboxIds).catch((e) => console.warn(e)); up.inboxIds = null; refreshInbox(); }
    if (up.queue.length) return nextInQueue();
    if (up.inboxQueue.length) return processInboxGroup(up.inboxQueue.shift());
    $("uploadDlg").close();
  } catch (err) {
    console.error(err);
    toast("השמירה נכשלה. בדקי חיבור ונסי שוב.", 4000);
  } finally { btn.disabled = false; btn.textContent = "אישור ושמירה"; }
});
function fieldError(id, msg) { toast(msg); $(id).focus(); }
function nextInQueue() {
  const f = up.queue.shift();
  up.pages = []; up.edit = null; up.dupFound = null;
  $("upTitle").textContent = `מסמך חדש (נשארו ${up.queue.length + 1})`;
  showStep("upCollect");
  addFiles([f], true);
}

/* ======================= ממתינים לאישור (מהאייפון) ======================= */
let inboxGroups = [];
async function refreshInbox() {
  let items = [];
  try { items = await state.store.listInbox(); } catch (e) { console.warn("inbox", e); }
  const map = new Map();
  for (const it of items) {
    // הקיצור באייפון שומר את הזמן ומספר העמוד בשם המסמך: <group>_<i>
    const [idG, idI] = String(it.id).split("_");
    if (it.i == null && idI) it.i = Number(idI);
    const g = it.group || (idI ? idG : it.id);
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(it);
  }
  inboxGroups = [...map.entries()].map(([group, arr]) => ({ group, items: arr.sort((a, b) => (Number(a.i) || 0) - (Number(b.i) || 0)) }))
    .sort((a, b) => String(a.group).localeCompare(String(b.group)));
  const n = inboxGroups.length, b = $("inboxBanner");
  b.hidden = !n;
  b.textContent = n === 1 ? "📥 מסמך אחד ממתין לאישור · לטיפול" : `📥 ${n} מסמכים ממתינים לאישור · לטיפול`;
  if ($("inboxDlg").open) renderInbox();
}
function groupLabel(g) {
  const m = String(g).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? `נשלח ${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "נשלח מהאייפון";
}
function renderInbox() {
  $("inboxAll").hidden = inboxGroups.length < 2;
  $("inboxList").innerHTML = inboxGroups.length ? inboxGroups.map((g, i) => `<li>
      <img src="${g.items[0]?.data || ""}" alt="">
      <div><b>${esc(groupLabel(g.group))}</b><div class="hint">${g.items.length > 1 ? `${g.items.length} דפים` : "דף אחד"}</div></div>
      <div class="ib-actions"><button class="btn btn-primary btn-sm" data-ib-open="${i}">טיפול</button><button class="btn btn-danger btn-sm" data-ib-del="${i}">מחיקה</button></div>
    </li>`).join("") : `<li class="hint" style="display:block">אין מסמכים ממתינים.</li>`;
}
$("inboxBanner").onclick = () => { renderInbox(); $("inboxDlg").showModal(); };
$("inboxList").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-ib-open]"), d = e.target.closest("[data-ib-del]");
  if (o) { $("inboxDlg").close(); up.inboxQueue = []; processInboxGroup(inboxGroups[Number(o.dataset.ibOpen)]); }
  if (d) {
    const g = inboxGroups[Number(d.dataset.ibDel)];
    if (!(await confirmBox("למחוק את המסמך הזה מהרשימה, בלי לשמור אותו?", "מחק"))) return;
    await state.store.deleteInbox(g.items.map((x) => x.id)); refreshInbox();
  }
});
$("inboxAll").onclick = () => {
  const [first, ...rest] = inboxGroups; if (!first) return;
  $("inboxDlg").close(); up.inboxQueue = rest; processInboxGroup(first);
};
async function processInboxGroup(g) {
  if (!g) return;
  const queue = up.inboxQueue;
  openUpload({ inboxIds: g.items.map((x) => x.id) });
  up.inboxQueue = queue;
  $("upTitle").textContent = up.inboxQueue.length ? `ממתין לאישור (נשארו ${up.inboxQueue.length + 1})` : "ממתין לאישור";
  $("upStart").hidden = true; $("upBusy").hidden = false; $("upBusyText").textContent = "מכין את המסמך…";
  // דחיסה אחידה כמו בהעלאה רגילה
  up.pages = [];
  for (const it of g.items) {
    try { const im = await loadImage(it.data); up.pages.push(compressCanvasSource(im, im.naturalWidth, im.naturalHeight)); }
    catch (e) { console.warn(e); }
  }
  if (!up.pages.length) { toast("לא הצלחתי לקרוא את המסמך", 4000); $("uploadDlg").close(); return; }
  runRecognition();
}

/* ======================= דוחות ======================= */
let reportsReady = false;
function initReports() {
  if (!reportsReady) {
    reportsReady = true;
    $("rMonth").value = state.month; $("rMonthFrom").value = shiftMonth(state.month, -1); $("rMonthTo").value = state.month;
    const [a, b] = monthBounds(state.month); $("rFrom").value = a; $("rTo").value = b;
    document.querySelectorAll('input[name="rBy"]').forEach((r) => r.addEventListener("change", () => {
      const by = document.querySelector('input[name="rBy"]:checked').value;
      $("rMonthBox").hidden = by !== "month"; $("rMonthsBox").hidden = by !== "months";
      $("rRangeBox").hidden = by !== "range"; $("rRangeHint").hidden = by !== "range";
    }));
    $("rRun").onclick = () => runReport(readReportForm());
    $("rShare").onclick = () => shareFiles(state.lastFiles, state.lastTitle);
    $("rDownloadAll").onclick = async () => { for (const f of state.lastFiles) { downloadBlob(f.blob, f.name); await new Promise((r) => setTimeout(r, 400)); } };
    $("rFiles").addEventListener("click", (e) => { const b = e.target.closest("[data-dl]"); if (b) { const f = state.lastFiles[Number(b.dataset.dl)]; downloadBlob(f.blob, f.name); } });
  }
}
const KINDS = ["invoice", "other"];
function readReportForm() {
  return {
    kinds: KINDS.filter((k) => $(k === "invoice" ? "rKindInv" : "rKindOther").checked),
    by: document.querySelector('input[name="rBy"]:checked').value,
    month: $("rMonth").value, from: $("rFrom").value, to: $("rTo").value,
    monthFrom: $("rMonthFrom").value, monthTo: $("rMonthTo").value,
    outputs: ["combined", "table", "docs", "excel"].filter((k) => $({ combined: "oCombined", table: "oTable", docs: "oDocs", excel: "oExcel" }[k]).checked)
  };
}
const kindsOf = (h) => h.kinds || (h.kind ? [h.kind] : KINDS);
const sortRows = (rows) => rows.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0));

async function runReport(p) {
  p = { ...p, kinds: kindsOf(p) };
  if (!p.kinds.length) return toast("סמני חשבוניות, ניירת אחרת או את שניהם");
  if (!p.outputs.length) return toast("בחרי לפחות קובץ אחד להפקה");
  let rows, period, tag;
  if (p.by === "month") {
    if (!p.month) return toast("בחרי חודש");
    rows = await state.store.listByMonth(p.month); period = `תיקיית ${monthName(p.month)}`; tag = p.month;
  } else if (p.by === "months") {
    if (!p.monthFrom || !p.monthTo) return toast("בחרי חודש התחלה וחודש סיום");
    if (p.monthFrom > p.monthTo) return toast("חודש ההתחלה אחרי חודש הסיום");
    const months = [];
    for (let m = p.monthFrom; m <= p.monthTo && months.length < 36; m = shiftMonth(m, 1)) months.push(m);
    rows = (await Promise.all(months.map((m) => state.store.listByMonth(m)))).flat();
    period = months.length === 1 ? `תיקיית ${monthName(months[0])}` : `תיקיות ${shortMonth(p.monthFrom)} עד ${shortMonth(p.monthTo)}`;
    tag = months.length === 1 ? p.monthFrom : `${p.monthFrom}_${p.monthTo}`;
  } else {
    if (!p.from || !p.to) return toast("בחרי טווח תאריכים");
    if (p.from > p.to) return toast("תאריך ההתחלה אחרי תאריך הסיום");
    rows = await state.store.listByRange(p.from, p.to); period = `${fmtDate(p.from)} עד ${fmtDate(p.to)}`; tag = `${p.from}_${p.to}`;
  }
  const sections = p.kinds.map((kind) => ({ kind, rows: sortRows(rows.filter((r) => r.kind === kind)) }));
  const withRows = sections.filter((s) => s.rows.length);
  if (!withRows.length) { $("rResult").hidden = true; return toast("אין מסמכים בטווח הזה"); }
  const empty = sections.filter((s) => !s.rows.length).map((s) => KIND_LABEL[s.kind]);
  const ok = await generate(withRows, { period, fileTag: tag, outputs: { combined: p.outputs.includes("combined"), table: p.outputs.includes("table"), docs: p.outputs.includes("docs"), excel: p.outputs.includes("excel") }, note: empty.length ? `אין ${empty.join(" ו")} בטווח הזה.` : "" });
  if (ok && (p.by === "month" || p.by === "months")) {
    const cur = ymOf(new Date());
    const ms = p.by === "month" ? [p.month] : (() => { const a = []; for (let m = p.monthFrom; m <= p.monthTo && a.length < 36; m = shiftMonth(m, 1)) a.push(m); return a; })();
    const open = ms.filter((m) => m < cur && !isClosed(m));
    if (open.length && await confirmBox(`לסמן את ${open.map(monthName).join(", ")} כנשלח לרואה החשבון? מסמכים שיגיעו אחר כך מהתקופה הזו ייכנסו לחודש הנוכחי עם סימון "באיחור".${missingText(open)}`, "כן, סמן כנשלח", false)) {
      await setClosed(open, true); toast("סומן כנשלח לרואה החשבון");
    }
  }

}

// sections: [{kind, rows}]
async function generate(sections, { period, fileTag, outputs, note = "" }) {
  const btn = $("rRun"); btn.disabled = true;
  const bizName = state.settings.businessName || "";
  const stamp = `הופק ${fmtDate(localIso(new Date())).replace(/\//g, "-")}`;
  const files = [];
  $("rResult").hidden = false; $("rResultInfo").textContent = "מפיק קבצים…"; $("rFiles").innerHTML = "";
  const summary = categorySummary(sections, (r) => catMemory(r.supplier));
  try {
    let first = true;
    for (const { kind, rows } of sections) {
      const label = KIND_LABEL[kind];
      const meta = { title: label, subtitle: period, bizName, summary: first ? summary : null };
      first = false;
      const base = safeName(`${label} ${fileTag}`);
      if (outputs.combined) {
        files.push({ name: `${base} - טבלה ו${kind === "invoice" ? "חשבוניות" : "מסמכים"} (${stamp}).pdf`, label: `${label}: טבלה + כל המסמכים בקובץ אחד`, blob: await buildCombinedPdf(rows, kind, meta, (id) => state.store.getPages(id), (i, n) => { btn.textContent = `${label}: מסמך ${i} מתוך ${n}…`; $("rResultInfo").textContent = `${label}: מכין מסמך ${i} מתוך ${n}…`; }) });
      }
      if (outputs.table) { btn.textContent = `מפיק טבלת ${label}…`; files.push({ name: `${base} - טבלה (${stamp}).pdf`, blob: await buildTablePdf(rows, kind, meta), label: `טבלת ${label} ב-PDF` }); }
      if (outputs.docs) {
        files.push({ name: `${base} - מסמכים (${stamp}).pdf`, label: `${label}: כל המסמכים ב-PDF`, blob: await buildDocsPdf(rows, kind, (id) => state.store.getPages(id), (i, n) => { btn.textContent = `${label}: מסמך ${i} מתוך ${n}…`; $("rResultInfo").textContent = `${label}: מכין מסמך ${i} מתוך ${n}…`; }) });
      }
    }
    if (outputs.excel) {
      btn.textContent = "מפיק אקסל…";
      const lbl = sections.map((s) => KIND_LABEL[s.kind]).join(" + ");
      files.push({ name: safeName(`${sections.length > 1 ? "ניירת לרואה חשבון" : lbl} ${fileTag} (${stamp}).xlsx`), blob: await buildExcel(sections, { subtitle: period, bizName, summary }), label: sections.length > 1 ? "אקסל עם גיליון לכל סוג וסיכום קטגוריות" : "טבלה באקסל + סיכום קטגוריות" });
    }
  } catch (e) {
    console.error(e); toast("ההפקה נכשלה: " + (e.message || e), 5000);
    $("rResultInfo").textContent = "ההפקה נכשלה. נסי שוב."; btn.disabled = false; btn.textContent = "הפק קבצים"; return false;
  }
  btn.disabled = false; btn.textContent = "הפק קבצים";
  state.lastFiles = files;
  state.lastTitle = `${sections.map((s) => KIND_LABEL[s.kind]).join(" + ")} · ${period} · ${bizName}`;
  const parts = sections.map((s) => {
    const total = s.kind === "invoice" ? sumOf(s.rows, "total") : sumOf(s.rows, "amount");
    return `${KIND_LABEL[s.kind]}: ${s.rows.length} מסמכים${total ? `, סה"כ ₪${fmtMoney(total)}` : ""}`;
  });
  const top = summary.list.slice(0, 4).map((x) => `${x.cat} ₪${fmtMoney(x.total)}`).join(" · ");
  $("rResultInfo").textContent = `${period} · ${parts.join(" · ")}.${top ? ` לפי קטגוריות: ${top}${summary.list.length > 4 ? " ועוד" : ""}.` : ""} המספור בכל קובץ מסמכים תואם לשורות בטבלה שלו. ${note}`.trim();
  $("rFiles").innerHTML = files.map((f, i) => `<li><div><div class="fname">${esc(f.name)}</div><div class="fsize">${f.label} · ${fmtSize(f.blob.size)}</div></div><button class="btn btn-ghost btn-sm" data-dl="${i}">הורדה</button></li>`).join("");
  $("rResult").scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/* ======================= שליחה ======================= */
async function shareFiles(files, title) {
  if (!files?.length) return;
  if (await tryShare(files, title)) return;
  $("shTo").value = state.settings.recentEmails?.[0] || "";
  $("shSubject").value = title;
  $("recentEmails").innerHTML = (state.settings.recentEmails || []).map((m) => `<option value="${esc(m)}">`).join("");
  $("shGo").onclick = async () => {
    const to = $("shTo").value.trim();
    for (const f of files) { downloadBlob(f.blob, f.name); await new Promise((r) => setTimeout(r, 400)); }
    if (to) {
      const list = [to, ...(state.settings.recentEmails || []).filter((m) => m !== to)].slice(0, 6);
      state.settings.recentEmails = list; state.store.saveSettings({ recentEmails: list }).catch(() => {});
    }
    const body = `שלום,\n\nמצורפים הקבצים:\n${files.map((f) => "• " + f.name).join("\n")}\n\nבברכה,\n${state.settings.businessName || ""}`;
    location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent($("shSubject").value)}&body=${encodeURIComponent(body)}`;
    $("shareDlg").close();
    toast("הקבצים ירדו. צרפי אותם למייל שנפתח.", 5000);
  };
  $("shareDlg").showModal();
}

/* ======================= הגדרות ======================= */
// מד אחסון: 1GB חינם. אזהרה מ-80%, התראה חמורה מ-95%
async function refreshUsage() {
  let u;
  try { u = await state.store.getUsage(); } catch (e) { console.warn(e); $("usageText").textContent = "לא הצלחתי לבדוק כרגע"; return; }
  const pct = Math.min(100, (u.bytes / FREE_BYTES) * 100);
  const mb = (b) => "\u2066" + mb0(b) + "\u2069";
  const mb0 = (b) => b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + " GB" : b >= 1024 ** 2 ? Math.round(b / 1024 ** 2) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  // עד שיש מספיק מסמכים, מניחים בזהירות כ-250KB למסמך
  const avg = u.docs >= 20 ? u.bytes / u.docs : Math.max(u.docs ? u.bytes / u.docs : 0, 250 * 1024);
  const left = Math.max(0, Math.floor((FREE_BYTES - u.bytes) / avg));
  const fill = $("usageFill");
  fill.style.width = Math.max(pct, 1) + "%";
  fill.classList.toggle("is-warn", pct >= 80 && pct < 95);
  fill.classList.toggle("is-full", pct >= 95);
  $("usageText").textContent = `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% בשימוש · ${mb(u.bytes)} מתוך \u20661 GB\u2069`;
  $("usageSub").textContent = `${u.docs} מסמכים שמורים · מקום לעוד כ-${left.toLocaleString("he-IL")} מסמכים`;
  const warn = pct >= 95 ? `האחסון כמעט מלא (${Math.round(pct)}%). כדי להמשיך להעלות: להוריד שנים ישנות כקובץ משולב לגיבוי ולמחוק אותן, או לעבור למסלול Blaze ב-Firebase (בערך חצי שקל לחודש לכל GB נוסף).`
    : pct >= 80 ? `האחסון מתמלא (${Math.round(pct)}%). כדאי לתכנן מראש: גיבוי ומחיקה של שנים ישנות, או מעבר למסלול Blaze ב-Firebase.` : "";
  $("usageWarn").hidden = !warn; $("usageWarn").textContent = warn;
  const banner = $("usageBanner");
  banner.hidden = pct < 80;
  banner.textContent = pct >= 95 ? `האחסון כמעט מלא (${Math.round(pct)}%) · לפרטים` : `האחסון מתמלא (${Math.round(pct)}%) · לפרטים`;
}
// ===== פינוי מקום: גיבוי ואז מחיקה =====
const cl = { rows: [], backedUp: false, key: "" };
function clMonths() {
  const a = $("clFrom").value, b = $("clTo").value;
  if (!a || !b) { toast("בחרי חודש התחלה וחודש סיום"); return null; }
  if (a > b) { toast("חודש ההתחלה אחרי חודש הסיום"); return null; }
  const out = []; for (let m = a; m <= b && out.length < 120; m = shiftMonth(m, 1)) out.push(m);
  return out;
}
function clReset() { cl.rows = []; cl.backedUp = false; $("clResult").hidden = true; $("clDelete").disabled = true; $("clBackupState").textContent = ""; }
$("clFrom").addEventListener("change", clReset); $("clTo").addEventListener("change", clReset);
$("clCheck").onclick = async () => {
  const months = clMonths(); if (!months) return;
  clReset();
  const btn = $("clCheck"); btn.disabled = true; btn.textContent = "בודק…";
  try { cl.rows = sortRows((await Promise.all(months.map((m) => state.store.listByMonth(m)))).flat()); }
  finally { btn.disabled = false; btn.textContent = "בדיקה: כמה זה יפנה?"; }
  cl.key = `${months[0]}_${months[months.length - 1]}`;
  $("clResult").hidden = false;
  if (!cl.rows.length) { $("clInfo").textContent = "אין מסמכים בתקופה הזו."; $("clBackup").disabled = true; return; }
  $("clBackup").disabled = false;
  const bytes = cl.rows.reduce((n, r) => n + (r.sizeBytes || (r.pageCount || 1) * 250 * 1024), 0);
  const inv = cl.rows.filter((r) => r.kind === "invoice").length;
  const size = bytes >= 1024 ** 2 ? Math.round(bytes / 1024 ** 2) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  $("clInfo").textContent = `תיקיות ${shortMonth(months[0])} עד ${shortMonth(months[months.length - 1])}: ${cl.rows.length} מסמכים (${inv} חשבוניות, ${cl.rows.length - inv} ניירת אחרת). המחיקה תפנה בערך \u2066${size}\u2069 (${Math.round(bytes / FREE_BYTES * 1000) / 10}% מהאחסון).`;
};
$("clBackup").onclick = async () => {
  if (!cl.rows.length) return;
  const btn = $("clBackup"); btn.disabled = true;
  const bizName = state.settings.businessName || "";
  const period = `גיבוי תיקיות ${cl.key.replace("_", " עד ")}`;
  const files = [];
  try {
    const sections = ["invoice", "other"].map((kind) => ({ kind, rows: cl.rows.filter((r) => r.kind === kind) })).filter((x) => x.rows.length);
    for (const { kind, rows } of sections) {
      const label = KIND_LABEL[kind];
      files.push({ name: safeName(`גיבוי ${label} ${cl.key}.pdf`), blob: await buildCombinedPdf(rows, kind, { title: label, subtitle: period, bizName }, (id) => state.store.getPages(id), (i, n) => (btn.textContent = `${label}: ${i} מתוך ${n}…`)) });
    }
    btn.textContent = "מכין אקסל…";
    files.push({ name: safeName(`גיבוי ${cl.key}.xlsx`), blob: await buildExcel(sections, { subtitle: period, bizName }) });
    for (const f of files) { downloadBlob(f.blob, f.name); await new Promise((r) => setTimeout(r, 500)); }
    cl.backedUp = true;
    $("clDelete").disabled = false;
    $("clBackupState").textContent = `✓ ירדו ${files.length} קבצים לתיקיית ההורדות. לפני המחיקה, פתחי אותם ובדקי שהם תקינים.`;
  } catch (e) {
    console.error(e); toast("הגיבוי נכשל: " + (e.message || e), 5000);
  } finally { btn.disabled = false; btn.textContent = "1. הורדת גיבוי"; }
};
$("clDelete").onclick = async () => {
  if (!cl.backedUp || !cl.rows.length) return;
  if (!(await confirmBox(`האם בדקת שקבצי הגיבוי ירדו ונפתחים?`, "כן, בדקתי", false))) return;
  if (!(await confirmBox(`למחוק לצמיתות ${cl.rows.length} מסמכים מתיקיות ${cl.key.replace("_", " עד ")}? אי אפשר לשחזר אותם מהמערכת, רק מהגיבוי.`, "מחק לצמיתות"))) return;
  const p = $("clProgress"); p.hidden = false; $("clDelete").disabled = true;
  const done = await deleteMany(cl.rows, (i, n) => (p.textContent = `מוחק ${i} מתוך ${n}…`));
  p.textContent = done === cl.rows.length ? `נמחקו ${done} מסמכים. המקום התפנה.` : `נמחקו ${done} מתוך ${cl.rows.length}. אפשר ללחוץ שוב "בדיקה" ולהמשיך.`;
  cl.rows = []; cl.backedUp = false;
  refreshUsage();
};
$("usageBanner").onclick = () => setView("settings");

function fillSettings() {
  if (!$("clFrom").value) { const y = Number(state.month.slice(0, 4)) - 2; $("clFrom").value = `${y}-01`; $("clTo").value = `${y}-12`; }
  const s = state.settings;
  $("sBizName").value = s.businessName || ""; $("sVat").value = s.vatRate ?? 18;
  $("sGeminiKey").value = s.geminiKey || ""; $("sGeminiModel").value = s.geminiModel || "";
  renderClosed();
}
function renderClosed() {
  const st = state.settings;
  const items = [];
  if (st.autoClosedThrough) items.push(`<li class="chip-auto">נסגרו אוטומטית: כל החודשים עד ${esc(monthName(st.autoClosedThrough))}</li>`);
  const manual = (st.closedMonths || []).filter((m) => !st.autoClosedThrough || m > st.autoClosedThrough);
  manual.slice().reverse().forEach((m) => items.push(`<li>${esc(monthName(m))}<button type="button" data-open-month="${m}">פתח</button></li>`));
  (st.reopenedMonths || []).slice().reverse().forEach((m) => items.push(`<li class="chip-open">${esc(monthName(m))} (נפתח מחדש)<button type="button" data-close-month="${m}">סגור</button></li>`));
  $("sClosed").innerHTML = items.join("") || `<li class="hint" style="background:none;padding:0">אין חודשים סגורים.</li>`;
  $("sWarnDay").value = warnDay(); $("sAutoDay").value = autoCloseDay();
}
$("sClosed").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open-month]"), c = e.target.closest("[data-close-month]");
  if (!o && !c) return;
  await setClosed(o ? o.dataset.openMonth : c.dataset.closeMonth, !o);
  renderClosed(); toast(o ? "החודש נפתח מחדש" : "החודש נסגר");
});
$("sSave").onclick = async () => {
  const wd = Math.round(Number($("sWarnDay").value)), ad = Math.round(Number($("sAutoDay").value));
  if (!(wd >= 1 && wd <= 28 && ad >= 2 && ad <= 28 && wd < ad)) { toast("יום ההתראה צריך להיות לפני יום הסגירה האוטומטית (ימים 1 עד 28)", 4000); return; }
  const patch = { businessName: $("sBizName").value.trim(), vatRate: Number($("sVat").value) || 18, geminiKey: $("sGeminiKey").value.trim(), geminiModel: $("sGeminiModel").value.trim() || "gemini-flash-latest", warnDay: wd, autoCloseDay: ad };
  try { await state.store.saveSettings(patch); Object.assign(state.settings, patch); $("bizName").textContent = patch.businessName; toast("ההגדרות נשמרו"); }
  catch (e) { console.error(e); toast("השמירה נכשלה", 4000); }
};
$("sLogout").onclick = () => state.store.signOut();

boot();
