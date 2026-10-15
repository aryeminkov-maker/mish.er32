// ===== דף נחיתה והרשמה להשתלמות (course.html?c=מזהה) – הרשמה פתוחה, בלי חשבון =====
import {
  collection, doc, getDoc, getDocs, addDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, auth, configReady, esc, toast, setupMissingNotice, normEmail } from "./common.js?v=20261020";
import { fmtIso, dayName } from "./util.js?v=20261020";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const cid = params.get("c");
// תצוגה מקדימה מתוך האשף: הדף מוצג גם כשהוא טיוטה, וההרשמה לא נשלחת
const preview = params.get("preview") === "1";
let course = null, sessions = [];

if (!configReady) {
  setupMissingNotice($("setupView")); $("courseView").innerHTML = "";
} else if (!cid) {
  $("courseView").innerHTML = `<div class="card medium"><p>לא נבחרה השתלמות.</p></div>`;
} else {
  load();
}

async function load() {
  // בתצוגה מקדימה מחכים לזיהוי איש הצוות (טיוטה גלויה רק לצוות)
  if (preview) await new Promise((res) => { const u = onAuthStateChanged(auth, () => { u(); res(); }); });
  try {
    const snap = await getDoc(doc(db, "courses", cid));
    if (!snap.exists()) throw new Error("not-found");
    course = { id: snap.id, ...snap.data() };
    const ss = await getDocs(query(collection(db, "sessions"), where("courseId", "==", cid)));
    sessions = ss.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  } catch (e) {
    $("courseView").innerHTML = `<div class="card medium"><h2>ההשתלמות לא נמצאה</h2><p class="muted">ייתכן שהקישור שגוי או שההשתלמות עדיין לא פורסמה.</p></div>`;
    return;
  }
  document.title = `${course.title} – מכון משפטי ארץ`;
  $("pageTitle").textContent = course.title;
  renderInfo();
  renderRegister();
}

function renderInfo() {
  const facts = [];
  if (course.startDate) facts.push(["מתי", course.endDate && course.endDate !== course.startDate ? `${fmtIso(course.startDate)} – ${fmtIso(course.endDate)}` : fmtIso(course.startDate)]);
  if (course.timeText) facts.push(["מועד", course.timeText]);
  if (sessions.length) facts.push(["מפגשים", String(sessions.length)]);
  if (course.location) facts.push(["מיקום", course.location]);
  if (course.lecturers) facts.push(["מרצים", course.lecturers]);
  if (course.audience) facts.push(["מיועד ל", course.audience]);
  facts.push(["עלות", course.price || "ללא עלות"]);
  $("courseView").innerHTML = `
    <div class="card medium">
      ${course.subtitle ? `<p class="lead">${esc(course.subtitle)}</p>` : ""}
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${course.description ? `<div class="pre" style="margin-top:12px">${esc(course.description)}</div>` : ""}
    </div>
    ${sessions.length ? `<div class="card medium"><h2>לוח המפגשים</h2>
      <ol class="sched">${sessions.map((s) => `<li><b>${dayName(s.date)} ${fmtIso(s.date)}</b> · ${esc(s.start)}–${esc(s.end)}
        ${s.topic ? `<div>${esc(s.topic)}</div>` : ""}${s.lecturer ? `<div class="small muted">${esc(s.lecturer)}</div>` : ""}</li>`).join("")}</ol></div>` : ""}
    <div class="card medium" id="regCard"></div>`;
}

