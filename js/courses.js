// ===== ניהול השתלמויות (לרכזים) + לוח שנה והתנגשויות =====
import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, normEmail, readWorkbook } from "./common.js?v=20261020";
import {
  todayIso, fmtIso, parseIso, isoDate, addDaysIso, dayName, HEB_MONTHS, HEB_DAYS, conflictsFor, allConflicts, norm, isUrl
} from "./util.js?v=20261020";
import { makeAd, makeBackground, loadDesigns, courseVars, lectureTopic, VAR_NAMES } from "./media.js?v=20261020";
import { openDesigner, thumbnail, exportPng, defaultAd, defaultBg } from "./designer.js?v=20261020";
import { composeMail } from "./mail.js?v=20261020";

const C_STATUS = { draft: "טיוטה", open: "פתוחה להרשמה", closed: "ההרשמה סגורה", done: "הסתיימה" };
const C_BADGE = { draft: "", open: "good", closed: "warn", done: "info" };
const SCH = { pending: "ממתינה", approved: "אושרה", rejected: "נדחתה" };
const SCH_BADGE = { pending: "warn", approved: "good", rejected: "bad" };
const R_STATUS = { pending: "ממתין לאישור", registered: "מאושר", rejected: "נדחה", cancelled: "ביטל" };
const R_BADGE = { pending: "warn", registered: "good", rejected: "bad", cancelled: "" };
const myAreaUrl = () => new URL("my.html", location.href).href;
const NO_ZOOM = "";
const CS = { courseId: null, tab: "details", calMonth: todayIso().slice(0, 7), calCourse: "", calLecturer: "", regSearch: "", showDone: false };
const PALETTE = ["#b8860b", "#2f6f8f", "#7a4d9a", "#2e7d4f", "#a8461b", "#5b6b2f", "#9a3b5a", "#3f5aa8"];

