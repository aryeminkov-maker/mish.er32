// ===== ספרים: קטלוג, חלוקה למוסדות (בתי כנסת), מוסדות, הזמנות מהחנות ו-Jgive =====
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, normEmail, readWorkbook } from "./common.js?v=20261026";
import { todayIso, fmtIso, uid, norm } from "./util.js?v=20261026";

const BS = { tab: "dist", book: "", search: "", missing: false, orderStatus: "open" };
export const ORDER_STATUS = { new: "ממתינה לתשלום", paid: "שולמה", shipped: "נשלחה", cancelled: "בוטלה" };
const ORDER_BADGE = { new: "warn", paid: "good", shipped: "info", cancelled: "" };
const DIST_STATUS = { planned: "מתוכנן", sent: "נשלח", delivered: "התקבל" };
const DIST_BADGE = { planned: "warn", sent: "info", delivered: "good" };
const KINDS = ["בית כנסת", "ישיבה", "כולל", "בית ספר", "מוסד ציבורי", "אחר"];
const shopUrl = () => new URL("shop.html", location.href).href;

const instList = (c) => [...c.S.institutions.values()].sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"));
const distsOf = (c, f = {}) => [...c.S.dists.values()].filter((d) => (!f.book || d.book === f.book) && (!f.inst || d.institutionId === f.inst))
  .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
const qtyOf = (list) => list.reduce((a, d) => a + (Number(d.qty) || 0), 0);
const catalog = (c) => c.S.bookItems || [];

export function renderBooks(c, full) {
  if (!full && document.querySelector("#bBody[data-editing]")) return;
  const tabs = [["dist", "חלוקה למוסדות"], ["inst", "מוסדות"], ["orders", "הזמנות מהחנות"], ["catalog", "קטלוג וחנות"], ...(c.can("admin") ? [["jgive", "Jgive"]] : [])];
  const newOrders = [...c.S.orders.values()].filter((o) => o.status === "new" || o.status === "paid").length;
  c.$("main").innerHTML = `
    <div class="row space"><h1>ספרים</h1></div>
    <div class="tabs" id="bTabs">${tabs.map(([k, l]) => `<button data-btab="${k}" class="${BS.tab === k ? "active" : ""}">${l}${k === "orders" && newOrders ? ` <span class="badge warn">${newOrders}</span>` : ""}</button>`).join("")}</div>
    <div id="bBody"></div>`;
  document.querySelectorAll("[data-btab]").forEach((b) => (b.onclick = () => { BS.tab = b.dataset.btab; renderBooks(c, true); }));
  ({ dist: tabDist, inst: tabInst, orders: tabOrders, catalog: tabCatalog, jgive: tabJgive })[BS.tab](c);
}
const editing = (c) => document.querySelectorAll("#bBody input, #bBody textarea, #bBody select").forEach((el) => el.addEventListener("input", () => c.$("bBody").setAttribute("data-editing", "1")));

