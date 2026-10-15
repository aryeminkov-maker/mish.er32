// ===== דיווח חודשי של חוקרים =====
// כל חוקר כותב פעם בחודש: מה השגתי החודש, ומה היעד שלי לחודש הבא.
// מנהל מערכת, רכז הרכזים ורכז מחקר רואים את כולם במסך אחד לכל חודש.
// מסמך: monthly/{מייל}_{YYYY-MM}  { researcherEmail, researcherName, month, achieved, nextGoal, coordComment }
import { doc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261022";
import { todayIso, HEB_MONTHS } from "./util.js?v=20261022";

// ---------- חודשים ----------
const thisMonth = () => todayIso().slice(0, 7);
function addMonths(m, n) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const monthLabel = (m) => { const [y, mo] = m.split("-").map(Number); return `${HEB_MONTHS[mo - 1]} ${y}`; };
const monthName = (m) => HEB_MONTHS[Number(m.split("-")[1]) - 1];

const RS = { month: "", started: false };
const isCoord = (c) => c.can("admin", "head", "research_coord");
const repOf = (c, email, month) => c.S.monthly.get(`${email}_${month}`);
const filled = (r) => !!(r && (r.achieved || r.nextGoal));
const txt = (c, s, empty = "—") => (s ? `<div class="pre">${c.esc(s)}</div>` : `<span class="muted">${empty}</span>`);

// החוקרים: כל מי שמוגדר "חוקר", וגם מי שכבר דיווח בעבר
function researchers(c) {
  const set = new Map();
  [...c.S.users.values()].filter((u) => u.role === "researcher").forEach((u) => set.set(u.id, u.name || u.id));
  [...c.S.monthly.values()].forEach((r) => { if (r.researcherEmail && !set.has(r.researcherEmail)) set.set(r.researcherEmail, r.researcherName || c.userName(r.researcherEmail)); });
  return [...set.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name, "he"));
}

// חודש ברירת המחדל: החודש הנוכחי. בשבוע הראשון של החודש, אם החודש הקודם עוד לא דווח – החודש הקודם
function defaultMonth(c) {
  const m = thisMonth();
  if (!isCoord(c) && Number(todayIso().slice(8, 10)) <= 7 && !filled(repOf(c, c.myEmail(), addMonths(m, -1)))) return addMonths(m, -1);
  if (isCoord(c) && Number(todayIso().slice(8, 10)) <= 7) return addMonths(m, -1);
  return m;
}

function monthNav(m) {
  const atMax = m >= thisMonth();
  return `<div class="month-nav">
    <button id="mPrev" aria-label="החודש הקודם">→</button>
    <b>${monthLabel(m)}</b>
    <button id="mNext" aria-label="החודש הבא" ${atMax ? "disabled" : ""}>←</button>
    ${m !== thisMonth() ? '<button class="link" id="mNow">לחודש הנוכחי</button>' : ""}
  </div>`;
}
function bindMonthNav(c) {
  c.$("mPrev").onclick = () => { RS.month = addMonths(RS.month, -1); renderResearch(c, true); };
  c.$("mNext").onclick = () => { if (RS.month < thisMonth()) { RS.month = addMonths(RS.month, 1); renderResearch(c, true); } };
  if (c.$("mNow")) c.$("mNow").onclick = () => { RS.month = thisMonth(); renderResearch(c, true); };
}

// ---------- סיכום לדף הראשי ----------
export function researchSummary(c) {
  const m = Number(todayIso().slice(8, 10)) <= 7 ? addMonths(thisMonth(), -1) : thisMonth();
  const rs = researchers(c);
  const done = rs.filter((r) => filled(repOf(c, r.email, m))).length;
  return `<div class="card">
    <div class="row space"><h2>דיווחי חוקרים</h2><button data-go="research">לדיווחים</button></div>
    <div class="stats" style="margin:0">
      <div class="stat"><div class="num">${done}/${rs.length}</div><div class="lbl">הגישו דיווח ל${monthName(m)}</div></div>
    </div></div>`;
}

