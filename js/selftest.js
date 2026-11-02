// ===== בדיקת הרשאות מול Firebase האמיתי =====
// כל איש צוות מריץ את הבדיקה מהחשבון שלו: המערכת מנסה לקרוא ולכתוב באוספים השונים
// ומשווה לתוצאה הצפויה לפי התפקיד. אם חוקי האבטחה לא מתאימים – תופיע שורה אדומה.
// הבדיקות לא משנות מידע אמיתי: כותבים רק למסמכי בדיקה (__ruletest__) ומוחקים אותם מיד.
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, query, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261028";

const ALL = ["admin", "head", "staff", "rabbi", "course_manager", "research_coord", "researcher"];
const STAFF = ["admin", "head", "staff", "rabbi"], EDIT = ["admin", "head", "staff"];
const list = (name) => () => getDocs(query(collection(db, name), limit(1)));
const tid = () => "__ruletest__" + Math.random().toString(36).slice(2, 8);

const PROBES = [
  ["קריאת אנשי קשר", STAFF, list("contacts")],
  ["קריאת היסטוריה (תרומות, ספרים...)", STAFF, list("activities")],
  ["קריאת שאלות שו\"ת", STAFF, list("questions")],
  ["קריאת רשימת המשתמשים", ALL, list("allowedEmails")],
  ["קריאת כל ההרשמות להשתלמויות", EDIT, list("registrations")],
  ["קריאת כל הדיווחים החודשיים של החוקרים", ["admin", "head", "research_coord"], list("monthly")],
  ["קריאת יומן השינויים", ["admin"], list("auditLog")],
  ["קריאת כל המיילים בתור", ["admin", "head"], list("mailQueue")],
  ["קריאת הזמנות מהחנות", EDIT, list("orders")],
  ["קריאת מוסדות", STAFF, list("institutions")],
  ["קריאת עדכוני Jgive", EDIT, list("jgiveInbox")],
  ["קריאת כל הפרויקטים", ["admin"], list("mgmtProjects")],
  ["פתיחת פרויקט", ["admin"], async () => { const r = doc(db, "mgmtProjects", tid()); await setDoc(r, { title: "בדיקה", sharedWith: [] }); await deleteDoc(r); }],
  ["קריאת כתובת ה-Webhook הסודית", ["admin"], () => getDoc(doc(db, "private", "jgive"))],
  ["קריאת רשימת מי שהסיר את עצמו מדיוור", ALL, list("optouts")],
  ["קריאת מזהי ההסרה הסודיים (אסור לכולם)", [], list("unsubTokens")],
  ["מחיקת איש קשר", ["admin"], () => deleteDoc(doc(db, "contacts", tid()))],
  ["מחיקת שאלה", ["admin"], () => deleteDoc(doc(db, "questions", tid()))],
  ["מחיקת רשומה מיומן השינויים (אסור לכולם)", [], () => deleteDoc(doc(db, "auditLog", tid()))],
  ["שינוי הגדרות", ["admin", "head"], async () => { const r = doc(db, "settings", tid()); await setDoc(r, { test: true }); await deleteDoc(r); }],
  ["הוספת משתמש מורשה", ["admin"], async () => { const r = doc(db, "allowedEmails", tid() + "@test.invalid"); await setDoc(r, { role: "staff", name: "בדיקה" }); await deleteDoc(r); }],
  ["פרסום במאגר השו\"ת", STAFF, async () => { const r = doc(db, "publicQA", tid()); await setDoc(r, { question: "בדיקה", answer: "בדיקה" }); await deleteDoc(r); }],
  ["הוספת מוסד", EDIT, async () => { const r = doc(db, "institutions", tid()); await setDoc(r, { name: "בדיקה" }); await deleteDoc(r); }],
  ["כתיבת דיווח חודשי בשם חוקר אחר (אסור לכולם)", [], () => setDoc(doc(db, "monthly", "someone@test.invalid_2026-01"), { researcherEmail: "someone@test.invalid", month: "2026-01", achieved: "", nextGoal: "" })],
  ["כתיבה ליומן השינויים בשם שלי", ALL, (c) => addDoc(collection(db, "auditLog"), { action: "בדיקת הרשאות", target: "", details: c.role(), by: c.myEmail(), at: serverTimestamp() })]
];

export async function renderSelfTest(c) {
  const role = c.role();
  c.$("main").innerHTML = `
    <h1>בדיקת הרשאות</h1>
    <div class="card"><p>הבדיקה מנסה לקרוא ולכתוב באוספים השונים מהחשבון שלך (<b dir="ltr">${c.esc(c.myEmail())}</b>, תפקיד: <b>${c.esc(role)}</b>),
      ומשווה למה שאמור לקרות לפי התפקיד. היא לא משנה מידע אמיתי.</p>
      <p class="small muted">מומלץ שאדם אחד מכל תפקיד יריץ את הבדיקה פעם אחת אחרי כל עדכון של חוקי האבטחה. אם יש שורה אדומה – צלמו את המסך ושלחו.</p>
      <button class="primary" id="stRun">הרצת הבדיקה</button> <span id="stSum"></span></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>בדיקה</th><th>צפוי</th><th>בפועל</th><th></th></tr></thead><tbody id="stRows"></tbody></table></div></div>`;
  c.$("stRun").onclick = async () => {
    c.$("stRun").disabled = true;
    const rows = c.$("stRows"); rows.innerHTML = "";
    let bad = 0;
    for (const [label, roles, fn] of PROBES) {
      const expect = roles.includes(role);
      let got, err = "";
      try { await fn(c); got = true; } catch (e) { got = false; err = e.code || e.message; if (e.code && e.code !== "permission-denied") err = e.code; }
      const ok = got === expect && (got || err === "permission-denied");
      if (!ok) bad++;
      rows.insertAdjacentHTML("beforeend", `<tr><td>${c.esc(label)}</td><td>${expect ? "מותר" : "חסום"}</td><td>${got ? "מותר" : "חסום"}${!got && err !== "permission-denied" ? ` <span class="small muted">(${c.esc(err)})</span>` : ""}</td>
        <td>${ok ? '<span class="badge good">✓</span>' : '<span class="badge bad">✗ לא תקין</span>'}</td></tr>`);
    }
    c.$("stSum").innerHTML = bad ? `<span class="badge bad">${bad} בדיקות לא תקינות</span>` : `<span class="badge good">כל ${PROBES.length} הבדיקות תקינות</span>`;
    c.$("stRun").disabled = false;
  };
}
