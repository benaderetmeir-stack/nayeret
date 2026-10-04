// נתונים לדוגמה למצב תצוגה בלבד. שמות העסקים בדויים.
import { makeThumb } from "./images.js?v=20261004b";

function receipt({ title, sub, lines, total, vat, no, date, exempt, kind }) {
  const W = 620, H = 860;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"); x.direction = "rtl";
  x.fillStyle = "#fbfbf8"; x.fillRect(0, 0, W, H);
  x.fillStyle = "#1d2a30"; x.textAlign = "center";
  x.font = "700 30px Heebo, Arial"; x.fillText(title, W / 2, 70);
  x.font = "400 17px Heebo, Arial"; x.fillText(sub, W / 2, 102);
  x.fillText(kind === "other" ? "" : exempt ? "עוסק פטור 03-1234567" : "ע.מ. 51-4455667", W / 2, 128);
  x.fillStyle = "#cfd8dc"; x.fillRect(40, 150, W - 80, 2);
  x.fillStyle = "#1d2a30"; x.textAlign = "right"; x.font = "700 22px Heebo, Arial";
  x.fillText(no ? `${kind === "other" ? "" : "חשבונית מס קבלה"} ${no}`.trim() : sub, W - 50, 195);
  x.font = "400 18px Heebo, Arial"; const [y, m, d] = date.split("-"); x.fillText(`תאריך: ${d}/${m}/${y}`, W - 50, 228);
  let yy = 290;
  x.font = "400 18px Heebo, Arial";
  for (const [t, v] of lines) { x.textAlign = "right"; x.fillText(t, W - 50, yy); x.textAlign = "left"; x.fillText(v, 50, yy); yy += 36; }
  x.fillStyle = "#cfd8dc"; x.fillRect(40, yy, W - 80, 2); yy += 40;
  x.fillStyle = "#1d2a30";
  if (vat != null) { x.textAlign = "right"; x.fillText(exempt ? "מע\"מ: פטור" : "מע\"מ 18%", W - 50, yy); x.textAlign = "left"; x.fillText(vat.toFixed(2), 50, yy); yy += 36; }
  x.font = "700 24px Heebo, Arial"; x.textAlign = "right"; x.fillText(kind === "other" ? "סכום" : "סה\"כ לתשלום", W - 50, yy); x.textAlign = "left"; x.fillText(total.toFixed(2) + " ₪", 50, yy);
  x.font = "400 15px Heebo, Arial"; x.textAlign = "center"; x.fillStyle = "#789"; x.fillText("מסמך לדוגמה בלבד", W / 2, H - 40);
  return c.toDataURL("image/jpeg", 0.8);
}

