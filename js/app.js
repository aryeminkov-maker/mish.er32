// ===== מערכת ניהול קשרים – מכון משפטי ארץ =====
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  db, auth, configReady, esc, normEmail, normPhone, toDate, fmtDate, toast, setupMissingNotice,
  DEFAULT_TAXONOMY, normTaxonomy, autoTagsFor
} from "./common.js?v=20261015c";

// ---------- קבועים ----------
const STAFF_ROLES = ["admin", "head", "rabbi", "staff"];
const ROLE_LABEL = { staff: "צוות", rabbi: "רב משיב", head: "רכז הרכזים", admin: "מנהל מערכת" };
const ACT_TYPES = {
  donation: "תרומה",
  course: "השתלמות",
  book_purchase: "רכישת ספרים",
  book_received: "קבלת ספרים",
  note: "פנייה / הערה"
};
const Q_STATUS = { new: "חדשה", in_progress: "בטיפול", answered: "נענתה" };
const Q_BADGE = { new: "bad", in_progress: "warn", answered: "good" };
const CONSENT = { yes: "מאשר", no: "לא מאשר", removed: "ביקש הסרה", unknown: "לא ידוע" };
const CONSENT_BADGE = { yes: "good", no: "bad", removed: "bad", unknown: "" };

// ---------- מצב ----------
const S = {
  user: null, profile: null, view: "dashboard",
  contacts: new Map(), activities: new Map(), questions: new Map(), users: new Map(), lists: new Map(),
  byEmail: new Map(), byPhone: new Map(), actByContact: new Map(), qByContact: new Map(),
  loaded: { contacts: false, activities: false, questions: false },
  linking: new Set(),
  cf: { text: "", tag: "", consent: "", conds: [] },
  qf: { status: "new", rabbi: "", text: "", topic: "", tag: "" },
  tax: normTaxonomy(DEFAULT_TAXONOMY), taxLoaded: false,
  unsub: []
};
const $ = (id) => document.getElementById(id);
const role = () => S.profile?.role || "none";
const myEmail = () => normEmail(S.user?.email);
const can = (...roles) => roles.includes(role());

// ---------- כניסה ----------
if (!configReady) {
  setupMissingNotice($("setupView"));
} else {
  initAuthUI();
  onAuthStateChanged(auth, handleAuth);
}

function initAuthUI() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  getRedirectResult(auth).catch((e) => toast("הכניסה נכשלה: " + e.code, "bad"));
  $("btnGoogle").onclick = async () => {
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
        await signInWithRedirect(auth, provider);
      } else if (e.code === "auth/unauthorized-domain") {
        toast("הדומיין של האתר לא אושר ב-Firebase (Authentication ← Settings ← Authorized domains)", "bad");
      } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
        toast("הכניסה נכשלה: " + e.code, "bad");
      }
    }
  };
  $("btnLogout").onclick = () => signOut(auth);
  $("btnLogoutPending").onclick = () => signOut(auth);
}

async function handleAuth(u) {
  S.unsub.forEach((f) => f()); S.unsub = [];
  ["loginView", "pendingView", "appView"].forEach((v) => $(v).classList.add("hidden"));
  if (!u) { $("loginView").classList.remove("hidden"); return; }
  S.user = u;
  // הכניסה מותרת רק למיילים שהמנהל הוסיף לרשימת המורשים
  let snap = null;
  let reason = "";
  try { snap = await getDoc(doc(db, "allowedEmails", myEmail())); }
  catch (e) { snap = null; reason = e.code === "permission-denied" ? "חוקי האבטחה ב-Firebase חוסמים את הבדיקה – צריך לפרסם את firestore.rules העדכני (Firestore ← Rules ← Publish)." : "שגיאה: " + e.code; }
  S.profile = snap?.exists() ? snap.data() : null;
  if (snap && !snap.exists()) reason = `לא נמצא מסמך בשם "${myEmail()}" באוסף allowedEmails.`;
  else if (S.profile && !STAFF_ROLES.includes(S.profile.role)) reason = `בשדה role רשום "${S.profile.role}". הערך צריך להיות admin, head, staff או rabbi.`;
  if (!S.profile || !STAFF_ROLES.includes(S.profile.role)) {
    $("deniedEmail").textContent = u.email;
    $("deniedReason").textContent = reason;
    $("pendingView").classList.remove("hidden");
    return;
  }
  // עדכון שם ותמונה מחשבון ה-Google (מותר למשתמש לעדכן רק את השדות האלה)
  const upd = {};
  if (!S.profile.name && u.displayName) upd.name = u.displayName;
  upd.lastLogin = serverTimestamp();
  updateDoc(doc(db, "allowedEmails", myEmail()), upd).catch(() => {});
  if (upd.name) S.profile.name = upd.name;
  $("appView").classList.remove("hidden");
  $("whoName").textContent = `${S.profile.name || u.email} · ${ROLE_LABEL[S.profile.role]}`;
  if (role() === "rabbi") S.qf.rabbi = "mine";
  setupNav();
  subscribeAll();
  go(location.hash.slice(1) || "dashboard");
}

// ---------- נתונים ----------
function subscribeAll() {
  S.unsub.push(onSnapshot(doc(db, "settings", "taxonomy"), (snap) => {
    S.tax = normTaxonomy(snap.exists() ? snap.data() : DEFAULT_TAXONOMY); S.taxLoaded = true; dataChanged();
  }, () => { S.taxLoaded = true; }));
  const sub = (name, onDocs) => S.unsub.push(onSnapshot(collection(db, name), (snap) => onDocs(snap), (err) => toast("שגיאה בטעינת " + name + ": " + err.code, "bad")));
  sub("contacts", (snap) => {
    S.contacts.clear(); S.byEmail.clear(); S.byPhone.clear();
    snap.forEach((d) => {
      const c = { id: d.id, ...d.data() };
      S.contacts.set(d.id, c);
      if (c.emailKey) S.byEmail.set(c.emailKey, d.id);
      if (c.phoneKey) S.byPhone.set(c.phoneKey, d.id);
    });
    S.loaded.contacts = true; dataChanged();
  });
  sub("activities", (snap) => {
    S.activities.clear(); S.actByContact.clear();
    snap.forEach((d) => {
      const a = { id: d.id, ...d.data() };
      S.activities.set(d.id, a);
      if (!S.actByContact.has(a.contactId)) S.actByContact.set(a.contactId, []);
      S.actByContact.get(a.contactId).push(a);
    });
    S.loaded.activities = true; dataChanged();
  });
  sub("questions", (snap) => {
    S.questions.clear(); S.qByContact.clear();
    snap.forEach((d) => {
      const q = { id: d.id, ...d.data() };
      S.questions.set(d.id, q);
      if (q.contactId) {
        if (!S.qByContact.has(q.contactId)) S.qByContact.set(q.contactId, []);
        S.qByContact.get(q.contactId).push(q);
      }
    });
    S.loaded.questions = true; dataChanged();
  });
  sub("allowedEmails", (snap) => { S.users.clear(); snap.forEach((d) => S.users.set(d.id, { id: d.id, email: d.id, ...d.data() })); dataChanged(); });
  sub("savedLists", (snap) => { S.lists.clear(); snap.forEach((d) => S.lists.set(d.id, { id: d.id, ...d.data() })); dataChanged(); });
}

let dataTimer = null;
function dataChanged() {
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => {
    if (S.loaded.contacts && S.loaded.questions) linkPendingQuestions();
    refreshView();
  }, 120);
}

// קישור שאלות שהגיעו מהטופס הציבורי לכרטיס איש קשר (קיים או חדש)
async function linkPendingQuestions() {
  // תיוג אוטומטי לשאלות חדשות שעוד לא תויגו
  if (S.taxLoaded) {
    for (const q of S.questions.values()) {
      if (q.autoTags !== undefined || S.linking.has("t:" + q.id)) continue;
      S.linking.add("t:" + q.id);
      updateDoc(doc(db, "questions", q.id), { autoTags: calcAutoTags(q.text, q.answer) }).catch(() => {});
    }
  }
  for (const q of S.questions.values()) {
    if (q.contactId || S.linking.has(q.id)) continue;
    S.linking.add(q.id);
    try {
      const contactId = await findOrCreateContact({
        firstName: q.firstName, lastName: q.lastName, email: q.email, phone: q.phone,
        consentEmail: q.consentEmail, source: "שו\"ת"
      });
      await updateDoc(doc(db, "questions", q.id), { contactId });
    } catch (e) { console.warn("link failed", e); }
  }
}

function findContactId(email, phone) {
  const e = normEmail(email), p = normPhone(phone);
  return (e && S.byEmail.get(e)) || (p && S.byPhone.get(p)) || null;
}

