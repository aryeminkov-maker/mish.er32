// ===== האזור האישי של המשתלם =====
import {
  collection, doc, getDoc, getDocs, setDoc, query, where, serverTimestamp, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { db, auth, configReady, esc, toast, setupMissingNotice, googleSignIn, handleRedirectResult, normEmail } from "./common.js?v=20261028";
import { fmtIso, dayName, todayIso, toMin } from "./util.js?v=20261028";
import { makeBackground } from "./media.js?v=20261028";

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
  if (location.hash.startsWith("#feedback-")) { const el = document.getElementById(location.hash.slice(1)); if (el) { el.open = true; el.scrollIntoView({ behavior: "smooth" }); } }
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
      try { const m = await getDoc(doc(db, "materials", s.id)); s.materials = m.exists() ? m.data().items || [] : []; } catch { s.materials = []; }
      if (course.recordingsOpen) {
        try { const r = await getDoc(doc(db, "recordings", s.id)); s.recording = r.exists() ? r.data().url : ""; } catch { s.recording = ""; }
      }
    }));
    let feedback = null;
    try { const f = await getDoc(doc(db, "feedback", `${reg.courseId}_${normEmail(auth.currentUser.email)}`)); feedback = f.exists() ? f.data() : null; } catch { /* */ }
    return { reg, course, sessions, feedback };
  } catch { return null; }
}

// מפגש "פעיל" – מחצי שעה לפני ההתחלה ועד הסיום
function liveNow(s) {
  if (s.date !== todayIso()) return false;
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  return m >= toMin(s.start) - 30 && m <= toMin(s.end);
}

// ---------- יומן ----------
const compact = (iso, t) => iso.replace(/-/g, "") + "T" + String(t || "00:00").replace(":", "") + "00";
const gcalUrl = (course, s) => "https://calendar.google.com/calendar/render?action=TEMPLATE"
  + "&text=" + encodeURIComponent(course.title + (s.topic ? " – " + s.topic : ""))
  + "&dates=" + compact(s.date, s.start) + "/" + compact(s.date, s.end || s.start)
  + "&ctz=Asia/Jerusalem&details=" + encodeURIComponent((s.zoomLink ? "קישור לזום: " + s.zoomLink + "\n" : "") + "האזור האישי: " + location.href.split("#")[0]);
const icsEsc = (t) => String(t || "").replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
function downloadIcs(course, sessions) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mishpetei Eretz//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Asia/Jerusalem",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0300", "TZNAME:IDT", "DTSTART:19700327T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=23,24,25,26,27,28,29;BYDAY=FR", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0200", "TZNAME:IST", "DTSTART:19701025T020000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE"];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  sessions.filter((s) => s.date >= todayIso()).forEach((s) => {
    lines.push("BEGIN:VEVENT", `UID:${s.id}@mishpetei-eretz`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Jerusalem:${compact(s.date, s.start)}`, `DTEND;TZID=Asia/Jerusalem:${compact(s.date, s.end || s.start)}`,
      `SUMMARY:${icsEsc(course.title + (s.topic ? " – " + s.topic : ""))}`,
      `DESCRIPTION:${icsEsc((s.zoomLink ? "קישור לזום: " + s.zoomLink + "\n" : "") + "האזור האישי: " + location.href.split("#")[0])}`,
      ...(s.zoomLink ? [`URL:${s.zoomLink}`, `LOCATION:${icsEsc("זום")}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(course.title)}`, "TRIGGER:-PT1H", "END:VALARM",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(course.title)}`, "TRIGGER:-P1D", "END:VALARM",
      "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${course.title}.ics`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
const matLinks = (s) => (s.materials || []).map((m) => `<a href="${esc(m.url)}" target="_blank" rel="noopener">📄 ${esc(m.title)}</a>`).join(" ");

// ---------- משוב ----------
const FB_Q = [["overall", "באופן כללי, כמה נהנית מההשתלמות?"], ["content", "התוכן"], ["lecturers", "המרצים"]];
function feedbackHtml(course, fb) {
  const stars = (k, cur) => `<div class="stars" role="radiogroup">${[5, 4, 3, 2, 1].map((n) => `<label><input type="radio" name="fb_${k}" value="${n}" ${Number(cur) === n ? "checked" : ""}><span aria-hidden="true">★</span><span class="sr-only">${n}</span></label>`).join("")}</div>`;
  return `<details class="fb-box" id="feedback-${esc(course.id)}" ${fb ? "" : "open"}><summary><b>${fb ? "✓ תודה על המשוב! (לעריכה)" : "📝 משוב על ההשתלמות – דקה אחת"}</b></summary>
    <form data-fb="${esc(course.id)}">
      ${FB_Q.map(([k, l]) => `<fieldset class="fb-q"><legend>${l}</legend>${stars(k, fb?.[k])}</fieldset>`).join("")}
      <fieldset class="fb-q"><legend>היית ממליץ/ה על ההשתלמות לחבר?</legend>
        <label class="check"><input type="radio" name="fb_recommend" value="yes" ${fb?.recommend === "yes" ? "checked" : ""}> <span>כן</span></label>
        <label class="check"><input type="radio" name="fb_recommend" value="no" ${fb?.recommend === "no" ? "checked" : ""}> <span>לא</span></label></fieldset>
      <div class="field"><label for="fbc_${esc(course.id)}">מה היה טוב, ומה כדאי לשפר?</label><textarea id="fbc_${esc(course.id)}" name="fb_comments" maxlength="3000">${esc(fb?.comments || "")}</textarea></div>
      <button class="primary" type="submit">שליחת המשוב</button>
    </form></details>`;
}

