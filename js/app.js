// ===== מערכת ניהול קשרים – מכון משפטי ארץ =====
import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch, Timestamp, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  db, auth, configReady, esc, normEmail, normPhone, toDate, fmtDate, toast, setupMissingNotice,
  DEFAULT_TAXONOMY, normTaxonomy, autoTagsFor, readWorkbook, sanitizeRich, plainToRich, richToText, richToMarkup
} from "./common.js?v=20261107";
import { renderCourses, renderCalendar, courseSummary } from "./courses.js?v=20261107";
import { renderResearch, researchSummary } from "./research.js?v=20261107";
import { composeMail, queueMail, schedulerState } from "./mail.js?v=20261107";
import { renderBooks } from "./books.js?v=20261107";
import { renderReports } from "./reports.js?v=20261107";
import { renderSelfTest } from "./selftest.js?v=20261107";
import { renderProjects } from "./projects.js?v=20261107";
// מספר הגרסה – נלקח אוטומטית מכתובת הקובץ (?v=...) ומוצג בתחתית העמוד
try { const v = new URL(import.meta.url).searchParams.get("v"); const el = document.getElementById("appVersion"); if (el && v) el.textContent = "גרסה " + v; } catch { /* */ }

// ---------- קבועים ----------
const ROLE_LABEL = {
  staff: "צוות", rabbi: "רב משיב", head: "רכז הרכזים", admin: "מנהל מערכת",
  course_manager: "רכז השתלמות", researcher: "חוקר", research_coord: "רכז מחקר"
};
const STAFF_ROLES = Object.keys(ROLE_LABEL);
// קבוצות הרשאה
const CRM_ROLES = ["admin", "head", "staff", "rabbi"];
const EDIT_ROLES = ["admin", "head", "staff"];
const COURSE_ROLES = ["admin", "head", "staff", "course_manager"];
const RESEARCH_ROLES = ["admin", "head", "research_coord", "researcher"];
const MAIL_ROLES = ["admin", "head", "staff", "rabbi", "course_manager"];
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
  contacts: new Map(), activities: new Map(), questions: new Map(), qaViews: new Map(), users: new Map(), lists: new Map(),
  byEmail: new Map(), byPhone: new Map(), actByContact: new Map(), qByContact: new Map(),
  loaded: { contacts: false, activities: false, questions: false },
  linking: new Set(),
  cf: { text: "", tag: "", consent: "", conds: [] },
  qf: { status: "new", rabbi: "", text: "", topic: "", tag: "" },
  tax: normTaxonomy(DEFAULT_TAXONOMY), taxLoaded: false,
  // השתלמויות
  courses: new Map(), sessions: new Map(), regs: new Map(), resources: { zoomAccounts: ["חשבון הזום של המכון"] },
  // מחקר
  monthly: new Map(),
  // סטטוס פרויקטים (מנהל מערכת + שיתופים)
  projects: new Map(),
  // מיילים מתוזמנים
  mailQueue: new Map(), scheduler: null,
  // הסרות מרשימת התפוצה (מקישור במייל)
  optouts: new Set(), optoutDocs: new Map(),
  // ספרים
  books: [], bookItems: [], booksDoc: {}, institutions: new Map(), dists: new Map(), orders: new Map(), jgive: new Map(), monthlyAll: null,
  unsub: []
};
const $ = (id) => document.getElementById(id);
const role = () => S.profile?.role || "none";
const myEmail = () => normEmail(S.user?.email);
const can = (...roles) => roles.includes(role());
const inGroup = (group) => group.includes(role());

// ---------- כניסה ----------
if (!configReady) {
  setupMissingNotice($("setupView"));
} else {
  initAuthUI();
  onAuthStateChanged(auth, handleAuth);
  // ניווט עם כפתור "אחורה" בדפדפן ושינוי כתובת
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (S.profile && v && v !== S.view) go(v);
  });
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
  if (snap && !snap.exists()) reason = "";
  else if (S.profile && !STAFF_ROLES.includes(S.profile.role)) reason = `בשדה role רשום "${S.profile.role}". הערך צריך להיות אחד מ: ${STAFF_ROLES.join(", ")}.`;
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
  // כתובת האתר – בשביל הקישורים שהסקריפט מכניס למיילים (תזכורות, הסרה מרשימת התפוצה)
  if (can("admin", "head")) {
    const url = new URL(".", location.href).href;
    getDoc(doc(db, "settings", "site")).then((d) => { if (d.data()?.url !== url) setDoc(doc(db, "settings", "site"), { url, updatedAt: serverTimestamp() }); }).catch(() => {});
  }
  go(location.hash.slice(1) || defaultView());
}

// ---------- נתונים ----------
function subscribeAll() {
  const fail = (name) => (err) => toast("שגיאה בטעינת " + name + ": " + err.code, "bad");
  const subQ = (name, q, onDocs) => S.unsub.push(onSnapshot(q, (snap) => onDocs(snap), fail(name)));
  const sub = (name, onDocs) => subQ(name, collection(db, name), onDocs);
  const intoMap = (map) => (snap) => { map.clear(); snap.forEach((d) => map.set(d.id, { id: d.id, ...d.data() })); dataChanged(); };

  S.unsub.push(onSnapshot(doc(db, "settings", "taxonomy"), (snap) => {
    S.tax = normTaxonomy(snap.exists() ? snap.data() : DEFAULT_TAXONOMY); S.taxLoaded = true; dataChanged();
  }, () => { S.taxLoaded = true; }));
  S.unsub.push(onSnapshot(doc(db, "settings", "resources"), (snap) => {
    const z = snap.exists() ? (snap.data().zoomAccounts || []).filter(Boolean) : [];
    S.resources = { zoomAccounts: z.length ? z : ["חשבון הזום של המכון"] }; dataChanged();
  }, () => {}));
  S.unsub.push(onSnapshot(doc(db, "settings", "books"), (snap) => {
    const d = snap.exists() ? snap.data() : {};
    S.booksDoc = d;
    // קטלוג (items) – ואם עוד אין, הרשימה הישנה (list)
    S.bookItems = (d.items || []).filter((b) => b.name);
    if (!S.bookItems.length && (d.list || []).length) S.bookItems = d.list.filter(Boolean).map((name, i) => ({ id: "b" + i, name, price: 0, forSale: false }));
    S.books = S.bookItems.map((b) => b.name);
    dataChanged();
  }, () => {}));
  S.unsub.push(onSnapshot(doc(db, "settings", "qaNotify"), (snap) => { S.qaNotify = snap.exists() ? snap.data() : null; }, () => {}));
  subQ("optouts", collection(db, "optouts"), (snap) => {
    S.optouts.clear(); S.optoutDocs.clear();
    snap.forEach((d) => { const e = normEmail(d.data().email); if (!e) return; S.optouts.add(e); if (!S.optoutDocs.has(e)) S.optoutDocs.set(e, []); S.optoutDocs.get(e).push({ id: d.id, ...d.data() }); });
    dataChanged();
  });
  sub("allowedEmails", (snap) => { S.users.clear(); snap.forEach((d) => S.users.set(d.id, { id: d.id, email: d.id, ...d.data() })); dataChanged(); });
  if (inGroup(MAIL_ROLES)) {
    const mq = can("admin", "head") ? collection(db, "mailQueue") : query(collection(db, "mailQueue"), where("createdBy", "==", myEmail()));
    subQ("mailQueue", mq, intoMap(S.mailQueue));
    S.unsub.push(onSnapshot(doc(db, "settings", "mailScheduler"), (snap) => { S.scheduler = snap.exists() ? snap.data() : null; dataChanged(); }, () => {}));
  }

  if (inGroup(CRM_ROLES)) {
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
    // צפיות בשאלות במאגר הציבורי (מוצג רק כאן, בממשק הניהול)
    subQ("qaViews", collection(db, "qaViews"), (snap) => { S.qaViews.clear(); snap.forEach((d) => S.qaViews.set(d.id, d.data().count || 0)); });
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
    sub("savedLists", intoMap(S.lists));
  }

  if (inGroup(COURSE_ROLES)) {
    sub("courses", intoMap(S.courses));
    sub("sessions", intoMap(S.sessions));
    // רכז השתלמות רואה רק את הנרשמים להשתלמויות שהוא מנהל
    const regsQ = inGroup(EDIT_ROLES) ? collection(db, "registrations")
      : query(collection(db, "registrations"), where("managerEmails", "array-contains", myEmail()));
    subQ("registrations", regsQ, (snap) => { S.regs.clear(); snap.forEach((d) => S.regs.set(d.id, { id: d.id, ...d.data() })); S.loaded.regs = true; dataChanged(); });
  }

  if (inGroup(EDIT_ROLES)) {
    const flag = (k) => (snap) => { S.loaded[k] = true; return snap; };
    subQ("institutions", collection(db, "institutions"), (snap) => intoMap(S.institutions)(snap));
    subQ("distributions", collection(db, "distributions"), (snap) => intoMap(S.dists)(snap));
    subQ("orders", collection(db, "orders"), (snap) => { flag("orders")(snap); intoMap(S.orders)(snap); });
    subQ("jgiveInbox", collection(db, "jgiveInbox"), (snap) => { flag("jgive")(snap); intoMap(S.jgive)(snap); });
  }
  // פרויקטים: מנהל מערכת רואה הכול; איש צוות – רק פרויקטים ששותפו איתו
  const pq = can("admin") ? collection(db, "mgmtProjects") : query(collection(db, "mgmtProjects"), where("sharedWith", "array-contains", myEmail()));
  S.unsub.push(onSnapshot(pq, (snap) => {
    S.projects.clear(); snap.forEach((d) => S.projects.set(d.id, { id: d.id, ...d.data() }));
    const nb = document.querySelector('#nav button[data-view="projects"]');
    if (nb) nb.classList.toggle("hidden", !can("admin") && !S.projects.size);
    dataChanged();
  }, () => {}));
  if (inGroup(RESEARCH_ROLES)) {
    // חוקר מקבל רק את הרשומות שלו
    const mine = (name) => role() === "researcher" ? query(collection(db, name), where("researcherEmail", "==", myEmail())) : collection(db, name);
    subQ("monthly", mine("monthly"), intoMap(S.monthly));
  }
}

let dataTimer = null;
function dataChanged() {
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => {
    if (S.loaded.contacts && S.loaded.questions) linkPendingQuestions();
    if (S.loaded.contacts && S.loaded.regs && inGroup(EDIT_ROLES)) linkRegistrations();
    if (S.loaded.contacts && inGroup(EDIT_ROLES)) applyOptouts();
    if (S.loaded.contacts && S.loaded.orders && S.loaded.jgive && inGroup(EDIT_ROLES)) processJgive();
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
        consentEmail: q.consentEmail, source: "שו\"ת", fresh: q.origin === "טופס באתר"
      });
      await updateDoc(doc(db, "questions", q.id), { contactId });
    } catch (e) { console.warn("link failed", e); }
  }
}