async function findOrCreateContact(d) {
  const existing = findContactId(d.email, d.phone);
  if (existing) {
    const c = S.contacts.get(existing) || {};
    const upd = {};
    for (const k of ["firstName", "lastName", "city"]) if (!c[k] && d[k]) upd[k] = d[k];
    if (!c.email && d.email) { upd.email = d.email.trim(); upd.emailKey = normEmail(d.email); }
    if (!c.phone && d.phone) { upd.phone = d.phone.trim(); upd.phoneKey = normPhone(d.phone); }
    if (d.consentEmail === true && !["yes", "removed"].includes(c.consentEmail?.status)) {
      upd.consentEmail = { status: "yes", at: Timestamp.now(), source: d.source };
    }
    if (Object.keys(upd).length) await updateDoc(doc(db, "contacts", existing), upd);
    return existing;
  }
  const data = newContactData(d);
  const ref = await addDoc(collection(db, "contacts"), data);
  if (data.emailKey) S.byEmail.set(data.emailKey, ref.id);
  if (data.phoneKey) S.byPhone.set(data.phoneKey, ref.id);
  return ref.id;
}

function newContactData(d) {
  return {
    firstName: (d.firstName || "").trim(), lastName: (d.lastName || "").trim(),
    email: (d.email || "").trim(), emailKey: normEmail(d.email),
    phone: (d.phone || "").trim(), phoneKey: normPhone(d.phone),
    city: (d.city || "").trim(), tags: d.tags || [], notes: d.notes || "",
    consentEmail: { status: d.consentEmail === true ? "yes" : d.consentEmail === false ? "no" : "unknown", at: Timestamp.now(), source: d.source || "" },
    consentSms: { status: "unknown", at: Timestamp.now(), source: "" },
    source: d.source || "", createdAt: Timestamp.now()
  };
}

// ---------- ניווט ----------
function setupNav() {
  document.querySelectorAll("#nav button").forEach((b) => {
    const roles = b.dataset.roles?.split(",");
    b.classList.toggle("hidden", !!roles && !roles.includes(role()));
    b.onclick = () => go(b.dataset.view);
  });
}
function go(view) {
  const btn = document.querySelector(`#nav button[data-view="${view}"]`);
  if (!btn || btn.classList.contains("hidden")) view = "dashboard";
  S.view = view;
  location.hash = view;
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  renderView(true);
}
function refreshView() { renderView(false); }

function renderView(full) {
  const views = { dashboard: renderDashboard, contacts: renderContacts, questions: renderQuestions, import: renderImport, users: renderUsers, settings: renderSettings };
  (views[S.view] || renderDashboard)(full);
}

// ---------- עזרי תצוגה ----------
const fullName = (c) => [c?.firstName, c?.lastName].filter(Boolean).join(" ") || c?.email || "(ללא שם)";
const consentOf = (c, ch = "Email") => c?.["consent" + ch]?.status || "unknown";
const userName = (email) => (email ? S.users.get(email)?.name || email : "");
// תגיות: ידניות (tags) + אוטומטיות לפי מילות מפתח (autoTags)
const qTags = (q) => [...new Set([...(q.tags || []), ...(q.autoTags || [])])];
const calcAutoTags = (text, answer) => autoTagsFor(`${text || ""} ${answer || ""}`, S.tax.tags);
const sameList = (a, b) => (a || []).slice().sort().join("|") === (b || []).slice().sort().join("|");
const tagBadges = (q) => qTags(q).map((t) => `<span class="badge brand">${esc(t)}</span>`).join("");
const categoryOptions = (cur, withEmpty) => {
  const cats = [...S.tax.categories];
  if (cur && !cats.includes(cur)) cats.push(cur);
  return (withEmpty ? '<option value="">ללא</option>' : "") + cats.map((t) => `<option ${t === cur ? "selected" : ""}>${esc(t)}</option>`).join("");
};
const rabbis = () => [...S.users.values()].filter((u) => ["rabbi", "head", "admin"].includes(u.role));

function countsOf(contactId) {
  const acts = S.actByContact.get(contactId) || [];
  const n = { questions: (S.qByContact.get(contactId) || []).length };
  for (const t of Object.keys(ACT_TYPES)) n[t] = acts.filter((a) => a.type === t).length;
  return n;
}

function contextBadges(contactId, excludeQ) {
  if (!contactId) return `<span class="muted small">מקשר לכרטיס איש קשר...</span>`;
  const n = countsOf(contactId);
  const prevQ = (S.qByContact.get(contactId) || []).filter((q) => q.id !== excludeQ).length;
  const out = [];
  if (n.donation) out.push(`<span class="badge good">תורם/ת (${n.donation})</span>`);
  if (n.course) out.push(`<span class="badge info">משתתף/ת בהשתלמויות (${n.course})</span>`);
  if (n.book_purchase) out.push(`<span class="badge brand">קנה/תה ספרים (${n.book_purchase})</span>`);
  if (n.book_received) out.push(`<span class="badge brand">קיבל/ה ספרים (${n.book_received})</span>`);
  if (prevQ) out.push(`<span class="badge warn">שואל/ת חוזר/ת – ${prevQ} שאלות קודמות</span>`);
  return out.length ? out.join("") : `<span class="muted small">פנייה ראשונה, אין היסטוריה קודמת</span>`;
}

function summaryBadges(contactId) {
  const n = countsOf(contactId), out = [];
  if (n.donation) out.push(`<span class="badge good">תרומות ${n.donation}</span>`);
  if (n.course) out.push(`<span class="badge info">השתלמויות ${n.course}</span>`);
  if (n.book_purchase + n.book_received) out.push(`<span class="badge brand">ספרים ${n.book_purchase + n.book_received}</span>`);
  if (n.questions) out.push(`<span class="badge warn">שאלות ${n.questions}</span>`);
  return out.join("");
}

function openModal(html, onMount) {
  const root = $("modalRoot");
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) closeModal(); });
  root.querySelectorAll("[data-close]").forEach((b) => (b.onclick = closeModal));
  onMount && onMount(root);
}
function closeModal() { $("modalRoot").innerHTML = ""; }

function exportXlsx(rows, filename) {
  if (!rows.length) return toast("אין נתונים לייצוא", "bad");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "נתונים");
  XLSX.writeFile(wb, filename);
}

const sortByDateDesc = (arr, key) => arr.sort((a, b) => (toDate(b[key])?.getTime() || 0) - (toDate(a[key])?.getTime() || 0));

// ======================================================
// ראשי
// ======================================================
function renderDashboard() {
  const qs = [...S.questions.values()];
  const monthAgo = Date.now() - 30 * 864e5;
  const cnt = (st) => qs.filter((q) => q.status === st).length;
  const answered30 = qs.filter((q) => q.status === "answered" && (toDate(q.answeredAt)?.getTime() || 0) > monthAgo).length;
  const consentYes = [...S.contacts.values()].filter((c) => consentOf(c) === "yes").length;

  const perRabbi = rabbis().map((r) => {
    const mine = qs.filter((q) => q.rabbiEmail === r.id);
    return `<tr><td>${esc(userName(r.id))}</td><td>${mine.filter((q) => q.status === "new").length}</td><td>${mine.filter((q) => q.status === "in_progress").length}</td><td>${mine.filter((q) => q.status === "answered").length}</td></tr>`;
  }).join("");
  const unassigned = qs.filter((q) => !q.rabbiEmail && q.status !== "answered").length;

  const latest = sortByDateDesc(qs.filter((q) => q.status !== "answered"), "createdAt").slice(0, 6);

  $("main").innerHTML = `
    <h1>שלום ${esc(S.profile.name || "")}</h1>
    <div class="stats">
      <div class="stat"><div class="num">${S.contacts.size}</div><div class="lbl">אנשי קשר</div></div>
      <div class="stat"><div class="num">${consentYes}</div><div class="lbl">אישרו דיוור במייל</div></div>
      <div class="stat"><div class="num">${cnt("new")}</div><div class="lbl">שאלות חדשות</div></div>
      <div class="stat"><div class="num">${cnt("in_progress")}</div><div class="lbl">שאלות בטיפול</div></div>
      <div class="stat"><div class="num">${answered30}</div><div class="lbl">נענו ב-30 הימים האחרונים</div></div>
    </div>
    <div class="split">
      <div class="card">
        <h2>שאלות פתוחות אחרונות</h2>
        <div class="qlist">${latest.map(qCardHtml).join("") || '<p class="muted">אין שאלות פתוחות</p>'}</div>
      </div>
      <div class="card">
        <h2>מצב השו"ת לפי רב</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>רב</th><th>חדשות</th><th>בטיפול</th><th>נענו</th></tr></thead>
          <tbody>${perRabbi || '<tr><td colspan="4" class="muted">עדיין לא הוגדרו רבנים בדף המשתמשים</td></tr>'}</tbody>
        </table></div>
        <p class="small muted">שאלות פתוחות שלא שויכו לרב: ${unassigned}</p>
      </div>
    </div>`;
  bindQCards();
}