// ---------- עזרים ----------
const coursesList = (c) => [...c.S.courses.values()].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
const sessionsOf = (c, cid) => [...c.S.sessions.values()].filter((s) => !cid || s.courseId === cid).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
const regsOf = (c, cid) => [...c.S.regs.values()].filter((r) => r.courseId === cid);
const activeRegs = (c, cid) => regsOf(c, cid).filter((r) => r.status === "registered");
const fullName = (r) => [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email;
const colorOf = (id) => PALETTE.at([...String(id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length);
const canManage = (c, course) => c.inGroup(c.EDIT_ROLES) || (course?.managerEmails || []).includes(c.myEmail());
const landingUrl = (cid) => new URL(`course.html?c=${encodeURIComponent(cid)}`, location.href).href;
const attendedCount = (r, sessions) => sessions.filter((s) => r.attendance?.[s.id]).length;
const pastSessions = (sessions) => sessions.filter((s) => s.date <= todayIso());
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const sessionTitle = (c, s) => `${c.S.courses.get(s.courseId)?.title || ""} · ${fmtIso(s.date)} ${s.start || ""}`;

function conflictBadge(c, s) {
  const list = conflictsFor(s, sessionsOf(c));
  if (!list.length) return "";
  const tip = list.map((x) => `${sessionTitle(c, x.other)} (${x.reasons.join(", ")})`).join("\n");
  return `<span class="badge bad" title="${c.esc(tip)}">התנגשות</span>`;
}

// ---------- סיכום לדף הראשי ----------
export function courseSummary(c) {
  const today = todayIso(), weekEnd = addDaysIso(today, 7);
  const upcoming = sessionsOf(c).filter((s) => s.date >= today && s.date <= weekEnd);
  const conflicts = allConflicts(sessionsOf(c).filter((s) => s.date >= today));
  const pendingSch = [...c.S.regs.values()].filter((r) => r.status === "registered" && r.scholarship?.status === "pending").length;
  const pendingRegs = [...c.S.regs.values()].filter((r) => r.status === "pending").length;
  const open = coursesList(c).filter((x) => x.status === "open").length;
  return `<div class="card">
    <div class="row space"><h2>השתלמויות</h2><div class="row"><button data-go="courses">להשתלמויות</button><button data-go="calendar">ללוח השנה</button></div></div>
    <div class="stats" style="margin:0 0 10px">
      <div class="stat"><div class="num">${open}</div><div class="lbl">פתוחות להרשמה</div></div>
      <div class="stat"><div class="num">${upcoming.length}</div><div class="lbl">מפגשים בשבוע הקרוב</div></div>
      <div class="stat"><div class="num ${conflicts.length ? "bad-text" : ""}">${conflicts.length}</div><div class="lbl">התנגשויות עתידיות</div></div>
      <div class="stat"><div class="num ${pendingRegs ? "bad-text" : ""}">${pendingRegs}</div><div class="lbl">הרשמות ממתינות לאישור</div></div>
      <div class="stat"><div class="num">${pendingSch}</div><div class="lbl">בקשות מלגה ממתינות</div></div>
    </div>
    ${upcoming.length ? `<ul class="timeline">${upcoming.slice(0, 8).map((s) => `<li><div class="when">${dayName(s.date)} ${fmtIso(s.date)} · ${c.esc(s.start)}–${c.esc(s.end)}</div>
      <span class="dot" style="background:${colorOf(s.courseId)}"></span>${c.esc(c.S.courses.get(s.courseId)?.title || "")} – ${c.esc(s.topic || "")} ${s.lecturer ? `<span class="muted small">(${c.esc(s.lecturer)})</span>` : ""} ${conflictBadge(c, s)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

// ======================================================
// רשימת השתלמויות
// ======================================================
export function renderCourses(c, full) {
  if (!full && document.querySelector("#main [data-editing]")) return;
  if (CS.courseId && c.S.courses.has(CS.courseId)) return renderDetail(c);
  CS.courseId = null;
  // רכז השתלמות רואה ברשימה רק את ההשתלמויות שלו (בלוח השנה רואים הכול, לבדיקת התנגשויות)
  const list = coursesList(c).filter((x) => (CS.showDone || x.status !== "done") && canManage(c, x));
  c.$("main").innerHTML = `
    <div class="row space"><h1>${c.inGroup(c.EDIT_ROLES) ? "השתלמויות" : "ההשתלמויות שלי"}</h1>
      <div class="row"><label class="check small" style="margin:0"><input type="checkbox" id="showDoneC" ${CS.showDone ? "checked" : ""}> להציג גם שהסתיימו</label>
      <button class="primary" id="newCourse">+ השתלמות חדשה</button></div></div>
    <div class="grid-cards">${list.map((x) => {
      const ss = sessionsOf(c, x.id), n = activeRegs(c, x.id).length, np = regsOf(c, x.id).filter((r) => r.status === "pending").length;
      const next = ss.find((s) => s.date >= todayIso());
      const conf = ss.filter((s) => conflictsFor(s, sessionsOf(c)).length).length;
      return `<div class="card course-card click" data-course="${x.id}" style="border-top:4px solid ${colorOf(x.id)}">
        <div class="row space"><h3 style="margin:0">${c.esc(x.title)}</h3><span class="badge ${C_BADGE[x.status]}">${C_STATUS[x.status] || ""}</span></div>
        ${x.subtitle ? `<div class="small muted">${c.esc(x.subtitle)}</div>` : ""}
        <div class="small" style="margin-top:6px">${x.startDate ? fmtIso(x.startDate) : ""}${x.endDate && x.endDate !== x.startDate ? " – " + fmtIso(x.endDate) : ""} · ${ss.length} מפגשים · ${n} נרשמים${x.capacity ? ` / ${x.capacity}` : ""}</div>
        ${next ? `<div class="small muted">המפגש הבא: ${dayName(next.date)} ${fmtIso(next.date)} ${c.esc(next.start)}</div>` : ""}
        ${np ? `<div><span class="badge warn">${np} ממתינים לאישור</span></div>` : ""}
        ${conf ? `<div><span class="badge bad">${conf} מפגשים בהתנגשות</span></div>` : ""}
      </div>`;
    }).join("") || '<p class="muted">עדיין אין השתלמויות.</p>'}</div>`;
  c.$("showDoneC").onchange = (e) => { CS.showDone = e.target.checked; renderCourses(c, true); };
  document.querySelectorAll("[data-course]").forEach((el) => (el.onclick = () => { CS.courseId = el.dataset.course; CS.tab = c.S.courses.get(el.dataset.course)?.status === "draft" ? "details" : "regs"; CS.regStatus = null; CS.regSearch = ""; renderCourses(c, true); }));
  c.$("newCourse").onclick = () => newCourse(c);
}

function newCourse(c) {
  c.openModal(`<div class="head"><h2>השתלמות חדשה</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="field"><label for="ncTitle">שם ההשתלמות</label><input id="ncTitle"></div>
    <p class="small muted">ההשתלמות תיווצר כטיוטה, והאשף ילווה אותך: פרטים ← לו"ז ← דף ההרשמה ← מודעה ← רקעי זום ← פרסום.</p>
    <button class="primary" id="ncSave">יצירה</button>`, () => {
    c.$("ncTitle").focus();
    c.$("ncSave").onclick = async () => {
      const title = c.$("ncTitle").value.trim();
      if (!title) return c.toast("נא לכתוב שם", "bad");
      try {
        const ref = await addDoc(collection(db, "courses"), {
          title, subtitle: "", description: "", audience: "", lecturers: "", location: "זום", timeText: "", price: "",
          startDate: "", endDate: "", capacity: null, status: "draft", managerEmails: [c.myEmail()],
          recordingsOpen: false, scholarships: false, scholarshipText: "", createdBy: c.myEmail(), createdAt: serverTimestamp()
        });
        c.closeModal(); CS.courseId = ref.id; CS.tab = "details";
        c.S.courses.set(ref.id, { id: ref.id, title, status: "draft", managerEmails: [c.myEmail()] });
        renderCourses(c, true);
      } catch (e) { c.toast("היצירה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ======================================================
// השתלמות בודדת
// ======================================================
const SETUP = [["details", "פרטים"], ["schedule", "לו\"ז"], ["landing", "דף ההרשמה"], ["ad", "מודעה"], ["bg", "רקעי זום"], ["publish", "פרסום"]];
const MANAGE = [["regs", "נרשמים"], ["attendance", "נוכחות"], ["recordings", "הקלטות"]];

// מה הושלם בכל צעד של האשף
function stepDone(c, course, key) {
  const ss = sessionsOf(c, course.id);
  return {
    details: !!(course.title && (course.description || course.subtitle) && (course.startDate || ss.length)),
    schedule: ss.length > 0,
    landing: !!course.landingChecked,
    ad: !!course.mediaAd,
    bg: !!course.mediaBg,
    publish: course.status !== "draft"
  }[key];
}

function renderDetail(c) {
  const course = c.S.courses.get(CS.courseId);
  const nPending = regsOf(c, course.id).filter((r) => r.status === "pending" || (r.status === "registered" && r.scholarship?.status === "pending")).length;
  c.$("main").innerHTML = `
    <button class="link" id="backList">→ לכל ההשתלמויות</button>
    <div class="row space" style="margin-top:6px"><h1 style="margin:0">${c.esc(course.title)}</h1><span class="badge ${C_BADGE[course.status]}">${C_STATUS[course.status] || ""}</span></div>
    <div class="wizard" id="cTabs" role="tablist" aria-label="שלבי הקמה">
      <span class="wiz-label">הקמה:</span>
      ${SETUP.map(([k, l], i) => `<button data-tab="${k}" class="wiz-step ${CS.tab === k ? "active" : ""} ${stepDone(c, course, k) ? "done" : ""}" role="tab" aria-selected="${CS.tab === k}">
        <span class="wiz-n">${stepDone(c, course, k) ? "✓" : i + 1}</span>${l}</button>`).join("")}
      <span class="wiz-sep"></span>
      <span class="wiz-label">ניהול:</span>
      ${MANAGE.map(([k, l]) => `<button data-tab="${k}" class="wiz-tab ${CS.tab === k ? "active" : ""}" role="tab" aria-selected="${CS.tab === k}">${l}${k === "regs" && nPending ? ` <span class="badge warn">${nPending}</span>` : ""}</button>`).join("")}
    </div>
    <div id="cBody"></div>
    <div id="wizNav"></div>`;
  c.$("backList").onclick = () => { CS.courseId = null; renderCourses(c, true); };
  c.$("cTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { CS.tab = b.dataset.tab; renderDetail(c); }));
  ({ details: tabDetails, schedule: tabSchedule, landing: tabLanding, ad: tabAd, bg: tabBg, publish: tabPublish,
     regs: tabRegs, attendance: tabAttendance, recordings: tabRecordings })[CS.tab](c, course);
  // ניווט "הקודם / הבא" בצעדי האשף
  const i = SETUP.findIndex(([k]) => k === CS.tab);
  if (i >= 0) {
    const prev = SETUP[i - 1], next = SETUP[i + 1];
    c.$("wizNav").innerHTML = `<div class="wiz-nav">
      ${prev ? `<button data-go="${prev[0]}">→ הקודם: ${prev[1]}</button>` : "<span></span>"}
      ${next ? `<button class="primary" data-go="${next[0]}">הבא: ${next[1]} ←</button>` : `<button class="primary" data-go="regs">לניהול הנרשמים ←</button>`}</div>`;
    c.$("wizNav").querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => {
      if (c.$("cBody").hasAttribute("data-editing") && !confirm("יש שינויים שלא נשמרו. להמשיך בלי לשמור?")) return;
      CS.tab = b.dataset.go; renderDetail(c); window.scrollTo(0, 0);
    }));
  }
}

const markStep = (course, field) => updateDoc(doc(db, "courses", course.id), { [field]: true }).catch(() => {});

// ---------- צעד 3: דף ההרשמה ----------
function tabLanding(c, course) {
  const url = landingUrl(course.id);
  c.$("cBody").innerHTML = `
    <div class="card"><div class="row space"><div><h3 style="margin:0">כך ייראה דף ההרשמה</h3>
      <p class="small muted" style="margin:4px 0 0">הדף נבנה אוטומטית מהפרטים ומהלו"ז. לשינוי הטקסטים חוזרים לצעד "פרטים". בתצוגה המקדימה ההרשמה לא נשלחת.</p></div>
      <div class="row"><button id="lReload">רענון</button><a class="btn" href="${c.esc(url)}" target="_blank" rel="noopener">פתיחה בחלון חדש</a></div></div></div>
    <div class="preview-frame"><iframe id="lFrame" src="${c.esc(url)}&preview=1" title="תצוגה מקדימה של דף ההרשמה" loading="lazy"></iframe></div>`;
  c.$("lReload").onclick = () => { c.$("lFrame").src = c.$("lFrame").src; };
  if (!course.landingChecked) markStep(course, "landingChecked");
}

// ---------- צעד 4: מודעה ----------
async function tabAd(c, course) {
  c.$("cBody").innerHTML = `<p class="muted">טוען...</p>`;
  const d = await loadDesigns(course.id);
  if (CS.tab !== "ad" || CS.courseId !== course.id) return;
  const ss = sessionsOf(c, course.id), vars = courseVars(course, ss, landingUrl(course.id));
  const fname = `מודעה-${course.title}.png`;
  c.$("cBody").innerHTML = `
    <div class="split">
      <div class="card" style="text-align:center"><img id="adThumb" class="thumb" alt="תצוגה מקדימה של המודעה" style="max-width:360px"></div>
      <div class="card">
        <h3>מודעה להשתלמות</h3>
        <p class="small muted">המודעה נבנית מתבנית קבועה ומתמלאת אוטומטית מפרטי ההשתלמות. בעורך אפשר לשנות כל טקסט, ולגרור, להגדיל ולהקטין כל אלמנט.</p>
        <p class="small">${d.hasCustomAd ? '<span class="badge good">יש עיצוב ייחודי להשתלמות</span>' : '<span class="badge">לפי התבנית הכללית</span>'}</p>
        <div class="row"><button class="primary" id="adEdit">עריכת המודעה</button><button id="adDl">הורדה</button></div>
      </div>
    </div>`;
  thumbnail(d.ad, vars, 360).then((u) => { if (c.$("adThumb")) c.$("adThumb").src = u; });
  c.$("adDl").onclick = async () => { await exportPng(d.ad, vars, fname); if (!course.mediaAd) markStep(course, "mediaAd"); };
  c.$("adEdit").onclick = () => openDesigner(c, {
    title: `עריכת מודעה · ${course.title}`, design: d.ad, defaultDesign: d.adTemplate, vars,
    varNames: VAR_NAMES.filter((v) => v !== "שם המרצה" && v !== "נושא ההרצאה"), filename: fname, factoryDesign: defaultAd(),
    onSave: async (design) => {
      await setDoc(doc(db, "courseMedia", course.id), { courseId: course.id, ad: design, updatedAt: serverTimestamp(), updatedBy: c.myEmail() }, { merge: true });
      markStep(course, "mediaAd");
    },
    onSaveTemplate: c.can("admin", "head") ? (design) => setDoc(doc(db, "settings", "adTemplate"), { design, updatedAt: serverTimestamp(), updatedBy: c.myEmail() }) : null
  });
}

// ---------- צעד 5: רקעי זום למרצים ----------
function lecturerNames(c, course) {
  const names = [];
  const add = (n) => { const t = String(n || "").trim(); if (t && !names.some((x) => norm(x) === norm(t))) names.push(t); };
  String(course.lecturers || "").split(/[,،]/).forEach(add);
  sessionsOf(c, course.id).forEach((s) => String(s.lecturer || "").split(",").forEach(add));
  (CS.bgExtra?.[course.id] || []).forEach(add);
  return names;
}

async function tabBg(c, course) {
  c.$("cBody").innerHTML = `<p class="muted">טוען...</p>`;
  const d = await loadDesigns(course.id);
  if (CS.tab !== "bg" || CS.courseId !== course.id) return;
  const ss = sessionsOf(c, course.id), base = courseVars(course, ss, landingUrl(course.id));
  const names = lecturerNames(c, course);
  const varsFor = (n) => ({ ...base, "שם המרצה": n, "נושא ההרצאה": lectureTopic(course, ss, n) });
  c.$("cBody").innerHTML = `
    <div class="card">
      <div class="row space"><div><h3 style="margin:0">רקע זום לכל מרצה</h3>
        <p class="small muted" style="margin:4px 0 0">תבנית קבועה – מתחלפים רק שם המרצה ונושא ההרצאה (הנושא של המפגשים שלו בלו"ז, ואם אין – שם ההשתלמות). בעורך אפשר להעלות את הרקע המעוצב שלכם ולמקם עליו את הטקסטים.</p></div>
        <div class="row"><button id="bgEdit">עריכת התבנית</button>${names.length > 1 ? `<button class="primary" id="bgAll">הורדת כל הרקעים (${names.length})</button>` : ""}</div></div>
      <p class="small">${d.hasCustomBg ? '<span class="badge good">עיצוב ייחודי להשתלמות</span>' : '<span class="badge">לפי התבנית הכללית</span>'}</p>
    </div>
    <div class="grid-cards">${names.map((n, i) => `<div class="card" style="text-align:center">
      <img class="thumb" data-thumb="${i}" alt="רקע זום – ${c.esc(n)}">
      <div class="row space" style="margin-top:8px"><b>${c.esc(n)}</b><button data-dl="${i}">הורדה</button></div></div>`).join("")
      || '<p class="muted">עדיין אין מרצים. מוסיפים אותם בפרטים, בלו"ז או כאן:</p>'}</div>
    <div class="card"><div class="row"><input id="bgName" placeholder="שם מרצה נוסף" style="width:240px" aria-label="שם מרצה נוסף"><button id="bgAdd">הוספה</button></div></div>`;
  names.forEach((n, i) => thumbnail(d.bg, varsFor(n), 300).then((u) => { const im = document.querySelector(`[data-thumb="${i}"]`); if (im) im.src = u; }));
  const dl = async (n) => { await exportPng(d.bg, varsFor(n), `רקע-זום-${n}.png`); if (!course.mediaBg) markStep(course, "mediaBg"); };
  document.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = () => dl(names[Number(b.dataset.dl)])));
  if (c.$("bgAll")) c.$("bgAll").onclick = async () => { for (const n of names) { await dl(n); await new Promise((r) => setTimeout(r, 600)); } };
  c.$("bgAdd").onclick = () => {
    const n = c.$("bgName").value.trim(); if (!n) return;
    CS.bgExtra = CS.bgExtra || {}; (CS.bgExtra[course.id] = CS.bgExtra[course.id] || []).push(n); tabBg(c, course);
  };
  c.$("bgEdit").onclick = () => openDesigner(c, {
    title: "עריכת תבנית רקע הזום", design: d.bg, defaultDesign: d.bgTemplate, vars: varsFor(names[0] || "הרב ישראל ישראלי"),
    varNames: ["שם המרצה", "נושא ההרצאה", "נושא ההשתלמות", "כותרת משנה", "תאריכים"], filename: "רקע-זום.png", factoryDesign: defaultBg(),
    onSave: async (design) => {
      await setDoc(doc(db, "courseMedia", course.id), { courseId: course.id, bg: design, updatedAt: serverTimestamp(), updatedBy: c.myEmail() }, { merge: true });
      markStep(course, "mediaBg");
    },
    onSaveTemplate: c.can("admin", "head") ? (design) => setDoc(doc(db, "settings", "bgTemplate"), { design, updatedAt: serverTimestamp(), updatedBy: c.myEmail() }) : null
  });
}

// ---------- פרטים ----------
function tabDetails(c, course) {
  const ss = sessionsOf(c, course.id);
  const autoStart = ss.at(0)?.date || "", autoEnd = ss.at(-1)?.date || "";
  c.$("cBody").innerHTML = `<div class="card" data-form>
    <div class="grid2">
      <div class="field"><label for="dTitle">שם ההשתלמות</label><input id="dTitle" value="${c.esc(course.title)}"></div>
      <div class="field"><label for="dStatus">סטטוס</label><select id="dStatus">${Object.entries(C_STATUS).map(([k, v]) => `<option value="${k}" ${course.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label for="dSub">כותרת משנה</label><input id="dSub" value="${c.esc(course.subtitle)}"></div>
      <div class="field"><label for="dAud">קהל יעד</label><input id="dAud" value="${c.esc(course.audience)}" placeholder="למשל: רבני קהילות, דיינים"></div>
      <div class="field"><label for="dLect">מרצים (לתצוגה)</label><input id="dLect" value="${c.esc(course.lecturers)}"></div>
      <div class="field"><label for="dLoc">מיקום</label><input id="dLoc" value="${c.esc(course.location)}" placeholder="זום / כתובת"></div>
      <div class="field"><label for="dTime">מועד (לתצוגה)</label><input id="dTime" value="${c.esc(course.timeText)}" placeholder="למשל: ימי שלישי, 20:00–21:30"></div>
      <div class="field"><label for="dPrice">עלות</label><input id="dPrice" value="${c.esc(course.price)}" placeholder="ריק = ללא עלות"></div>
      <div class="field"><label for="dStart">תאריך התחלה</label><input id="dStart" type="date" value="${course.startDate || autoStart}"></div>
      <div class="field"><label for="dEnd">תאריך סיום</label><input id="dEnd" type="date" value="${course.endDate || autoEnd}"></div>
      <div class="field"><label for="dCap">מספר מקומות</label><input id="dCap" type="number" min="0" value="${course.capacity ?? ""}" placeholder="ללא הגבלה"></div>
      <div class="field"><label for="dMgr">רכזי ההשתלמות (מיילים, מופרדים בפסיק)</label><input id="dMgr" value="${c.esc((course.managerEmails || []).join(", "))}"></div>
    </div>
    <div class="field"><label for="dDesc">תיאור (יופיע בדף הנחיתה)</label><textarea id="dDesc" style="min-height:140px">${c.esc(course.description)}</textarea></div>
    <label class="check"><input type="checkbox" id="dRec" ${course.recordingsOpen ? "checked" : ""}> <span>להציג הקלטות למשתלמים באזור האישי</span></label>
    <label class="check"><input type="checkbox" id="dSch" ${course.scholarships ? "checked" : ""}> <span>לאפשר בקשת מלגה בהרשמה</span></label>
    <div class="field" style="margin-top:8px"><label for="dSchText">הסבר על המלגה (יוצג בטופס)</label><input id="dSchText" value="${c.esc(course.scholarshipText)}"></div>
    <div class="row space" style="margin-top:12px"><button class="primary" id="dSave">שמירה</button>
      ${c.can("admin", "head") ? '<button class="danger" id="dDel">מחיקת ההשתלמות</button>' : ""}</div>
  </div>`;
  markEditing(c);
  c.$("dSave").onclick = () => saveDetails(c, course);
  if (c.$("dDel")) c.$("dDel").onclick = () => deleteCourse(c, course);
}

function markEditing(c) {
  document.querySelectorAll("#cBody input, #cBody textarea, #cBody select").forEach((el) =>
    el.addEventListener("input", () => c.$("cBody").setAttribute("data-editing", "1")));
}

async function saveDetails(c, course) {
  const mgr = [...new Set(c.$("dMgr").value.split(",").map(normEmail).filter(Boolean))];
  if (!c.inGroup(c.EDIT_ROLES) && !mgr.includes(c.myEmail())) return c.toast("אי אפשר להסיר את עצמך מרכזי ההשתלמות", "bad");
  const cap = c.$("dCap").value.trim();
  const data = {
    title: c.$("dTitle").value.trim(), status: c.$("dStatus").value, subtitle: c.$("dSub").value.trim(), audience: c.$("dAud").value.trim(),
    lecturers: c.$("dLect").value.trim(), location: c.$("dLoc").value.trim(), timeText: c.$("dTime").value.trim(), price: c.$("dPrice").value.trim(),
    startDate: c.$("dStart").value, endDate: c.$("dEnd").value, capacity: cap ? Number(cap) : null, managerEmails: mgr,
    description: c.$("dDesc").value.trim(), recordingsOpen: c.$("dRec").checked, scholarships: c.$("dSch").checked,
    scholarshipText: c.$("dSchText").value.trim(), updatedAt: serverTimestamp()
  };
  if (!data.title) return c.toast("נא למלא שם", "bad");
  try {
    const b = writeBatch(db);
    b.update(doc(db, "courses", course.id), data);
    // רשימת הרכזים משוכפלת בכל הרשמה (כדי שהרכז יוכל לראות את הנרשמים שלו)
    const changed = (course.managerEmails || []).slice().sort().join() !== mgr.slice().sort().join();
    if (changed) regsOf(c, course.id).forEach((r) => b.update(doc(db, "registrations", r.id), { managerEmails: mgr }));
    await b.commit();
    c.$("cBody").removeAttribute("data-editing");
    c.toast("נשמר", "good");
  } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
}

async function deleteCourse(c, course) {
  const n = regsOf(c, course.id).length;
  if (!confirm(`למחוק את "${course.title}"? יימחקו גם ${sessionsOf(c, course.id).length} מפגשים${n ? ` ו-${n} הרשמות` : ""}. ההיסטוריה ב-CRM תישמר.`)) return;
  try {
    const b = writeBatch(db);
    sessionsOf(c, course.id).forEach((s) => { b.delete(doc(db, "sessions", s.id)); b.delete(doc(db, "sessionPrivate", s.id)); b.delete(doc(db, "recordings", s.id)); });
    regsOf(c, course.id).forEach((r) => b.delete(doc(db, "registrations", r.id)));
    b.delete(doc(db, "courses", course.id));
    await b.commit();
    CS.courseId = null; c.toast("נמחק"); c.refresh();
  } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
}

// ---------- לו"ז ----------
function tabSchedule(c, course) {
  const ss = sessionsOf(c, course.id);
  c.$("cBody").innerHTML = `
    <div class="row" style="margin-bottom:10px"><button class="primary" id="addSess">+ מפגש</button><button id="addSeries">+ סדרת מפגשים שבועיים</button></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>#</th><th>תאריך</th><th>שעה</th><th>נושא</th><th>מרצה</th><th>חשבון זום</th><th></th></tr></thead>
      <tbody>${ss.map((s, i) => `<tr class="click" data-sess="${s.id}">
        <td>${i + 1}</td><td>${dayName(s.date)} ${fmtIso(s.date)}</td><td>${c.esc(s.start)}–${c.esc(s.end)}</td>
        <td>${c.esc(s.topic)}</td><td>${c.esc(s.lecturer)}</td><td>${c.esc(s.zoomAccount || "—")}</td><td>${conflictBadge(c, s)}</td></tr>`).join("")
        || '<tr><td colspan="7" class="muted">עדיין אין מפגשים</td></tr>'}</tbody></table></div></div>
    <p class="small muted">המערכת בודקת התנגשויות מול כל ההשתלמויות: אותו מרצה או אותו חשבון זום באותו זמן.</p>`;
  c.$("addSess").onclick = () => openSession(c, course, null);
  c.$("addSeries").onclick = () => openSeries(c, course);
  document.querySelectorAll("[data-sess]").forEach((tr) => (tr.onclick = () => openSession(c, course, tr.dataset.sess)));
}

const lecturerList = (c) => [...new Set(sessionsOf(c).flatMap((s) => String(s.lecturer || "").split(",").map((x) => x.trim()).filter(Boolean)))].sort();
const zoomOptions = (c, cur) => `<option value="${NO_ZOOM}">ללא (פרונטלי)</option>` + [...new Set([...c.S.resources.zoomAccounts, ...(cur ? [cur] : [])])]
  .map((z) => `<option ${z === cur ? "selected" : ""}>${c.esc(z)}</option>`).join("");

export async function openSession(c, course, sid) {
  const s = sid ? c.S.sessions.get(sid) : { courseId: course.id, date: "", start: "20:00", end: "21:30", topic: "", lecturer: "", zoomAccount: c.S.resources.zoomAccounts[0] || "" };
  let priv = {};
  if (sid) { try { const p = await getDoc(doc(db, "sessionPrivate", sid)); priv = p.exists() ? p.data() : {}; } catch { /* אין הרשאה */ } }
  const editable = canManage(c, course);
  c.openModal(`
    <div class="head"><h2>${sid ? "עריכת מפגש" : "מפגש חדש"} · ${c.esc(course.title)}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="sDate">תאריך</label><input id="sDate" type="date" value="${s.date}"></div>
      <div class="field"><label>שעות</label><div class="row" style="flex-wrap:nowrap"><input id="sStart" type="time" value="${s.start}" aria-label="שעת התחלה"><span>–</span><input id="sEnd" type="time" value="${s.end}" aria-label="שעת סיום"></div></div>
      <div class="field"><label for="sTopic">נושא</label><input id="sTopic" value="${c.esc(s.topic)}"></div>
      <div class="field"><label for="sLect">מרצה (כמה – מופרדים בפסיק)</label><input id="sLect" value="${c.esc(s.lecturer)}" list="lectList">
        <datalist id="lectList">${lecturerList(c).map((l) => `<option value="${c.esc(l)}">`).join("")}</datalist></div>
      <div class="field"><label for="sZoom">חשבון זום</label><select id="sZoom">${zoomOptions(c, s.zoomAccount)}</select></div>
      <div class="field"><label for="sLink">קישור הצטרפות (יוצג רק לנרשמים)</label><input id="sLink" value="${c.esc(priv.zoomLink)}" placeholder="https://zoom.us/j/..."></div>
    </div>
    <div id="sConf"></div>
    ${editable ? `<div class="row space"><button class="primary" id="sSave">שמירה</button>${sid ? '<button class="danger" id="sDel">מחיקת המפגש</button>' : ""}</div>` : '<p class="muted small">אין לך הרשאה לערוך את ההשתלמות הזו.</p>'}`, () => {
    const draft = () => ({ id: sid || "__new", courseId: course.id, date: c.$("sDate").value, start: c.$("sStart").value, end: c.$("sEnd").value, lecturer: c.$("sLect").value, zoomAccount: c.$("sZoom").value });
    const check = () => {
      const list = conflictsFor(draft(), sessionsOf(c));
      c.$("sConf").innerHTML = list.length ? `<div class="conflict-box"><b>⚠ התנגשות:</b><ul>${list.map((x) => `<li>${c.esc(sessionTitle(c, x.other))} – ${c.esc(x.reasons.join(", "))}</li>`).join("")}</ul></div>` : "";
      return list;
    };
    ["sDate", "sStart", "sEnd", "sLect", "sZoom"].forEach((id) => c.$(id).addEventListener("input", check));
    check();
    if (!editable) return;
    c.$("sSave").onclick = async () => {
      const d = draft();
      if (!d.date || !d.start || !d.end) return c.toast("נא למלא תאריך ושעות", "bad");
      if (d.end <= d.start) return c.toast("שעת הסיום צריכה להיות אחרי שעת ההתחלה", "bad");
      const link = c.$("sLink").value.trim();
      if (link && !isUrl(link)) return c.toast("קישור ההצטרפות לא תקין", "bad");
      if (check().length && !confirm("יש התנגשות עם מפגש אחר. לשמור בכל זאת?")) return;
      const data = { courseId: course.id, date: d.date, start: d.start, end: d.end, topic: c.$("sTopic").value.trim(), lecturer: d.lecturer.trim(), zoomAccount: d.zoomAccount, updatedAt: serverTimestamp() };
      try {
        const id = sid || doc(collection(db, "sessions")).id;
        const b = writeBatch(db);
        b.set(doc(db, "sessions", id), data, { merge: true });
        b.set(doc(db, "sessionPrivate", id), { courseId: course.id, zoomLink: link }, { merge: true });
        await b.commit();
        c.toast("נשמר", "good"); c.closeModal();
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
    if (c.$("sDel")) c.$("sDel").onclick = async () => {
      if (!confirm("למחוק את המפגש? הנוכחות שנרשמה עליו תימחק מהדוחות.")) return;
      try {
        const b = writeBatch(db);
        ["sessions", "sessionPrivate", "recordings"].forEach((col) => b.delete(doc(db, col, sid)));
        await b.commit(); c.closeModal();
      } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
    };
  });
}

function openSeries(c, course) {
  c.openModal(`
    <div class="head"><h2>סדרת מפגשים שבועיים</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="zFirst">תאריך המפגש הראשון</label><input id="zFirst" type="date"></div>
      <div class="field"><label for="zCount">מספר מפגשים</label><input id="zCount" type="number" min="1" max="52" value="8"></div>
      <div class="field"><label>שעות</label><div class="row" style="flex-wrap:nowrap"><input id="zStart" type="time" value="20:00" aria-label="שעת התחלה"><span>–</span><input id="zEnd" type="time" value="21:30" aria-label="שעת סיום"></div></div>
      <div class="field"><label for="zLect">מרצה</label><input id="zLect" list="lectList2"><datalist id="lectList2">${lecturerList(c).map((l) => `<option value="${c.esc(l)}">`).join("")}</datalist></div>
      <div class="field"><label for="zZoom">חשבון זום</label><select id="zZoom">${zoomOptions(c, c.S.resources.zoomAccounts[0])}</select></div>
      <div class="field"><label for="zLink">קישור הצטרפות קבוע (רשות)</label><input id="zLink" placeholder="https://zoom.us/j/..."></div>
    </div>
    <div id="zPreview"></div>
    <button class="primary" id="zSave">יצירת המפגשים</button>`, () => {
    const build = () => {
      const first = c.$("zFirst").value, n = Math.min(52, Math.max(1, Number(c.$("zCount").value) || 0));
      if (!first) return [];
      return Array.from({ length: n }, (_, i) => ({ id: "__s" + i, courseId: course.id, date: addDaysIso(first, 7 * i), start: c.$("zStart").value, end: c.$("zEnd").value, lecturer: c.$("zLect").value, zoomAccount: c.$("zZoom").value }));
    };
    const preview = () => {
      const list = build();
      const bad = list.filter((s) => conflictsFor(s, sessionsOf(c)).length);
      c.$("zPreview").innerHTML = list.length ? `<p class="small">${list.length} מפגשים: ${fmtIso(list.at(0).date)} עד ${fmtIso(list.at(-1).date)} (${dayName(list.at(0).date)})</p>
        ${bad.length ? `<div class="conflict-box"><b>⚠ ${bad.length} מפגשים מתנגשים:</b><ul>${bad.map((s) => `<li>${fmtIso(s.date)} – ${conflictsFor(s, sessionsOf(c)).map((x) => c.esc(sessionTitle(c, x.other) + " (" + x.reasons.join(", ") + ")")).join("; ")}</li>`).join("")}</ul></div>` : ""}` : "";
      return { list, bad };
    };
    ["zFirst", "zCount", "zStart", "zEnd", "zLect", "zZoom"].forEach((id) => c.$(id).addEventListener("input", preview));
    c.$("zSave").onclick = async () => {
      const { list, bad } = preview();
      if (!list.length) return c.toast("נא לבחור תאריך ראשון", "bad");
      if (c.$("zEnd").value <= c.$("zStart").value) return c.toast("שעת הסיום צריכה להיות אחרי שעת ההתחלה", "bad");
      const link = c.$("zLink").value.trim();
      if (link && !isUrl(link)) return c.toast("קישור ההצטרפות לא תקין", "bad");
      if (bad.length && !confirm(`${bad.length} מפגשים מתנגשים עם מפגשים אחרים. ליצור בכל זאת?`)) return;
      const startN = sessionsOf(c, course.id).length;
      try {
        const b = writeBatch(db);
        list.forEach((s, i) => {
          const id = doc(collection(db, "sessions")).id;
          b.set(doc(db, "sessions", id), { courseId: course.id, date: s.date, start: s.start, end: s.end, topic: `מפגש ${startN + i + 1}`, lecturer: s.lecturer.trim(), zoomAccount: s.zoomAccount, updatedAt: serverTimestamp() });
          b.set(doc(db, "sessionPrivate", id), { courseId: course.id, zoomLink: link });
        });
        await b.commit();
        c.toast(`נוצרו ${list.length} מפגשים`, "good"); c.closeModal();
      } catch (e) { c.toast("היצירה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ---------- נרשמים ----------
function tabRegs(c, course) {
  const ss = pastSessions(sessionsOf(c, course.id));
  const all = regsOf(c, course.id);
  if (!CS.regStatus) CS.regStatus = all.some((r) => r.status === "pending") ? "pending" : "registered";
  const t = norm(CS.regSearch);
  const dupEmails = new Set(all.map((r) => r.email).filter((e, i, arr) => arr.indexOf(e) !== i));
  const list = all.filter((r) => (CS.regStatus === "all" || r.status === CS.regStatus) && (!t || norm([fullName(r), r.email, r.phone, r.city].join(" ")).includes(t)))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), "he"));
  const cnt = (st) => all.filter((r) => st === "all" || r.status === st).length;
  const pending = all.filter((r) => r.status === "pending");
  c.$("cBody").innerHTML = `
    <div class="row space" style="margin-bottom:10px">
      <div class="tabs" style="margin:0">${[["pending", "ממתינים"], ["registered", "מאושרים"], ["rejected", "נדחו"], ["cancelled", "ביטלו"], ["all", "הכול"]].map(([k, l]) =>
        `<button data-rst="${k}" class="${CS.regStatus === k ? "active" : ""}">${l} (${cnt(k)})</button>`).join("")}</div>
      <span class="small">${cnt("registered")} מאושרים${course.capacity ? ` מתוך ${course.capacity} מקומות` : ""}</span></div>
    <div class="row" style="margin-bottom:10px">
      <input id="regSearch" placeholder="חיפוש" value="${c.esc(CS.regSearch)}" style="width:180px" aria-label="חיפוש נרשמים">
      ${CS.regStatus === "pending" && pending.length ? `<button class="primary" id="approveAll">אישור כל הממתינים (${pending.length})</button>` : ""}
      <button id="addReg">+ הוספת נרשם</button>
      <span class="grow"></span>
      <button id="mailAll">מייל למאושרים</button><button id="mailReminder">תזכורת למפגש הבא</button><button id="regExport">ייצוא ל-Excel</button></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>שם</th><th>מייל (לכניסה)</th><th>טלפון</th><th>נרשם</th><th>נוכחות</th>${course.scholarships ? "<th>מלגה</th>" : ""}<th>סטטוס</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr>
        <td>${c.esc(fullName(r))}${r.city ? `<div class="small muted">${c.esc(r.city)}</div>` : ""}${r.note ? `<div class="small" title="${c.esc(r.note)}">📝 ${c.esc(r.note.slice(0, 40))}${r.note.length > 40 ? "…" : ""}</div>` : ""}</td>
        <td dir="ltr" style="text-align:right">${c.esc(r.email)}${dupEmails.has(r.email) ? ' <span class="badge warn">כפול</span>' : ""}</td><td>${c.esc(r.phone)}</td>
        <td>${c.fmtDate(r.createdAt)}${r.source && r.source !== "טופס באתר" ? `<div class="small muted">${c.esc(r.source)}</div>` : ""}</td>
        <td>${r.status === "registered" && ss.length ? `${attendedCount(r, ss)}/${ss.length}` : "—"}</td>
        ${course.scholarships ? `<td>${r.scholarship ? `<span class="badge ${SCH_BADGE[r.scholarship.status]}" title="${c.esc(r.scholarship.reason)}">${SCH[r.scholarship.status]}</span>
          ${r.scholarship.status === "pending" ? `<button class="link" data-sch="${r.id}|approved">אישור</button> <button class="link danger" data-sch="${r.id}|rejected">דחייה</button>` : ""}
          ${r.scholarship.reason ? `<div class="small muted">${c.esc(r.scholarship.reason)}</div>` : ""}` : "—"}</td>` : ""}
        <td><span class="badge ${R_BADGE[r.status] || ""}">${R_STATUS[r.status] || r.status}</span>${r.approvalSentAt ? '<div class="small muted">נשלח אישור</div>' : ""}</td>
        <td class="nowrap">${r.status === "pending" ? `<button class="link" data-appr="${r.id}">אישור</button> <button class="link danger" data-rej="${r.id}">דחייה</button>`
          : r.status === "registered" ? `<button class="link danger" data-revoke="${r.id}">ביטול</button>`
          : `<button class="link" data-appr="${r.id}">אישור</button>`}
          <button class="link" data-editreg="${r.id}">עריכה</button></td></tr>`).join("")
        || `<tr><td colspan="8" class="muted">אין נרשמים ברשימה הזו</td></tr>`}</tbody></table></div></div>
    <p class="small muted">נרשם מאושר נכנס לאזור האישי (${c.esc(myAreaUrl())}) עם חשבון Google של כתובת המייל שלו. אם הוא משתמש בכתובת אחרת – מעדכנים אותה ב"עריכה".</p>`;
  c.$("cBody").querySelectorAll("[data-rst]").forEach((b) => (b.onclick = () => { CS.regStatus = b.dataset.rst; tabRegs(c, course); }));
  c.$("regSearch").oninput = (e) => { CS.regSearch = e.target.value; const pos = e.target.selectionStart; tabRegs(c, course); c.$("regSearch").focus(); c.$("regSearch").setSelectionRange(pos, pos); };
  c.$("regExport").onclick = () => c.exportXlsx(list.map((r) => ({
    "שם פרטי": r.firstName || "", "שם משפחה": r.lastName || "", "מייל": r.email, "טלפון": r.phone || "", "יישוב": r.city || "",
    "תאריך הרשמה": c.fmtDate(r.createdAt), "סטטוס": R_STATUS[r.status] || r.status, "אישור דיוור": r.consentEmail ? "כן" : "לא",
    "נוכחות": ss.length && r.status === "registered" ? `${attendedCount(r, ss)}/${ss.length}` : "", "מלגה": r.scholarship ? SCH[r.scholarship.status] : "",
    "נימוק מלגה": r.scholarship?.reason || "", "הערות": r.note || ""
  })), `נרשמים-${course.title}.xlsx`);
  if (c.$("approveAll")) c.$("approveAll").onclick = () => approve(c, course, pending);
  c.$("addReg").onclick = () => editReg(c, course, null);
  c.$("mailAll").onclick = () => mailRegistered(c, course);
  c.$("mailReminder").onclick = () => mailReminder(c, course);
  document.querySelectorAll("[data-appr]").forEach((b) => (b.onclick = () => approve(c, course, [c.S.regs.get(b.dataset.appr)])));
  document.querySelectorAll("[data-rej]").forEach((b) => (b.onclick = () => setStatus(c, course, c.S.regs.get(b.dataset.rej), "rejected")));
  document.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = () => {
    if (confirm("לבטל את ההרשמה? הגישה לאזור האישי של ההשתלמות תיחסם.")) setStatus(c, course, c.S.regs.get(b.dataset.revoke), "cancelled");
  }));
  document.querySelectorAll("[data-editreg]").forEach((b) => (b.onclick = () => editReg(c, course, b.dataset.editreg)));
  document.querySelectorAll("[data-sch]").forEach((b) => (b.onclick = async () => {
    const [rid, st] = b.dataset.sch.split("|");
    const r = c.S.regs.get(rid);
    try { await updateDoc(doc(db, "registrations", rid), { scholarship: { ...r.scholarship, status: st, decidedBy: c.myEmail(), decidedAt: todayIso() } }); c.toast("עודכן", "good"); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); }
  }));
}

const accessId = (courseId, email) => `${courseId}_${normEmail(email)}`;

// אישור: סטטוס "מאושר" + הרשאת גישה לפי המייל, ואחר כך הצעה לשלוח מייל אישור
async function approve(c, course, regs) {
  regs = regs.filter(Boolean);
  if (!regs.length) return;
  if (regs.length > 1 && !confirm(`לאשר ${regs.length} נרשמים?`)) return;
  try {
    for (let i = 0; i < regs.length; i += 200) {
      const b = writeBatch(db);
      regs.slice(i, i + 200).forEach((r) => {
        b.update(doc(db, "registrations", r.id), { status: "registered", approvedAt: serverTimestamp(), approvedBy: c.myEmail() });
        b.set(doc(db, "courseAccess", accessId(course.id, r.email)), { courseId: course.id, email: normEmail(r.email), regId: r.id });
      });
      await b.commit();
    }
    c.toast(regs.length > 1 ? `אושרו ${regs.length} נרשמים` : "אושר", "good");
    mailApproval(c, course, regs);
  } catch (e) { c.toast("האישור נכשל: " + e.code, "bad"); }
}

async function setStatus(c, course, r, status) {
  try {
    const b = writeBatch(db);
    b.update(doc(db, "registrations", r.id), { status, statusAt: serverTimestamp(), statusBy: c.myEmail() });
    b.delete(doc(db, "courseAccess", accessId(course.id, r.email)));
    await b.commit();
    c.toast("עודכן", "good");
  } catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); }
}

function editReg(c, course, rid) {
  const r = rid ? c.S.regs.get(rid) : { status: "registered" };
  c.openModal(`
    <div class="head"><h2>${rid ? "עריכת נרשם" : "הוספת נרשם"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="eFirst">שם פרטי</label><input id="eFirst" value="${c.esc(r.firstName)}"></div>
      <div class="field"><label for="eLast">שם משפחה</label><input id="eLast" value="${c.esc(r.lastName)}"></div>
      <div class="field"><label for="eEmail">מייל (לכניסה עם Google)</label><input id="eEmail" type="email" dir="ltr" value="${c.esc(r.email)}"></div>
      <div class="field"><label for="ePhone">טלפון</label><input id="ePhone" value="${c.esc(r.phone)}"></div>
      <div class="field"><label for="eCity">יישוב</label><input id="eCity" value="${c.esc(r.city)}"></div>
      <div class="field"><label for="eStatus">סטטוס</label><select id="eStatus">${Object.entries(R_STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="eNote">הערות</label><textarea id="eNote" style="min-height:60px">${c.esc(r.note)}</textarea></div>
    <label class="check"><input type="checkbox" id="eConsent" ${r.consentEmail ? "checked" : ""}> <span>אישר קבלת דיוור</span></label>
    <div class="row" style="margin-top:12px"><button class="primary" id="eSave">שמירה</button></div>`, () => {
    c.$("eSave").onclick = async () => {
      const email = normEmail(c.$("eEmail").value), status = c.$("eStatus").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.toast("כתובת המייל לא תקינה", "bad");
      if (!c.$("eFirst").value.trim()) return c.toast("נא למלא שם", "bad");
      const data = { firstName: c.$("eFirst").value.trim(), lastName: c.$("eLast").value.trim(), email, phone: c.$("ePhone").value.trim(),
        city: c.$("eCity").value.trim(), note: c.$("eNote").value.trim(), consentEmail: c.$("eConsent").checked, status };
      try {
        const b = writeBatch(db);
        const id = rid || doc(collection(db, "registrations")).id;
        if (rid) {
          b.update(doc(db, "registrations", id), { ...data, updatedAt: serverTimestamp() });
          // הרשאת הגישה תמיד תואמת את המייל והסטטוס
          b.delete(doc(db, "courseAccess", accessId(course.id, r.email)));
        } else {
          b.set(doc(db, "registrations", id), { ...data, courseId: course.id, managerEmails: course.managerEmails || [], source: "הוספה ידנית", createdAt: serverTimestamp() });
        }
        if (status === "registered") b.set(doc(db, "courseAccess", accessId(course.id, email)), { courseId: course.id, email, regId: id });
        await b.commit();
        c.toast("נשמר", "good"); c.closeModal();
        if (status === "registered" && (!rid || r.status !== "registered")) mailApproval(c, course, [{ ...data, id }]);
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ---------- מיילים להשתלמות ----------
const recOf = (r, vars) => ({ email: r.email, name: fullName(r), firstName: r.firstName, contactId: r.contactId, ref: r.id, consent: r.consentEmail === true, vars });

function mailApproval(c, course, regs) {
  const next = sessionsOf(c, course.id).find((s) => s.date >= todayIso());
  composeMail(c, {
    title: "שליחת מייל אישור הרשמה", kind: "course-approval",
    recipients: regs.map((r) => recOf(r, { "השתלמות": course.title, "קישור": myAreaUrl(), "מייל": r.email })),
    subject: `אושרה הרשמתך ל${course.title}`,
    body: `שלום {שם פרטי},

שמחים לבשר שהרשמתך להשתלמות "{השתלמות}" אושרה.
${next ? `\nהמפגש הקרוב: יום ${dayName(next.date)} ${fmtIso(next.date)} בשעה ${next.start}.\n` : ""}
באזור האישי תמצאו את לוח המפגשים, קישורי ההצטרפות לזום, ההקלטות והנוכחות:
{קישור}

הכניסה לאזור האישי היא עם חשבון Google של הכתובת {מייל}.

בברכה,
מכון משפטי ארץ`,
    mark: { collection: "registrations", field: "approvalSentAt" }
  });
}

function mailRegistered(c, course) {
  const regs = activeRegs(c, course.id);
  if (!regs.length) return c.toast("אין נרשמים מאושרים", "bad");
  composeMail(c, {
    title: `מייל לנרשמי ${course.title}`, kind: "course-message",
    recipients: regs.map((r) => recOf(r, { "השתלמות": course.title, "קישור": myAreaUrl() })),
    subject: `${course.title} – עדכון`,
    body: `שלום {שם פרטי},\n\n\n\nבברכה,\nמכון משפטי ארץ\n\nהאזור האישי: {קישור}`
  });
}

async function mailReminder(c, course) {
  const regs = activeRegs(c, course.id);
  if (!regs.length) return c.toast("אין נרשמים מאושרים", "bad");
  const next = sessionsOf(c, course.id).find((s) => s.date >= todayIso());
  if (!next) return c.toast("אין מפגשים קרובים", "bad");
  let link = "";
  try { const p = await getDoc(doc(db, "sessionPrivate", next.id)); link = p.exists() ? p.data().zoomLink || "" : ""; } catch { /* */ }
  const when = `${next.date === todayIso() ? "היום" : `ביום ${dayName(next.date)}`} ${fmtIso(next.date)} בשעה ${next.start}`;
  composeMail(c, {
    title: "תזכורת למפגש הבא", kind: "course-reminder",
    recipients: regs.map((r) => recOf(r, { "השתלמות": course.title, "קישור": myAreaUrl() })),
    subject: `תזכורת: ${course.title} – ${when}`,
    body: `שלום {שם פרטי},

תזכורת: המפגש הבא בהשתלמות "{השתלמות}" יתקיים ${when}${next.topic ? `\nנושא: ${next.topic}` : ""}${next.lecturer ? `\nמרצה: ${next.lecturer}` : ""}
${link ? `\nקישור להצטרפות: ${link}\n` : ""}
כל הפרטים באזור האישי: {קישור}

בברכה,
מכון משפטי ארץ`
  });
}

// ---------- נוכחות ----------
function tabAttendance(c, course) {
  const ss = sessionsOf(c, course.id);
  const rs = activeRegs(c, course.id).sort((a, b) => fullName(a).localeCompare(fullName(b), "he"));
  const past = pastSessions(ss);
  c.$("cBody").innerHTML = `
    <div class="card"><h3>ייבוא דוח משתתפים מזום</h3>
      <p class="small muted">בזום: Reports ← Usage ← Participants ← Export. המערכת מסמנת נוכחות לפי כתובת המייל, ואם אין התאמה – לפי השם המלא.</p>
      <div class="row"><select id="zSess" style="width:auto" aria-label="מפגש">${ss.map((s, i) => `<option value="${s.id}" ${s.date === todayIso() || (!past.length && i === 0) || (past.at(-1)?.id === s.id) ? "selected" : ""}>מפגש ${i + 1} · ${fmtIso(s.date)}</option>`).join("")}</select>
      <input type="file" id="zFile" accept=".csv,.xlsx,.xls" style="width:auto" aria-label="קובץ דוח זום"></div>
      <div id="zResult"></div></div>
    <div class="row space" style="margin-bottom:8px"><span class="small muted">לחיצה על משבצת מסמנת או מבטלת נוכחות.</span><button id="attExport">ייצוא ל-Excel</button></div>
    <div class="card" style="padding:0"><div class="table-wrap att-wrap"><table class="att">
      <thead><tr><th>משתתף</th>${ss.map((s, i) => `<th title="${c.esc(s.topic)}">${i + 1}<div class="small muted">${fmtIso(s.date).slice(0, 5)}</div></th>`).join("")}<th>%</th></tr></thead>
      <tbody>${rs.map((r) => `<tr><td>${c.esc(fullName(r))}</td>${ss.map((s) => `<td><input type="checkbox" data-att="${r.id}|${s.id}" ${r.attendance?.[s.id] ? "checked" : ""} aria-label="${c.esc(fullName(r))} – מפגש ${fmtIso(s.date)}"></td>`).join("")}
        <td>${pct(attendedCount(r, past), past.length)}%</td></tr>`).join("") || `<tr><td colspan="${ss.length + 2}" class="muted">אין נרשמים</td></tr>`}</tbody>
    </table></div></div>`;
  document.querySelectorAll("[data-att]").forEach((cb) => (cb.onchange = async () => {
    const [rid, sid] = cb.dataset.att.split("|");
    try { await updateDoc(doc(db, "registrations", rid), { ["attendance." + sid]: cb.checked }); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); cb.checked = !cb.checked; }
  }));
  c.$("attExport").onclick = () => c.exportXlsx(rs.map((r) => {
    const row = { "שם": fullName(r), "מייל": r.email };
    ss.forEach((s, i) => { row[`${i + 1} (${fmtIso(s.date)})`] = r.attendance?.[s.id] ? "✓" : ""; });
    row["אחוז נוכחות"] = pct(attendedCount(r, past), past.length) + "%";
    return row;
  }), `נוכחות-${course.title}.xlsx`);
  c.$("zFile").onchange = (e) => importZoom(c, course, c.$("zSess").value, e.target.files[0]);
}

async function importZoom(c, course, sid, file) {
  if (!file || !sid) return;
  const wb = await readWorkbook(file);
  // בדוחות זום יש לפעמים שורות פתיחה לפני הכותרות – מחפשים את שורת הכותרות
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const hi = rows.findIndex((r) => r.some((x) => /mail|מייל|דוא/i.test(String(x))));
  if (hi < 0) return c.toast("לא נמצאה עמודת מייל בקובץ", "bad");
  const head = rows.at(hi).map(String);
  const ei = head.findIndex((x) => /mail|מייל|דוא/i.test(x));
  const ni = head.findIndex((x) => /name|שם/i.test(x));
  const regs = activeRegs(c, course.id);
  const byEmail = new Map(regs.map((r) => [normEmail(r.email), r]));
  const byName = new Map(regs.map((r) => [norm(fullName(r)), r]));
  const hit = new Set(), unmatched = [];
  rows.slice(hi + 1).forEach((row) => {
    const em = normEmail(row.at(ei)), nm = ni >= 0 ? norm(String(row.at(ni)).replace(/\(.*?\)/g, "")) : "";
    if (!em && !nm) return;
    const r = (em && byEmail.get(em)) || (nm && byName.get(nm));
    if (r) hit.add(r.id); else unmatched.push(String(row.at(ni >= 0 ? ni : ei) || em));
  });
  const toMark = [...hit].filter((rid) => !c.S.regs.get(rid)?.attendance?.[sid]);
  try {
    const b = writeBatch(db);
    toMark.forEach((rid) => b.update(doc(db, "registrations", rid), { ["attendance." + sid]: true }));
    if (toMark.length) await b.commit();
    const uniq = [...new Set(unmatched)];
    c.$("zResult").innerHTML = `<div class="context"><b>${hit.size}</b> נרשמים זוהו בדוח (${toMark.length} סומנו עכשיו).
      ${uniq.length ? `<details><summary>${uniq.length} משתתפים בדוח שלא זוהו כנרשמים</summary><div class="small">${uniq.map(c.esc).join(" · ")}</div></details>` : ""}</div>`;
  } catch (e) { c.toast("הסימון נכשל: " + e.code, "bad"); }
}

// ---------- הקלטות ----------
async function tabRecordings(c, course) {
  const ss = sessionsOf(c, course.id);
  c.$("cBody").innerHTML = `<p class="muted">טוען...</p>`;
  let rec = new Map();
  try { (await getDocs(query(collection(db, "recordings"), where("courseId", "==", course.id)))).forEach((d) => rec.set(d.id, d.data())); }
  catch (e) { c.toast("טעינת ההקלטות נכשלה: " + e.code, "bad"); }
  if (CS.tab !== "recordings" || CS.courseId !== course.id) return;
  c.$("cBody").innerHTML = `
    <div class="card"><label class="check"><input type="checkbox" id="recOpen" ${course.recordingsOpen ? "checked" : ""}> <span><b>להציג את ההקלטות למשתלמים באזור האישי</b></span></label>
      <p class="small muted">מומלץ להעלות ליוטיוב כסרטון "לא רשום" (Unlisted) ולהדביק כאן את הקישור.</p></div>
    <div class="card">${ss.map((s, i) => `<div class="row" style="margin-bottom:8px">
      <span style="min-width:150px">מפגש ${i + 1} · ${fmtIso(s.date)}</span>
      <input class="grow" data-rec="${s.id}" value="${c.esc(rec.get(s.id)?.url)}" placeholder="https://youtu.be/..." aria-label="קישור הקלטה למפגש ${i + 1}">
      ${rec.get(s.id)?.url ? `<a class="btn" href="${c.esc(rec.get(s.id).url)}" target="_blank" rel="noopener">צפייה</a>` : ""}</div>`).join("") || '<p class="muted">אין מפגשים</p>'}
      ${ss.length ? '<button class="primary" id="recSave">שמירת הקישורים</button>' : ""}</div>`;
  c.$("recOpen").onchange = async (e) => {
    try { await updateDoc(doc(db, "courses", course.id), { recordingsOpen: e.target.checked }); c.toast(e.target.checked ? "ההקלטות גלויות למשתלמים" : "ההקלטות הוסתרו", "good"); }
    catch (err) { c.toast("העדכון נכשל: " + err.code, "bad"); e.target.checked = !e.target.checked; }
  };
  if (c.$("recSave")) c.$("recSave").onclick = async () => {
    const inputs = [...document.querySelectorAll("[data-rec]")];
    const bad = inputs.find((i) => i.value.trim() && !isUrl(i.value));
    if (bad) { bad.focus(); return c.toast("אחד הקישורים לא תקין", "bad"); }
    try {
      const b = writeBatch(db);
      inputs.forEach((i) => {
        const url = i.value.trim(), sid = i.dataset.rec;
        if (url) b.set(doc(db, "recordings", sid), { courseId: course.id, url, updatedAt: serverTimestamp() });
        else if (rec.has(sid)) b.delete(doc(db, "recordings", sid));
      });
      await b.commit(); c.toast("נשמר", "good"); tabRecordings(c, course);
    } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
  };
  document.querySelectorAll("[data-rec]").forEach((i) => i.addEventListener("input", () => c.$("cBody").setAttribute("data-editing", "1")));
}

// ---------- צעד 6: פרסום ----------
function tabPublish(c, course) {
  const url = landingUrl(course.id);
  const ss = sessionsOf(c, course.id);
  const missing = SETUP.filter(([k]) => k !== "publish" && !stepDone(c, course, k)).map(([, l]) => l);
  const msg = `${course.title}${course.subtitle ? "\n" + course.subtitle : ""}${course.startDate ? `\n${fmtIso(course.startDate)}${course.endDate && course.endDate !== course.startDate ? " – " + fmtIso(course.endDate) : ""}` : ""}${ss.length ? ` · ${ss.length} מפגשים` : ""}${course.timeText ? "\n" + course.timeText : ""}\n\nלפרטים ולהרשמה:\n${url}`;
  c.$("cBody").innerHTML = `
    <div class="card">
      <h3>סטטוס ההרשמה</h3>
      ${course.status === "draft" ? `
        ${missing.length ? `<p class="small" style="color:var(--warn)">עוד לא הושלמו: ${missing.join(", ")}. אפשר לפרסם גם כך.</p>` : '<p class="small" style="color:var(--good)">כל הצעדים הושלמו ✓</p>'}
        <button class="primary" id="pOpen" style="font-size:1.05rem;padding:10px 22px">פתיחת ההרשמה ופרסום הדף</button>`
      : `<p><span class="badge ${C_BADGE[course.status]}">${C_STATUS[course.status]}</span></p>
        <div class="row">${course.status === "open" ? '<button id="pClose">סגירת ההרשמה</button>' : '<button id="pReopen">פתיחה מחדש להרשמה</button>'}
          <button class="link" id="pDraft">החזרה לטיוטה (הסתרת הדף)</button></div>`}
    </div>
    <div class="card"><h3>קישור לדף ההרשמה</h3>
      <div class="row"><input id="lUrl" class="grow" value="${c.esc(url)}" readonly aria-label="קישור לדף ההרשמה" dir="ltr">
        <button id="lCopy">העתקה</button><a class="btn" href="${c.esc(url)}" target="_blank" rel="noopener">פתיחה</a></div>
      <h3 style="margin-top:14px">הודעה מוכנה לוואטסאפ</h3>
      <textarea id="waMsg" style="min-height:120px">${c.esc(msg)}</textarea>
      <div class="row"><button id="waCopy">העתקת ההודעה</button><button id="adDl2">הורדת המודעה</button></div></div>`;
  const setStatus = async (status) => {
    try { await updateDoc(doc(db, "courses", course.id), { status }); c.toast(C_STATUS[status], "good"); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); }
  };
  if (c.$("pOpen")) c.$("pOpen").onclick = () => setStatus("open");
  if (c.$("pClose")) c.$("pClose").onclick = () => setStatus("closed");
  if (c.$("pReopen")) c.$("pReopen").onclick = () => setStatus("open");
  if (c.$("pDraft")) c.$("pDraft").onclick = () => { if (confirm("להחזיר לטיוטה? דף ההרשמה לא יהיה גלוי לציבור.")) setStatus("draft"); };
  c.$("lCopy").onclick = async () => { try { await navigator.clipboard.writeText(url); c.toast("הקישור הועתק", "good"); } catch { c.$("lUrl").select(); } };
  c.$("waCopy").onclick = async () => { try { await navigator.clipboard.writeText(c.$("waMsg").value); c.toast("ההודעה הועתקה", "good"); } catch { /* */ } };
  c.$("adDl2").onclick = async () => { try { await makeAd(course, ss, url); } catch { c.toast("יצירת המודעה נכשלה", "bad"); } };
}

// ======================================================
// לוח שנה
// ======================================================
export function renderCalendar(c) {
  const [y, m] = CS.calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const gridStart = addDaysIso(isoDate(first), -first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(gridStart, i));
  const monthEnd = isoDate(new Date(y, m, 0));
  const lastRowNeeded = days.findIndex((d) => d > monthEnd);
  const cells = days.slice(0, lastRowNeeded > 0 ? Math.ceil(lastRowNeeded / 7) * 7 : 42);
  const all = sessionsOf(c);
  const ln = norm(CS.calLecturer);
  const shown = all.filter((s) => (!CS.calCourse || s.courseId === CS.calCourse) && (!ln || norm(s.lecturer).includes(ln)));
  const monthConf = allConflicts(all.filter((s) => s.date.startsWith(CS.calMonth)));
  const today = todayIso();

  c.$("main").innerHTML = `
    <div class="row space"><h1>לוח שנה</h1>
      <div class="row"><button id="calPrev" aria-label="חודש קודם">→</button><b style="min-width:120px;text-align:center">${HEB_MONTHS.at(m - 1)} ${y}</b><button id="calNext" aria-label="חודש הבא">←</button><button id="calToday">היום</button></div></div>
    <div class="card"><div class="row">
      <select id="calCourse" style="width:auto" aria-label="סינון לפי השתלמות"><option value="">כל ההשתלמויות</option>${coursesList(c).map((x) => `<option value="${x.id}" ${CS.calCourse === x.id ? "selected" : ""}>${c.esc(x.title)}</option>`).join("")}</select>
      <input id="calLect" placeholder="סינון לפי מרצה" value="${c.esc(CS.calLecturer)}" style="width:200px" list="calLectList" aria-label="סינון לפי מרצה"><datalist id="calLectList">${lecturerList(c).map((l) => `<option value="${c.esc(l)}">`).join("")}</datalist>
    </div></div>
    ${monthConf.length ? `<div class="conflict-box"><b>⚠ ${monthConf.length} התנגשויות החודש:</b><ul>${monthConf.map((x) => `<li>${dayName(x.a.date)} ${fmtIso(x.a.date)}: ${c.esc(c.S.courses.get(x.a.courseId)?.title || "")} ${c.esc(x.a.start)}–${c.esc(x.a.end)} ↔ ${c.esc(c.S.courses.get(x.b.courseId)?.title || "")} ${c.esc(x.b.start)}–${c.esc(x.b.end)} · <b>${c.esc(x.reasons.join(", "))}</b></li>`).join("")}</ul></div>` : '<p class="small muted">אין התנגשויות החודש.</p>'}
    <div class="cal" role="grid" aria-label="לוח שנה">
      ${HEB_DAYS.map((d) => `<div class="cal-h" role="columnheader">${d}</div>`).join("")}
      ${cells.map((d) => {
        const list = shown.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start));
        return `<div class="cal-d ${d.slice(0, 7) !== CS.calMonth ? "out" : ""} ${d === today ? "today" : ""}" role="gridcell">
          <div class="cal-n">${Number(d.slice(8))}<span class="cal-wd"> · יום ${dayName(d)} ${fmtIso(d)}</span></div>
          ${list.map((s) => {
            const conf = conflictsFor(s, all).length;
            const crs = c.S.courses.get(s.courseId);
            return `<button class="cal-ev ${conf ? "conf" : ""}" data-ev="${s.id}" style="border-inline-start-color:${colorOf(s.courseId)}" title="${c.esc(`${crs?.title || ""}\n${s.topic || ""}\n${s.lecturer || ""}\n${s.zoomAccount || "פרונטלי"}`)}">
              <b>${c.esc(s.start)}</b> ${c.esc(crs?.title || "")}${s.lecturer ? `<span class="small"> · ${c.esc(s.lecturer)}</span>` : ""}${conf ? " ⚠" : ""}</button>`;
          }).join("")}
        </div>`;
      }).join("")}
    </div>`;
  const setMonth = (iso) => { CS.calMonth = iso.slice(0, 7); renderCalendar(c); };
  c.$("calPrev").onclick = () => setMonth(isoDate(new Date(y, m - 2, 1)));
  c.$("calNext").onclick = () => setMonth(isoDate(new Date(y, m, 1)));
  c.$("calToday").onclick = () => setMonth(todayIso());
  c.$("calCourse").onchange = (e) => { CS.calCourse = e.target.value; renderCalendar(c); };
  c.$("calLect").onchange = (e) => { CS.calLecturer = e.target.value; renderCalendar(c); };
  document.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => {
    const s = c.S.sessions.get(b.dataset.ev);
    openSession(c, c.S.courses.get(s.courseId), s.id);
  }));
}