// ---------- Jgive והזמנות ----------
// כל עדכון מ-Jgive: איש קשר + "תרומה" ב-CRM, ואם הוא תשלום על הזמנה מהחנות (אותו מייל וסכום) – ההזמנה מסומנת "שולמה"
async function processJgive() {
  for (const j of S.jgive.values()) {
    if (j.processed || S.linking.has("j:" + j.id)) continue;
    S.linking.add("j:" + j.id);
    try {
      const [first, ...rest] = String(j.fullName || "").split(/\s+/);
      const contactId = j.email || j.phone ? await findOrCreateContact({ firstName: j.firstName || first || "", lastName: j.lastName || rest.join(" "), email: j.email, phone: j.phone,
        consentEmail: j.receiveUpdates ? true : undefined, source: "Jgive" }) : "";
      const when = toDate(j.date) || toDate(j.receivedAt) || new Date();
      const order = !j.refunded && [...S.orders.values()].find((o) => o.status === "new" && normEmail(o.email) === normEmail(j.email)
        && Math.abs(Number(o.total) - Number(j.amount)) < 1 && Math.abs((toDate(o.createdAt)?.getTime() || 0) - when.getTime()) < 7 * 864e5);
      const upd = { processed: true, processedAt: serverTimestamp(), contactId: contactId || "" };
      if (order) {
        await updateDoc(doc(db, "orders", order.id), { status: "paid", paidAt: serverTimestamp(), jgiveId: j.jgiveId || j.id });
        await recordOrderPurchase({ ...order, status: "paid" }, contactId);
        upd.orderId = order.id;
      } else if (contactId) {
        await addDoc(collection(db, "activities"), { contactId, type: j.refunded ? "note" : "donation", details: j.refunded ? `החזר תרומה ב-Jgive (₪${j.amount})` : [j.purpose, j.comment, j.recurring ? "הוראת קבע" : ""].filter(Boolean).join(" · ") || "תרומה ב-Jgive",
          amount: j.refunded ? null : Number(j.amount) || null, date: Timestamp.fromDate(when), source: "Jgive", jgiveId: j.jgiveId || j.id, createdBy: S.user.uid, createdAt: serverTimestamp() });
      } else upd.note = "אין מייל או טלפון – לא נוצר איש קשר";
      await updateDoc(doc(db, "jgiveInbox", j.id), upd);
    } catch (e) { console.warn("jgive", e); S.linking.delete("j:" + j.id); }
  }
}
// הזמנה ששולמה: איש קשר + "רכישת ספרים" בהיסטוריה
async function recordOrderPurchase(o, contactId) {
  try {
    const id = contactId || await findOrCreateContact({ firstName: o.firstName, lastName: o.lastName, email: o.email, phone: o.phone, consentEmail: o.consentEmail === true ? true : undefined, source: "חנות הספרים" });
    await addDoc(collection(db, "activities"), { contactId: id, type: "book_purchase", details: (o.items || []).map((x) => `${x.name}${x.qty > 1 ? ` × ${x.qty}` : ""}`).join(", "),
      books: (o.items || []).map((x) => x.name), amount: Number(o.total) || null, date: serverTimestamp(), source: "חנות הספרים", orderId: o.id, createdBy: S.user.uid, createdAt: serverTimestamp() });
    await updateDoc(doc(db, "orders", o.id), { contactId: id });
  } catch (e) { console.warn("order purchase", e); }
}

// ---------- יומן שינויים ----------
// פעולות רגישות (מחיקות, הרשאות, מיזוגים, הגדרות) נרשמות ב-auditLog. רק מנהל מערכת רואה את היומן.
function audit(action, target = "", details = "") {
  if (!S.user) return;
  addDoc(collection(db, "auditLog"), { action, target: String(target || "").slice(0, 200), details: String(details || "").slice(0, 500), by: myEmail(), at: serverTimestamp() }).catch(() => {});
}

// מי שלחץ "הסרה מרשימת התפוצה" במייל – מסומן בכרטיס "ביקש הסרה"
function applyOptouts() {
  for (const [email, docs] of S.optoutDocs) {
    const id = S.byEmail.get(email);
    const c = id && S.contacts.get(id);
    if (!c || c.consentEmail?.status === "removed" || S.linking.has("o:" + id)) continue;
    const last = docs.map((d) => toDate(d.at)).filter(Boolean).sort((a, b) => b - a)[0] || new Date();
    // הסכמה חדשה שניתנה אחרי ההסרה גוברת (ואז מסמך ההסרה נמחק)
    if (c.consentEmail?.status === "yes" && toDate(c.consentEmail.at) > last) continue;
    S.linking.add("o:" + id);
    const b = writeBatch(db);
    b.update(doc(db, "contacts", id), { consentEmail: { status: "removed", at: Timestamp.fromDate(last), source: "הסרה מקישור במייל" } });
    b.set(doc(collection(db, "activities")), { contactId: id, type: "note", details: "הסיר/ה את עצמו/ה מרשימת התפוצה (קישור במייל)", amount: null, date: Timestamp.fromDate(last), source: "הסרה מדיוור", createdBy: S.user.uid, createdAt: serverTimestamp() });
    b.commit().then(() => audit("הסרה מדיוור", email)).catch(() => S.linking.delete("o:" + id));
  }
}

// כל נרשם להשתלמות נכנס ל-CRM: כרטיס איש קשר + רשומת "השתלמות" בהיסטוריה
async function linkRegistrations() {
  for (const r of S.regs.values()) {
    if (r.contactId || S.linking.has("r:" + r.id)) continue;
    S.linking.add("r:" + r.id);
    try {
      const course = S.courses.get(r.courseId);
      const contactId = await findOrCreateContact({
        firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, city: r.city,
        consentEmail: r.consentEmail, source: "הרשמה להשתלמות", fresh: r.source === "טופס באתר"
      });
      await addDoc(collection(db, "activities"), {
        contactId, type: "course", details: course?.title || "השתלמות", amount: null,
        date: r.createdAt || Timestamp.now(), source: "הרשמה באתר", courseId: r.courseId,
        createdBy: S.user.uid, createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, "registrations", r.id), { contactId });
    } catch (e) { console.warn("reg link failed", e); }
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
    if (d.consentEmail === true && (!["yes", "removed"].includes(c.consentEmail?.status) || (d.fresh && c.consentEmail?.status === "removed"))) {
      upd.consentEmail = { status: "yes", at: Timestamp.now(), source: d.source };
      // אישור חדש בטופס אחרי הסרה – מבטלים את ההסרה
      if (c.consentEmail?.status === "removed") (S.optoutDocs.get(normEmail(d.email)) || []).forEach((o) => deleteDoc(doc(db, "optouts", o.id)).catch(() => {}));
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
function defaultView() {
  if (role() === "researcher" || role() === "research_coord") return "research";
  if (role() === "course_manager") return "courses";
  return "dashboard";
}
function go(view) {
  const btn = document.querySelector(`#nav button[data-view="${view}"]`);
  // "בדיקת הרשאות" – מסך שלא בתפריט, פתוח לכל איש צוות
  if (view !== "selftest" && !(view === "projects" && S.projects.size) && (!btn || btn.classList.contains("hidden"))) view = defaultView();
  S.view = view;
  location.hash = view;
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  // במובייל התפריט נגלל לרוחב – מוודאים שהלשונית הפעילה נראית
  const act = document.querySelector("#nav button.active");
  if (act) { const nav = act.parentElement; nav.scrollLeft += act.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - act.offsetWidth) / 2; }
  renderView(true);
}
function refreshView() { renderView(false); }

function renderView(full) {
  const views = {
    dashboard: renderDashboard, contacts: renderContacts, questions: renderQuestions, import: renderImport,
    users: renderUsers, settings: renderSettings, mail: renderMail,
    courses: (f) => renderCourses(ctx(), f), calendar: (f) => renderCalendar(ctx(), f), research: (f) => renderResearch(ctx(), f),
    books: (f) => renderBooks(ctx(), f), projects: (f) => renderProjects(ctx(), f), reports: (f) => renderReports(ctx(), f), selftest: (f) => renderSelfTest(ctx(), f)
  };
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
// משיב ברירת מחדל לשאלה שלא שויכה: הרב של הקטגוריה, ואם אין – המשיב הכללי שבהגדרות
const defaultRabbi = (topic) => { const n = S.qaNotify || {}; const e = (n.byCategory?.[topic] || [])[0] || n.defaultRabbi || ""; return S.users.has(e) ? e : ""; };

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

// הקשר משותף למודולים (השתלמויות, מחקר)
function ctx() {
  return { S, $, esc, toast, openModal, closeModal, exportXlsx, can, inGroup, role, myEmail, userName, fmtDate, toDate, audit, recordOrderPurchase,
    refresh: () => renderView(true), COURSE_ROLES, RESEARCH_ROLES, EDIT_ROLES };
}

const sortByDateDesc = (arr, key) => arr.sort((a, b) => (toDate(b[key])?.getTime() || 0) - (toDate(a[key])?.getTime() || 0));

// ======================================================
// ראשי
// ======================================================
// התקנה כאפליקציה (PWA)
let installPrompt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (S.view === "dashboard") renderDashboard(); });
const localStorageGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const localStorageSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

function renderDashboard() {
  const parts = [];
  if (inGroup(CRM_ROLES)) parts.push(crmDashboard());
  if (inGroup(COURSE_ROLES)) parts.push(courseSummary(ctx()));
  if (inGroup(RESEARCH_ROLES) && role() !== "researcher") parts.push(researchSummary(ctx()));
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!standalone && !localStorageGet("hideInstall")) parts.push(`<div class="card install-card"><div class="row space"><div><b>📱 התקנה בטלפון</b>
    <div class="small muted">${installPrompt ? "המערכת תיפתח כמו אפליקציה, עם אייקון במסך הבית." : /iphone|ipad/i.test(navigator.userAgent) ? "בספארי: כפתור השיתוף ⬆ ← \"הוספה למסך הבית\"." : "בכרום: תפריט ⋮ ← \"התקנת האפליקציה\" / \"הוספה למסך הבית\"."}</div></div>
    <div class="row">${installPrompt ? '<button class="primary" id="doInstall">התקנה</button>' : ""}<button class="link" id="hideInstall">לא עכשיו</button></div></div></div>`);
  $("main").innerHTML = `<h1>שלום ${esc(S.profile.name || "")}</h1>` + parts.join("");
  if ($("doInstall")) $("doInstall").onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice.catch(() => {}); installPrompt = null; renderDashboard(); };
  if ($("hideInstall")) $("hideInstall").onclick = () => { localStorageSet("hideInstall", "1"); renderDashboard(); };
  bindQCards();
  document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
}