// ======================================================
// אנשי קשר
// ======================================================
function renderContacts(full) {
  if (!full && $("contactsTable")) { renderContactsTable(); renderListSelect(); renderTagSelect(); return; }
  const canEdit = !can("rabbi");
  $("main").innerHTML = `
    <div class="row space"><h1>אנשי קשר</h1>
      <div class="row">
        ${canEdit ? '<button class="primary" id="btnNewContact">+ איש קשר חדש</button>' : ""}
        ${canEdit ? '<button id="btnDups">בדיקת כפילויות</button>' : ""}
      </div>
    </div>
    <div class="card">
      <div class="row">
        <input id="fText" class="grow" placeholder="חיפוש לפי שם, מייל, טלפון, יישוב או תגית" value="${esc(S.cf.text)}">
        <select id="fTag" style="width:auto"></select>
        <select id="fConsent" style="width:auto">
          <option value="">הסכמת מייל: הכול</option>
          ${Object.entries(CONSENT).map(([k, v]) => `<option value="${k}" ${S.cf.consent === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div id="conds"></div>
      <div class="row" style="margin-top:8px">
        <button id="btnAddCond">+ תנאי היסטוריה</button>
        <span class="grow"></span>
        <select id="listSelect" style="width:auto"></select>
        <button id="btnSaveList">שמירה כרשימה</button>
        <button id="btnDelList" class="danger hidden">מחיקת רשימה</button>
      </div>
    </div>
    <div class="row space" style="margin-bottom:8px">
      <span id="contactsCount" class="muted"></span>
      <div class="row">
        <button id="btnCopyEmails">העתקת מיילים (רק מאשרי דיוור)</button>
        <button id="btnExportContacts">ייצוא ל-Excel</button>
      </div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap" id="contactsTable"></div></div>`;

  $("fText").oninput = (e) => { S.cf.text = e.target.value; renderContactsTable(); };
  $("fTag").onchange = (e) => { S.cf.tag = e.target.value; renderContactsTable(); };
  $("fConsent").onchange = (e) => { S.cf.consent = e.target.value; renderContactsTable(); };
  $("btnAddCond").onclick = () => { S.cf.conds.push({ has: true, type: "donation", text: "" }); renderConds(); renderContactsTable(); };
  $("btnExportContacts").onclick = exportContacts;
  $("btnCopyEmails").onclick = copyEmails;
  $("btnSaveList").onclick = saveList;
  $("btnDelList").onclick = deleteList;
  $("listSelect").onchange = (e) => loadList(e.target.value);
  if ($("btnNewContact")) $("btnNewContact").onclick = () => openContact(null);
  if ($("btnDups")) $("btnDups").onclick = openDuplicates;
  renderTagSelect(); renderListSelect(); renderConds(); renderContactsTable();
}

function renderTagSelect() {
  const sel = $("fTag"); if (!sel) return;
  const tags = new Set(); S.contacts.forEach((c) => (c.tags || []).forEach((t) => tags.add(t)));
  sel.innerHTML = `<option value="">כל התגיות</option>` + [...tags].sort().map((t) => `<option ${S.cf.tag === t ? "selected" : ""}>${esc(t)}</option>`).join("");
}

function renderListSelect() {
  const sel = $("listSelect"); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">רשימות שמורות...</option>` + [...S.lists.values()].sort((a, b) => a.name.localeCompare(b.name, "he"))
    .map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
  sel.value = cur;
  $("btnDelList").classList.toggle("hidden", !sel.value);
}

function renderConds() {
  const box = $("conds"); if (!box) return;
  const types = { ...ACT_TYPES, question: "שאלת שו\"ת" };
  box.innerHTML = S.cf.conds.map((c, i) => `
    <div class="cond" data-i="${i}">
      <select data-k="has"><option value="1" ${c.has ? "selected" : ""}>יש לו</option><option value="0" ${!c.has ? "selected" : ""}>אין לו</option></select>
      <select data-k="type">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input data-k="text" placeholder="שמכיל את הטקסט (רשות) – למשל שם הספר או ההשתלמות" value="${esc(c.text)}">
      <button data-k="del" class="danger" title="הסרת תנאי">✕</button>
    </div>`).join("");
  box.querySelectorAll(".cond").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('[data-k="has"]').onchange = (e) => { S.cf.conds[i].has = e.target.value === "1"; renderContactsTable(); };
    row.querySelector('[data-k="type"]').onchange = (e) => { S.cf.conds[i].type = e.target.value; renderContactsTable(); };
    row.querySelector('[data-k="text"]').oninput = (e) => { S.cf.conds[i].text = e.target.value; renderContactsTable(); };
    row.querySelector('[data-k="del"]').onclick = () => { S.cf.conds.splice(i, 1); renderConds(); renderContactsTable(); };
  });
}

function itemsOf(contactId, type) {
  if (type === "question") return (S.qByContact.get(contactId) || []).map((q) => ({ details: `${q.topic || ""} ${q.text || ""}` }));
  return (S.actByContact.get(contactId) || []).filter((a) => a.type === type);
}

function contactMatches(c) {
  const f = S.cf;
  if (f.text) {
    const t = f.text.trim().toLowerCase();
    const hay = [c.firstName, c.lastName, c.email, c.phone, c.phoneKey, c.city, (c.tags || []).join(" ")].join(" ").toLowerCase();
    const digits = t.replace(/\D/g, "");
    if (!hay.includes(t) && !(digits.length >= 4 && (c.phoneKey || "").includes(digits))) return false;
  }
  if (f.tag && !(c.tags || []).includes(f.tag)) return false;
  if (f.consent && consentOf(c) !== f.consent) return false;
  for (const cond of f.conds) {
    const t = (cond.text || "").trim().toLowerCase();
    const hit = itemsOf(c.id, cond.type).some((i) => !t || String(i.details || "").toLowerCase().includes(t));
    if (cond.has !== hit) return false;
  }
  return true;
}

function filteredContacts() {
  return [...S.contacts.values()].filter(contactMatches)
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "he"));
}

function renderContactsTable() {
  const box = $("contactsTable"); if (!box) return;
  const list = filteredContacts();
  $("contactsCount").textContent = `${list.length} אנשי קשר${list.length > 300 ? " (מוצגים 300 הראשונים)" : ""}`;
  box.innerHTML = `<table>
    <thead><tr><th>שם</th><th>מייל</th><th class="hide-mobile">טלפון</th><th class="hide-mobile">יישוב</th><th>דיוור</th><th>היסטוריה</th></tr></thead>
    <tbody>${list.slice(0, 300).map((c) => `
      <tr class="click" data-id="${c.id}">
        <td>${esc(fullName(c))}${(c.tags || []).map((t) => ` <span class="badge">${esc(t)}</span>`).join("")}</td>
        <td>${esc(c.email)}</td><td class="hide-mobile">${esc(c.phone)}</td><td class="hide-mobile">${esc(c.city)}</td>
        <td><span class="badge ${CONSENT_BADGE[consentOf(c)]}">${CONSENT[consentOf(c)]}</span></td>
        <td>${summaryBadges(c.id)}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="muted">לא נמצאו אנשי קשר</td></tr>'}</tbody></table>`;
  box.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => openContact(tr.dataset.id)));
}

function exportContacts() {
  const rows = filteredContacts().map((c) => {
    const n = countsOf(c.id);
    return {
      "שם פרטי": c.firstName || "", "שם משפחה": c.lastName || "", "מייל": c.email || "", "טלפון": c.phone || "",
      "יישוב": c.city || "", "תגיות": (c.tags || []).join(", "),
      "הסכמת מייל": CONSENT[consentOf(c)], "הסכמת SMS/וואטסאפ": CONSENT[consentOf(c, "Sms")],
      "תרומות": n.donation, "השתלמויות": n.course, "רכישות ספרים": n.book_purchase, "קבלת ספרים": n.book_received,
      "שאלות": n.questions, "מקור": c.source || "", "נוצר": fmtDate(c.createdAt)
    };
  });
  exportXlsx(rows, "אנשי-קשר.xlsx");
}

async function copyEmails() {
  const list = filteredContacts();
  const ok = list.filter((c) => consentOf(c) === "yes" && c.email);
  if (!ok.length) return toast("אין ברשימה אנשים שאישרו דיוור במייל", "bad");
  try {
    await navigator.clipboard.writeText(ok.map((c) => c.email).join(", "));
    toast(`הועתקו ${ok.length} מיילים. ${list.length - ok.length} לא נכללו כי לא אישרו דיוור או חסר מייל.`, "good");
  } catch { toast("ההעתקה נכשלה", "bad"); }
}