// ---------- חלוקה ----------
function tabDist(c) {
  const books = [...new Set([...c.S.books, ...distsOf(c).map((d) => d.book)])].filter(Boolean);
  const list = distsOf(c, { book: BS.book });
  const insts = instList(c);
  const got = new Set(list.map((d) => d.institutionId));
  const missing = BS.book ? insts.filter((i) => !got.has(i.id)) : [];
  const t = norm(BS.search);
  const shown = list.filter((d) => !t || norm(`${d.institutionName} ${d.book} ${c.S.institutions.get(d.institutionId)?.city || ""}`).includes(t));
  c.$("bBody").innerHTML = `
    <div class="stats">${books.slice(0, 6).map((b) => { const l = distsOf(c, { book: b }); return `<div class="stat"><div class="num">${qtyOf(l)}</div><div class="lbl">${c.esc(b)} · ${new Set(l.map((d) => d.institutionId)).size} מוסדות</div></div>`; }).join("")
      || '<div class="stat"><div class="num">0</div><div class="lbl">עותקים שחולקו</div></div>'}</div>
    <div class="row" style="margin-bottom:10px">
      <select id="dBook" style="width:auto" aria-label="סינון לפי ספר"><option value="">כל הספרים</option>${books.map((b) => `<option ${BS.book === b ? "selected" : ""}>${c.esc(b)}</option>`).join("")}</select>
      <input id="dSearch" placeholder="חיפוש מוסד או יישוב" value="${c.esc(BS.search)}" style="width:200px" aria-label="חיפוש">
      ${BS.book ? `<label class="check"><input type="checkbox" id="dMissing" ${BS.missing ? "checked" : ""}> <span>הצגת המוסדות שעוד לא קיבלו (${missing.length})</span></label>` : ""}
      <span class="grow"></span>
      ${c.inGroup(c.EDIT_ROLES) ? '<button class="primary" id="dAdd">+ חלוקה</button>' : ""}<button id="dExport">ייצוא ל-Excel</button>
    </div>
    ${BS.book && BS.missing ? `<div class="card"><h3 style="margin-top:0">עוד לא קיבלו את "${c.esc(BS.book)}" (${missing.length})</h3>
      ${missing.length ? `<div class="table-wrap"><table><thead><tr><th>מוסד</th><th>סוג</th><th>יישוב</th><th>איש קשר</th><th>טלפון</th></tr></thead><tbody>
      ${missing.map((i) => `<tr><td>${c.esc(i.name)}</td><td>${c.esc(i.kind)}</td><td>${c.esc(i.city)}</td><td>${c.esc(i.contactName)}</td><td>${c.esc(i.phone)}</td></tr>`).join("")}</tbody></table></div>
      ${c.inGroup(c.EDIT_ROLES) ? `<button id="dAddMissing" style="margin-top:8px">חלוקה לכל ${missing.length} המוסדות האלה</button>` : ""}` : '<p class="muted">כל המוסדות כבר קיבלו 👍</p>'}</div>` : ""}
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>תאריך</th><th>מוסד</th><th>יישוב</th><th>ספר</th><th>כמות</th><th>סטטוס</th><th>הערות</th><th></th></tr></thead>
      <tbody>${shown.map((d) => `<tr><td class="nowrap">${fmtIso(d.date)}</td><td>${c.esc(d.institutionName)}</td><td>${c.esc(c.S.institutions.get(d.institutionId)?.city || "")}</td>
        <td>${c.esc(d.book)}</td><td>${Number(d.qty) || 0}</td>
        <td>${c.inGroup(c.EDIT_ROLES) ? `<select data-dstat="${d.id}" style="width:auto" aria-label="סטטוס">${Object.entries(DIST_STATUS).map(([k, v]) => `<option value="${k}" ${d.status === k ? "selected" : ""}>${v}</option>`).join("")}</select>`
          : `<span class="badge ${DIST_BADGE[d.status] || ""}">${DIST_STATUS[d.status] || ""}</span>`}</td>
        <td class="small">${c.esc(d.notes || "")}</td>
        <td>${c.inGroup(c.EDIT_ROLES) ? `<button class="link danger" data-ddel="${d.id}" aria-label="מחיקה">✕</button>` : ""}</td></tr>`).join("")
        || '<tr><td colspan="8" class="muted">עדיין לא נרשמו חלוקות</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${qtyOf(shown)} עותקים ב-${shown.length} חלוקות. כדי לראות מי עוד לא קיבל – בוחרים ספר ומסמנים "הצגת המוסדות שעוד לא קיבלו".</p>`;
  c.$("dBook").onchange = (e) => { BS.book = e.target.value; BS.missing = false; tabDist(c); };
  c.$("dSearch").oninput = (e) => { BS.search = e.target.value; const p = e.target.selectionStart; tabDist(c); c.$("dSearch").focus(); c.$("dSearch").setSelectionRange(p, p); };
  if (c.$("dMissing")) c.$("dMissing").onchange = (e) => { BS.missing = e.target.checked; tabDist(c); };
  if (c.$("dAdd")) c.$("dAdd").onclick = () => openDistribution(c, []);
  if (c.$("dAddMissing")) c.$("dAddMissing").onclick = () => openDistribution(c, missing.map((i) => i.id), BS.book);
  c.$("dExport").onclick = () => c.exportXlsx(shown.map((d) => {
    const i = c.S.institutions.get(d.institutionId) || {};
    return { "תאריך": fmtIso(d.date), "מוסד": d.institutionName, "סוג": i.kind || "", "יישוב": i.city || "", "כתובת": i.address || "", "איש קשר": i.contactName || "", "טלפון": i.phone || "", "ספר": d.book, "כמות": Number(d.qty) || 0, "סטטוס": DIST_STATUS[d.status] || "", "הערות": d.notes || "" };
  }), `חלוקת-ספרים${BS.book ? "-" + BS.book : ""}.xlsx`);
  document.querySelectorAll("[data-dstat]").forEach((s) => (s.onchange = async () => {
    try { await updateDoc(doc(db, "distributions", s.dataset.dstat), { status: s.value, updatedAt: serverTimestamp() }); c.toast("עודכן", "good"); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); }
  }));
  document.querySelectorAll("[data-ddel]").forEach((b) => (b.onclick = async () => {
    const d = c.S.dists.get(b.dataset.ddel);
    if (!confirm(`למחוק את החלוקה של "${d.book}" ל${d.institutionName}?`)) return;
    try { await deleteDoc(doc(db, "distributions", d.id)); c.audit("מחיקת חלוקת ספרים", d.institutionName, `${d.book} × ${d.qty}`); }
    catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
  }));
}