function crmDashboard() {
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
  return `
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
        <button id="btnMailList">מייל לרשימה</button>
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
  $("btnMailList").onclick = () => mailContacts(filteredContacts(), "מייל לרשימה");
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

// מייל לאנשי קשר – מי שביקש הסרה לא מקבל לעולם
function mailContacts(list, title) {
  const removed = list.filter((x) => consentOf(x) === "removed").length;
  const rec = list.filter((x) => x.email && consentOf(x) !== "removed").map((x) => ({
    email: x.email, name: fullName(x), firstName: x.firstName, contactId: x.id, consent: consentOf(x) === "yes", vars: { "יישוב": x.city || "" }
  }));
  if (!rec.length) return toast(removed ? "כל אנשי הקשר ברשימה ביקשו הסרה מדיוור" : "אין ברשימה כתובות מייל", "bad");
  composeMail(ctx(), {
    title, kind: "crm", recipients: rec,
    warning: removed ? `${removed} אנשי קשר שביקשו הסרה מדיוור הוצאו מהרשימה.` : "",
    subject: "", body: "שלום {שם פרטי},\n\n\n\nבברכה,\nמכון משפטי ארץ"
  });
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
          ${id && c.email ? '<button id="cMail">שליחת מייל</button>' : ""}
          ${id && can("admin") ? '<button class="danger" id="cDelete">מחיקת איש קשר</button>' : ""}
        </div>`}
      </div>
      <div>
        ${id ? `<h3>היסטוריה</h3>
        ${ro ? "" : `<details style="margin-bottom:10px"><summary class="small">+ הוספת רשומה</summary>
          <div class="grid2" style="margin-top:8px">
            <div class="field"><label>סוג</label><select id="aType">${Object.entries(ACT_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
            <div class="field"><label>תאריך</label><input id="aDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div class="field"><label>פרטים</label><input id="aDetails" placeholder="שם ספר, השתלמות, קמפיין..." list="bookNames">
              <datalist id="bookNames">${S.books.map((b) => `<option value="${esc(b)}">`).join("")}</datalist></div>
            <div class="field"><label>סכום (₪, רשות)</label><input id="aAmount" type="number"></div>
          </div><button id="aAdd">הוספה</button></details>`}
        <ul class="timeline" id="cTimeline"></ul>` : '<p class="muted">ההיסטוריה תופיע אחרי השמירה.</p>'}
      </div>
    </div>`, () => {
    if (id) renderTimeline(id);
    if ($("cSave")) $("cSave").onclick = () => saveContact(id);
    if ($("cMail")) $("cMail").onclick = () => mailContacts([c], "שליחת מייל ל" + fullName(c));
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
    audit("מחיקת רשומת היסטוריה", fullName(S.contacts.get(id) || {}));
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
  audit("מחיקת איש קשר", fullName(S.contacts.get(id) || {}) + " " + (S.contacts.get(id)?.email || ""));
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
  audit("מיזוג אנשי קשר", list.map((x) => fullName(x) + (x.email ? ` <${x.email}>` : "")).join(" + "));
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
const pubMode = () => document.querySelector('[name="qPubMode"]:checked')?.value || "none";
function qCardHtml(q) {
  return `<div class="qcard" data-q="${q.id}">
    <div class="row space"><b>${q.imported ? `📚 ${esc(q.title || "ארכיון האתר")}` : esc([q.firstName, q.lastName].filter(Boolean).join(" ") || q.email || "שואל")}</b>
      <span>${q.consentEmail && q.status !== "answered" ? '<span class="badge prio" title="השואל אישר קבלת דיוור – הובטחה לו עדיפות במענה">עדיפות</span>' : ""}<span class="badge ${Q_BADGE[q.status]}">${Q_STATUS[q.status]}</span>${q.topic ? `<span class="badge">${esc(q.topic)}</span>` : ""}</span></div>
    <div class="qtext">${esc(q.text)}</div>
    ${qTags(q).length ? `<div>${tagBadges(q)}</div>` : ""}
    <div class="row space small"><span>${q.imported ? "" : contextBadges(q.contactId, q.id)}</span>
      <span class="muted">${q.publish && S.qaViews.get(q.id) ? `<span class="views" title="צפיות במאגר הציבורי (מוצג רק בממשק הניהול)">👁 ${S.qaViews.get(q.id)}</span> · ` : ""}${q.imported ? `ארכיון האתר${q.rabbiName ? " · " + esc(q.rabbiName) : ""}` : fmtDate(q.createdAt)}${q.imported ? "" : q.rabbiEmail ? " · " + esc(userName(q.rabbiEmail)) : q.status !== "answered" && defaultRabbi(q.topic) ? ` · ${esc(userName(defaultRabbi(q.topic)))} <span class="small">(ברירת מחדל)</span>` : " · לא שויך"}</span></div>
  </div>`;
}
function bindQCards() { document.querySelectorAll(".qcard[data-q]").forEach((el) => (el.onclick = () => openQuestion(el.dataset.q))); }

function filteredQuestions() {
  const f = S.qf;
  const sorted = (list) => f.sort === "views" ? list.sort((a, b) => (S.qaViews.get(b.id) || 0) - (S.qaViews.get(a.id) || 0)) : sortByDateDesc(list, "createdAt");
  return sorted([...S.questions.values()].filter((q) => {
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
  }));
}

function renderQuestions(full) {
  if (!full && $("qList")) { renderQList(); return; }
  const f = S.qf;
  const cnt = (st) => [...S.questions.values()].filter((q) => !st || q.status === st).length;
  $("main").innerHTML = `
    <div class="row space"><h1>שו"ת – שאל את הרב</h1>
      <div class="row"><button id="btnNewQ">+ שאלה ידנית</button><button id="btnExportQ">ייצוא ל-Excel</button>${can("admin", "head") ? '<button id="btnSitemap" title="קובץ שעוזר לגוגל למצוא את כל השאלות במאגר">מפת אתר לגוגל</button>' : ""}</div></div>
    <div class="tabs" id="qTabs">
      ${[["new", "חדשות"], ["in_progress", "בטיפול"], ["answered", "נענו"], ["", "הכול"]].map(([k, l]) =>
        `<button data-st="${k}" class="${f.status === k ? "active" : ""}">${l} (<span data-cnt="${k}">${cnt(k)}</span>)</button>`).join("")}
    </div>
    <div class="card"><div class="row">
      <input id="qText" class="grow" placeholder="חיפוש בשאלות ובתשובות" value="${esc(f.text)}">
      <select id="qRabbi" style="width:auto" aria-label="סינון לפי רב">
        <option value="">כל הרבנים</option><option value="mine">השאלות שלי</option><option value="none">לא שויכו</option>
        ${rabbis().map((r) => `<option value="${r.id}">${esc(userName(r.id))}</option>`).join("")}
      </select>
      <select id="qTopic" style="width:auto" aria-label="סינון לפי קטגוריה"><option value="">כל הקטגוריות</option>${S.tax.categories.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
      <select id="qTag" style="width:auto" aria-label="סינון לפי תגית"><option value="">כל התגיות</option>${allTagNames().map((t) => `<option>${esc(t)}</option>`).join("")}</select>
      <select id="qSort" style="width:auto" aria-label="מיון"><option value="">החדשות קודם</option><option value="views">הכי נצפות במאגר</option></select>
    </div></div>
    <div class="qlist" id="qList"></div>`;
  $("qRabbi").value = f.rabbi; $("qTopic").value = f.topic; $("qTag").value = f.tag; $("qSort").value = f.sort || "";
  $("qSort").onchange = (e) => { S.qf.sort = e.target.value; renderQList(); };
  $("qTag").onchange = (e) => { S.qf.tag = e.target.value; renderQList(); };
  $("qTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.qf.status = b.dataset.st; renderQuestions(true); }));
  $("qText").oninput = (e) => { S.qf.text = e.target.value; renderQList(); };
  $("qRabbi").onchange = (e) => { S.qf.rabbi = e.target.value; renderQList(); };
  $("qTopic").onchange = (e) => { S.qf.topic = e.target.value; renderQList(); };
  $("btnExportQ").onclick = exportQuestions;
  if ($("btnSitemap")) $("btnSitemap").onclick = downloadSitemap;
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

// sitemap.xml – רשימת כל דפי השאלות שבמאגר, בשביל גוגל. מעלים את הקובץ לתיקייה הראשית של האתר.
function downloadSitemap() {
  const base = new URL(".", location.href).href;
  const urls = [base + "shut.html", base + "ask.html", ...[...S.questions.values()].filter((q) => q.publish).map((q) => base + "q.html?id=" + encodeURIComponent(q.id))];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u.replace(/&/g, "&amp;")}</loc></url>`).join("\n") + "\n</urlset>\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" }));
  a.download = "sitemap.xml"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`נוצר sitemap.xml עם ${urls.length} דפים. מעלים אותו לתיקייה הראשית של האתר.`, "good");
}

function exportQuestions() {
  const rows = filteredQuestions().map((q) => {
    const n = q.contactId ? countsOf(q.contactId) : {};
    return {
      "תאריך": fmtDate(q.createdAt), "שם": [q.firstName, q.lastName].filter(Boolean).join(" "), "מייל": q.email || "", "טלפון": q.phone || "",
      "קטגוריה": q.topic || "", "תגיות": qTags(q).join(", "), "שאלה": q.text || "", "סטטוס": Q_STATUS[q.status] || "", "רב": userName(q.rabbiEmail),
      "תשובה": q.answer || "", "תאריך מענה": fmtDate(q.answeredAt), "פורסם במאגר": q.publish ? (q.publishMode === "named" ? `כן, בשם: ${q.publicName || ""}` : "כן, בעילום שם") : "לא",
      "תורם": n.donation ? "כן" : "", "משתתף השתלמויות": n.course ? "כן" : "", "מקור": q.origin || ""
    };
  });
  exportXlsx(rows, "שאלות-שות.xlsx");
}

// ---------- עורך טקסט מעוצב (תשובות) ----------
const RTE_BTNS = [["bold", "<b>B</b>", "מודגש (Ctrl+B)"], ["underline", "<u>U</u>", "קו תחתון (Ctrl+U)"], ["h3", "כותרת", "כותרת"], ["h4", "כותרת משנה", "כותרת משנה"],
  ["p", "טקסט רגיל", "טקסט רגיל"], ["ul", "• רשימה", "רשימה"]];
function richEditorHtml(id, html, labelId) {
  return `<div class="rte"><div class="rte-bar" role="toolbar" aria-label="עיצוב טקסט">${RTE_BTNS.map(([k, l, t]) => `<button type="button" data-rte="${k}" title="${t}" aria-label="${t}">${l}</button>`).join("")}</div>
    <div class="rte-area" id="${id}" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${labelId}">${html || "<p><br></p>"}</div></div>`;
}
function bindRichEditor(id) {
  const area = $(id), bar = area.previousElementSibling;
  try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* */ }
  bar.querySelectorAll("[data-rte]").forEach((b) => {
    b.onmousedown = (e) => e.preventDefault(); // לא לאבד את הסימון
    b.onclick = () => {
      area.focus();
      const k = b.dataset.rte;
      if (k === "bold" || k === "underline") document.execCommand(k);
      else if (k === "ul") document.execCommand("insertUnorderedList");
      else document.execCommand("formatBlock", false, k.toUpperCase());
      area.dispatchEvent(new Event("input"));
    };
  });
  // הדבקה מוורד או מאתר – נשאר רק העיצוב המותר
  area.addEventListener("paste", (e) => {
    const html = e.clipboardData?.getData("text/html"), text = e.clipboardData?.getData("text/plain");
    e.preventDefault();
    document.execCommand("insertHTML", false, html ? sanitizeRich(html) : plainToRich(text || ""));
  });
}