async function saveList() {
  const name = prompt("שם לרשימה (למשל: תורמים שאישרו מייל)");
  if (!name) return;
  await addDoc(collection(db, "savedLists"), { name, filter: JSON.parse(JSON.stringify(S.cf)), createdBy: S.user.uid, createdAt: serverTimestamp() });
  toast("הרשימה נשמרה", "good");
}
function loadList(id) {
  $("btnDelList").classList.toggle("hidden", !id);
  if (!id) return;
  const l = S.lists.get(id); if (!l) return;
  S.cf = { text: "", tag: "", consent: "", conds: [], ...l.filter };
  $("fText").value = S.cf.text; $("fConsent").value = S.cf.consent;
  renderTagSelect(); renderConds(); renderContactsTable();
}
async function deleteList() {
  const id = $("listSelect").value; if (!id) return;
  if (!confirm("למחוק את הרשימה השמורה? אנשי הקשר עצמם לא יימחקו.")) return;
  await deleteDoc(doc(db, "savedLists", id));
  toast("הרשימה נמחקה");
}

// ---------- כרטיס איש קשר ----------
function openContact(id) {
  const c = id ? S.contacts.get(id) : { tags: [], consentEmail: { status: "unknown" }, consentSms: { status: "unknown" } };
  if (!c) return;
  const ro = can("rabbi");
  const dis = ro ? "disabled" : "";
  const consentSel = (k, cur) => `<select id="${k}" ${dis}>${Object.entries(CONSENT).map(([v, l]) => `<option value="${v}" ${cur === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const consentInfo = (o) => o?.at && o.status !== "unknown" ? `<div class="small muted">עודכן ${fmtDate(o.at)}${o.source ? " · " + esc(o.source) : ""}</div>` : "";

  openModal(`
    <div class="head"><h2>${id ? esc(fullName(c)) : "איש קשר חדש"}</h2><button class="close" data-close>×</button></div>
    <div class="split">
      <div>
        <div class="grid2">
          <div class="field"><label>שם פרטי</label><input id="cFirst" value="${esc(c.firstName)}" ${dis}></div>
          <div class="field"><label>שם משפחה</label><input id="cLast" value="${esc(c.lastName)}" ${dis}></div>
          <div class="field"><label>מייל</label><input id="cEmail" type="email" value="${esc(c.email)}" ${dis}></div>
          <div class="field"><label>טלפון</label><input id="cPhone" value="${esc(c.phone)}" ${dis}></div>
          <div class="field"><label>יישוב</label><input id="cCity" value="${esc(c.city)}" ${dis}></div>
          <div class="field"><label>תגיות (מופרדות בפסיק)</label><input id="cTags" value="${esc((c.tags || []).join(", "))}" ${dis}></div>
          <div class="field"><label>הסכמה לדיוור במייל</label>${consentSel("cConsentEmail", consentOf(c))}${consentInfo(c.consentEmail)}</div>
          <div class="field"><label>הסכמה ל-SMS / וואטסאפ</label>${consentSel("cConsentSms", consentOf(c, "Sms"))}${consentInfo(c.consentSms)}</div>
        </div>
        <div class="field"><label>הערות פנימיות</label><textarea id="cNotes" ${dis}>${esc(c.notes)}</textarea></div>
        ${id ? `<p class="small muted">מקור: ${esc(c.source || "—")} · נוצר ${fmtDate(c.createdAt)}</p>` : ""}
        ${ro ? "" : `<div class="row space">
          <button class="primary" id="cSave">שמירה</button>
          ${id && can("admin") ? '<button class="danger" id="cDelete">מחיקת איש קשר</button>' : ""}
        </div>`}
      </div>
      <div>
        ${id ? `<h3>היסטוריה</h3>
        ${ro ? "" : `<details style="margin-bottom:10px"><summary class="small">+ הוספת רשומה</summary>
          <div class="grid2" style="margin-top:8px">
            <div class="field"><label>סוג</label><select id="aType">${Object.entries(ACT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
            <div class="field"><label>תאריך</label><input id="aDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div class="field"><label>פרטים</label><input id="aDetails" placeholder="שם ספר, השתלמות, קמפיין..."></div>
            <div class="field"><label>סכום (₪, רשות)</label><input id="aAmount" type="number"></div>
          </div><button id="aAdd">הוספה</button></details>`}
        <ul class="timeline" id="cTimeline"></ul>` : '<p class="muted">ההיסטוריה תופיע אחרי השמירה.</p>'}
      </div>
    </div>`, () => {
    if (id) renderTimeline(id);
    if ($("cSave")) $("cSave").onclick = () => saveContact(id);
    if ($("cDelete")) $("cDelete").onclick = () => deleteContact(id);
    if ($("aAdd")) $("aAdd").onclick = async () => {
      const amount = $("aAmount").value ? Number($("aAmount").value) : null;
      await addDoc(collection(db, "activities"), {
        contactId: id, type: $("aType").value, details: $("aDetails").value.trim(), amount,
        date: $("aDate").value ? Timestamp.fromDate(new Date($("aDate").value)) : Timestamp.now(),
        source: "הוספה ידנית", createdBy: S.user.uid, createdAt: serverTimestamp()
      });
      toast("נוסף", "good");
      setTimeout(() => renderTimeline(id), 400);
    };
  });
}

function renderTimeline(id) {
  const ul = $("cTimeline"); if (!ul) return;
  const items = [
    ...(S.actByContact.get(id) || []).map((a) => ({ kind: "act", date: a.date, a })),
    ...(S.qByContact.get(id) || []).map((q) => ({ kind: "q", date: q.createdAt, q }))
  ];
  sortByDateDesc(items, "date");
  ul.innerHTML = items.map((it) => {
    if (it.kind === "q") {
      return `<li><div class="when">${fmtDate(it.date)} · שאלת שו"ת <span class="badge ${Q_BADGE[it.q.status]}">${Q_STATUS[it.q.status]}</span></div>
        <button class="link" data-q="${it.q.id}">${esc(it.q.topic || "")}: ${esc((it.q.text || "").slice(0, 80))}${(it.q.text || "").length > 80 ? "…" : ""}</button></li>`;
    }
    const a = it.a;
    return `<li><div class="when">${fmtDate(a.date)} · ${ACT_TYPES[a.type] || a.type}${a.amount ? ` · ₪${Number(a.amount).toLocaleString("he-IL")}` : ""}</div>
      <div>${esc(a.details || "")}</div>${a.source ? `<div class="small muted">${esc(a.source)}</div>` : ""}
      ${can("rabbi") ? "" : `<button class="link small x danger" data-del="${a.id}" title="מחיקה">✕</button>`}</li>`;
  }).join("") || '<li class="muted">אין עדיין היסטוריה</li>';
  ul.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => openQuestion(b.dataset.q)));
  ul.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm("למחוק את הרשומה?")) return;
    await deleteDoc(doc(db, "activities", b.dataset.del));
    setTimeout(() => renderTimeline(id), 400);
  }));
}

async function saveContact(id) {
  const email = $("cEmail").value.trim(), phone = $("cPhone").value.trim();
  if (!$("cFirst").value.trim() && !$("cLast").value.trim() && !email) return toast("נא למלא לפחות שם או מייל", "bad");
  const dup = findContactId(email, phone);
  if (dup && dup !== id) {
    if (confirm("כבר קיים איש קשר עם המייל או הטלפון האלה. לפתוח את הכרטיס הקיים?")) return openContact(dup);
    return;
  }
  const old = id ? S.contacts.get(id) : {};
  const consent = (key, field) => {
    const v = $(key).value;
    const prev = old?.[field];
    return prev?.status === v ? prev : { status: v, at: Timestamp.now(), source: "עדכון ידני" };
  };
  const data = {
    firstName: $("cFirst").value.trim(), lastName: $("cLast").value.trim(),
    email, emailKey: normEmail(email), phone, phoneKey: normPhone(phone),
    city: $("cCity").value.trim(),
    tags: $("cTags").value.split(",").map((t) => t.trim()).filter(Boolean),
    notes: $("cNotes").value.trim(),
    consentEmail: consent("cConsentEmail", "consentEmail"),
    consentSms: consent("cConsentSms", "consentSms")
  };
  try {
    if (id) await updateDoc(doc(db, "contacts", id), data);
    else {
      const ref = await addDoc(collection(db, "contacts"), { ...data, source: "הוספה ידנית", createdAt: Timestamp.now() });
      id = ref.id;
    }
    toast("נשמר", "good");
    closeModal();
  } catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
}

async function deleteContact(id) {
  const n = countsOf(id);
  if (!confirm(`למחוק את איש הקשר לצמיתות? יימחקו גם ${(S.actByContact.get(id) || []).length} רשומות היסטוריה. שאלות שו"ת יישמרו בלי שיוך.`)) return;
  const b = writeBatch(db);
  (S.actByContact.get(id) || []).forEach((a) => b.delete(doc(db, "activities", a.id)));
  (S.qByContact.get(id) || []).forEach((q) => b.update(doc(db, "questions", q.id), { contactId: "deleted", firstName: "", lastName: "", email: "", phone: "" }));
  b.delete(doc(db, "contacts", id));
  await b.commit();
  toast("נמחק"); closeModal();
}