function openDistribution(c, preselect = [], preBook = "") {
  const insts = instList(c);
  if (!insts.length) return c.toast("קודם מוסיפים מוסדות בלשונית \"מוסדות\"", "bad");
  const books = c.S.books;
  c.openModal(`
    <div class="head"><h2>חלוקת ספרים</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="nBook">ספר</label><input id="nBook" list="nBooks" value="${c.esc(preBook || books[0] || "")}">
        <datalist id="nBooks">${books.map((b) => `<option value="${c.esc(b)}">`).join("")}</datalist></div>
      <div class="field"><label for="nDate">תאריך</label><input id="nDate" type="date" value="${todayIso()}"></div>
      <div class="field"><label for="nQty">כמות לכל מוסד</label><input id="nQty" type="number" min="1" value="1"></div>
      <div class="field"><label for="nStatus">סטטוס</label><select id="nStatus">${Object.entries(DIST_STATUS).map(([k, v]) => `<option value="${k}" ${k === "sent" ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="nNotes">הערות (רשות)</label><input id="nNotes"></div>
    <div class="row space"><b>מוסדות</b><div class="row"><input id="nFilter" placeholder="סינון" style="width:160px" aria-label="סינון מוסדות"><button class="link" id="nAll">סימון כולם</button><button class="link" id="nNone">ניקוי</button></div></div>
    <div class="inst-pick">${insts.map((i) => `<label class="qa-row" data-name="${c.esc(norm(`${i.name} ${i.city} ${i.kind}`))}"><input type="checkbox" value="${i.id}" ${preselect.includes(i.id) ? "checked" : ""}>
      <span>${c.esc(i.name)}<span class="small muted"> · ${c.esc([i.kind, i.city].filter(Boolean).join(", "))}</span></span>
      <input type="number" min="1" class="qty" data-qty="${i.id}" placeholder="כמות" aria-label="כמות ל${c.esc(i.name)}" style="width:70px;margin-inline-start:auto"></label>`).join("")}</div>
    <p class="small muted">כמות ריקה = הכמות הכללית שלמעלה.</p>
    <button class="primary" id="nSave">שמירה</button> <span id="nCount" class="small muted"></span>`, () => {
    const count = () => { c.$("nCount").textContent = `${document.querySelectorAll(".inst-pick input[type=checkbox]:checked").length} מוסדות נבחרו`; };
    document.querySelectorAll(".inst-pick input[type=checkbox]").forEach((x) => (x.onchange = count)); count();
    c.$("nFilter").oninput = (e) => { const t = norm(e.target.value); document.querySelectorAll(".inst-pick [data-name]").forEach((l) => l.classList.toggle("hidden", !!t && !l.dataset.name.includes(t))); };
    c.$("nAll").onclick = () => { document.querySelectorAll(".inst-pick [data-name]:not(.hidden) input[type=checkbox]").forEach((x) => (x.checked = true)); count(); };
    c.$("nNone").onclick = () => { document.querySelectorAll(".inst-pick input[type=checkbox]").forEach((x) => (x.checked = false)); count(); };
    c.$("nSave").onclick = async () => {
      const book = c.$("nBook").value.trim(), date = c.$("nDate").value, qty = Number(c.$("nQty").value) || 1;
      const ids = [...document.querySelectorAll(".inst-pick input[type=checkbox]:checked")].map((x) => x.value);
      if (!book) return c.toast("נא לבחור ספר", "bad");
      if (!ids.length) return c.toast("נא לסמן לפחות מוסד אחד", "bad");
      try {
        for (let i = 0; i < ids.length; i += 400) {
          const b = writeBatch(db);
          ids.slice(i, i + 400).forEach((id) => {
            const inst = c.S.institutions.get(id);
            const q = Number(document.querySelector(`[data-qty="${id}"]`).value) || qty;
            b.set(doc(collection(db, "distributions")), { institutionId: id, institutionName: inst.name, book, qty: q, date, status: c.$("nStatus").value,
              notes: c.$("nNotes").value.trim(), createdBy: c.myEmail(), createdAt: serverTimestamp() });
          });
          await b.commit();
        }
        c.toast(`נרשמו ${ids.length} חלוקות`, "good"); c.closeModal();
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ---------- מוסדות ----------
function tabInst(c) {
  const t = norm(BS.search);
  const list = instList(c).filter((i) => !t || norm(`${i.name} ${i.city} ${i.kind} ${i.contactName}`).includes(t));
  const ed = c.inGroup(c.EDIT_ROLES);
  c.$("bBody").innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <input id="iSearch" placeholder="חיפוש" value="${c.esc(BS.search)}" style="width:200px" aria-label="חיפוש מוסדות">
      <span class="grow"></span>
      ${ed ? '<button class="primary" id="iAdd">+ מוסד</button><button id="iImport">ייבוא מאקסל</button>' : ""}<button id="iExport">ייצוא ל-Excel</button></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>שם</th><th>סוג</th><th>יישוב</th><th>איש קשר</th><th>טלפון</th><th>ספרים שקיבל</th></tr></thead>
      <tbody>${list.map((i) => { const ds = distsOf(c, { inst: i.id }); return `<tr class="click" data-inst="${i.id}"><td>${c.esc(i.name)}</td><td>${c.esc(i.kind)}</td><td>${c.esc(i.city)}</td>
        <td>${c.esc(i.contactName)}</td><td>${c.esc(i.phone)}</td><td class="small">${ds.length ? `${qtyOf(ds)} עותקים · ${c.esc([...new Set(ds.map((d) => d.book))].join(", "))}` : '<span class="muted">—</span>'}</td></tr>`; }).join("")
        || '<tr><td colspan="6" class="muted">עדיין אין מוסדות</td></tr>'}</tbody></table></div></div>
    <p class="small muted">${list.length} מוסדות. ייבוא מאקסל: עמודות שם, סוג, יישוב, כתובת, איש קשר, טלפון, מייל, הערות.</p>`;
  c.$("iSearch").oninput = (e) => { BS.search = e.target.value; const p = e.target.selectionStart; tabInst(c); c.$("iSearch").focus(); c.$("iSearch").setSelectionRange(p, p); };
  if (c.$("iAdd")) c.$("iAdd").onclick = () => openInst(c, null);
  if (c.$("iImport")) c.$("iImport").onclick = () => importInst(c);
  c.$("iExport").onclick = () => c.exportXlsx(list.map((i) => ({ "שם": i.name, "סוג": i.kind || "", "יישוב": i.city || "", "כתובת": i.address || "", "איש קשר": i.contactName || "", "טלפון": i.phone || "", "מייל": i.email || "", "הערות": i.notes || "",
    "עותקים שקיבל": qtyOf(distsOf(c, { inst: i.id })) })), "מוסדות.xlsx");
  document.querySelectorAll("[data-inst]").forEach((tr) => (tr.onclick = () => openInst(c, tr.dataset.inst)));
}

function openInst(c, id) {
  const i = id ? c.S.institutions.get(id) : { kind: "בית כנסת" };
  const ed = c.inGroup(c.EDIT_ROLES), ds = id ? distsOf(c, { inst: id }) : [];
  const F = [["name", "שם המוסד"], ["city", "יישוב"], ["address", "כתובת"], ["contactName", "איש קשר (גבאי, מנהל)"], ["phone", "טלפון"], ["email", "מייל"]];
  c.openModal(`
    <div class="head"><h2>${id ? c.esc(i.name) : "מוסד חדש"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">${F.map(([k, l]) => `<div class="field"><label for="in_${k}">${l}</label><input id="in_${k}" value="${c.esc(i[k] || "")}" ${ed ? "" : "disabled"} ${k === "email" ? 'dir="ltr" type="email"' : ""}></div>`).join("")}
      <div class="field"><label for="in_kind">סוג</label><select id="in_kind" ${ed ? "" : "disabled"}>${KINDS.map((k) => `<option ${i.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select></div></div>
    <div class="field"><label for="in_notes">הערות</label><textarea id="in_notes" style="min-height:60px" ${ed ? "" : "disabled"}>${c.esc(i.notes || "")}</textarea></div>
    ${ed ? `<div class="row space"><button class="primary" id="inSave">שמירה</button>${id && c.can("admin", "head") ? '<button class="danger" id="inDel">מחיקה</button>' : ""}</div>` : ""}
    ${id ? `<h3>ספרים שקיבל</h3><ul class="timeline">${ds.map((d) => `<li><div class="when">${fmtIso(d.date)} · ${DIST_STATUS[d.status] || ""}</div>${c.esc(d.book)} × ${Number(d.qty) || 0}</li>`).join("") || '<li class="muted">עדיין לא</li>'}</ul>` : ""}`, () => {
    if (!ed) return;
    c.$("inSave").onclick = async () => {
      const data = Object.fromEntries([...F.map(([k]) => [k, c.$("in_" + k).value.trim()]), ["kind", c.$("in_kind").value], ["notes", c.$("in_notes").value.trim()]]);
      if (!data.name) return c.toast("נא למלא שם", "bad");
      try {
        if (id) {
          await updateDoc(doc(db, "institutions", id), { ...data, updatedAt: serverTimestamp() });
          // שם המוסד משוכפל בחלוקות (לייצוא ולחיפוש)
          if (data.name !== i.name) { const b = writeBatch(db); ds.forEach((d) => b.update(doc(db, "distributions", d.id), { institutionName: data.name })); await b.commit(); }
        } else await addDoc(collection(db, "institutions"), { ...data, createdAt: serverTimestamp(), createdBy: c.myEmail() });
        c.toast("נשמר", "good"); c.closeModal();
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
    if (c.$("inDel")) c.$("inDel").onclick = async () => {
      if (!confirm(`למחוק את "${i.name}"?${ds.length ? ` גם ${ds.length} רשומות החלוקה שלו יימחקו.` : ""}`)) return;
      try { const b = writeBatch(db); ds.forEach((d) => b.delete(doc(db, "distributions", d.id))); b.delete(doc(db, "institutions", id)); await b.commit(); c.audit("מחיקת מוסד", i.name); c.closeModal(); }
      catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
    };
  });
}

function importInst(c) {
  c.openModal(`
    <div class="head"><h2>ייבוא מוסדות מאקסל</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <p class="small">עמודות שהמערכת מזהה: <b>שם</b> (חובה), סוג, יישוב/עיר, כתובת, איש קשר/גבאי, טלפון, מייל, הערות. מוסד שכבר קיים (אותו שם ואותו יישוב) – מדולג.</p>
    <div class="field"><label for="iiFile">הקובץ</label><input type="file" id="iiFile" accept=".xlsx,.xls,.csv"></div><div id="iiRes"></div>`, () => {
    c.$("iiFile").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let rows;
      try { const wb = await readWorkbook(f); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }); } catch { return c.toast("לא הצלחתי לקרוא את הקובץ", "bad"); }
      const heads = Object.keys(rows[0] || {});
      const col = (re) => heads.find((h) => re.test(String(h).trim()));
      const C = { name: col(/^(שם|שם המוסד|מוסד|בית כנסת|name)$/i) || col(/שם|מוסד/i), kind: col(/סוג|kind|type/i), city: col(/עיר|יישוב|ישוב|city/i), address: col(/כתובת|address/i),
        contactName: col(/איש קשר|גבאי|מנהל|contact/i), phone: col(/טלפון|נייד|phone/i), email: col(/מייל|דוא|mail/i), notes: col(/הער|note/i) };
      if (!C.name) return c.toast("לא נמצאה עמודת שם", "bad");
      const have = new Set(instList(c).map((i) => norm(i.name) + "|" + norm(i.city)));
      const ok = [];
      rows.forEach((r) => {
        const d = Object.fromEntries(Object.entries(C).map(([k, h]) => [k, h ? String(r[h] ?? "").trim() : ""]));
        if (!d.name) return;
        if (!KINDS.includes(d.kind)) d.kind = d.kind ? (KINDS.find((k) => d.kind.includes(k)) || "אחר") : "בית כנסת";
        const key = norm(d.name) + "|" + norm(d.city);
        if (have.has(key)) return; have.add(key); ok.push(d);
      });
      c.$("iiRes").innerHTML = `<div class="context"><b>${ok.length}</b> מוסדות חדשים (${rows.length - ok.length} דולגו – ריקים או קיימים).</div>${ok.length ? `<button class="primary" id="iiGo">ייבוא ${ok.length} מוסדות</button>` : ""}`;
      if (c.$("iiGo")) c.$("iiGo").onclick = async () => {
        try {
          for (let i = 0; i < ok.length; i += 400) { const b = writeBatch(db); ok.slice(i, i + 400).forEach((d) => b.set(doc(collection(db, "institutions")), { ...d, createdAt: serverTimestamp(), createdBy: c.myEmail() })); await b.commit(); }
          c.toast(`יובאו ${ok.length} מוסדות`, "good"); c.closeModal(); c.audit("ייבוא מוסדות", f.name, `${ok.length} מוסדות`);
        } catch (err) { c.toast("הייבוא נכשל: " + err.code, "bad"); }
      };
    };
  });
}

// ---------- הזמנות מהחנות ----------
function tabOrders(c) {
  const all = [...c.S.orders.values()].sort((a, b) => (c.toDate(b.createdAt)?.getTime() || 0) - (c.toDate(a.createdAt)?.getTime() || 0));
  const list = all.filter((o) => BS.orderStatus === "all" || (BS.orderStatus === "open" ? ["new", "paid"].includes(o.status) : o.status === BS.orderStatus));
  c.$("bBody").innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <div class="tabs" style="margin:0">${[["open", "לטיפול"], ["new", "ממתינות לתשלום"], ["paid", "שולמו"], ["shipped", "נשלחו"], ["cancelled", "בוטלו"], ["all", "הכול"]].map(([k, l]) =>
        `<button data-ost="${k}" class="${BS.orderStatus === k ? "active" : ""}">${l}</button>`).join("")}</div>
      <span class="grow"></span><a class="btn" href="${c.esc(shopUrl())}" target="_blank" rel="noopener">לחנות</a><button id="oExport">ייצוא ל-Excel</button></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>תאריך</th><th>מזמין</th><th>ספרים</th><th>סכום</th><th>משלוח</th><th>סטטוס</th></tr></thead>
      <tbody>${list.map((o) => `<tr><td class="nowrap">${c.fmtDate(o.createdAt)}</td>
        <td>${c.esc([o.firstName, o.lastName].join(" "))}<div class="small muted" dir="ltr" style="text-align:right">${c.esc(o.email)}</div><div class="small muted">${c.esc(o.phone)}</div></td>
        <td class="small">${(o.items || []).map((x) => `${c.esc(x.name)} × ${x.qty}`).join("<br>")}${o.note ? `<div class="muted">📝 ${c.esc(o.note)}</div>` : ""}</td>
        <td>₪${Number(o.total || 0).toLocaleString("he-IL")}${o.jgiveId ? '<div class="small muted">שולם ב-Jgive</div>' : ""}</td>
        <td class="small">${o.delivery === "pickup" ? "איסוף עצמי" : c.esc(o.address || "")}</td>
        <td><select data-ostat="${o.id}" style="width:auto" aria-label="סטטוס ההזמנה">${Object.entries(ORDER_STATUS).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td></tr>`).join("")
        || '<tr><td colspan="6" class="muted">אין הזמנות</td></tr>'}</tbody></table></div></div>
    <p class="small muted">הזמנה ששולמה ב-Jgive מסומנת "שולמה" אוטומטית (לפי המייל והסכום). אפשר גם לסמן ידנית. כשהזמנה מסומנת "שולמה" נרשמת אצל המזמין ב-CRM "רכישת ספרים".</p>`;
  document.querySelectorAll("[data-ost]").forEach((b) => (b.onclick = () => { BS.orderStatus = b.dataset.ost; tabOrders(c); }));
  c.$("oExport").onclick = () => c.exportXlsx(list.map((o) => ({ "תאריך": c.fmtDate(o.createdAt), "שם": [o.firstName, o.lastName].join(" "), "מייל": o.email, "טלפון": o.phone,
    "ספרים": (o.items || []).map((x) => `${x.name} × ${x.qty}`).join(", "), "סכום": o.total, "משלוח": o.delivery === "pickup" ? "איסוף עצמי" : o.address, "סטטוס": ORDER_STATUS[o.status] || o.status, "הערה": o.note || "" })), "הזמנות-ספרים.xlsx");
  document.querySelectorAll("[data-ostat]").forEach((s) => (s.onchange = async () => {
    const o = c.S.orders.get(s.dataset.ostat);
    try {
      const upd = { status: s.value, updatedAt: serverTimestamp(), updatedBy: c.myEmail() };
      if (s.value === "paid" && !o.paidAt) upd.paidAt = serverTimestamp();
      if (s.value === "shipped" && !o.shippedAt) upd.shippedAt = serverTimestamp();
      await updateDoc(doc(db, "orders", o.id), upd);
      if (s.value === "paid" && !o.contactId && c.recordOrderPurchase) c.recordOrderPurchase({ ...o, ...upd });
      c.toast("עודכן", "good");
    } catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); }
  }));
}

// ---------- קטלוג וחנות ----------
function tabCatalog(c) {
  const ed = c.can("admin", "head");
  const items = catalog(c).length ? catalog(c) : [{ id: uid(), name: "", price: "", forSale: true }];
  const sold = (name) => [...c.S.orders.values()].filter((o) => ["paid", "shipped"].includes(o.status)).reduce((a, o) => a + (o.items || []).filter((x) => x.name === name).reduce((s, x) => s + (Number(x.qty) || 0), 0), 0);
  c.$("bBody").innerHTML = `
    <div class="card">
      <div class="row space"><h3 style="margin:0">חנות הספרים באתר</h3><div class="row"><a class="btn" href="${c.esc(shopUrl())}" target="_blank" rel="noopener">פתיחת החנות</a><button id="shopCopy">העתקת הקישור</button></div></div>
      <p class="small muted">בחנות מוצגים הספרים שמסומנים "למכירה" ושיש להם מחיר. המזמין ממלא פרטים, ההזמנה נשמרת כאן בלשונית "הזמנות", והוא מועבר לתשלום ב-Jgive.</p>
      <div class="field"><label for="jgUrl">קישור לדף התשלום ב-Jgive (כללי לכל הספרים)</label><input id="jgUrl" dir="ltr" value="${c.esc(c.S.booksDoc?.jgiveUrl || "")}" placeholder="https://www.jgive.com/new/he/ils/donation-targets/..." ${ed ? "" : "disabled"}></div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="cat-table">
      <thead><tr><th>שם הספר</th><th>מחיר (₪)</th><th>למכירה</th><th>תיאור קצר</th><th>תמונה (קישור, רשות)</th><th>קישור Jgive ייעודי (רשות)</th><th>נמכרו</th><th>חולקו</th>${ed ? "<th></th>" : ""}</tr></thead>
      <tbody id="catRows">${items.map((b) => catRow(c, b, ed, sold(b.name), qtyOf(distsOf(c, { book: b.name })))).join("")}</tbody></table></div></div>
    ${ed ? '<div class="row"><button id="catAdd">+ ספר</button><button class="primary" id="catSave">שמירת הקטלוג</button></div>' : '<p class="small muted">רק מנהל ורכז הרכזים יכולים לערוך את הקטלוג.</p>'}`;
  c.$("shopCopy").onclick = async () => { try { await navigator.clipboard.writeText(shopUrl()); c.toast("הקישור הועתק", "good"); } catch { /* */ } };
  if (!ed) return;
  editing(c);
  const bindDel = () => document.querySelectorAll("[data-catdel]").forEach((b) => (b.onclick = () => { b.closest("tr").remove(); c.$("bBody").setAttribute("data-editing", "1"); }));
  bindDel();
  c.$("catAdd").onclick = () => { c.$("catRows").insertAdjacentHTML("beforeend", catRow(c, { id: uid(), name: "", price: "", forSale: true }, true, 0, 0)); bindDel(); editing(c); };
  c.$("catSave").onclick = async () => {
    const rows = [...document.querySelectorAll("#catRows tr")].map((tr) => {
      const v = (k) => tr.querySelector(`[data-k="${k}"]`);
      return { id: tr.dataset.id, name: v("name").value.trim(), price: Number(v("price").value) || 0, forSale: v("forSale").checked, desc: v("desc").value.trim(), image: v("image").value.trim(), jgiveUrl: v("jgiveUrl").value.trim() };
    }).filter((b) => b.name);
    const bad = rows.find((b) => (b.image && !/^https:\/\//.test(b.image)) || (b.jgiveUrl && !/^https:\/\//.test(b.jgiveUrl)));
    if (bad) return c.toast(`בספר "${bad.name}": קישור צריך להתחיל ב-https://`, "bad");
    const jg = c.$("jgUrl").value.trim();
    if (jg && !/^https:\/\//.test(jg)) return c.toast("קישור Jgive צריך להתחיל ב-https://", "bad");
    if (new Set(rows.map((b) => b.name)).size !== rows.length) return c.toast("יש שני ספרים עם אותו שם", "bad");
    try {
      await setDoc(doc(db, "settings", "books"), { items: rows, list: rows.map((b) => b.name), jgiveUrl: jg, updatedBy: c.myEmail(), updatedAt: serverTimestamp() });
      c.$("bBody").removeAttribute("data-editing"); c.toast(`נשמרו ${rows.length} ספרים`, "good"); c.audit("עדכון קטלוג הספרים", `${rows.length} ספרים`);
    } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
  };
}
function catRow(c, b, ed, sold, dist) {
  const dis = ed ? "" : "disabled";
  return `<tr data-id="${c.esc(b.id || uid())}">
    <td><input data-k="name" value="${c.esc(b.name)}" ${dis} aria-label="שם הספר" style="min-width:160px"></td>
    <td><input data-k="price" type="number" min="0" value="${c.esc(b.price)}" ${dis} aria-label="מחיר" style="width:80px"></td>
    <td style="text-align:center"><input data-k="forSale" type="checkbox" ${b.forSale !== false ? "checked" : ""} ${dis} aria-label="למכירה"></td>
    <td><input data-k="desc" value="${c.esc(b.desc || "")}" ${dis} aria-label="תיאור" style="min-width:160px"></td>
    <td><input data-k="image" value="${c.esc(b.image || "")}" ${dis} dir="ltr" aria-label="קישור לתמונה" style="min-width:120px"></td>
    <td><input data-k="jgiveUrl" value="${c.esc(b.jgiveUrl || "")}" ${dis} dir="ltr" aria-label="קישור Jgive ייעודי" style="min-width:120px"></td>
    <td>${sold}</td><td>${dist}</td>${ed ? `<td><button class="link danger" data-catdel aria-label="הסרת הספר">✕</button></td>` : ""}</tr>`;
}

// ---------- Jgive ----------
async function tabJgive(c) {
  c.$("bBody").innerHTML = `<p class="muted">טוען...</p>`;
  let url = "";
  try { const d = await getDoc(doc(db, "private", "jgive")); url = d.exists() ? d.data().webhookUrl || "" : ""; } catch { /* */ }
  if (BS.tab !== "jgive") return;
  const inbox = [...c.S.jgive.values()].sort((a, b) => (c.toDate(b.receivedAt)?.getTime() || 0) - (c.toDate(a.receivedAt)?.getTime() || 0));
  c.$("bBody").innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">חיבור אוטומטי ל-Jgive</h3>
      <p>כל תרומה או תשלום ב-Jgive נכנסים למערכת לבד: איש הקשר נוצר או מתעדכן ב-CRM, נרשמת אצלו "תרומה", ותשלום על הזמנה מהחנות מסמן את ההזמנה כ"שולמה".</p>
      ${url ? `<div class="field"><label for="jgHook">הכתובת שמדביקים ב-Jgive</label><div class="row"><input id="jgHook" class="grow" dir="ltr" readonly value="${c.esc(url)}"><button id="jgCopy">העתקה</button></div></div>
        <p class="small">ב-Jgive: אזור הארגון ← <b>Account Settings</b> ← לשונית <b>Integrations</b> ← <b>Webhook URL</b> ← מדביקים ← Save.</p>
        <p class="small muted">הכתובת כוללת מפתח סודי – לא לשתף אותה.</p>`
      : `<div class="conflict-box">הכתובת עוד לא נוצרה. צריך לפרסם את הסקריפט כ-Web App (README, פרק "חיבור ל-Jgive") ולהריץ שוב את setup.</div>`}
    </div>
    <h3>עדכונים אחרונים מ-Jgive</h3>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>התקבל</th><th>תורם</th><th>סכום</th><th>מטרה</th><th>טיפול</th></tr></thead>
      <tbody>${inbox.slice(0, 100).map((j) => `<tr><td class="nowrap">${c.fmtDate(j.receivedAt)}</td>
        <td>${c.esc(j.fullName || [j.firstName, j.lastName].join(" "))}<div class="small muted" dir="ltr" style="text-align:right">${c.esc(j.email)}</div></td>
        <td>${c.esc(j.currency === "ILS" ? "₪" : j.currency + " ")}${Number(j.amount || 0).toLocaleString("he-IL")}${j.recurring ? ' <span class="badge">הוראת קבע</span>' : ""}${j.refunded ? ' <span class="badge bad">הוחזר</span>' : ""}</td>
        <td class="small">${c.esc(j.purpose || j.comment || "")}</td>
        <td class="small">${j.processed ? (j.orderId ? '<span class="badge good">שויך להזמנה</span>' : '<span class="badge good">נרשם ב-CRM</span>') : '<span class="badge warn">ממתין</span>'}${j.note ? `<div class="muted">${c.esc(j.note)}</div>` : ""}</td></tr>`).join("")
        || '<tr><td colspan="5" class="muted">עדיין לא התקבלו עדכונים</td></tr>'}</tbody></table></div></div>`;
  if (c.$("jgCopy")) c.$("jgCopy").onclick = async () => { try { await navigator.clipboard.writeText(url); c.toast("הועתק", "good"); } catch { c.$("jgHook").select(); } };
}