function openQuestion(id) {
  const q = S.questions.get(id); if (!q) return;
  const c = q.contactId ? S.contacts.get(q.contactId) : null;
  const name = [q.firstName, q.lastName].filter(Boolean).join(" ") || q.email || "שואל";
  openModal(`
    <div class="head"><h2>${q.imported ? `📚 ${esc(q.title || "שאלה מארכיון האתר")}` : `שאלה מאת ${esc(name)}`}</h2><button class="close" data-close>×</button></div>
    ${q.imported ? `<p class="small muted" style="margin-top:-6px">יובאה מאתר המכון הישן${q.rabbiName ? " · השיב: " + esc(q.rabbiName) : ""}${q.sourceUrl ? ` · <a href="${esc(q.sourceUrl)}" target="_blank" rel="noopener">הדף המקורי ↗</a>` : ""}</p>` : ""}
    <div class="split">
      <div>
        <p class="small muted">${q.imported ? "" : fmtDate(q.createdAt) + " · "}${esc(q.topic || "ללא קטגוריה")} · ${esc(q.origin || "")}${q.publish ? ` · 👁 ${S.qaViews.get(q.id) || 0} צפיות במאגר · <a href="q.html?id=${encodeURIComponent(id)}" target="_blank" rel="noopener">לדף השאלה באתר ↗</a>` : ""}</p>
        <div class="card pre" style="background:var(--surface-2)">${esc(q.text)}</div>
        <div class="field"><label id="qAnsLbl">תשובה</label>${richEditorHtml("qAnswer", q.answerHtml ? sanitizeRich(q.answerHtml) : plainToRich(q.answer), "qAnsLbl")}</div>
        <div class="grid2">
          <div class="field"><label for="qRabbiSel">רב משיב${!q.rabbiEmail && q.status !== "answered" && defaultRabbi(q.topic) ? ' <span class="small muted">(הוצע משיב ברירת המחדל)</span>' : ""}</label><select id="qRabbiSel"><option value="">לא שויך</option>
            ${rabbis().map((r) => `<option value="${r.id}" ${(q.rabbiEmail || (q.status !== "answered" ? defaultRabbi(q.topic) : "")) === r.id ? "selected" : ""}>${esc(userName(r.id))}</option>`).join("")}</select></div>
          <div class="field"><label>סטטוס</label><select id="qStatusSel">
            ${Object.entries(Q_STATUS).map(([k, v]) => `<option value="${k}" ${q.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field"><label>קטגוריה</label><select id="qTopicSel">${categoryOptions(q.topic, true)}</select></div>
          <div class="field"><label>תגיות ידניות (מופרדות בפסיק)</label><input id="qTagsIn" value="${esc((q.tags || []).join(", "))}" list="tagNames">
            <datalist id="tagNames">${allTagNames().map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>
        </div>
        <p class="small muted">תגיות אוטומטיות: <span id="qAutoTags">${(q.autoTags || []).map((t) => `<span class="badge brand">${esc(t)}</span>`).join("") || "אין"}</span></p>
        <div class="card publish-box">
          <h3 style="margin:0 0 6px">פרסום במאגר השו"ת</h3>
          <div class="field"><label for="qPublicText">נוסח השאלה לפרסום – אפשר לערוך, לקצר ולהסיר פרטים מזהים (השאלה המקורית נשמרת)</label>
            <textarea id="qPublicText" style="min-height:110px">${esc(q.publicText ?? q.text)}</textarea></div>
          <div class="row space"><span></span><button class="link" id="qPubReset">החזרת הנוסח המקורי</button></div>
          <fieldset class="pub-mode"><legend class="small"><b>האם לפרסם?</b></legend>
            <label class="check"><input type="radio" name="qPubMode" value="none" ${!q.publish ? "checked" : ""}> <span>לא לפרסם</span></label>
            <label class="check"><input type="radio" name="qPubMode" value="anon" ${q.publish && q.publishMode !== "named" ? "checked" : ""}> <span>לפרסם בעילום שם</span></label>
            <label class="check"><input type="radio" name="qPubMode" value="named" ${q.publish && q.publishMode === "named" ? "checked" : ""}> <span>לפרסם עם שם השואל</span></label>
          </fieldset>
          <div class="field ${q.publish && q.publishMode === "named" ? "" : "hidden"}" id="qPubNameBox"><label for="qPubName">השם שיופיע במאגר (אפשר לשנות, למשל רק שם פרטי ויישוב)</label>
            <input id="qPubName" value="${esc(q.publicName ?? [q.firstName, q.lastName].filter(Boolean).join(" "))}" maxlength="80"></div>
          <p class="small muted" style="margin:4px 0 0">התשובה מתפרסמת כפי שהיא כתובה למעלה, כולל העיצוב.</p>
        </div>
        <div class="row">
          <button class="primary" id="qSave">שמירה</button>
          ${q.email ? `<button class="primary" id="qMail">✉ שליחת התשובה לשואל</button>` : ""}
          <button id="qCopy">העתקת השאלה והתשובה</button>
          ${q.answerSentAt ? `<span class="badge good">התשובה נשלחה ${fmtDate(q.answerSentAt)}</span>` : q.email ? "" : '<span class="small muted">אין לשואל כתובת מייל</span>'}
        </div>
      </div>
      ${q.imported ? `<div><h3>מארכיון האתר</h3>
        ${q.summary ? `<p class="small">${esc(q.summary)}</p>` : ""}
        <p class="small muted">השאלה יובאה מהאתר הישן (דף ${esc(String(q.oldId || ""))}), בלי פרטי שואל.</p>
        ${q.sourceUrl ? `<a href="${esc(q.sourceUrl)}" target="_blank" rel="noopener">לדף המקורי ↗</a>` : ""}` : `<div>
        <h3>על השואל</h3>
        <div class="context">${contextBadges(q.contactId, q.id)}</div>
        <p>${esc(q.email)}${q.phone ? "<br>" + esc(q.phone) : ""}</p>
        <p class="small">הסכמה לדיוור: ${c ? CONSENT[consentOf(c)] : (q.consentEmail ? "אישר בטופס" : "לא אישר")}</p>
        ${c ? `<button id="qOpenContact">פתיחת כרטיס איש הקשר</button>` : ""}
        <h3 style="margin-top:16px">שאלות קודמות</h3>
        <ul class="timeline">${(q.contactId ? sortByDateDesc((S.qByContact.get(q.contactId) || []).filter((x) => x.id !== id), "createdAt") : [])
          .map((x) => `<li><div class="when">${fmtDate(x.createdAt)} · <span class="badge ${Q_BADGE[x.status]}">${Q_STATUS[x.status]}</span></div>
            <button class="link" data-prevq="${x.id}">${esc((x.text || "").slice(0, 90))}</button></li>`).join("") || '<li class="muted">אין</li>'}</ul>`}
      </div>
    </div>`, (root) => {
    bindRichEditor("qAnswer");
    $("qPubReset").onclick = () => { $("qPublicText").value = q.text || ""; };
    // שינוי קטגוריה בשאלה שלא שויכה – מציע את המשיב של הקטגוריה החדשה (אם לא בחרו ידנית)
    let rabbiTouched = !!q.rabbiEmail;
    $("qRabbiSel").addEventListener("change", () => (rabbiTouched = true));
    $("qTopicSel").addEventListener("change", (e) => { if (!rabbiTouched && q.status !== "answered") $("qRabbiSel").value = defaultRabbi(e.target.value); });
    document.querySelectorAll('[name="qPubMode"]').forEach((r) => (r.onchange = () => $("qPubNameBox").classList.toggle("hidden", pubMode() !== "named")));
    // שליחת התשובה במייל – עם השאלה, ועם הכותרות וההדגשות של התשובה
    const sendAnswer = (cur, html) => {
      const rabbi = userName(cur.rabbiEmail || "");
      composeMail(ctx(), {
        title: "שליחת התשובה לשואל", kind: "qa-answer",
        warning: cur.consentEmail === false ? "השואל לא אישר קבלת דיוור בטופס. אפשר לשלוח לו את התשובה – זה מייל אישי בתשובה לשאלה שלו." : "",
        recipients: [{ email: cur.email, name: [cur.firstName, cur.lastName].filter(Boolean).join(" "), firstName: cur.firstName, contactId: cur.contactId, ref: id, consent: cur.consentEmail }],
        subject: "תשובה לשאלתך – מכון משפטי ארץ",
        body: `שלום {שם פרטי},\n\n## שאלתך\n${cur.text}\n\n## תשובה\n${richToMarkup(html)}\n\nבברכה,${rabbi ? "\n" + rabbi : ""}\nמכון משפטי ארץ`,
        mark: { collection: "questions", field: "answerSentAt" }
      });
    };
    $("qSave").onclick = async () => {
      const html = sanitizeRich($("qAnswer").innerHTML), st = $("qStatusSel").value;
      if (!(await saveQuestion(id))) return;
      const cur = S.questions.get(id) || q;
      if (st === "answered" && cur.email && !cur.answerSentAt && confirm("התשובה נשמרה. לשלוח אותה עכשיו לשואל במייל?")) sendAnswer({ ...cur, rabbiEmail: $("qRabbiSel")?.value || cur.rabbiEmail }, html);
    };
    $("qCopy").onclick = async () => {
      const html = sanitizeRich($("qAnswer").innerHTML), qt = $("qPublicText").value.trim() || q.text || "";
      if (!richToText(html)) return toast("עדיין אין תשובה", "bad");
      const rich = `<div dir="rtl"><h2>שאלה</h2>${plainToRich(qt)}<h2>תשובה</h2>${html}</div>`;
      const plain = `שאלה\n${qt}\n\nתשובה\n${richToText(html)}`;
      try {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([rich], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
      } catch { await navigator.clipboard.writeText(plain); }
      toast("השאלה והתשובה הועתקו – עם הכותרות", "good");
    };
    if ($("qMail")) $("qMail").onclick = async () => {
      const html = sanitizeRich($("qAnswer").innerHTML);
      if (!richToText(html)) return toast("נא לכתוב תשובה לפני השליחה", "bad");
      $("qStatusSel").value = "answered";
      const rabbiEmail = $("qRabbiSel").value || (can("rabbi") ? myEmail() : "");
      if (!(await saveQuestion(id))) return;
      sendAnswer({ ...(S.questions.get(id) || q), rabbiEmail }, html);
    };
    if ($("qOpenContact")) $("qOpenContact").onclick = () => openContact(q.contactId);
    root.querySelectorAll("[data-prevq]").forEach((b) => (b.onclick = () => openQuestion(b.dataset.prevq)));
    $("qAnswer").addEventListener("input", () => {
      const txt = $("qAnswer").innerText.trim();
      if ($("qStatusSel").value === "new" && txt) $("qStatusSel").value = "in_progress";
      $("qAutoTags").innerHTML = calcAutoTags(q.text, txt).map((t) => `<span class="badge brand">${esc(t)}</span>`).join("") || "אין";
    });
  });
}

// מחזירה true אם נשמר
async function saveQuestion(id) {
  const q = S.questions.get(id);
  const status = $("qStatusSel").value;
  const answerHtml = sanitizeRich($("qAnswer").innerHTML);
  const answer = richToText(answerHtml);
  const mode = pubMode(), publish = mode !== "none";
  const publicName = $("qPubName").value.trim();
  if (mode === "named" && !publicName) { toast("נא למלא את השם שיופיע במאגר", "bad"); $("qPubName").focus(); return false; }
  const publicText = $("qPublicText").value.trim();
  if (status === "answered" && !answer) { toast("כדי לסמן 'נענתה' צריך לכתוב תשובה", "bad"); return false; }
  if (publish && (!answer || status !== "answered")) { toast("אפשר לפרסם רק שאלה שנענתה", "bad"); return false; }
  // רב שעונה על שאלה שלא שויכה – משויך אליה אוטומטית
  const rabbiEmail = $("qRabbiSel").value || (status !== "new" && can("rabbi") ? myEmail() : "");
  const tags = [...new Set($("qTagsIn").value.split(",").map((t) => t.trim()).filter(Boolean))];
  const autoTags = calcAutoTags(q.text, answer);
  const upd = { status, answer, answerHtml: answer ? answerHtml : "", rabbiEmail: rabbiEmail || "", topic: $("qTopicSel").value, tags, autoTags, publish, publishMode: publish ? mode : "", publicName: mode === "named" ? publicName : (q.publicName ?? null), publicText, updatedAt: serverTimestamp() };
  if (status === "answered" && q.status !== "answered") upd.answeredAt = serverTimestamp();
  try {
    await updateDoc(doc(db, "questions", id), upd);
    if (publish) {
      await setDoc(doc(db, "publicQA", id), { topic: upd.topic, tags: [...new Set([...tags, ...autoTags])], question: publicText || q.text, askerName: mode === "named" ? publicName : "", answer, answerHtml: upd.answerHtml,
        rabbiName: rabbiEmail ? userName(rabbiEmail) : (q.rabbiName || ""), title: q.title || "", ...(q.imported ? { archive: true, summary: q.summary || "", sourceUrl: q.sourceUrl || "", oldId: q.oldId || null } : {}),
        publishedAt: q.publish ? (q.publishedAt || serverTimestamp()) : serverTimestamp() });
      if (!q.publish) await updateDoc(doc(db, "questions", id), { publishedAt: serverTimestamp() });
    } else if (q.publish) {
      await deleteDoc(doc(db, "publicQA", id));
      audit("הסרת שאלה מהמאגר הציבורי", (q.publicText || q.text || "").slice(0, 80));
    }
    toast("נשמר", "good"); closeModal();
    return true;
  } catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); return false; }
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
  ["fullName", "שם מלא (עמודה אחת)", /^(שם|שם מלא|name|full ?name|שם התורם|שם הלקוח|שם המקבל)$/i],
  ["email", "מייל", /מייל|דוא|e-?mail|mail/i],
  ["phone", "טלפון", /טלפון|נייד|phone|mobile|tel|סלולרי/i],
  ["city", "יישוב", /עיר|יישוב|ישוב|city/i],
  ["date", "תאריך", /תאריך|date/i],
  ["amount", "סכום", /סכום|מחיר|amount|sum|total/i],
  ["details", "פרטים", /פרטים|קמפיין|השתלמות|ספר|campaign|details|description|תיאור|פרויקט|מוצר/i],
  ["status", "סטטוס הנרשם", /סטטוס|status|מצב/i],
  ["consent", "הסכמה לדיוור", /דיוור|הסכמ|consent|newsletter|marketing|עדכונים/i]
];
// תוויות שמשתנות לפי סוג הקובץ
const IMP_LABELS = {
  book_received: { date: "תאריך החלוקה", details: "איזה ספר (עמודה)" },
  book_purchase: { date: "תאריך הקנייה", details: "אילו ספרים (עמודה)", amount: "סכום ששולם" },
  course: { date: "תאריך ההרשמה", details: "שם ההשתלמות (עמודה)" },
  donation: { date: "תאריך התרומה", details: "קמפיין / פרטים" }
};
const REG_STATUS_LABEL = { registered: "מאושר", pending: "ממתין לאישור", rejected: "נדחה", cancelled: "ביטל" };
const statusOf = (v) => {
  const t = String(v || "").trim();
  if (!t) return "";
  if (/ממתין|pending|המתנה/i.test(t)) return "pending";
  if (/נדח|reject|לא אושר/i.test(t)) return "rejected";
  if (/בוטל|ביטל|cancel/i.test(t)) return "cancelled";
  if (/אושר|מאושר|רשום|נרשם|השתתף|registered|approved|כן|v|✓/i.test(t)) return "registered";
  return "";
};
// התאמת שם ספר לרשימת ספרי המכון (חלק מהשם מספיק)
const nrm = (x) => String(x || "").replace(/["'״׳]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
function matchBooks(value) {
  const parts = String(value || "").split(/[,;\n/]|\s\+\s/).map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => {
    const n = nrm(p);
    const hit = S.books.find((b) => nrm(b) === n) || S.books.find((b) => nrm(b).includes(n) || n.includes(nrm(b)));
    return { name: hit || p, known: !!hit };
  });
}
function matchCourse(value) {
  const n = nrm(value); if (!n) return null;
  const list = [...S.courses.values()];
  return list.find((c) => nrm(c.title) === n) || list.find((c) => nrm(c.title).includes(n) || n.includes(nrm(c.title))) || null;
}
let IMP = null;

function renderImport(full) {
  if (!full) return;
  $("main").innerHTML = `
    <h1>ייבוא מאקסל</h1>
    <div class="card medium" style="margin:0 0 16px">
      <p class="muted">מעלים קובץ Excel או CSV (רשימת מקבלי ספרים, קונים, נרשמים להשתלמות, דוח תרומות מ-Jgive). המערכת מזהה אנשים קיימים לפי מייל או טלפון, ולא יוצרת כפילויות.</p>
      <div class="grid2">
        <div class="field"><label for="impType">מה הקובץ מכיל?</label><select id="impType">
          ${[["book_received", "חלוקת ספרים"], ["book_purchase", "מכירת ספרים"], ["course", "נרשמים / משתתפים בהשתלמות"], ["donation", "תרומות"], ["contacts", "אנשי קשר בלבד"]]
            .map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select></div>
        <div class="field"><label for="impFile">קובץ</label><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></div>
      </div>
      <div id="impMap"></div>
    </div>`;
  $("impFile").onchange = readImportFile;
  $("impType").onchange = () => { if (IMP) drawImpMap(); };
}

async function readImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  let rows;
  try {
    const wb = await readWorkbook(file);
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  } catch { return toast("לא הצלחתי לקרוא את הקובץ", "bad"); }
  if (!rows.length) return toast("הקובץ ריק", "bad");
  IMP = { file: file.name, rows, headers: Object.keys(rows[0]) };
  drawImpMap();
}