// ---------- כפילויות ----------
function findDuplicateGroups() {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  S.contacts.forEach((c) => parent.set(c.id, c.id));
  const byKey = new Map();
  S.contacts.forEach((c) => {
    for (const k of [c.emailKey && "e:" + c.emailKey, c.phoneKey && "p:" + c.phoneKey]) {
      if (!k) continue;
      if (byKey.has(k)) union(c.id, byKey.get(k)); else byKey.set(k, c.id);
    }
  });
  const groups = new Map();
  S.contacts.forEach((c) => { const r = find(c.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  return [...groups.values()].filter((g) => g.length > 1);
}

function openDuplicates() {
  const groups = findDuplicateGroups();
  openModal(`
    <div class="head"><h2>כפילויות (${groups.length})</h2><button class="close" data-close>×</button></div>
    <p class="muted small">אנשי קשר עם אותו מייל או טלפון. במיזוג נשמר הכרטיס הוותיק, שדות ריקים מתמלאים מהאחרים, וכל ההיסטוריה עוברת אליו.</p>
    ${groups.map((g, i) => `<div class="card"><div class="row space">
      <div>${g.map((c) => `<div><b>${esc(fullName(c))}</b> · ${esc(c.email)} · ${esc(c.phone)} <span class="small muted">(${esc(c.source || "")}, ${fmtDate(c.createdAt)})</span></div>`).join("")}</div>
      <button class="primary" data-merge="${i}">מיזוג</button></div></div>`).join("") || '<p>לא נמצאו כפילויות 👍</p>'}`,
  (root) => root.querySelectorAll("[data-merge]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    await mergeContacts(groups[Number(b.dataset.merge)].map((c) => c.id));
    toast("מוזג", "good");
    b.closest(".card").remove();
  })));
}

async function mergeContacts(ids) {
  const list = ids.map((i) => S.contacts.get(i)).sort((a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
  const [p, ...rest] = list;
  const upd = {};
  const tags = new Set(p.tags || []);
  let notes = p.notes || "";
  let cE = p.consentEmail, cS = p.consentSms;
  const pick = (a, b) => {
    if (a?.status === "removed") return a;
    if (b?.status === "removed") return b;
    if (!a || a.status === "unknown") return b || a;
    if (!b || b.status === "unknown") return a;
    return (toDate(b.at)?.getTime() || 0) > (toDate(a.at)?.getTime() || 0) ? b : a;
  };
  for (const c of rest) {
    for (const k of ["firstName", "lastName", "email", "emailKey", "phone", "phoneKey", "city"]) if (!p[k] && !upd[k] && c[k]) upd[k] = c[k];
    (c.tags || []).forEach((t) => tags.add(t));
    if (c.notes && !notes.includes(c.notes)) notes = notes ? notes + "\n" + c.notes : c.notes;
    cE = pick(cE, c.consentEmail); cS = pick(cS, c.consentSms);
  }
  Object.assign(upd, { tags: [...tags], notes, consentEmail: cE || { status: "unknown" }, consentSms: cS || { status: "unknown" } });
  const b = writeBatch(db);
  b.update(doc(db, "contacts", p.id), upd);
  for (const c of rest) {
    (S.actByContact.get(c.id) || []).forEach((a) => b.update(doc(db, "activities", a.id), { contactId: p.id }));
    (S.qByContact.get(c.id) || []).forEach((q) => b.update(doc(db, "questions", q.id), { contactId: p.id }));
    b.delete(doc(db, "contacts", c.id));
  }
  await b.commit();
}

// ======================================================
// שו"ת
// ======================================================
function qCardHtml(q) {
  return `<div class="qcard" data-q="${q.id}">
    <div class="row space"><b>${esc([q.firstName, q.lastName].filter(Boolean).join(" ") || q.email || "שואל")}</b>
      <span><span class="badge ${Q_BADGE[q.status]}">${Q_STATUS[q.status]}</span>${q.topic ? `<span class="badge">${esc(q.topic)}</span>` : ""}</span></div>
    <div class="qtext">${esc(q.text)}</div>
    ${qTags(q).length ? `<div>${tagBadges(q)}</div>` : ""}
    <div class="row space small"><span>${contextBadges(q.contactId, q.id)}</span>
      <span class="muted">${fmtDate(q.createdAt)}${q.rabbiEmail ? " · " + esc(userName(q.rabbiEmail)) : " · לא שויך"}</span></div>
  </div>`;
}
function bindQCards() { document.querySelectorAll(".qcard[data-q]").forEach((el) => (el.onclick = () => openQuestion(el.dataset.q))); }

function filteredQuestions() {
  const f = S.qf;
  return sortByDateDesc([...S.questions.values()].filter((q) => {
    if (f.status && q.status !== f.status) return false;
    if (f.rabbi === "mine" && q.rabbiEmail !== myEmail()) return false;
    if (f.rabbi === "none" && q.rabbiEmail) return false;
    if (f.rabbi && !["mine", "none"].includes(f.rabbi) && q.rabbiEmail !== f.rabbi) return false;
    if (f.topic && q.topic !== f.topic) return false;
    if (f.tag && !qTags(q).includes(f.tag)) return false;
    if (f.text) {
      const t = f.text.toLowerCase();
      if (![q.text, q.answer, q.firstName, q.lastName, q.email, qTags(q).join(" ")].join(" ").toLowerCase().includes(t)) return false;
    }
    return true;
  }), "createdAt");
}

function renderQuestions(full) {
  if (!full && $("qList")) { renderQList(); return; }
  const f = S.qf;
  const cnt = (st) => [...S.questions.values()].filter((q) => !st || q.status === st).length;
  $("main").innerHTML = `
    <div class="row space"><h1>שו"ת – שאל את הרב</h1>
      <div class="row"><button id="btnNewQ">+ שאלה ידנית</button><button id="btnExportQ">ייצוא ל-Excel</button></div></div>
    <div class="tabs" id="qTabs">
      ${[["new", "חדשות"], ["in_progress", "בטיפול"], ["answered", "נענו"], ["", "הכול"]].map(([k, l]) =>
        `<button data-st="${k}" class="${f.status === k ? "active" : ""}">${l} (<span data-cnt="${k}">${cnt(k)}</span>)</button>`).join("")}
    </div>
    <div class="card"><div class="row">
      <input id="qText" class="grow" placeholder="חיפוש בשאלות ובתשובות" value="${esc(f.text)}">
      <select id="qRabbi" style="width:auto">
        <option value="">כל הרבנים</option><option value="mine">השאלות שלי</option><option value="none">לא שויכו</option>
        ${rabbis().map((r) => `<option value="${r.id}">${esc(userName(r.id))}</option>`).join("")}
      </select>
      <select id="qTopic" style="width:auto"><option value="">כל הקטגוריות</option>${S.tax.categories.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
      <select id="qTag" style="width:auto"><option value="">כל התגיות</option>${allTagNames().map((t) => `<option>${esc(t)}</option>`).join("")}</select>
    </div></div>
    <div class="qlist" id="qList"></div>`;
  $("qRabbi").value = f.rabbi; $("qTopic").value = f.topic; $("qTag").value = f.tag;
  $("qTag").onchange = (e) => { S.qf.tag = e.target.value; renderQList(); };
  $("qTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.qf.status = b.dataset.st; renderQuestions(true); }));
  $("qText").oninput = (e) => { S.qf.text = e.target.value; renderQList(); };
  $("qRabbi").onchange = (e) => { S.qf.rabbi = e.target.value; renderQList(); };
  $("qTopic").onchange = (e) => { S.qf.topic = e.target.value; renderQList(); };
  $("btnExportQ").onclick = exportQuestions;
  $("btnNewQ").onclick = openManualQuestion;
  renderQList();
}

function allTagNames() {
  const set = new Set(S.tax.tags.map((t) => t.name));
  S.questions.forEach((q) => qTags(q).forEach((t) => set.add(t)));
  return [...set].sort((a, b) => a.localeCompare(b, "he"));
}

function renderQList() {
  const box = $("qList"); if (!box) return;
  document.querySelectorAll("[data-cnt]").forEach((s) => {
    const k = s.dataset.cnt; s.textContent = [...S.questions.values()].filter((q) => !k || q.status === k).length;
  });
  const list = filteredQuestions();
  box.innerHTML = list.slice(0, 200).map(qCardHtml).join("") || '<p class="muted">אין שאלות להצגה</p>';
  bindQCards();
}

function exportQuestions() {
  const rows = filteredQuestions().map((q) => {
    const n = q.contactId ? countsOf(q.contactId) : {};
    return {
      "תאריך": fmtDate(q.createdAt), "שם": [q.firstName, q.lastName].filter(Boolean).join(" "), "מייל": q.email || "", "טלפון": q.phone || "",
      "קטגוריה": q.topic || "", "תגיות": qTags(q).join(", "), "שאלה": q.text || "", "סטטוס": Q_STATUS[q.status] || "", "רב": userName(q.rabbiEmail),
      "תשובה": q.answer || "", "תאריך מענה": fmtDate(q.answeredAt), "פורסם במאגר": q.publish ? "כן" : "לא",
      "תורם": n.donation ? "כן" : "", "משתתף השתלמויות": n.course ? "כן" : "", "מקור": q.origin || ""
    };
  });
  exportXlsx(rows, "שאלות-שות.xlsx");
}

function openQuestion(id) {
  const q = S.questions.get(id); if (!q) return;
  const c = q.contactId ? S.contacts.get(q.contactId) : null;
  const name = [q.firstName, q.lastName].filter(Boolean).join(" ") || q.email || "שואל";
  openModal(`
    <div class="head"><h2>שאלה מאת ${esc(name)}</h2><button class="close" data-close>×</button></div>
    <div class="split">
      <div>
        <p class="small muted">${fmtDate(q.createdAt)} · ${esc(q.topic || "ללא קטגוריה")} · ${esc(q.origin || "")}</p>
        <div class="card pre" style="background:var(--surface-2)">${esc(q.text)}</div>
        <div class="field"><label>תשובה</label><textarea id="qAnswer" style="min-height:180px">${esc(q.answer)}</textarea></div>
        <div class="grid2">
          <div class="field"><label>רב משיב</label><select id="qRabbiSel"><option value="">לא שויך</option>
            ${rabbis().map((r) => `<option value="${r.id}" ${q.rabbiEmail === r.id ? "selected" : ""}>${esc(userName(r.id))}</option>`).join("")}</select></div>
          <div class="field"><label>סטטוס</label><select id="qStatusSel">
            ${Object.entries(Q_STATUS).map(([k, v]) => `<option value="${k}" ${q.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>קטגוריה</label><select id="qTopicSel">${categoryOptions(q.topic, true)}</select></div>
          <div class="field"><label>תגיות ידניות (מופרדות בפסיק)</label><input id="qTagsIn" value="${esc((q.tags || []).join(", "))}" list="tagNames">
            <datalist id="tagNames">${allTagNames().map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>
        </div>
        <p class="small muted">תגיות אוטומטיות: <span id="qAutoTags">${(q.autoTags || []).map((t) => `<span class="badge brand">${esc(t)}</span>`).join("") || "אין"}</span></p>
        <details ${q.publish ? "open" : ""} class="card" style="padding:10px 14px">
          <summary>פרסום במאגר השו"ת הציבורי</summary>
          <label class="check" style="margin-top:8px"><input type="checkbox" id="qPublish" ${q.publish ? "checked" : ""}> לפרסם בעילום שם</label>
          <div class="field" style="margin-top:8px"><label>נוסח השאלה לפרסום (הסירו פרטים מזהים)</label>
            <textarea id="qPublicText">${esc(q.publicText ?? q.text)}</textarea></div>
          <p class="small muted">התשובה תפורסם כפי שהיא כתובה למעלה.</p>
        </details>
        <div class="row">
          <button class="primary" id="qSave">שמירה</button>
          <button id="qCopy">העתקת התשובה</button>
          ${q.email ? `<a class="btn" id="qMail" href="#">פתיחה במייל</a>` : ""}
        </div>
      </div>
      <div>
        <h3>על השואל</h3>
        <div class="context">${contextBadges(q.contactId, q.id)}</div>
        <p>${esc(q.email)}${q.phone ? "<br>" + esc(q.phone) : ""}</p>
        <p class="small">הסכמה לדיוור: ${c ? CONSENT[consentOf(c)] : (q.consentEmail ? "אישר בטופס" : "לא אישר")}</p>
        ${c ? `<button id="qOpenContact">פתיחת כרטיס איש הקשר</button>` : ""}
        <h3 style="margin-top:16px">שאלות קודמות</h3>
        <ul class="timeline">${(q.contactId ? sortByDateDesc((S.qByContact.get(q.contactId) || []).filter((x) => x.id !== id), "createdAt") : [])
          .map((x) => `<li><div class="when">${fmtDate(x.createdAt)} · <span class="badge ${Q_BADGE[x.status]}">${Q_STATUS[x.status]}</span></div>
            <button class="link" data-prevq="${x.id}">${esc((x.text || "").slice(0, 90))}</button></li>`).join("") || '<li class="muted">אין</li>'}</ul>
      </div>
    </div>`, (root) => {
    $("qSave").onclick = () => saveQuestion(id);
    $("qCopy").onclick = async () => { await navigator.clipboard.writeText($("qAnswer").value); toast("התשובה הועתקה", "good"); };
    if ($("qMail")) $("qMail").onclick = (e) => {
      e.preventDefault();
      const body = `שלום ${q.firstName || ""},\n\nבתשובה לשאלתך:\n${q.text}\n\n${$("qAnswer").value}\n\nבברכה,\nמכון משפטי ארץ`;
      location.href = `mailto:${encodeURIComponent(q.email)}?subject=${encodeURIComponent("תשובה לשאלתך – מכון משפטי ארץ")}&body=${encodeURIComponent(body)}`;
    };
    if ($("qOpenContact")) $("qOpenContact").onclick = () => openContact(q.contactId);
    root.querySelectorAll("[data-prevq]").forEach((b) => (b.onclick = () => openQuestion(b.dataset.prevq)));
    $("qAnswer").addEventListener("input", () => {
      if ($("qStatusSel").value === "new" && $("qAnswer").value.trim()) $("qStatusSel").value = "in_progress";
      $("qAutoTags").innerHTML = calcAutoTags(q.text, $("qAnswer").value).map((t) => `<span class="badge brand">${esc(t)}</span>`).join("") || "אין";
    });
  });
}

async function saveQuestion(id) {
  const q = S.questions.get(id);
  const status = $("qStatusSel").value;
  const answer = $("qAnswer").value.trim();
  const publish = $("qPublish").checked;
  const publicText = $("qPublicText").value.trim();
  if (status === "answered" && !answer) return toast("כדי לסמן 'נענתה' צריך לכתוב תשובה", "bad");
  if (publish && (!answer || status !== "answered")) return toast("אפשר לפרסם רק שאלה שנענתה", "bad");
  // רב שעונה על שאלה שלא שויכה – משויך אליה אוטומטית
  const rabbiEmail = $("qRabbiSel").value || (status !== "new" && can("rabbi") ? myEmail() : "");
  const tags = [...new Set($("qTagsIn").value.split(",").map((t) => t.trim()).filter(Boolean))];
  const autoTags = calcAutoTags(q.text, answer);
  const upd = { status, answer, rabbiEmail: rabbiEmail || "", topic: $("qTopicSel").value, tags, autoTags, publish, publicText, updatedAt: serverTimestamp() };
  if (status === "answered" && q.status !== "answered") upd.answeredAt = serverTimestamp();
  try {
    await updateDoc(doc(db, "questions", id), upd);
    if (publish) {
      await setDoc(doc(db, "publicQA", id), { topic: upd.topic, tags: [...new Set([...tags, ...autoTags])], question: publicText, answer, rabbiName: userName(rabbiEmail), publishedAt: q.publish ? (q.publishedAt || serverTimestamp()) : serverTimestamp() });
      if (!q.publish) await updateDoc(doc(db, "questions", id), { publishedAt: serverTimestamp() });
    } else if (q.publish) {
      await deleteDoc(doc(db, "publicQA", id));
    }
    toast("נשמר", "good"); closeModal();
  } catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
}

function openManualQuestion() {
  openModal(`
    <div class="head"><h2>הוספת שאלה ידנית</h2><button class="close" data-close>×</button></div>
    <p class="muted small">לשאלות שהגיעו במייל, בטלפון או בעל-פה. השואל יקושר אוטומטית לכרטיס קיים לפי מייל או טלפון.</p>
    <div class="grid2">
      <div class="field"><label>שם פרטי</label><input id="mFirst"></div>
      <div class="field"><label>שם משפחה</label><input id="mLast"></div>
      <div class="field"><label>מייל</label><input id="mEmail" type="email"></div>
      <div class="field"><label>טלפון</label><input id="mPhone"></div>
      <div class="field"><label>קטגוריה</label><select id="mTopic">${categoryOptions(S.tax.defaultCategory, false)}</select></div>
      <div class="field"><label>מקור</label><select id="mOrigin"><option>מייל</option><option>טלפון</option><option>וואטסאפ</option><option>בעל-פה</option></select></div>
      <div class="field"><label>תאריך השאלה</label><input id="mDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    <div class="field"><label>השאלה</label><textarea id="mText"></textarea></div>
    <label class="check"><input type="checkbox" id="mConsent"> השואל אישר קבלת דיוור במייל</label>
    <div class="row" style="margin-top:12px"><button class="primary" id="mSave">שמירה</button></div>`, () => {
    $("mSave").onclick = async () => {
      if (!$("mText").value.trim()) return toast("נא לכתוב את השאלה", "bad");
      if (!$("mEmail").value.trim() && !$("mPhone").value.trim()) return toast("נא למלא מייל או טלפון", "bad");
      await addDoc(collection(db, "questions"), {
        firstName: $("mFirst").value.trim(), lastName: $("mLast").value.trim(), email: $("mEmail").value.trim(), phone: $("mPhone").value.trim(),
        topic: $("mTopic").value, text: $("mText").value.trim(), consentEmail: $("mConsent").checked,
        tags: [], autoTags: calcAutoTags($("mText").value, ""),
        status: "new", contactId: null, origin: $("mOrigin").value, createdBy: S.user.uid,
        createdAt: Timestamp.fromDate(new Date($("mDate").value || Date.now()))
      });
      toast("השאלה נוספה", "good"); closeModal();
    };
  });
}

// ======================================================
// ייבוא מאקסל
// ======================================================
const IMPORT_FIELDS = [
  ["firstName", "שם פרטי", /פרטי|first/i],
  ["lastName", "שם משפחה", /משפחה|last|surname/i],
  ["fullName", "שם מלא (עמודה אחת)", /^(שם|שם מלא|name|full ?name|שם התורם|שם הלקוח)$/i],
  ["email", "מייל", /מייל|דוא|e-?mail|mail/i],
  ["phone", "טלפון", /טלפון|נייד|phone|mobile|tel|סלולרי/i],
  ["city", "יישוב", /עיר|יישוב|ישוב|city/i],
  ["date", "תאריך", /תאריך|date/i],
  ["amount", "סכום", /סכום|amount|sum|total/i],
  ["details", "פרטים (ספר / השתלמות / קמפיין)", /פרטים|קמפיין|השתלמות|ספר|campaign|details|description|תיאור|פרויקט|מוצר/i],
  ["consent", "הסכמה לדיוור", /דיוור|הסכמ|consent|newsletter|marketing|עדכונים/i]
];
let IMP = null;

function renderImport(full) {
  if (!full) return;
  $("main").innerHTML = `
    <h1>ייבוא מאקסל</h1>
    <div class="card medium" style="margin:0 0 16px">
      <p class="muted">מעלים קובץ Excel או CSV (למשל דוח תרומות מ-Jgive, רשימת משתתפי השתלמות או רשימת מקבלי ספרים). המערכת מזהה אנשים קיימים לפי מייל או טלפון, ולא יוצרת כפילויות.</p>
      <div class="grid2">
        <div class="field"><label>קובץ</label><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></div>
        <div class="field"><label>מה הקובץ מכיל?</label><select id="impType">
          <option value="contacts">אנשי קשר בלבד</option>
          ${Object.entries(ACT_TYPES).filter(([k]) => k !== "note").map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select></div>
      </div>
      <div id="impMap"></div>
    </div>`;
  $("impFile").onchange = readImportFile;
}

async function readImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  if (!rows.length) return toast("הקובץ ריק", "bad");
  const headers = Object.keys(rows[0]);
  IMP = { file: file.name, rows, headers };
  const guess = (re) => headers.find((h) => re.test(String(h).trim())) || "";
  $("impMap").innerHTML = `
    <h3>התאמת עמודות (${rows.length} שורות)</h3>
    <div class="grid2">${IMPORT_FIELDS.map(([k, label, re]) => `
      <div class="field"><label>${label}</label><select data-f="${k}"><option value="">— לא קיים —</option>
        ${headers.map((h) => `<option ${guess(re) === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("")}
    </div>
    <div class="field"><label>תיאור קבוע לכל השורות (רשות – למשל "השתלמות שמיטה תשפ״ז")</label><input id="impFixed"></div>
    <div class="table-wrap" style="max-height:220px;margin-bottom:12px"><table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0, 5).map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h] instanceof Date ? fmtDate(r[h]) : r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <button class="primary" id="impRun">ייבוא</button> <span id="impProgress" class="muted"></span>`;
  $("impRun").onclick = runImport;
}

const truthy = (v) => /^(כן|yes|y|true|1|v|✓|מאשר|מאושר)$/i.test(String(v).trim());

async function runImport() {
  const map = {};
  document.querySelectorAll("#impMap select[data-f]").forEach((s) => (map[s.dataset.f] = s.value));
  if (!map.email && !map.phone) return toast("חובה לבחור עמודת מייל או טלפון", "bad");
  const type = $("impType").value;
  const fixed = $("impFixed").value.trim();
  const btn = $("impRun"); btn.disabled = true;

  const idxE = new Map(S.byEmail), idxP = new Map(S.byPhone);
  const pending = new Map(); // contactId -> data (new or updates)
  let created = 0, updated = 0, acts = 0, skipped = 0;
  let batch = writeBatch(db), ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
  const val = (r, k) => (map[k] ? r[map[k]] : "");

  for (const r of IMP.rows) {
    let first = String(val(r, "firstName") || "").trim(), last = String(val(r, "lastName") || "").trim();
    const full = String(val(r, "fullName") || "").trim();
    if (!first && !last && full) { const parts = full.split(/\s+/); first = parts.shift() || ""; last = parts.join(" "); }
    const email = String(val(r, "email") || "").trim(), phone = String(val(r, "phone") || "").trim();
    const eK = normEmail(email), pK = normPhone(phone);
    if (!eK && !pK) { skipped++; continue; }
    const consent = map.consent ? truthy(val(r, "consent")) : undefined;
    let id = (eK && idxE.get(eK)) || (pK && idxP.get(pK));
    if (!id) {
      const ref = doc(collection(db, "contacts"));
      id = ref.id;
      const data = newContactData({ firstName: first, lastName: last, email, phone, city: String(val(r, "city") || ""), consentEmail: consent, source: "ייבוא: " + IMP.file });
      batch.set(ref, data); ops++; created++;
      pending.set(id, data);
    } else {
      const c = pending.get(id) || S.contacts.get(id) || {};
      const upd = {};
      if (!c.firstName && first) upd.firstName = first;
      if (!c.lastName && last) upd.lastName = last;
      if (!c.email && email) { upd.email = email; upd.emailKey = eK; }
      if (!c.phone && phone) { upd.phone = phone; upd.phoneKey = pK; }
      if (!c.city && val(r, "city")) upd.city = String(val(r, "city"));
      if (consent && !["yes", "removed"].includes(c.consentEmail?.status)) upd.consentEmail = { status: "yes", at: Timestamp.now(), source: "ייבוא: " + IMP.file };
      if (Object.keys(upd).length) { batch.update(doc(db, "contacts", id), upd); ops++; updated++; pending.set(id, { ...c, ...upd }); }
    }
    if (eK) idxE.set(eK, id);
    if (pK) idxP.set(pK, id);
    if (type !== "contacts") {
      const d = toDate(val(r, "date"));
      const amt = parseFloat(String(val(r, "amount") || "").replace(/[^\d.]/g, ""));
      batch.set(doc(collection(db, "activities")), {
        contactId: id, type, details: [fixed, String(val(r, "details") || "").trim()].filter(Boolean).join(" · "),
        amount: isNaN(amt) ? null : amt, date: d ? Timestamp.fromDate(d) : Timestamp.now(),
        source: "ייבוא: " + IMP.file, createdBy: S.user.uid, createdAt: serverTimestamp()
      });
      ops++; acts++;
    }
    if (ops >= 400) { await flush(); $("impProgress").textContent = `מייבא... ${created + updated} אנשי קשר`; }
  }
  try {
    await flush();
    $("impProgress").textContent = "";
    toast(`הייבוא הסתיים: ${created} חדשים, ${updated} עודכנו, ${acts} רשומות היסטוריה, ${skipped} שורות בלי מייל וטלפון דולגו`, "good");
    renderImport(true);
  } catch (e) { toast("הייבוא נכשל: " + e.code, "bad"); btn.disabled = false; }
}

// ======================================================
// משתמשים
// ======================================================
function renderUsers(full) {
  const keep = full ? null : { e: $("uEmail")?.value, n: $("uName")?.value, r: $("uRole")?.value };
  const users = [...S.users.values()].sort((a, b) => userName(a.id).localeCompare(userName(b.id), "he"));
  const roleOpts = (cur) => Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`).join("");
  $("main").innerHTML = `
    <h1>משתמשים מורשים</h1>
    <p class="muted">רק מי שהמייל שלו ברשימה יכול להיכנס עם חשבון ה-Google שלו. הסרה מהרשימה חוסמת את הגישה מיד.</p>
    <div class="card">
      <h3>הוספת משתמש</h3>
      <div class="row">
        <input id="uEmail" type="email" class="grow" placeholder="כתובת Gmail / Google">
        <input id="uName" class="grow" placeholder="שם">
        <select id="uRole" style="width:auto">${roleOpts("staff")}</select>
        <button class="primary" id="uAdd">הוספה</button>
      </div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>שם</th><th>מייל</th><th>תפקיד</th><th class="hide-mobile">כניסה אחרונה</th><th></th></tr></thead>
      <tbody>${users.map((u) => {
        const me = u.id === myEmail();
        return `<tr><td>${esc(u.name || "")}</td><td>${esc(u.id)}</td>
        <td><select data-email="${esc(u.id)}" style="width:auto" ${me ? "disabled" : ""}>${roleOpts(u.role)}</select></td>
        <td class="hide-mobile small muted">${u.lastLogin ? fmtDate(u.lastLogin) : "עוד לא נכנס"}</td>
        <td>${me ? "" : `<button class="danger" data-remove="${esc(u.id)}">הסרה</button>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>
    <div class="card small muted">
      <b>מה כל תפקיד רואה:</b> מנהל מערכת – הכול, כולל משתמשים ומחיקה. רכז הרכזים וצוות – אנשי קשר, שו"ת וייבוא.
      רב משיב – שו"ת ותקציר על השואל, צפייה בלבד בכרטיסי אנשי קשר.
    </div>`;
  if (keep?.e != null) { $("uEmail").value = keep.e; $("uName").value = keep.n; $("uRole").value = keep.r; }
  $("uAdd").onclick = async () => {
    const email = normEmail($("uEmail").value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("כתובת מייל לא תקינה", "bad");
    if (S.users.has(email)) return toast("המייל כבר ברשימה", "bad");
    try {
      await setDoc(doc(db, "allowedEmails", email), { name: $("uName").value.trim(), role: $("uRole").value, addedBy: myEmail(), addedAt: serverTimestamp() });
      toast("נוסף. עכשיו הוא יכול להיכנס עם חשבון ה-Google שלו", "good");
    } catch (e) { toast("ההוספה נכשלה: " + e.code, "bad"); }
  };
  document.querySelectorAll("select[data-email]").forEach((s) => (s.onchange = async () => {
    try { await updateDoc(doc(db, "allowedEmails", s.dataset.email), { role: s.value }); toast("התפקיד עודכן", "good"); }
    catch (e) { toast("העדכון נכשל: " + e.code, "bad"); }
  }));
  document.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`להסיר את ${b.dataset.remove}? הגישה שלו תיחסם מיד.`)) return;
    try { await deleteDoc(doc(db, "allowedEmails", b.dataset.remove)); toast("הוסר"); }
    catch (e) { toast("ההסרה נכשלה: " + e.code, "bad"); }
  }));
}

// ======================================================
// הגדרות: קטגוריות ותגיות
// ======================================================
let SET = null; // טיוטת עריכה

function renderSettings(full) {
  if (!full && $("setCats")) return; // לא לדרוס עריכה פתוחה
  SET = JSON.parse(JSON.stringify(S.tax));
  $("main").innerHTML = `
    <h1>הגדרות שו"ת</h1>
    <div class="split">
      <div class="card">
        <h2>קטגוריות</h2>
        <p class="small muted">מופיעות בטופס "שאל את הרב", במאגר ובסינון. הקטגוריה המסומנת היא ברירת המחדל בטופס.</p>
        <div id="setCats"></div>
        <button id="addCat" style="margin-top:8px">+ קטגוריה</button>
      </div>
      <div class="card">
        <h2>תגיות ומילות מפתח</h2>
        <p class="small muted">תגית מתווספת אוטומטית לשאלה כשאחת ממילות המפתח מופיעה בשאלה או בתשובה. אפשר לכתוב חלק ממילה – למשל "שכיר" יתפוס גם "השכירות" ו"שכירים". תגית בלי מילות מפתח משמשת רק לתיוג ידני.</p>
        <div id="setTags"></div>
        <button id="addTag" style="margin-top:8px">+ תגית</button>
      </div>
    </div>
    <div class="row">
      <button class="primary" id="saveSet">שמירת ההגדרות</button>
      <button id="retagAll">החלת תגיות אוטומטיות על כל השאלות הקיימות</button>
      <span id="retagMsg" class="muted small"></span>
    </div>`;
  drawSettingsLists();
  $("addCat").onclick = () => { SET.categories.push(""); drawSettingsLists(); };
  $("addTag").onclick = () => { SET.tags.push({ name: "", keywords: [] }); drawSettingsLists(); };
  $("saveSet").onclick = saveSettings;
  $("retagAll").onclick = retagAll;
}

function drawSettingsLists() {
  $("setCats").innerHTML = SET.categories.map((c, i) => `
    <div class="cond" data-i="${i}">
      <label class="check" title="ברירת מחדל" style="margin:0"><input type="radio" name="defCat" data-k="def" ${c && c === SET.defaultCategory ? "checked" : ""}></label>
      <input data-k="name" value="${esc(c)}" placeholder="שם הקטגוריה" style="flex:1">
      <button data-k="up" title="למעלה" ${i === 0 ? "disabled" : ""}>▲</button>
      <button data-k="del" class="danger" title="מחיקה">✕</button>
    </div>`).join("");
  $("setCats").querySelectorAll(".cond").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('[data-k="name"]').oninput = (e) => {
      const was = SET.categories[i]; SET.categories[i] = e.target.value;
      if (SET.defaultCategory === was) SET.defaultCategory = e.target.value;
    };
    row.querySelector('[data-k="def"]').onchange = () => { SET.defaultCategory = SET.categories[i]; };
    row.querySelector('[data-k="up"]').onclick = () => { const c = SET.categories.splice(i, 1)[0]; SET.categories.splice(i - 1, 0, c); drawSettingsLists(); };
    row.querySelector('[data-k="del"]').onclick = () => { SET.categories.splice(i, 1); drawSettingsLists(); };
  });

  $("setTags").innerHTML = SET.tags.map((t, i) => `
    <div class="card" data-i="${i}" style="padding:10px 12px;margin-bottom:8px">
      <div class="row">
        <input data-k="name" value="${esc(t.name)}" placeholder="שם התגית (למשל: שכירות)" style="flex:1">
        <button data-k="del" class="danger" title="מחיקה">✕</button>
      </div>
      <input data-k="kw" value="${esc(t.keywords.join(", "))}" placeholder="מילות מפתח, מופרדות בפסיק (למשל: שכיר, משכיר, דמי שכירות)" style="margin-top:6px">
    </div>`).join("") || '<p class="muted small">עדיין אין תגיות.</p>';
  $("setTags").querySelectorAll(".card[data-i]").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('[data-k="name"]').oninput = (e) => { SET.tags[i].name = e.target.value; };
    row.querySelector('[data-k="kw"]').oninput = (e) => { SET.tags[i].keywords = e.target.value.split(",").map((k) => k.trim()).filter(Boolean); };
    row.querySelector('[data-k="del"]').onclick = () => { SET.tags.splice(i, 1); drawSettingsLists(); };
  });
}