function renderRegister() {
  const box = $("regCard");
  if (preview) box.insertAdjacentHTML("beforebegin", `<div class="card medium preview-note">תצוגה מקדימה${course.status === "draft" ? " – ההשתלמות עדיין טיוטה ולא גלויה לציבור" : ""}</div>`);
  if (course.status !== "open" && !preview) {
    box.innerHTML = `<h2>הרשמה</h2><p>${course.status === "done" ? "ההשתלמות הסתיימה." : "ההרשמה להשתלמות סגורה."}</p>
      <p>נרשמת ואושרת? <a href="my.html">לאזור האישי</a></p>`;
    return;
  }
  box.innerHTML = `<h2>הרשמה להשתלמות</h2>
    <form id="regForm" novalidate>
      <div class="grid2">
        <div class="field"><label for="rFirst">שם פרטי *</label><input id="rFirst" required maxlength="60" autocomplete="given-name"></div>
        <div class="field"><label for="rLast">שם משפחה *</label><input id="rLast" required maxlength="60" autocomplete="family-name"></div>
        <div class="field"><label for="rEmail">מייל *</label><input id="rEmail" type="email" required maxlength="120" autocomplete="email" dir="ltr"></div>
        <div class="field"><label for="rPhone">טלפון *</label><input id="rPhone" type="tel" required maxlength="20" autocomplete="tel"></div>
        <div class="field"><label for="rCity">יישוב</label><input id="rCity" maxlength="60" autocomplete="address-level2"></div>
      </div>
      <p class="small muted">אחרי אישור ההרשמה, הכניסה לאזור האישי (קישורי זום, הקלטות ונוכחות) תהיה עם <b>חשבון Google של כתובת המייל הזו</b>. אפשר לפתוח חשבון Google גם לכתובת שאינה Gmail.</p>
      ${course.scholarships ? `<label class="check" for="rSch"><input type="checkbox" id="rSch"> <span>אני מבקש/ת מלגה</span></label>
        ${course.scholarshipText ? `<p class="small muted">${esc(course.scholarshipText)}</p>` : ""}
        <div class="field hidden" id="rSchBox"><label for="rSchReason">נימוק לבקשה</label><textarea id="rSchReason" maxlength="1000"></textarea></div>` : ""}
      <div class="field"><label for="rNote">הערות (רשות)</label><textarea id="rNote" maxlength="1000" style="min-height:60px"></textarea></div>
      <label class="check" for="rConsent"><input type="checkbox" id="rConsent"> <span>אני מאשר/ת לקבל עדכונים מהמכון במייל (אפשר להסיר בכל עת)</span></label>
      <p class="small muted">פרטיך ישמשו לניהול ההשתלמות ולקשר איתך. פרטים נוספים ב<a href="privacy.html">מדיניות הפרטיות</a>.</p>
      <div class="hp" aria-hidden="true"><label for="rWebsite">אתר</label><input id="rWebsite" tabindex="-1" autocomplete="off"></div>
      <button class="primary" type="submit" id="rSend">שליחת ההרשמה</button>
    </form>
    <p class="small" style="margin-top:12px">כבר נרשמת ואושרת? <a href="my.html">לאזור האישי</a></p>`;
  if ($("rSch")) $("rSch").onchange = (e) => $("rSchBox").classList.toggle("hidden", !e.target.checked);
  $("regForm").onsubmit = submit;
}

async function submit(e) {
  e.preventDefault();
  if ($("rWebsite").value) return; // מלכודת לרובוטים
  if (preview) return toast("זו תצוגה מקדימה – ההרשמה לא נשלחה", "bad");
  const email = normEmail($("rEmail").value);
  const first = $("rFirst").value.trim(), last = $("rLast").value.trim(), phone = $("rPhone").value.trim();
  if (!first || !last) return toast("נא למלא שם פרטי ושם משפחה", "bad");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("rEmail").focus(); return toast("כתובת המייל לא תקינה", "bad"); }
  if (phone.replace(/\D/g, "").length < 9) { $("rPhone").focus(); return toast("מספר הטלפון לא תקין", "bad"); }
  const btn = $("rSend"); btn.disabled = true;
  const data = {
    courseId: cid, email, firstName: first, lastName: last, phone, city: $("rCity").value.trim(),
    note: $("rNote").value.trim(), consentEmail: $("rConsent").checked, status: "pending",
    managerEmails: course.managerEmails || [], source: "טופס באתר", createdAt: serverTimestamp()
  };
  if ($("rSch")?.checked) data.scholarship = { status: "pending", reason: $("rSchReason").value.trim() };
  try {
    await addDoc(collection(db, "registrations"), data);
    $("regCard").innerHTML = `<h2>ההרשמה התקבלה ✓</h2>
      <p>תודה ${esc(first)}! ההרשמה תיבדק על ידי רכז ההשתלמות. לאחר האישור תישלח הודעה לכתובת <b dir="ltr">${esc(email)}</b>.</p>
      <p>אחרי האישור נכנסים ל<a href="my.html">אזור האישי</a> עם חשבון Google של כתובת המייל הזו.</p>`;
  } catch (err) {
    toast(err.code === "permission-denied" ? "ההרשמה לא התאפשרה – ייתכן שההרשמה נסגרה" : "השליחה נכשלה, נסו שוב", "bad");
    btn.disabled = false;
  }
}