function courseCard({ reg, course, sessions, feedback }) {
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
      <div class="row">${liveNow(next) ? (reg.attendance?.[next.id] ? '<span class="badge good">✓ הנוכחות נרשמה</span>'
          : `<button class="primary" data-checkin="${esc(next.id)}">אני נוכח/ת במפגש</button>`) : ""}
        ${next.zoomLink ? `<a class="btn primary-link" href="${esc(next.zoomLink)}" target="_blank" rel="noopener">הצטרפות לזום</a>` : ""}</div>
      ${next.materials?.length ? `<div class="small" style="flex-basis:100%">חומרים למפגש: ${matLinks(next)}</div>` : ""}</div>` : '<p class="small muted">כל המפגשים הסתיימו.</p>'}
    ${course.calendarOn !== false && sessions.some((s) => s.date >= todayIso()) ? `<div class="row" style="margin:8px 0"><button data-ics>📅 הוספת כל המפגשים ליומן (עם תזכורת)</button>
      <span class="small muted">קובץ ליומן Google, לאייפון או לאאוטלוק – כולל תזכורת שעה לפני כל מפגש. או: ליד כל מפגש בטבלה – "ליומן Google".</span></div>` : ""}
    ${!next && sessions.length ? feedbackHtml(course, feedback) : ""}
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
          <td>${s.recording ? `<a href="${esc(s.recording)}" target="_blank" rel="noopener">צפייה בהקלטה</a>` : !isPast && s.zoomLink ? `<a href="${esc(s.zoomLink)}" target="_blank" rel="noopener">קישור לזום</a>` : ""}
            ${!isPast && course.calendarOn !== false ? `<div><a class="small" href="${esc(gcalUrl(course, s))}" target="_blank" rel="noopener">ליומן Google</a></div>` : ""}
            ${s.materials?.length ? `<div class="small">${matLinks(s)}</div>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div></details>
    <div class="row" style="margin-top:12px">
      <button data-bg>הורדת רקע זום עם השם שלי</button>
      <button class="link danger" data-cancel>ביטול ההרשמה</button>
    </div>
    <p class="small muted">בזום: הגדרות ← Background ← הוספת תמונה. אצלך הכיתוב ייראה הפוך כמו במראה – לשאר המשתתפים הוא מוצג כרגיל.</p>
  </div>`;
}

function bind({ reg, course, sessions }, name) {
  const card = document.querySelector(`[data-reg="${CSS.escape(reg.id)}"]`);
  const ics = card.querySelector("[data-ics]");
  if (ics) ics.onclick = () => downloadIcs(course, sessions);
  const fbForm = card.querySelector("[data-fb]");
  if (fbForm) fbForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(fbForm);
    if (!f.get("fb_overall")) return toast("נא לסמן לפחות את השאלה הראשונה", "bad");
    const email = normEmail(auth.currentUser.email);
    try {
      await setDoc(doc(db, "feedback", `${course.id}_${email}`), {
        courseId: course.id, email, name: [reg.firstName, reg.lastName].filter(Boolean).join(" ") || name,
        overall: Number(f.get("fb_overall")) || 0, content: Number(f.get("fb_content")) || 0, lecturers: Number(f.get("fb_lecturers")) || 0,
        recommend: f.get("fb_recommend") || "", comments: String(f.get("fb_comments") || "").trim(), at: serverTimestamp()
      });
      toast("תודה! המשוב נשלח", "good"); render(auth.currentUser);
    } catch (err) { toast("השליחה נכשלה: " + err.code, "bad"); }
  };
  card.querySelector("[data-bg]").onclick = async () => {
    try { await makeBackground(course, [reg.firstName, reg.lastName].filter(Boolean).join(" ") || name); }
    catch { toast("יצירת הרקע נכשלה", "bad"); }
  };
  const ci = card.querySelector("[data-checkin]");
  if (ci) ci.onclick = async () => {
    ci.disabled = true;
    try {
      await updateDoc(doc(db, "registrations", reg.id), { ["attendance." + ci.dataset.checkin]: true, selfCheckin: { sid: ci.dataset.checkin, at: serverTimestamp() } });
      toast("הנוכחות נרשמה. מפגש מוצלח!", "good"); render(auth.currentUser);
    } catch (e) { toast("רישום הנוכחות נכשל" + (e.code === "permission-denied" ? " – אפשר לסמן רק ביום המפגש" : ""), "bad"); ci.disabled = false; }
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
