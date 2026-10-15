// ===== האזור האישי של המשתלם =====
import {
  collection, doc, getDoc, getDocs, query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, auth, configReady, esc, toast, setupMissingNotice, googleSignIn, handleRedirectResult, normEmail } from "./common.js?v=20261020";
import { fmtIso, dayName, todayIso, toMin } from "./util.js?v=20261020";
import { makeBackground } from "./media.js?v=20261020";

const $ = (id) => document.getElementById(id);
const SCH = { pending: "ממתינה לאישור", approved: "אושרה", rejected: "לא אושרה" };
const SCH_BADGE = { pending: "warn", approved: "good", rejected: "bad" };

if (!configReady) {
  setupMissingNotice($("setupView")); $("myView").innerHTML = "";
} else {
  handleRedirectResult();
  onAuthStateChanged(auth, render);
}

async function render(user) {
  const box = $("myView");
  if (!user) {
    box.innerHTML = `<div class="card narrow"><h2>כניסה לאזור האישי</h2>
      <p>כאן תמצא/י את ההשתלמויות שנרשמת אליהן: לו"ז, קישורי הצטרפות, הקלטות ונוכחות.</p>
      <button class="primary" id="gIn" style="width:100%;padding:11px">כניסה עם חשבון Google</button>
      <p class="small muted" style="margin-top:10px">יש להיכנס עם חשבון Google של כתובת המייל שאיתה נרשמת להשתלמות.</p></div>`;
    $("gIn").onclick = googleSignIn;
    return;
  }
  box.innerHTML = `<p class="muted" style="text-align:center">טוען...</p>`;
  let all = [];
  try {
    // ההרשמות מזוהות לפי כתובת המייל של חשבון ה-Google
    const snap = await getDocs(query(collection(db, "registrations"), where("email", "==", normEmail(user.email))));
    all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { box.innerHTML = `<div class="card medium"><p>הטעינה נכשלה (${esc(e.code)}).</p></div>`; return; }
  const regs = all.filter((r) => r.status === "registered");
  const pending = all.filter((r) => r.status === "pending");

  const items = await Promise.all(regs.map(loadCourse));
  const pend = await Promise.all(pending.map(async (r) => { try { const c = await getDoc(doc(db, "courses", r.courseId)); return c.exists() ? c.data().title : ""; } catch { return ""; } }));
  const name = [all[0]?.firstName, all[0]?.lastName].filter(Boolean).join(" ") || user.displayName || "";
  box.innerHTML = `
    <div class="row space medium-w"><div><b>שלום ${esc(name)}</b><div class="small muted" dir="ltr">${esc(user.email)}</div></div><button id="gOut">יציאה</button></div>
    ${pend.filter(Boolean).map((t) => `<div class="card medium"><b>${esc(t)}</b> – <span class="badge warn">ההרשמה ממתינה לאישור הרכז</span></div>`).join("")}
    ${items.filter(Boolean).map((it) => courseCard(it)).join("") || (pend.filter(Boolean).length ? "" : `<div class="card medium"><h2>לא נמצאו הרשמות</h2>
      <p>לא מצאנו הרשמה מאושרת לכתובת <b dir="ltr">${esc(user.email)}</b>.</p>
      <p>אם נרשמת עם כתובת מייל אחרת – צא/י והיכנס/י עם חשבון Google של אותה כתובת, או בקש/י מרכז ההשתלמות לעדכן את הכתובת שלך.</p></div>`)}`;
  $("gOut").onclick = () => signOut(auth);
  items.filter(Boolean).forEach((it) => bind(it, name));
}

async function loadCourse(reg) {
  try {
    const cs = await getDoc(doc(db, "courses", reg.courseId));
    if (!cs.exists()) return null;
    const course = { id: cs.id, ...cs.data() };
    const ss = await getDocs(query(collection(db, "sessions"), where("courseId", "==", reg.courseId)));
    const sessions = ss.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    // קישורי זום והקלטות – כל מפגש בנפרד (חוקי האבטחה בודקים שההרשמה בתוקף)
    await Promise.all(sessions.map(async (s) => {
      try { const p = await getDoc(doc(db, "sessionPrivate", s.id)); s.zoomLink = p.exists() ? p.data().zoomLink : ""; } catch { s.zoomLink = ""; }
      if (course.recordingsOpen) {
        try { const r = await getDoc(doc(db, "recordings", s.id)); s.recording = r.exists() ? r.data().url : ""; } catch { s.recording = ""; }
      }
    }));
    return { reg, course, sessions };
  } catch { return null; }
}

// מפגש "פעיל" – מחצי שעה לפני ההתחלה ועד הסיום
function liveNow(s) {
  if (s.date !== todayIso()) return false;
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  return m >= toMin(s.start) - 30 && m <= toMin(s.end);
}

function courseCard({ reg, course, sessions }) {
  const today = todayIso();
  const past = sessions.filter((s) => s.date < today || (s.date === today && toMin(s.end) < new Date().getHours() * 60 + new Date().getMinutes()));
  const attended = past.filter((s) => reg.attendance?.[s.id]).length;
  const next = sessions.find((s) => !past.includes(s));
  return `<div class="card medium" data-reg="${esc(reg.id)}">
    <div class="row space"><h2 style="margin:0">${esc(course.title)}</h2><a class="small" href="course.html?c=${encodeURIComponent(course.id)}">דף ההשתלמות</a></div>
    ${course.subtitle ? `<p class="muted">${esc(course.subtitle)}</p>` : ""}
    ${next ? `<div class="next-box ${liveNow(next) ? "live" : ""}">
      <div><div class="small">${liveNow(next) ? "המפגש מתקיים עכשיו" : "המפגש הבא"}</div>
        <b>${dayName(next.date)} ${fmtIso(next.date)} · ${esc(next.start)}–${esc(next.end)}</b>${next.topic ? `<div>${esc(next.topic)}</div>` : ""}</div>
      ${next.zoomLink ? `<a class="btn primary-link" href="${esc(next.zoomLink)}" target="_blank" rel="noopener">הצטרפות לזום</a>` : ""}</div>` : '<p class="small muted">כל המפגשים הסתיימו.</p>'}
    <div class="row" style="margin:10px 0">
      ${past.length ? `<span class="badge info">נוכחות: ${attended} מתוך ${past.length} מפגשים</span>` : ""}
      ${reg.scholarship ? `<span class="badge ${SCH_BADGE[reg.scholarship.status]}">מלגה: ${SCH[reg.scholarship.status]}</span>` : ""}
    </div>
    <details ${sessions.length <= 12 ? "open" : ""}><summary><b>לוח המפגשים</b></summary>
      <div class="table-wrap"><table><thead><tr><th>תאריך</th><th>שעה</th><th>נושא</th><th>נוכחות</th><th></th></tr></thead><tbody>
      ${sessions.map((s) => {
        const isPast = past.includes(s);
        return `<tr><td>${dayName(s.date)} ${fmtIso(s.date)}</td><td>${esc(s.start)}–${esc(s.end)}</td>
          <td>${esc(s.topic)}${s.lecturer ? `<div class="small muted">${esc(s.lecturer)}</div>` : ""}</td>
          <td>${isPast ? (reg.attendance?.[s.id] ? '<span class="badge good">נכח/ה</span>' : '<span class="badge">לא נרשמה נוכחות</span>') : ""}</td>
          <td>${s.recording ? `<a href="${esc(s.recording)}" target="_blank" rel="noopener">צפייה בהקלטה</a>` : !isPast && s.zoomLink ? `<a href="${esc(s.zoomLink)}" target="_blank" rel="noopener">קישור לזום</a>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div></details>
    <div class="row" style="margin-top:12px">
      <button data-bg>הורדת רקע זום עם השם שלי</button>
      <button class="link danger" data-cancel>ביטול ההרשמה</button>
    </div>
    <p class="small muted">בזום: הגדרות ← Background ← הוספת תמונה. אצלך הכיתוב ייראה הפוך כמו במראה – לשאר המשתתפים הוא מוצג כרגיל.</p>
  </div>`;
}

function bind({ reg, course }, name) {
  const card = document.querySelector(`[data-reg="${CSS.escape(reg.id)}"]`);
  card.querySelector("[data-bg]").onclick = async () => {
    try { await makeBackground(course, [reg.firstName, reg.lastName].filter(Boolean).join(" ") || name); }
    catch { toast("יצירת הרקע נכשלה", "bad"); }
  };
  card.querySelector("[data-cancel]").onclick = async () => {
    if (!confirm(`לבטל את ההרשמה ל"${course.title}"?`)) return;
    try {
      const b = writeBatch(db);
      b.update(doc(db, "registrations", reg.id), { status: "cancelled", updatedAt: serverTimestamp() });
      b.delete(doc(db, "courseAccess", `${reg.courseId}_${reg.email}`));
      await b.commit();
      toast("ההרשמה בוטלה"); render(auth.currentUser);
    }
    catch (e) { toast("הביטול נכשל: " + e.code, "bad"); }
  };
}