export async function seedDemo(store) {
  await document.fonts?.ready;
  const now = new Date(); const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const cur = ym(now);
  const prevD = new Date(now.getFullYear(), now.getMonth() - 1, 15); const prev = ym(prevD);
  const day = (m, d) => `${m}-${String(d).padStart(2, "0")}`;
  const inv = (supplier, no, date, total, opts = {}) => {
    const exempt = !!opts.exempt;
    const vat = exempt ? 0 : Math.round(total / 1.18 * 0.18 * 100) / 100;
    return { kind: "invoice", category: opts.cat || "", supplier, invoiceNumber: no, date, total, vat, net: Math.round((total - vat) * 100) / 100, exempt, docType: "חשבונית מס קבלה", note: opts.note || "", details: opts.details ?? (opts.lines || []).map((l) => l[0]).join(", "), month: opts.month || date.slice(0, 7), origMonth: date.slice(0, 7), late: !!opts.late, lines: opts.lines };
  };
  const items = [
    inv("מאור ציוד אסתטי בע\"מ", "20931", day(cur, 3), 2360, { cat: "חומרים ותכשירים", lines: [["סרום היאלורוני x12", "1,440.00"], ["מסכות אלגינט x20", "560.00"]] }),
    inv("פרחי הדר", "1187", day(cur, 5), 180, { cat: "כיבוד ומשרד", exempt: true, lines: [["זר לקבלה", "180.00"]] }),
    inv("מעבדות גל-טק", "88412", day(cur, 9), 4130, { cat: "ציוד ומכשירים", lines: [["ראש טיפול RF", "3,500.00"]] }),
    inv("דפוס אלון", "5520", day(cur, 12), 590, { cat: "שיווק ופרסום", lines: [["כרטיסי ביקור 500", "500.00"]] }),
    inv("ניקיון ברק שירותים", "3310", day(cur, 15), 1180, { cat: "שכירות ואחזקה", lines: [["ניקיון חודשי", "1,000.00"]] }),
    inv("מאור ציוד אסתטי בע\"מ", "20877", day(prev, 27), 944, { month: cur, late: true, note: "", lines: [["כפפות ניטריל x10", "800.00"]] }),
    inv("מעבדות גל-טק", "88207", day(prev, 4), 1770, { lines: [["תחזוקת מכשיר", "1,500.00"]] }),
    inv("דפוס אלון", "5461", day(prev, 11), 354, { lines: [["עלונים", "300.00"]] }),
    inv("פרחי הדר", "1142", day(prev, 18), 150, { exempt: true, lines: [["זר לקבלה", "150.00"]] }),
    // היסטוריה של ספק חודשי, כדי להדגים "חשבוניות קבועות שחסרות"
    ...[2, 3, 4].map((n) => { const d = new Date(now.getFullYear(), now.getMonth() - n, 16); const m = ym(d); return inv("פלאפון תקשורת בע\"מ", "77" + n, day(m, 16), 129.9, { lines: [["חבילת סלולר", "110.08"]] }); }),
    { kind: "other", docType: "תלוש שכר", name: "עובדת א'", date: day(cur, 1), amount: 7420, note: "", month: cur, origMonth: cur, lines: [["שכר ברוטו", "9,100.00"], ["ניכויים", "1,680.00"]] },
    { kind: "other", docType: "העברת משכורת", name: "עובדת א'", date: day(cur, 9), amount: 7420, note: "", details: "הועבר לעובדת א' סך של ₪7,420 (משכורת)", month: cur, origMonth: cur, lines: [["העברה בנקאית", "7,420.00"]] },
    { kind: "other", docType: "תעודת משלוח", name: "מאור ציוד אסתטי בע\"מ", date: day(cur, 3), amount: null, note: "תואם לחשבונית 20931", month: cur, origMonth: cur, lines: [["סרום היאלורוני", "12 יח'"], ["מסכות אלגינט", "20 יח'"]] },
    { kind: "other", docType: "דף בנק", name: "בנק לדוגמה", date: day(prev, 30), amount: null, note: "", month: prev, origMonth: prev, lines: [["יתרת פתיחה", "—"], ["יתרת סגירה", "—"]] }
  ];
  for (const it of items) {
    const { lines, ...meta } = it;
    const img = receipt({ title: it.kind === "invoice" ? it.supplier : it.docType, sub: it.kind === "invoice" ? "רח' הדוגמה 12, ראשון לציון" : it.name, lines: lines || [], total: it.total ?? it.amount ?? 0, vat: it.kind === "invoice" ? it.vat : null, no: it.invoiceNumber, date: it.date, exempt: it.exempt, kind: it.kind });
    meta.thumb = await makeThumb(img);
    await store.addDoc(meta, [img]);
  }
  // שני מסמכים שממתינים באיבוקס (כאילו נשלחו מהאייפון)
  const g = `${cur.replace("-", "")}${String(now.getDate()).padStart(2, "0")}093000`;
  store.inbox = [
    { id: "in1", group: g, i: 1, total: 1, data: receipt({ title: "קפה גרג", sub: "רח' הדוגמה 3, ראשון לציון", lines: [["ישיבת צוות - קפה ומאפה", "180.00"]], total: 212.4, vat: 32.4, no: "7741", date: day(cur, 20), kind: "invoice" }) },
    { id: "in2", group: g.replace(/093000$/, "101500"), i: 1, total: 1, data: receipt({ title: "תלוש שכר", sub: "עובדת ב'", lines: [["שכר ברוטו", "8,200.00"]], total: 6950, vat: null, no: "", date: day(cur, 1), kind: "other" }) }
  ];
  await store.saveSettings({ closedMonths: [prev], recentEmails: ["office@example-cpa.co.il"] });
  await store.addReport({ kind: "invoice", by: "month", month: prev, from: "", to: "", count: 4, outputs: ["table", "docs", "excel"] });
}
