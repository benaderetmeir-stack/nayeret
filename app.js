// ניירת INBAR — לוגיקת האפליקציה
import { FirebaseStore, DemoStore } from "./store.js";
import { fileToPages, makeThumb, isPdf } from "./images.js";
import { recognize } from "./ocr.js";
import { COLS, KIND_LABEL, fmtMoney, fmtDate, sumOf, cellText, buildTablePdf, buildDocsPdf, buildCombinedPdf, buildExcel, downloadBlob, tryShare, fmtSize, localIso } from "./reports.js";

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
const isClosed = (ym) => (state.settings?.closedMonths || []).includes(ym);
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
    const { seedDemo } = await import("./demo.js");
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
  setView(location.hash.replace("#", "") || "invoice");
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
  if (v === "settings") fillSettings();
}

/* ======================= טבלאות ======================= */
$("monthPrev").onclick = () => { state.month = shiftMonth(state.month, -1); loadRows(); };
$("monthNext").onclick = () => { state.month = shiftMonth(state.month, 1); loadRows(); };
$("monthLabel").onclick = () => { const p = $("monthPicker"); p.value = state.month; p.showPicker ? p.showPicker() : p.click(); };
$("monthPicker").onchange = (e) => { if (e.target.value) { state.month = e.target.value; loadRows(); } };

$("closeMonthBtn").onclick = async () => {
  const m = state.month, closed = isClosed(m);
  const ok = await confirmBox(closed
    ? `לפתוח מחדש את ${monthName(m)}? מסמכים חדשים מהחודש הזה ייכנסו אליו ולא לחודש הנוכחי.`
    : `לסגור את ${monthName(m)} כנשלח לרואה החשבון? מסמך שיגיע מעכשיו עם תאריך מהחודש הזה ייכנס לחודש הפתוח הנוכחי, עם סימון איחור.`,
    closed ? "פתח מחדש" : "סגור חודש", false);
  if (!ok) return;
  const list = new Set(state.settings.closedMonths || []);
  closed ? list.delete(m) : list.add(m);
  state.settings.closedMonths = [...list].sort();
  await state.store.saveSettings({ closedMonths: state.settings.closedMonths });
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
}

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
        rows = rows.filter((r) => [r.supplier, r.name, r.invoiceNumber, r.docType, r.note].some((v) => String(v || "").toLowerCase().includes(q)));
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
      if (c.key === "note") return `<td class="note-cell">${r.late ? `<span class="pill pill-late">באיחור מ-${shortMonth(r.origMonth)}</span> ` : ""}${esc(r.note)}</td>`;
      if (c.key === "supplier" || c.key === "name") return `<td class="name-cell">${esc(r[c.key])}</td>`;
      return `<td class="${c.money ? "num" : ""}${c.strong ? " total-cell" : ""}">${esc(cellText(r, c.key))}</td>`;
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
      <div class="card-amt">${amountOf(r) != null ? "₪" + fmtMoney(amountOf(r)) : ""}${kind === "invoice" ? `<small>מע"מ ${fmtMoney(r.vat)}</small>` : ""}
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
    row.note ? `<span>הערה: <b>${esc(row.note)}</b></span>` : ""
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
const up = { pages: [], queue: [], edit: null, pendingFiles: null, manualMonth: false, dupTimer: 0, dupFound: null, pageIdx: 0 };

$("fab").onclick = () => openUpload();
function showStep(id) { ["upCollect", "upMulti", "upReview"].forEach((s) => ($(s).hidden = s !== id)); }
function openUpload(opts = {}) {
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
    setIfEmpty($("rvDocType"), src.kind === "other" ? src.docType : "");
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
  $("rvDocType").value = d.docType && d.kind === "other" ? d.docType : "";
  $("rvName").value = d.name || ""; $("rvAmount").value = d.amount ?? "";
  $("rvNote").value = d.note || "";
  applyExempt();
  if (up.edit) { $("rvMonth").value = d.month; updateMonthHint(); }
  else syncDate();
  $("rvDup").hidden = true; up.dupFound = null;
  checkDup();
  setTimeout(() => (d.supplier ? $("rvSave") : (curKind() === "invoice" ? $("rvSupplier") : $("rvDocType"))).focus({ preventScroll: true }), 60);
}
function renderReviewImg() {
  $("rvImg").src = up.pages[up.pageIdx] || "";
  $("rvImgFrame").hidden = !up.pages.length;
  $("rvImgNav").innerHTML = up.pages.length > 1 ? up.pages.map((_, i) => `<button type="button" data-pi="${i}" class="${i === up.pageIdx ? "is-active" : ""}">דף ${i + 1}</button>`).join("") : "";
}
$("rvImgNav").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (b) { up.pageIdx = Number(b.dataset.pi); renderReviewImg(); } });
$("rvImg").addEventListener("click", () => $("rvImg").classList.toggle("zoomed"));

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
  if (up.queue.length && !(await confirmBox(`לבטל גם את ${up.queue.length} הקבצים שנשארו בתור?`, "בטל הכול"))) { return nextInQueue(); }
  $("uploadDlg").close();
};