function drawImpMap() {
  const { rows, headers } = IMP, type = $("impType").value, L = IMP_LABELS[type] || {};
  const prev = {}; document.querySelectorAll("#impMap select[data-f]").forEach((s) => (prev[s.dataset.f] = s.value));
  const guess = (k, re) => (k in prev ? prev[k] : headers.find((h) => re.test(String(h).trim())) || "");
  const fields = IMPORT_FIELDS.filter(([k]) => (k !== "status" || type === "course") && (type !== "contacts" || !["date", "amount", "details"].includes(k))
    && (k !== "amount" || ["donation", "book_purchase"].includes(type)));
  const isBook = type === "book_received" || type === "book_purchase";
  const courses = [...S.courses.values()].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  const today = new Date().toISOString().slice(0, 10);
  $("impMap").innerHTML = `
    <h3>התאמת עמודות (${rows.length} שורות)</h3>
    <p class="small muted" style="margin-top:0">לכל שדה בוחרים מאיזו עמודה בקובץ לקחת אותו. מייל או טלפון – חובה.</p>
    <div class="grid2">${fields.map(([k, label, re]) => `
      <div class="field"><label>${esc(L[k] || label)}</label><select data-f="${k}"><option value="">— אין בקובץ —</option>
        ${headers.map((h) => `<option ${guess(k, re) === h ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></div>`).join("")}
    </div>
    ${isBook ? `<div class="imp-extra">
      <h3>${type === "book_received" ? "איזה ספר חולק" : "אילו ספרים נקנו"}</h3>
      <div class="grid2">
        <div class="field"><label for="impBook">ספר לכל השורות</label><select id="impBook">
          <option value="">— לפי העמודה בקובץ —</option>${S.books.map((b) => `<option>${esc(b)}</option>`).join("")}<option value="__other">ספר אחר...</option></select></div>
        <div class="field hidden" id="impBookOtherBox"><label for="impBookOther">שם הספר</label><input id="impBookOther"></div>
        <div class="field"><label for="impDate">${type === "book_received" ? "תאריך החלוקה" : "תאריך הקנייה"} (כשאין עמודת תאריך)</label><input type="date" id="impDate" value="${today}"></div>
      </div>
      ${S.books.length ? `<p class="small muted">שמות ספרים בעמודה מותאמים אוטומטית לרשימת ספרי המכון (מספיק חלק מהשם). כמה ספרים בתא אחד – מפרידים בפסיק.</p>`
        : `<p class="small" style="color:var(--warn)">עדיין לא הוגדרה רשימת ספרי המכון. מגדירים אותה ב<b>ספרים ← קטלוג וחנות</b>, ואז אפשר לבחור ספר מהרשימה.</p>`}
    </div>` : ""}
    ${type === "course" ? `<div class="imp-extra">
      <h3>איזו השתלמות</h3>
      <div class="grid2">
        <div class="field"><label for="impCourse">השתלמות לכל השורות</label><select id="impCourse">
          ${courses.map((c) => `<option value="${c.id}">${esc(c.title)}${c.startDate ? " · " + c.startDate.slice(0, 7).split("-").reverse().join("/") : ""}</option>`).join("")}
          <option value="__col">— לפי עמודת "שם ההשתלמות" בקובץ —</option><option value="__other">השתלמות ישנה שלא במערכת (רק תיעוד)</option></select></div>
        <div class="field hidden" id="impCourseOtherBox"><label for="impCourseOther">שם ההשתלמות</label><input id="impCourseOther" placeholder="למשל: שמיטה תשפ״ב"></div>
        <div class="field"><label for="impStatus">סטטוס (כשאין עמודת סטטוס או שהתא ריק)</label><select id="impStatus">
          ${Object.entries(REG_STATUS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      </div>
      <p class="small muted">השתלמות שקיימת במערכת: האנשים נרשמים אליה עם הסטטוס (מאושר = גישה לאזור האישי), ומופיעים בלשונית "נרשמים". מי שכבר רשום אליה – מדולג.
        ערכים מוכרים בעמודת הסטטוס: מאושר / ממתין / נדחה / ביטל.</p>
    </div>` : ""}
    ${type === "donation" ? `<div class="field"><label for="impFixed">תיאור קבוע לכל השורות (רשות – למשל "קמפיין חנוכה תשפ״ז")</label><input id="impFixed"></div>` : ""}
    <div class="table-wrap" style="max-height:220px;margin-bottom:12px"><table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.slice(0, 5).map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h] instanceof Date ? fmtDate(r[h]) : r[h])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <button class="primary" id="impRun">ייבוא</button> <span id="impProgress" class="muted"></span>
    <div id="impResult"></div>`;
  if ($("impBook")) $("impBook").onchange = (e) => $("impBookOtherBox").classList.toggle("hidden", e.target.value !== "__other");
  if ($("impCourse")) $("impCourse").onchange = (e) => $("impCourseOtherBox").classList.toggle("hidden", e.target.value !== "__other");
  $("impRun").onclick = runImport;
}

const truthy = (v) => /^(כן|yes|y|true|1|v|✓|מאשר|מאושר)$/i.test(String(v).trim());

async function runImport() {
  const map = {};
  document.querySelectorAll("#impMap select[data-f]").forEach((s) => (map[s.dataset.f] = s.value));
  if (!map.email && !map.phone) return toast("חובה לבחור עמודת מייל או טלפון", "bad");
  const type = $("impType").value;
  const isBook = type === "book_received" || type === "book_purchase";
  const val = (r, k) => (map[k] ? r[map[k]] : "");
  // ספר קבוע / השתלמות קבועה
  const fixedBook = isBook ? ($("impBook").value === "__other" ? $("impBookOther").value.trim() : $("impBook").value) : "";
  if (isBook && $("impBook").value === "__other" && !fixedBook) return toast("נא לכתוב את שם הספר", "bad");
  if (isBook && !fixedBook && !map.details) return toast("נא לבחור ספר, או עמודה בקובץ שבה כתוב הספר", "bad");
  const fixedDate = isBook && $("impDate").value ? new Date($("impDate").value + "T12:00") : null;
  const courseSel = type === "course" ? $("impCourse").value : "";
  if (type === "course" && courseSel === "__col" && !map.details) return toast('נא לבחור את עמודת "שם ההשתלמות"', "bad");
  const otherCourse = courseSel === "__other" ? $("impCourseOther").value.trim() : "";
  if (courseSel === "__other" && !otherCourse) return toast("נא לכתוב את שם ההשתלמות", "bad");
  if (type === "course" && !courseSel) return toast("נא לבחור השתלמות", "bad");
  const defStatus = type === "course" ? $("impStatus").value : "";
  const fixed = $("impFixed")?.value.trim() || "";
  const btn = $("impRun"); btn.disabled = true;

  const idxE = new Map(S.byEmail), idxP = new Map(S.byPhone);
  const regKeys = new Set([...S.regs.values()].map((r) => `${r.courseId}|${normEmail(r.email)}`));
  const pending = new Map(); // contactId -> data (new or updates)
  let created = 0, updated = 0, acts = 0, skipped = 0, regsAdded = 0, regsDup = 0;
  const unknownBooks = new Set(), unknownCourses = new Set(), noEmailForCourse = [];
  let batch = writeBatch(db), ops = 0;
  const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };

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
      const d = toDate(val(r, "date")) || fixedDate;
      const date = d ? Timestamp.fromDate(d) : Timestamp.now();
      const amt = parseFloat(String(val(r, "amount") || "").replace(/[^\d.]/g, ""));
      const act = { contactId: id, type, amount: isNaN(amt) ? null : amt, date, source: "ייבוא: " + IMP.file, createdBy: S.user.uid, createdAt: serverTimestamp() };
      let writeAct = true;
      if (isBook) {
        const books = fixedBook ? [{ name: fixedBook, known: S.books.includes(fixedBook) }] : matchBooks(val(r, "details"));
        books.filter((b) => !b.known).forEach((b) => unknownBooks.add(b.name));
        act.books = books.map((b) => b.name);
        act.details = act.books.join(", ") || "ספרים";
      } else if (type === "course") {
        const course = courseSel === "__col" ? matchCourse(val(r, "details")) : courseSel !== "__other" ? S.courses.get(courseSel) : null;
        const status = statusOf(val(r, "status")) || defStatus;
        if (course) {
          act.details = course.title; act.courseId = course.id;
          if (!eK) noEmailForCourse.push(full || [first, last].join(" ") || phone);
          else if (regKeys.has(`${course.id}|${eK}`)) { regsDup++; writeAct = false; }
          else {
            regKeys.add(`${course.id}|${eK}`);
            const ref = doc(collection(db, "registrations"));
            batch.set(ref, { courseId: course.id, email: eK, firstName: first, lastName: last, phone, status, consentEmail: consent === true,
              managerEmails: course.managerEmails || [], source: "ייבוא: " + IMP.file, contactId: id, createdAt: date }); ops++; regsAdded++;
            if (status === "registered") { batch.set(doc(db, "courseAccess", `${course.id}_${eK}`), { courseId: course.id, email: eK, regId: ref.id }); ops++; }
          }
        } else {
          const name = courseSel === "__other" ? otherCourse : String(val(r, "details") || "").trim();
          if (courseSel === "__col" && name) unknownCourses.add(name);
          act.details = [name || "השתלמות", status && status !== "registered" ? REG_STATUS_LABEL[status] : ""].filter(Boolean).join(" · ");
        }
      } else {
        act.details = [fixed, String(val(r, "details") || "").trim()].filter(Boolean).join(" · ");
      }
      if (writeAct) { batch.set(doc(collection(db, "activities")), act); ops++; acts++; }
    }
    if (ops >= 380) { await flush(); $("impProgress").textContent = `מייבא... ${created + updated} אנשי קשר`; }
  }
  try {
    await flush();
    $("impProgress").textContent = "";
    const notes = [
      `<b>${created}</b> אנשי קשר חדשים, <b>${updated}</b> עודכנו, <b>${acts}</b> רשומות היסטוריה.`,
      regsAdded ? `<b>${regsAdded}</b> נרשמו להשתלמות.` : "", regsDup ? `${regsDup} כבר היו רשומים להשתלמות – דולגו.` : "",
      skipped ? `${skipped} שורות בלי מייל וטלפון – דולגו.` : "",
      noEmailForCourse.length ? `${noEmailForCourse.length} בלי מייל – נשמרו בהיסטוריה אבל לא נרשמו להשתלמות (ההרשמה מחייבת מייל): ${noEmailForCourse.slice(0, 15).map(esc).join(", ")}` : "",
      unknownBooks.size ? `ספרים שלא נמצאו ברשימת ספרי המכון (נשמרו כפי שהם): ${[...unknownBooks].slice(0, 15).map(esc).join(", ")}` : "",
      unknownCourses.size ? `השתלמויות שלא נמצאו במערכת (נשמרו רק בהיסטוריה): ${[...unknownCourses].slice(0, 15).map(esc).join(", ")}` : ""
    ].filter(Boolean);
    const impFile = IMP?.file || ""; IMP = null;
    audit("ייבוא מאקסל", impFile, `${created} חדשים, ${updated} עודכנו, ${acts} רשומות`);
    renderImport(true);
    $("impMap").innerHTML = `<div class="context"><b>הייבוא הסתיים</b><ul style="margin:6px 0 0">${notes.map((n) => `<li>${n}</li>`).join("")}</ul></div>`;
    toast("הייבוא הסתיים", "good");
  } catch (e) { toast("הייבוא נכשל: " + e.code, "bad"); btn.disabled = false; }
}

// ======================================================
// משתמשים
// ======================================================
async function loadAudit() {
  let list = [];
  try { list = (await getDocs(query(collection(db, "auditLog"), orderBy("at", "desc"), limit(200)))).docs.map((d) => d.data()); }
  catch (e) { const b = $("auditBox"); if (b) b.innerHTML = `<p class="muted" style="padding:12px">לא נטען (${esc(e.code)}) – ייתכן שחוקי האבטחה עוד לא עודכנו.</p>`; return; }
  const box = $("auditBox"); if (!box) return;
  box.innerHTML = `<div class="table-wrap" style="max-height:420px"><table><thead><tr><th>מתי</th><th>מי</th><th>פעולה</th><th>על מה</th><th>פרטים</th></tr></thead><tbody>
    ${list.map((a) => `<tr><td class="nowrap">${toDate(a.at)?.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) || ""}</td><td class="small">${esc(userName(a.by))}</td>
      <td>${esc(a.action)}</td><td class="small">${esc(a.target)}</td><td class="small muted">${esc(a.details)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">עדיין אין רשומות</td></tr>'}</tbody></table></div>`;
}

function renderUsers(full) {
  if (!full && document.activeElement?.matches?.("[data-uphone]")) return; // לא לדרוס הקלדת טלפון
  const keep = full ? null : { e: $("uEmail")?.value, n: $("uName")?.value, p: $("uPhone")?.value, r: $("uRole")?.value };
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
        <input id="uPhone" type="tel" dir="ltr" style="width:150px" placeholder="טלפון (וואטסאפ)" aria-label="טלפון">
        <select id="uRole" style="width:auto">${roleOpts("staff")}</select>
        <button class="primary" id="uAdd">הוספה</button>
      </div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>שם</th><th>מייל</th><th>טלפון (וואטסאפ)</th><th>תפקיד</th><th class="hide-mobile">כניסה אחרונה</th><th></th></tr></thead>
      <tbody>${users.map((u) => {
        const me = u.id === myEmail();
        return `<tr><td>${esc(u.name || "")}</td><td>${esc(u.id)}</td>
        <td><input data-uphone="${esc(u.id)}" value="${esc(u.phone || "")}" type="tel" dir="ltr" style="width:140px" placeholder="050..." aria-label="טלפון של ${esc(u.name || u.id)}"></td>
        <td><select data-email="${esc(u.id)}" style="width:auto" ${me ? "disabled" : ""}>${roleOpts(u.role)}</select></td>
        <td class="hide-mobile small muted">${u.lastLogin ? fmtDate(u.lastLogin) : "עוד לא נכנס"}</td>
        <td>${me ? "" : `<button class="danger" data-remove="${esc(u.id)}">הסרה</button>`}</td></tr>`;
      }).join("")}</tbody></table></div></div>
    <div class="card small muted">
      <b>מה כל תפקיד רואה:</b> מנהל מערכת – הכול, כולל משתמשים ומחיקה. רכז הרכזים וצוות – אנשי קשר, שו"ת וייבוא.
      רב משיב – שו"ת ותקציר על השואל, צפייה בלבד בכרטיסי אנשי קשר.
    </div>
    <div class="row space" style="margin-top:16px"><h2 style="margin:0">יומן שינויים</h2><button data-go="selftest">בדיקת הרשאות</button></div>
    <p class="small muted">מחיקות, מיזוגים, שינויי הרשאות, ייבוא והגדרות – מי, מה ומתי. אי אפשר לערוך או למחוק את היומן.</p>
    <div class="card" style="padding:0" id="auditBox"><p class="muted" style="padding:12px">טוען...</p></div>`;
  loadAudit();
  document.querySelectorAll("#main [data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  if (keep?.e != null) { $("uEmail").value = keep.e; $("uName").value = keep.n; $("uPhone").value = keep.p || ""; $("uRole").value = keep.r; }
  $("uAdd").onclick = async () => {
    const email = normEmail($("uEmail").value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast("כתובת מייל לא תקינה", "bad");
    if (S.users.has(email)) return toast("המייל כבר ברשימה", "bad");
    try {
      await setDoc(doc(db, "allowedEmails", email), { name: $("uName").value.trim(), phone: $("uPhone").value.trim(), role: $("uRole").value, addedBy: myEmail(), addedAt: serverTimestamp() });
      audit("הוספת משתמש", email, ROLE_LABEL[$("uRole").value]);
      toast("נוסף. עכשיו הוא יכול להיכנס עם חשבון ה-Google שלו", "good");
    } catch (e) { toast("ההוספה נכשלה: " + e.code, "bad"); }
  };
  document.querySelectorAll("[data-uphone]").forEach((i) => (i.onchange = async () => {
    const ph = i.value.trim();
    if (ph && ph.replace(/\D/g, "").length < 9) return toast("מספר הטלפון לא תקין", "bad");
    try { await updateDoc(doc(db, "allowedEmails", i.dataset.uphone), { phone: ph }); toast("הטלפון נשמר", "good"); }
    catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
  }));
  document.querySelectorAll("select[data-email]").forEach((s) => (s.onchange = async () => {
    try { await updateDoc(doc(db, "allowedEmails", s.dataset.email), { role: s.value }); toast("התפקיד עודכן", "good"); audit("שינוי תפקיד", s.dataset.email, ROLE_LABEL[s.value]); }
    catch (e) { toast("העדכון נכשל: " + e.code, "bad"); }
  }));
  document.querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`להסיר את ${b.dataset.remove}? הגישה שלו תיחסם מיד.`)) return;
    try { await deleteDoc(doc(db, "allowedEmails", b.dataset.remove)); toast("הוסר"); audit("הסרת משתמש", b.dataset.remove); }
    catch (e) { toast("ההסרה נכשלה: " + e.code, "bad"); }
  }));
}

// ======================================================
// הגדרות: קטגוריות ותגיות
// ======================================================
let SET = null; // טיוטת עריכה

function renderSettings(full) {
  if (!full && $("setCats") && (SET?.dirty || document.querySelector("#modalRoot .modal"))) return; // לא לדרוס עריכה פתוחה
  SET = JSON.parse(JSON.stringify(S.tax));
  // כל קטגוריה זוכרת את שמה המקורי – כדי לעדכן את השאלות כשמשנים שם או מוחקים
  SET.rows = SET.categories.map((name) => ({ name, orig: name }));
  SET.moves = new Map(); // שם מקורי של קטגוריה שנמחקה ← השורה שאליה עוברות השאלות
  $("main").innerHTML = `
    <h1>הגדרות</h1>
    <div class="split">
      <div class="card">
        <h2>קטגוריות</h2>
        <p class="small muted">מופיעות בטופס "שאל את הרב", במאגר ובסינון. העיגול המסומן = ברירת המחדל בטופס.
          שינוי שם מעדכן את כל השאלות של הקטגוריה; במחיקה בוחרים לאן להעביר את השאלות שלה. השינויים נכנסים לתוקף בלחיצה על "שמירת ההגדרות".</p>
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
    </div>
    <div class="card" style="margin-top:16px">
      <h2>שליחת מיילים</h2>
      ${schedulerState(S.scheduler).ok ? `<p><span class="badge good">סקריפט השליחה פעיל</span>${S.scheduler?.account ? ` · שולח מ-<b dir="ltr">${esc(S.scheduler.account)}</b>` : ""}</p>`
        : `<div class="conflict-box">${esc(schedulerState(S.scheduler).text)}</div>`}
      ${S.scheduler?.lastError ? `<div class="conflict-box" style="margin-top:8px">שגיאה בהרצה האחרונה של הסקריפט: <span dir="auto">${esc(S.scheduler.lastError)}</span></div>` : ""}
      <p class="small muted">כל המיילים נשלחים מחשבון ה-Gmail של המכון על ידי הסקריפט, תוך כמה דקות. בכל מייל יש קישור להסרה מרשימת התפוצה. ${S.optouts.size ? `עד היום ${S.optouts.size} כתובות הוסרו.` : ""}</p>
      <button id="mailTest">שליחת מייל ניסיון לעצמי</button>
    </div>
    ${can("admin", "head") ? qaNotifyCard() : ""}
    ${can("admin") ? `<div class="card" style="margin-top:16px">
      <h2>גיבוי</h2>
      <p class="small">${toDate(S.scheduler?.lastBackup) ? `גיבוי אוטומטי אחרון: <b>${toDate(S.scheduler.lastBackup).toLocaleString("he-IL")}</b> – בתיקייה "גיבוי מערכת משפטי ארץ" ב-Google Drive של חשבון המכון (12 הגיבויים האחרונים נשמרים).`
        : "הגיבוי האוטומטי (כל יום ראשון בלילה, ל-Google Drive של חשבון המכון) עוד לא רץ – הוא מופעל עם התקנת הסקריפט."}</p>
      <div class="row"><button id="bkXlsx">הורדת גיבוי מלא עכשיו (Excel)</button><button id="bkJson">הורדה כקובץ JSON</button><span id="bkMsg" class="small muted"></span></div>
    </div>` : ""}
    <div class="card" style="margin-top:16px">
      <h2>חשבונות זום (להתראות התנגשות)</h2>
      <p class="small muted">חשבון בכל שורה. אם שני מפגשים חופפים משתמשים באותו חשבון, לוח השנה יתריע.</p>
      <textarea id="zoomAccounts" style="min-height:90px" aria-label="חשבונות זום">${esc(S.resources.zoomAccounts.join("\n"))}</textarea>
      <button id="saveZoom" style="margin-top:8px">שמירת חשבונות</button>
    </div>`;
  $("mailTest").onclick = () => composeMail(ctx(), {
    title: "מייל ניסיון", kind: "test",
    recipients: [{ email: myEmail(), name: S.profile.name || "", firstName: (S.profile.name || "").split(" ")[0] }],
    subject: "בדיקת שליחה ממערכת משפטי ארץ", body: "שלום {שם פרטי},\n\nזה מייל ניסיון. אם קיבלת אותו – השליחה מהמערכת עובדת.\n\nמכון משפטי ארץ"
  });
  if ($("qnSave")) bindQaNotify();
  if ($("bkXlsx")) { $("bkXlsx").onclick = () => fullBackup("xlsx"); $("bkJson").onclick = () => fullBackup("json"); }
  $("saveZoom").onclick = async () => {
    const list = [...new Set($("zoomAccounts").value.split("\n").map((x) => x.trim()).filter(Boolean))];
    if (!list.length) return toast("צריך לפחות חשבון אחד", "bad");
    try { await setDoc(doc(db, "settings", "resources"), { zoomAccounts: list, updatedAt: serverTimestamp() }); toast("נשמר", "good"); audit("עדכון חשבונות זום", list.join(", ")); }
    catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
  };
  drawSettingsLists();
  // ברגע שמתחילים לערוך – המסך לא מתרענן מעצמו (כדי לא לאבד שינויים)
  ["setCats", "setTags", "addCat", "addTag"].forEach((id) => ["input", "click"].forEach((ev) => $(id).addEventListener(ev, (e) => { if (ev === "input" || e.target.closest("button")) SET.dirty = true; })));
  $("addCat").onclick = () => { SET.rows.push({ name: "", orig: "" }); drawSettingsLists(); $("setCats").querySelector(".cond:last-child [data-k=name]")?.focus(); };
  $("addTag").onclick = () => { SET.tags.push({ name: "", keywords: [] }); drawSettingsLists(); };
  $("saveSet").onclick = saveSettings;
  $("retagAll").onclick = retagAll;
}

function drawSettingsLists() {
  // שאלות לפי שם מקורי של קטגוריה, כולל שאלות שכבר הועברו לשורה הזו ממחיקה קודמת
  const qCount = (orig) => (orig ? [...S.questions.values()].filter((q) => q.topic === orig).length : 0);
  const origsOf = (row) => [row.orig, ...[...SET.moves].filter(([, t]) => t === row).map(([o]) => o)].filter(Boolean);
  const qn = (k) => (k === 1 ? "שאלה אחת" : `${k} שאלות`);
  const rowCount = (row) => origsOf(row).reduce((a, o) => a + qCount(o), 0);
  $("setCats").innerHTML = SET.rows.map((r, i) => {
    const n = rowCount(r), renamed = r.orig && r.name.trim() !== r.orig, moved = [...SET.moves].filter(([, t]) => t === r).map(([o]) => o);
    return `
    <div class="cond cat-row" data-i="${i}">
      <label class="check" title="ברירת מחדל בטופס" style="margin:0"><input type="radio" name="defCat" data-k="def" aria-label="ברירת מחדל" ${r.name && r.name === SET.defaultCategory ? "checked" : ""}></label>
      <input data-k="name" value="${esc(r.name)}" placeholder="שם הקטגוריה" style="flex:1" aria-label="שם הקטגוריה">
      <span class="small muted cat-n" title="שאלות בקטגוריה">${n ? qn(n) : ""}</span>
      <button data-k="up" title="למעלה" aria-label="להעלות" ${i === 0 ? "disabled" : ""}>▲</button>
      <button data-k="del" class="danger" title="מחיקה" aria-label="מחיקת הקטגוריה">✕</button>
    </div>
    ${renamed || moved.length ? `<div class="small cat-note">${renamed ? `השם ישתנה מ"${esc(r.orig)}"${qCount(r.orig) ? ` – ${qn(qCount(r.orig))} יעודכנו` : ""}. ` : ""}${moved.length ? `יקבל את השאלות של: ${moved.map((o) => `"${esc(o)}"`).join(", ")}.` : ""}</div>` : ""}`;
  }).join("");
  $("setCats").querySelectorAll(".cond").forEach((row) => {
    const i = Number(row.dataset.i), r = SET.rows[i];
    row.querySelector('[data-k="name"]').oninput = (e) => {
      const was = r.name; r.name = e.target.value;
      if (SET.defaultCategory === was) SET.defaultCategory = e.target.value;
    };
    row.querySelector('[data-k="name"]').onchange = () => drawSettingsLists();
    row.querySelector('[data-k="def"]').onchange = () => { SET.defaultCategory = r.name; };
    row.querySelector('[data-k="up"]').onclick = () => { SET.rows.splice(i, 1); SET.rows.splice(i - 1, 0, r); drawSettingsLists(); };
    row.querySelector('[data-k="del"]').onclick = () => deleteCategory(r, origsOf(r), rowCount(r));
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

// מחיקת קטגוריה: אם יש בה שאלות – שואלים לאיזו קטגוריה להעביר אותן
function deleteCategory(row, origs, n) {
  const others = SET.rows.filter((x) => x !== row && x.name.trim());
  const remove = (target) => {
    SET.rows = SET.rows.filter((x) => x !== row);
    origs.forEach((o) => (target ? SET.moves.set(o, target) : SET.moves.delete(o)));
    if (SET.defaultCategory === row.name) SET.defaultCategory = (target || others[0])?.name || "";
    drawSettingsLists();
  };
  if (!n) { if (!row.name.trim() || confirm(`למחוק את הקטגוריה "${row.name}"?`)) remove(null); return; }
  if (!others.length) return toast("אי אפשר למחוק את הקטגוריה היחידה – קודם מוסיפים קטגוריה אחרת", "bad");
  openModal(`
    <div class="head"><h2>מחיקת הקטגוריה "${esc(row.name)}"</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <p>בקטגוריה הזו יש <b>${n === 1 ? "שאלה אחת" : n + " שאלות"}</b>${origs.length > 1 ? " (כולל שאלות שכבר הועברו אליה)" : ""}. לאיזו קטגוריה להעביר אותן?</p>
    <div class="field"><label for="catMoveTo">להעביר לקטגוריה</label>
      <select id="catMoveTo">${others.map((x, i) => `<option value="${i}">${esc(x.name)}</option>`).join("")}</select></div>
    <p class="small muted">ההעברה תתבצע (גם במאגר השו"ת שפורסם) בלחיצה על "שמירת ההגדרות".</p>
    <div class="row"><button class="primary" id="catMoveOk">מחיקה והעברה</button><button data-close>ביטול</button></div>`, () => {
    $("catMoveOk").onclick = () => { remove(others[Number($("catMoveTo").value)]); closeModal(); };
  });
}

async function saveSettings() {
  const cats = [...new Set(SET.rows.map((r) => r.name.trim()).filter(Boolean))];
  if (cats.length !== SET.rows.filter((r) => r.name.trim()).length) return toast("יש שתי קטגוריות עם אותו שם", "bad");
  if (!cats.length) return toast("צריך לפחות קטגוריה אחת", "bad");
  const names = SET.tags.map((t) => t.name.trim()).filter(Boolean);
  if (new Set(names).size !== names.length) return toast("יש שתי תגיות עם אותו שם", "bad");
  const data = normTaxonomy({ categories: cats, defaultCategory: cats.includes(SET.defaultCategory?.trim()) ? SET.defaultCategory.trim() : cats[0], tags: SET.tags });
  // שם ישן ← שם חדש: קטגוריות ששמן שונה, וקטגוריות שנמחקו והשאלות שלהן עוברות
  const remap = new Map();
  SET.rows.forEach((r) => { if (r.orig && r.name.trim() && r.name.trim() !== r.orig) remap.set(r.orig, r.name.trim()); });
  SET.moves.forEach((t, o) => { if (t.name.trim()) remap.set(o, t.name.trim()); });
  const qs = [...S.questions.values()].filter((q) => remap.has(q.topic));
  try {
    let pub = [];
    for (const old of remap.keys()) { const snap = await getDocs(query(collection(db, "publicQA"), where("topic", "==", old))); snap.forEach((d) => pub.push([d.id, remap.get(old)])); }
    const ops = [...qs.map((q) => [doc(db, "questions", q.id), remap.get(q.topic)]), ...pub.map(([id, t]) => [doc(db, "publicQA", id), t])];
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      ops.slice(i, i + 400).forEach(([r, topic]) => b.update(r, { topic }));
      await b.commit();
    }
    // רב לפי קטגוריה (התראות שו"ת) – עובר עם שינוי השם
    const byCat = S.qaNotify?.byCategory;
    if (byCat && [...remap.keys()].some((k) => byCat[k])) {
      const nb = {};
      Object.entries(byCat).forEach(([k, v]) => { const nk = remap.get(k) || k; if (cats.includes(nk) && !nb[nk]) nb[nk] = v; });
      await setDoc(doc(db, "settings", "qaNotify"), { byCategory: nb }, { merge: true });
    }
    await setDoc(doc(db, "settings", "taxonomy"), { ...data, updatedBy: myEmail(), updatedAt: serverTimestamp() });
    audit("עדכון קטגוריות ותגיות", "", remap.size ? [...remap].map(([a, b]) => `${a} ← ${b}`).join(", ") + ` (${qs.length} שאלות)` : "");
    S.tax = data;
    toast(qs.length ? `ההגדרות נשמרו ו-${qs.length} שאלות עודכנו` : "ההגדרות נשמרו", "good");
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


// ---------- גיבוי ידני (מנהל מערכת) ----------
const BACKUP_COLS = ["mgmtProjects", "contacts", "activities", "questions", "publicQA", "allowedEmails", "savedLists", "courses", "sessions", "sessionPrivate", "recordings", "materials",
  "registrations", "courseAccess", "feedback", "monthly", "settings", "optouts", "orders", "institutions", "distributions", "jgiveInbox", "mailQueue", "auditLog"];
async function fullBackup(kind) {
  const out = {};
  for (const [i, name] of BACKUP_COLS.entries()) {
    $("bkMsg").textContent = `טוען ${i + 1}/${BACKUP_COLS.length}: ${name}`;
    try { out[name] = (await getDocs(collection(db, name))).docs.map((d) => ({ _id: d.id, ...d.data() })); } catch (e) { out[name] = []; }
  }
  const plain = (v) => (v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v);
  const deep = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === "object" && typeof v.toDate === "function" ? v.toDate().toISOString() : v)));
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "json") {
    const blob = new Blob([JSON.stringify(deep(out), null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `גיבוי-משפטי-ארץ-${stamp}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  } else {
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
    for (const [name, rows] of Object.entries(out)) {
      const flat = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => { v = plain(v); return [k, v && typeof v === "object" ? JSON.stringify(deep(v)).slice(0, 32000) : v]; })));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flat.length ? flat : [{ "": "ריק" }]), name.slice(0, 31));
    }
    const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `גיבוי-משפטי-ארץ-${stamp}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  $("bkMsg").textContent = `הגיבוי ירד: ${Object.values(out).reduce((a, r) => a + r.length, 0)} רשומות`;
  audit("גיבוי ידני", kind);
}

// ---------- התראות שו"ת (נשלחות על ידי הסקריפט) ----------
function qaNotifyCard() {
  const n = S.qaNotify || {};
  const people = [...S.users.values()].filter((u) => ["rabbi", "head", "admin", "staff"].includes(u.role)).sort((a, b) => userName(a.id).localeCompare(userName(b.id), "he"));
  const checks = (name, sel) => people.map((u) => `<label class="check"><input type="checkbox" data-${name}="${esc(u.id)}" ${(sel || []).includes(u.id) ? "checked" : ""}> <span>${esc(userName(u.id))} <span class="small muted">(${ROLE_LABEL[u.role]})</span></span></label>`).join("");
  const inst = n.newTo ?? (S.scheduler?.account || "");
  return `<div class="card" style="margin-top:16px">
    <h2>התראות שו"ת במייל</h2>
    <label class="check"><input type="checkbox" id="qnNew" ${n.notifyNew !== false && S.qaNotify ? "checked" : ""}> <span><b>מייל על כל שאלה חדשה</b></span></label>
    <div class="field" style="max-width:640px;margin:6px 0 10px"><label for="qnTo"><b>כתובת לקבלת התראות על שאלות חדשות</b> (ברירת מחדל – בדרך כלל המייל של המכון. אפשר כמה כתובות, מופרדות בפסיק)</label>
      <input id="qnTo" dir="ltr" value="${esc(inst)}" placeholder="dintora@gmail.com"></div>
    <label class="check"><input type="checkbox" id="qnRemind" ${n.remind !== false && S.qaNotify ? "checked" : ""}> <span><b>תזכורת על שאלה שלא נענתה</b> אחרי</span>
      <input type="number" id="qnDays" min="1" max="30" value="${n.remindDays || 3}" style="width:70px" aria-label="מספר ימים"> <span>ימים (ושוב כל אותו מספר ימים) – לכתובת שלמעלה ולרב של השאלה</span></label>
    <div class="field" style="margin-top:10px;max-width:640px"><label for="qnDefRabbi"><b>משיב ברירת מחדל</b> – יופיע אוטומטית כ"רב משיב" בכל שאלה שלא שויכה (לא מקבל מייל על שאלות חדשות)</label>
      <select id="qnDefRabbi"><option value="">ללא</option>${rabbis().sort((a, b) => userName(a.id).localeCompare(userName(b.id), "he")).map((u) => `<option value="${esc(u.id)}" ${n.defaultRabbi === u.id ? "selected" : ""}>${esc(userName(u.id))}</option>`).join("")}</select></div>
    <div class="grid2" style="margin-top:10px">
      <div><h3>עותק מכל שאלה חדשה גם ל:</h3><p class="small muted" style="margin-top:0">בנוסף לכתובת שלמעלה (רשות)</p>${checks("qnnew", n.newAlso)}</div>
      <div><h3>עותק מכל תזכורת גם ל:</h3><p class="small muted" style="margin-top:0">(רשות)</p>${checks("qncc", n.remindAlso)}</div>
    </div>
    <h3 style="margin-top:10px">רב נוסף לפי קטגוריה (רשות)</h3>
    <p class="small muted" style="margin-top:0">שאלה בקטגוריה שהוגדר לה רב – נשלחת <b>גם</b> אליו (בנוסף לכתובת שלמעלה), ובמייל לכתובת שלמעלה יצוין שהשאלה נשלחה גם אליו. הוא גם יופיע כמשיב המוצע בשאלה. שאלה ששויכה לרב – התזכורות עליה הולכות גם אליו.</p>
    <div class="grid2">${S.tax.categories.map((cat) => `<div class="field"><label>${esc(cat)}</label><select data-qncat="${esc(cat)}" aria-label="רב לקטגוריה ${esc(cat)}"><option value="">רק לכתובת שלמעלה</option>
      ${people.map((u) => `<option value="${esc(u.id)}" ${(n.byCategory?.[cat] || [])[0] === u.id ? "selected" : ""}>${esc(userName(u.id))}</option>`).join("")}</select></div>`).join("")}</div>
    <button id="qnSave">שמירת הגדרות ההתראות</button>
    <p class="small muted">ההתראות חלות על שאלות שמגיעות מרגע השמירה הראשונה (לא על שאלות ישנות).</p>
  </div>`;
}
function bindQaNotify() {
  $("qnSave").onclick = async () => {
    const picked = (name) => [...document.querySelectorAll(`[data-${name}]:checked`)].map((x) => x.getAttribute(`data-${name}`));
    const byCategory = {};
    document.querySelectorAll("[data-qncat]").forEach((sel) => { if (sel.value) byCategory[sel.dataset.qncat] = [sel.value]; });
    const data = { notifyNew: $("qnNew").checked, remind: $("qnRemind").checked, remindDays: Math.max(1, Number($("qnDays").value) || 3),
      newTo: $("qnTo").value.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).join(", "), remindAlso: picked("qncc"), newAlso: picked("qnnew"), defaultRabbi: $("qnDefRabbi").value, byCategory, updatedBy: myEmail(), updatedAt: serverTimestamp() };
    if (!S.qaNotify?.enabledAt) data.enabledAt = serverTimestamp();
    const bad = data.newTo.split(", ").filter((x) => x && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (bad.length) { $("qnTo").focus(); return toast("כתובת מייל לא תקינה: " + bad.join(", "), "bad"); }
    if ((data.notifyNew || data.remind) && !data.newTo) { $("qnTo").focus(); return toast("נא למלא כתובת לקבלת ההתראות", "bad"); }
    try { await setDoc(doc(db, "settings", "qaNotify"), data, { merge: true }); toast("נשמר", "good"); audit("עדכון התראות שו\"ת"); }
    catch (e) { toast("השמירה נכשלה: " + e.code, "bad"); }
  };
}

// ======================================================
// מיילים מתוזמנים ויומן שליחות
// ======================================================
const JOB_STATUS = { scheduled: "ממתין בתור", sending: "בשליחה", sent: "נשלח", partial: "נשלח חלקית", failed: "נכשל", cancelled: "בוטל" };
const JOB_BADGE = { scheduled: "info", sending: "warn", sent: "good", partial: "warn", failed: "bad", cancelled: "" };
let mailLogCache = null;

function renderMail(full) {
  const jobs = [...S.mailQueue.values()].sort((a, b) => (toDate(b.sendAt)?.getTime() || 0) - (toDate(a.sendAt)?.getTime() || 0));
  const lastRun = toDate(S.scheduler?.lastRun);
  const alive = lastRun && Date.now() - lastRun.getTime() < 20 * 60000;
  const upcoming = jobs.filter((j) => j.status === "scheduled");
  $("main").innerHTML = `
    <h1>מיילים</h1>
    <div class="card">
      ${alive ? `<span class="badge good">סקריפט השליחה פעיל</span> <span class="small muted">ריצה אחרונה: ${lastRun.toLocaleString("he-IL")}</span>`
        : `<div class="conflict-box"><b>סקריפט השליחה לא פעיל.</b> המיילים מחכים בתור ולא יישלחו עד שהסקריפט יותקן בחשבון ה-Gmail של המכון (README, פרק "שליחת מיילים").
          ${lastRun ? `<div class="small">ריצה אחרונה: ${lastRun.toLocaleString("he-IL")}</div>` : ""}</div>`}
      ${S.scheduler?.lastError ? `<div class="small" style="color:var(--bad)">שגיאה אחרונה: ${esc(S.scheduler.lastError)}</div>` : ""}
      <p class="small muted" style="margin-bottom:0">כל מייל שנשלח מהמערכת נכנס לתור, והסקריפט שולח אותו תוך כמה דקות (או במועד שנקבע). ${can("admin", "head") ? "כאן מוצגים כל המיילים." : "כאן מוצגים המיילים ששלחת."}</p>
    </div>
    <h2>בתור ${upcoming.length ? `(${upcoming.length})` : ""}</h2>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>מועד</th><th>נושא</th><th>נמענים</th><th>סטטוס</th><th>נוצר על ידי</th><th></th></tr></thead>
      <tbody>${jobs.map((j) => `<tr>
        <td class="nowrap">${toDate(j.sendAt)?.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) || ""}</td>
        <td>${esc(j.subject)}${j.title ? `<div class="small muted">${esc(j.title)}</div>` : ""}</td>
        <td>${j.total || (j.recipients || []).length}${(j.recipients || []).length === 1 ? `<div class="small muted">${esc(j.recipients[0].email)}</div>` : ""}</td>
        <td><span class="badge ${JOB_BADGE[j.status] || ""}">${JOB_STATUS[j.status] || j.status}</span>
          ${["sent", "partial", "sending"].includes(j.status) ? `<div class="small muted">${(j.sentEmails || []).length - (j.failed || []).length}/${j.total}</div>` : ""}
          ${(j.failed || []).length ? `<details><summary class="small">${j.failed.length} נכשלו</summary><div class="small">${j.failed.map(esc).join("<br>")}</div></details>` : ""}</td>
        <td class="small">${esc(userName(j.createdBy))}</td>
        <td>${j.status === "scheduled" ? `<button class="link" data-viewjob="${j.id}">תצוגה</button> <button class="link danger" data-canceljob="${j.id}">ביטול</button>` : `<button class="link" data-viewjob="${j.id}">תצוגה</button>`}</td></tr>`).join("")
        || '<tr><td colspan="6" class="muted">אין מיילים</td></tr>'}</tbody></table></div></div>
    ${can("admin", "head") ? `<h2>יומן שליחות</h2><div class="card" style="padding:0" id="mailLogBox"><p class="muted" style="padding:12px">טוען...</p></div>` : ""}`;
  document.querySelectorAll("[data-canceljob]").forEach((b) => (b.onclick = async () => {
    if (!confirm("לבטל את המייל?")) return;
    try { await updateDoc(doc(db, "mailQueue", b.dataset.canceljob), { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: myEmail() }); toast("בוטל"); }
    catch (e) { toast("הביטול נכשל (ייתכן שהשליחה כבר התחילה): " + e.code, "bad"); }
  }));
  document.querySelectorAll("[data-viewjob]").forEach((b) => (b.onclick = () => {
    const j = S.mailQueue.get(b.dataset.viewjob);
    const r0 = (j.recipients || [])[0] || {};
    const fillOne = (t) => String(t).replace(/\{([^{}]+)\}/g, (m, k) => ({ "שם": r0.name, "שם פרטי": r0.firstName || (r0.name || "").split(" ")[0], ...(r0.vars || {}) })[k] ?? m);
    openModal(`<div class="head"><h2>${esc(j.subject)}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
      <p class="small muted">${toDate(j.sendAt)?.toLocaleString("he-IL") || ""} · ${j.total} נמענים · דוגמה עבור ${esc(r0.name || r0.email || "")}</p>
      <div class="card pre" style="background:var(--surface-2)">${esc(fillOne(j.body))}</div>
      <details><summary class="small">כל הנמענים</summary><div class="small muted">${(j.recipients || []).map((r) => esc(r.name ? `${r.name} <${r.email}>` : r.email)).join(" · ")}</div></details>`);
  }));
  if (can("admin", "head") && (full || !mailLogCache)) loadMailLog();
  else if (mailLogCache) drawMailLog();
}

async function loadMailLog() {
  try {
    const snap = await getDocs(query(collection(db, "mailLog"), orderBy("at", "desc"), limit(100)));
    mailLogCache = snap.docs.map((d) => d.data());
  } catch (e) { mailLogCache = []; }
  drawMailLog();
}
function drawMailLog() {
  const box = $("mailLogBox"); if (!box) return;
  box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>נשלח</th><th>אל</th><th>נושא</th><th>על ידי</th></tr></thead><tbody>
    ${mailLogCache.map((m) => `<tr><td class="nowrap">${toDate(m.at)?.toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) || ""}</td><td dir="ltr" style="text-align:right">${esc(m.to)}</td><td>${esc(m.subject)}</td><td class="small">${esc(userName(m.by))}${m.scheduled ? " · מתוזמן" : ""}</td></tr>`).join("")
    || '<tr><td colspan="4" class="muted">עדיין לא נשלחו מיילים</td></tr>'}</tbody></table></div>
    <p class="small muted" style="padding:0 12px">100 המיילים האחרונים.</p>`;
}