async function saveSettings() {
  const cats = [...new Set(SET.categories.map((c) => c.trim()).filter(Boolean))];
  if (!cats.length) return toast("צריך לפחות קטגוריה אחת", "bad");
  const names = SET.tags.map((t) => t.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) return toast("יש שתי תגיות עם אותו שם", "bad");
  const data = normTaxonomy({ categories: cats, defaultCategory: SET.defaultCategory, tags: SET.tags });
  try {
    await setDoc(doc(db, "settings", "taxonomy"), { ...data, updatedBy: myEmail(), updatedAt: serverTimestamp() });
    S.tax = data;
    toast("ההגדרות נשמרו", "good");
    renderSettings(true);
  } catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
}

async function retagAll() {
  const changes = [...S.questions.values()]
    .map((q) => ({ q, auto: calcAutoTags(q.text, q.answer) }))
    .filter(({ q, auto }) => !sameList(q.autoTags, auto));
  if (!changes.length) { $("retagMsg").textContent = "כל השאלות כבר מתויגות לפי ההגדרות השמורות."; return; }
  if (!confirm(`לעדכן תגיות אוטומטיות ב-${changes.length} שאלות? (לפי ההגדרות השמורות; תגיות ידניות לא ישתנו)`)) return;
  $("retagAll").disabled = true;
  try {
    for (let i = 0; i < changes.length; i += 400) {
      const b = writeBatch(db);
      changes.slice(i, i + 400).forEach(({ q, auto }) => {
        b.update(doc(db, "questions", q.id), { autoTags: auto });
        if (q.publish) b.set(doc(db, "publicQA", q.id), { tags: [...new Set([...(q.tags || []), ...auto])] }, { merge: true });
      });
      await b.commit();
      $("retagMsg").textContent = `עודכנו ${Math.min(i + 400, changes.length)} מתוך ${changes.length}`;
    }
    toast("התגיות עודכנו", "good");
  } catch (e) { toast("העדכון נכשל: " + e.code, "bad"); }
  $("retagAll").disabled = false;
}