// ---------- כניסה ----------
export function renderResearch(c, full) {
  if (!full && document.querySelector("[data-editing]")) return; // לא לדרוס טופס בזמן כתיבה
  if (!RS.started) { RS.month = defaultMonth(c); RS.started = true; }
  if (isCoord(c)) renderManagers(c); else renderResearcher(c);
}

// ======================================================
// חוקר
// ======================================================
function renderResearcher(c) {
  const me = c.myEmail(), m = RS.month, next = addMonths(m, 1);
  const rep = repOf(c, me, m) || {};
  const goal = repOf(c, me, addMonths(m, -1))?.nextGoal || "";
  const history = [...c.S.monthly.values()].filter((r) => r.researcherEmail === me && r.month !== m && filled(r))
    .sort((a, b) => b.month.localeCompare(a.month));

  c.$("main").innerHTML = `
    <div class="row space"><h1>הדיווח החודשי שלי</h1>${monthNav(m)}</div>
    <div class="card medium-w">
      <div class="goal-box"><div class="small muted">היעד שהצבתי ל${monthName(m)}</div>${txt(c, goal, "לא הוגדר יעד לחודש הזה")}</div>
      <div class="field"><label for="rAch">מה עשיתי והשגתי ב${monthName(m)}</label>
        <textarea id="rAch" style="min-height:140px" placeholder="מה התקדם, מה נכתב, מה הושלם...">${c.esc(rep.achieved || "")}</textarea></div>
      <div class="field"><label for="rGoal">היעד שלי ל${monthName(next)}</label>
        <textarea id="rGoal" style="min-height:110px" placeholder="מה אני רוצה להשיג בחודש הבא">${c.esc(rep.nextGoal || "")}</textarea></div>
      <div class="row"><button class="primary" id="rSave">${filled(rep) ? "עדכון הדיווח" : "שמירת הדיווח"}</button>
        ${rep.updatedAt ? `<span class="small muted">נשמר ${c.fmtDate(rep.updatedAt)}</span>` : ""}</div>
      ${rep.coordComment ? `<div class="context" style="margin-top:12px"><b>הערה מהרכז:</b> ${c.esc(rep.coordComment)}</div>` : ""}
    </div>
    ${history.length ? `<h2>החודשים הקודמים</h2>${history.map((r) => `
      <div class="card medium-w">
        <h3 style="margin-top:0">${monthLabel(r.month)}</h3>
        <div class="mrep-grid">
          <div><div class="small muted">היעד שהצבתי</div>${txt(c, repOf(c, me, addMonths(r.month, -1))?.nextGoal)}</div>
          <div><div class="small muted">מה השגתי</div>${txt(c, r.achieved)}</div>
          <div><div class="small muted">היעד ל${monthName(addMonths(r.month, 1))}</div>${txt(c, r.nextGoal)}</div>
        </div>
        ${r.coordComment ? `<p class="small" style="margin-bottom:0"><b>הערה מהרכז:</b> ${c.esc(r.coordComment)}</p>` : ""}
      </div>`).join("")}` : ""}`;

  bindMonthNav(c);
  ["rAch", "rGoal"].forEach((id) => c.$(id).addEventListener("input", (e) => e.target.setAttribute("data-editing", "1")));
  c.$("rSave").onclick = async () => {
    const achieved = c.$("rAch").value.trim(), nextGoal = c.$("rGoal").value.trim();
    if (!achieved && !nextGoal) return c.toast("כתבו מה השגתם או מה היעד לחודש הבא", "bad");
    const id = `${me}_${m}`;
    try {
      if (c.S.monthly.has(id)) await updateDoc(doc(db, "monthly", id), { achieved, nextGoal, updatedAt: serverTimestamp() });
      else await setDoc(doc(db, "monthly", id), { researcherEmail: me, researcherName: c.userName(me), month: m, achieved, nextGoal, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      c.toast("הדיווח נשמר", "good");
      document.querySelectorAll("[data-editing]").forEach((e) => e.removeAttribute("data-editing"));
      renderResearch(c, true);
    } catch (e) { c.toast("השמירה נכשלה: " + (e.code || e.message), "bad"); }
  };
}

// ======================================================
// מנהלים: כל החוקרים לחודש אחד
// ======================================================
function renderManagers(c) {
  const m = RS.month, prev = addMonths(m, -1), next = addMonths(m, 1);
  const rs = researchers(c);
  const done = rs.filter((r) => filled(repOf(c, r.email, m)));
  const missing = rs.filter((r) => !filled(repOf(c, r.email, m)));
  // קודם מי שהגיש, אחר כך מי שלא
  const ordered = [...done, ...missing];

  c.$("main").innerHTML = `
    <div class="row space"><h1>דיווחים חודשיים</h1>${monthNav(m)}</div>
    <div class="card no-print-break">
      <div class="row space">
        <div><b>הגישו ${done.length} מתוך ${rs.length} חוקרים</b>
          ${missing.length ? `<div class="small muted">טרם הגישו: ${missing.map((r) => c.esc(r.name)).join(", ")}</div>` : ""}</div>
        <button id="mPrint" class="no-print">הדפסה / PDF</button>
      </div>
    </div>
    ${ordered.map((r) => {
      const rep = repOf(c, r.email, m);
      const goal = repOf(c, r.email, prev)?.nextGoal;
      return `<div class="card mrep">
        <div class="row space"><h2 style="margin:0">${c.esc(r.name)}</h2>
          ${filled(rep) ? `<span class="badge good">הוגש${rep.updatedAt ? " · " + c.fmtDate(rep.updatedAt) : ""}</span>` : '<span class="badge warn">טרם הוגש</span>'}</div>
        <div class="mrep-grid">
          <div><div class="small muted">היעד שהציב ל${monthName(m)}</div>${txt(c, goal)}</div>
          <div><div class="small muted">מה הושג ב${monthName(m)}</div>${txt(c, rep?.achieved)}</div>
          <div><div class="small muted">היעד ל${monthName(next)}</div>${txt(c, rep?.nextGoal)}</div>
        </div>
        ${rep ? `<div class="row no-print" style="margin-top:10px">
            <input data-cmt="${c.esc(rep ? `${r.email}_${m}` : "")}" value="${c.esc(rep.coordComment || "")}" placeholder="הערה לחוקר (הוא יראה אותה)" aria-label="הערה ל${c.esc(r.name)}" style="flex:1;min-width:200px">
            <button data-cmtsave="${c.esc(`${r.email}_${m}`)}">שמירת הערה</button></div>
          ${rep.coordComment ? `<p class="small print-only"><b>הערה:</b> ${c.esc(rep.coordComment)}</p>` : ""}` : ""}
      </div>`;
    }).join("") || '<div class="card"><p class="muted">עדיין אין חוקרים. מוסיפים אותם במסך "משתמשים" עם התפקיד "חוקר".</p></div>'}`;

  bindMonthNav(c);
  c.$("mPrint").onclick = () => window.print();
  document.querySelectorAll("[data-cmt]").forEach((i) => i.addEventListener("input", () => i.setAttribute("data-editing", "1")));
  document.querySelectorAll("[data-cmtsave]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.cmtsave, inp = document.querySelector(`[data-cmt="${CSS.escape(id)}"]`);
    try {
      await updateDoc(doc(db, "monthly", id), { coordComment: inp.value.trim(), coordAt: serverTimestamp(), coordBy: c.myEmail() });
      inp.removeAttribute("data-editing"); c.toast("ההערה נשמרה", "good");
    } catch (e) { c.toast("השמירה נכשלה: " + (e.code || e.message), "bad"); }
  }));
}