$("upReview").addEventListener("submit", async (e) => {
  e.preventDefault();
  const kind = curKind();
  const date = dateEl().value;
  const month = $("rvMonth").value || (date ? date.slice(0, 7) : ymOf(new Date()));
  const origMonth = date ? date.slice(0, 7) : month;
  const meta = { kind, date, month, origMonth, late: origMonth !== month && isClosed(origMonth), note: $("rvNote").value.trim() };
  if (kind === "invoice") {
    Object.assign(meta, {
      supplier: $("rvSupplier").value.trim(), invoiceNumber: $("rvInvNo").value.trim(), exempt: $("rvExempt").checked,
      total: numVal($("rvTotal")), vat: $("rvExempt").checked ? 0 : numVal($("rvVat")), net: numVal($("rvNet")),
      docType: "", name: "", amount: null
    });
    if (meta.net == null && meta.total != null && meta.vat != null) meta.net = r2(meta.total - meta.vat);
    if (!meta.supplier) return fieldError("rvSupplier", "חסר שם ספק");
    if (!date) return fieldError("rvDateI", "חסר תאריך");
    if (meta.total == null) return fieldError("rvTotal", "חסר סכום כולל");
  } else {
    Object.assign(meta, { docType: $("rvDocType").value.trim(), name: $("rvName").value.trim(), amount: numVal($("rvAmount")), supplier: "", invoiceNumber: "", total: null, vat: null, net: null, exempt: false });
    if (!meta.docType) return fieldError("rvDocType", "חסר סוג מסמך");
    if (!date) return fieldError("rvDateO", "חסר תאריך");
  }
  if (up.dupFound && !(await confirmBox("נראה שהחשבונית הזו כבר שמורה במערכת (אותו מספר ואותו סכום). לשמור בכל זאת?", "שמור בכל זאת", false))) return;

  const btn = $("rvSave"); btn.disabled = true; btn.textContent = "שומר…";
  try {
    if (up.edit) {
      await state.store.updateDoc(up.edit.id, meta);
      toast("הפרטים עודכנו");
    } else {
      meta.thumb = await makeThumb(up.pages[0]);
      await state.store.addDoc(meta, up.pages);
      toast(`נשמר בתיקיית ${monthName(month)}${meta.late ? " (באיחור)" : ""}`);
    }
    state.month = month;
    if (state.view !== kind && !up.queue.length) setView(kind); else loadRows();
    if (up.queue.length) return nextInQueue();
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
  await generate(withRows, { period, fileTag: tag, outputs: { combined: p.outputs.includes("combined"), table: p.outputs.includes("table"), docs: p.outputs.includes("docs"), excel: p.outputs.includes("excel") }, note: empty.length ? `אין ${empty.join(" ו")} בטווח הזה.` : "" });

}

// sections: [{kind, rows}]
async function generate(sections, { period, fileTag, outputs, note = "" }) {
  const btn = $("rRun"); btn.disabled = true;
  const bizName = state.settings.businessName || "";
  const stamp = `הופק ${fmtDate(localIso(new Date())).replace(/\//g, "-")}`;
  const files = [];
  $("rResult").hidden = false; $("rResultInfo").textContent = "מפיק קבצים…"; $("rFiles").innerHTML = "";
  try {
    for (const { kind, rows } of sections) {
      const label = KIND_LABEL[kind];
      const meta = { title: label, subtitle: period, bizName };
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
      files.push({ name: safeName(`${sections.length > 1 ? "ניירת לרואה חשבון" : lbl} ${fileTag} (${stamp}).xlsx`), blob: await buildExcel(sections, { subtitle: period, bizName }), label: sections.length > 1 ? "אקסל עם גיליון לכל סוג" : "טבלה באקסל" });
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
  $("rResultInfo").textContent = `${period} · ${parts.join(" · ")}. המספור בכל קובץ מסמכים תואם לשורות בטבלה שלו. ${note}`.trim();
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
function fillSettings() {
  const s = state.settings;
  $("sBizName").value = s.businessName || ""; $("sVat").value = s.vatRate ?? 18;
  $("sGeminiKey").value = s.geminiKey || ""; $("sGeminiModel").value = s.geminiModel || "";
  renderClosed();
}
function renderClosed() {
  const list = state.settings.closedMonths || [];
  $("sClosed").innerHTML = list.length ? list.slice().reverse().map((m) => `<li>${esc(monthName(m))}<button type="button" data-open-month="${m}">פתח</button></li>`).join("") : `<li class="hint" style="background:none;padding:0">אין חודשים סגורים.</li>`;
}
$("sClosed").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-open-month]"); if (!b) return;
  state.settings.closedMonths = state.settings.closedMonths.filter((m) => m !== b.dataset.openMonth);
  await state.store.saveSettings({ closedMonths: state.settings.closedMonths });
  renderClosed(); toast("החודש נפתח מחדש");
});
$("sSave").onclick = async () => {
  const patch = { businessName: $("sBizName").value.trim(), vatRate: Number($("sVat").value) || 18, geminiKey: $("sGeminiKey").value.trim(), geminiModel: $("sGeminiModel").value.trim() || "gemini-flash-latest" };
  try { await state.store.saveSettings(patch); Object.assign(state.settings, patch); $("bizName").textContent = patch.businessName; toast("ההגדרות נשמרו"); }
  catch (e) { console.error(e); toast("השמירה נכשלה", 4000); }
};
$("sLogout").onclick = () => state.store.signOut();

boot();
