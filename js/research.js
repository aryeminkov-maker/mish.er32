// ===== מעקב התקדמות חוקרים =====
import {
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261020";
import { todayIso, fmtIso, addDaysIso, weekStartIso, stageProgress, uid } from "./util.js?v=20261020";

const P_STATUS = { active: "פעיל", paused: "מוקפא", done: "הושלם" };
const P_BADGE = { active: "info", paused: "warn", done: "good" };
const RS = { tab: "overview", researcher: "", week: weekStartIso(), month: todayIso().slice(0, 7), showDone: false };

// ---------- עזרים ----------
const isCoord = (c) => c.can("admin", "head", "research_coord");
const researchers = (c) => {
  const set = new Map();
  [...c.S.users.values()].filter((u) => u.role === "researcher").forEach((u) => set.set(u.id, u.name || u.id));
  [...c.S.projects.values(), ...c.S.tasks.values()].forEach((p) => { if (p.researcherEmail && !set.has(p.researcherEmail)) set.set(p.researcherEmail, c.userName(p.researcherEmail)); });
  return [...set.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name, "he"));
};
const projectsOf = (c, email) => [...c.S.projects.values()].filter((p) => !email || p.researcherEmail === email);
const tasksOf = (c, email) => [...c.S.tasks.values()].filter((t) => !email || t.researcherEmail === email);
const hoursOf = (c, email) => [...c.S.hours.values()].filter((h) => !email || h.researcherEmail === email);
const overdue = (iso) => iso && iso < todayIso();
const projTitle = (c, id) => c.S.projects.get(id)?.title || "";
const sum = (arr) => Math.round(arr.reduce((a, h) => a + (Number(h.hours) || 0), 0) * 100) / 100;
const weekLabel = (w) => `${fmtIso(w)} – ${fmtIso(addDaysIso(w, 6))}`;

function bar(pct) {
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}
function stageBadges(p) {
  const late = (p.stages || []).filter((s) => !s.done && overdue(s.due)).length;
  return late ? `<span class="badge bad">${late} שלבים באיחור</span>` : "";
}

// ---------- סיכום לדף הראשי ----------
export function researchSummary(c) {
  const ps = projectsOf(c).filter((p) => p.status === "active");
  const lateTasks = tasksOf(c).filter((t) => t.status !== "done" && overdue(t.due)).length;
  const rs = researchers(c);
  const week = weekStartIso();
  const missing = rs.filter((r) => !c.S.reports.get(`${r.email}_${week}`)).length;
  return `<div class="card">
    <div class="row space"><h2>מחקר</h2><button data-go="research">למעקב המחקר</button></div>
    <div class="stats" style="margin:0">
      <div class="stat"><div class="num">${ps.length}</div><div class="lbl">פרויקטים פעילים</div></div>
      <div class="stat"><div class="num">${lateTasks}</div><div class="lbl">משימות באיחור</div></div>
      <div class="stat"><div class="num">${missing}/${rs.length}</div><div class="lbl">חסר דיווח השבוע</div></div>
    </div></div>`;
}

// ---------- כניסה ----------
export function renderResearch(c, full) {
  if (!full && document.querySelector("[data-editing]")) return; // לא לדרוס טופס בעריכה
  if (isCoord(c)) renderCoordinator(c); else renderResearcher(c);
}

// ======================================================
// תצוגת חוקר
// ======================================================
function renderResearcher(c) {
  const me = c.myEmail();
  const ps = projectsOf(c, me).filter((p) => p.status !== "done");
  const ts = tasksOf(c, me);
  const open = ts.filter((t) => t.status !== "done").sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  const done = ts.filter((t) => t.status === "done");
  const week = weekStartIso();
  const rep = c.S.reports.get(`${me}_${week}`) || {};
  const hs = hoursOf(c, me);
  const weekHours = sum(hs.filter((h) => h.date >= week && h.date <= addDaysIso(week, 6)));
  const monthHours = sum(hs.filter((h) => (h.date || "").startsWith(RS.month)));

  c.$("main").innerHTML = `
    <h1>המחקר שלי</h1>
    <div class="stats">
      <div class="stat"><div class="num">${ps.length}</div><div class="lbl">פרויקטים פעילים</div></div>
      <div class="stat"><div class="num">${open.length}</div><div class="lbl">משימות פתוחות</div></div>
      <div class="stat"><div class="num">${open.filter((t) => overdue(t.due)).length}</div><div class="lbl">באיחור</div></div>
      <div class="stat"><div class="num">${weekHours}</div><div class="lbl">שעות השבוע</div></div>
    </div>
    <div class="split">
      <div>
        <div class="card">
          <h2>דיווח שבועי · ${weekLabel(week)}</h2>
          ${rep.coordComment ? `<div class="context"><b>הערת הרכז:</b> ${c.esc(rep.coordComment)}</div>` : ""}
          <div class="field"><label for="rDid">מה עשיתי השבוע</label><textarea id="rDid">${c.esc(rep.did)}</textarea></div>
          <div class="field"><label for="rNext">מה מתוכנן לשבוע הבא</label><textarea id="rNext">${c.esc(rep.next)}</textarea></div>
          <div class="field"><label for="rBlock">קשיים / צריך עזרה</label><textarea id="rBlock" style="min-height:60px">${c.esc(rep.blockers)}</textarea></div>
          <div class="row"><button class="primary" id="rSave">${rep.week ? "עדכון הדיווח" : "שליחת הדיווח"}</button>
            ${rep.updatedAt ? `<span class="small muted">נשמר ${c.fmtDate(rep.updatedAt)}</span>` : ""}</div>
          ${pastReports(c, me, week)}
        </div>
        <div class="card">
          <h2>המשימות שלי</h2>
          <div id="myTasks">${open.map((t) => taskRow(c, t, true)).join("") || '<p class="muted">אין משימות פתוחות</p>'}</div>
          ${done.length ? `<details><summary class="small">משימות שהושלמו (${done.length})</summary>${done.map((t) => taskRow(c, t, true)).join("")}</details>` : ""}
        </div>
      </div>
      <div>
        <div class="card">
          <h2>דיווח שעות</h2>
          <div class="grid2">
            <div class="field"><label for="hDate">תאריך</label><input id="hDate" type="date" value="${todayIso()}"></div>
            <div class="field"><label for="hHours">שעות</label><input id="hHours" type="number" min="0.25" max="24" step="0.25"></div>
            <div class="field"><label for="hProj">פרויקט</label><select id="hProj">${projectsOf(c, me).map((p) => `<option value="${p.id}">${c.esc(p.title)}</option>`).join("")}<option value="">כללי</option></select></div>
            <div class="field"><label for="hNote">הערה</label><input id="hNote"></div>
          </div>
          <button id="hAdd">הוספה</button>
          <p class="small muted" style="margin-top:10px">החודש: ${monthHours} שעות</p>
          ${hoursList(c, hs.filter((h) => (h.date || "").startsWith(RS.month)), true)}
        </div>
        <div class="card">
          <h2>הפרויקטים שלי</h2>
          ${ps.map((p) => projectCard(c, p, "researcher")).join("") || '<p class="muted">עדיין לא שויכו לך פרויקטים</p>'}
        </div>
      </div>
    </div>`;

  c.$("rSave").onclick = () => saveReport(c, week, rep);
  c.$("hAdd").onclick = () => addHours(c, me);
  bindCommon(c);
  ["rDid", "rNext", "rBlock", "hHours", "hNote"].forEach((id) => c.$(id).addEventListener("input", (e) => e.target.setAttribute("data-editing", "1")));
}

function pastReports(c, me, week) {
  const list = [...c.S.reports.values()].filter((r) => r.researcherEmail === me && r.week !== week).sort((a, b) => b.week.localeCompare(a.week));
  if (!list.length) return "";
  return `<details style="margin-top:12px"><summary class="small">דיווחים קודמים (${list.length})</summary>
    ${list.map((r) => reportView(c, r)).join("")}</details>`;
}
function reportView(c, r) {
  return `<div class="report"><div class="small muted">${weekLabel(r.week)}</div>
    ${r.did ? `<p><b>עשיתי:</b> ${c.esc(r.did)}</p>` : ""}${r.next ? `<p><b>מתוכנן:</b> ${c.esc(r.next)}</p>` : ""}
    ${r.blockers ? `<p class="bad-text"><b>קשיים:</b> ${c.esc(r.blockers)}</p>` : ""}
    ${r.coordComment ? `<p class="small"><b>הערת הרכז:</b> ${c.esc(r.coordComment)}</p>` : ""}</div>`;
}

async function saveReport(c, week, rep) {
  const me = c.myEmail();
  const data = { did: c.$("rDid").value.trim(), next: c.$("rNext").value.trim(), blockers: c.$("rBlock").value.trim(), updatedAt: serverTimestamp() };
  if (!data.did && !data.next) return c.toast("נא למלא לפחות מה עשית או מה מתוכנן", "bad");
  try {
    if (rep.week) await updateDoc(doc(db, "reports", `${me}_${week}`), data);
    else await setDoc(doc(db, "reports", `${me}_${week}`), { ...data, researcherEmail: me, week, createdAt: serverTimestamp() });
    c.toast("הדיווח נשמר", "good");
    document.querySelectorAll("[data-editing]").forEach((e) => e.removeAttribute("data-editing"));
  } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
}

async function addHours(c, email) {
  const hours = Number(c.$("hHours").value);
  if (!hours || hours <= 0 || hours > 24) return c.toast("נא להזין מספר שעות תקין", "bad");
  try {
    await addDoc(collection(db, "hours"), {
      researcherEmail: email, date: c.$("hDate").value || todayIso(), hours, projectId: c.$("hProj").value,
      note: c.$("hNote").value.trim(), createdAt: serverTimestamp()
    });
    c.toast("נוסף", "good");
    c.$("hHours").value = ""; c.$("hNote").value = "";
    document.querySelectorAll("[data-editing]").forEach((e) => e.removeAttribute("data-editing"));
  } catch (e) { c.toast("ההוספה נכשלה: " + e.code, "bad"); }
}

function hoursList(c, list, canDelete) {
  if (!list.length) return "";
  return `<div class="table-wrap"><table><thead><tr><th>תאריך</th><th>שעות</th><th>פרויקט</th><th>הערה</th><th></th></tr></thead><tbody>
    ${list.sort((a, b) => b.date.localeCompare(a.date)).map((h) => `<tr><td>${fmtIso(h.date)}</td><td>${h.hours}</td><td>${c.esc(projTitle(c, h.projectId) || "כללי")}</td><td>${c.esc(h.note)}</td>
      <td>${canDelete ? `<button class="link danger" data-delhour="${h.id}" aria-label="מחיקה">✕</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function taskRow(c, t, mine) {
  const late = t.status !== "done" && overdue(t.due);
  return `<div class="task ${t.status === "done" ? "done" : ""}">
    <label class="check"><input type="checkbox" data-task="${t.id}" ${t.status === "done" ? "checked" : ""}>
      <span><b>${c.esc(t.title)}</b>${t.projectId ? ` <span class="badge">${c.esc(projTitle(c, t.projectId))}</span>` : ""}
      ${!mine ? ` <span class="badge brand">${c.esc(c.userName(t.researcherEmail))}</span>` : ""}</span></label>
    ${t.details ? `<div class="small pre">${c.esc(t.details)}</div>` : ""}
    <div class="small ${late ? "bad-text" : "muted"}">${t.due ? `יעד: ${fmtIso(t.due)}${late ? " · באיחור" : ""}` : "ללא תאריך יעד"}${t.doneAt ? ` · הושלם ${c.fmtDate(t.doneAt)}` : ""}</div>
    ${!mine ? `<div class="row" style="margin-top:4px"><button class="link" data-edittask="${t.id}">עריכה</button><button class="link danger" data-deltask="${t.id}">מחיקה</button></div>` : ""}
  </div>`;
}

function projectCard(c, p, mode) {
  const pct = stageProgress(p.stages);
  const coord = mode === "coord";
  return `<div class="project">
    <div class="row space"><b>${c.esc(p.title)}</b>
      <span><span class="badge ${P_BADGE[p.status] || ""}">${P_STATUS[p.status] || ""}</span>${stageBadges(p)}</span></div>
    ${coord ? `<div class="small muted">${c.esc(c.userName(p.researcherEmail))}</div>` : ""}
    ${p.description ? `<div class="small pre">${c.esc(p.description)}</div>` : ""}
    <div class="row" style="margin:6px 0">${bar(pct)}<span class="small">${pct}%</span>
      ${p.dueDate ? `<span class="small ${p.status !== "done" && overdue(p.dueDate) ? "bad-text" : "muted"}">יעד ${fmtIso(p.dueDate)}</span>` : ""}</div>
    <ul class="stages">${(p.stages || []).map((s) => `<li class="${s.done ? "done" : ""}">
      <label class="check"><input type="checkbox" data-stage="${p.id}|${s.id}" ${s.done ? "checked" : ""}> <span>${c.esc(s.name)}</span></label>
      ${s.due ? `<span class="small ${!s.done && overdue(s.due) ? "bad-text" : "muted"}">${fmtIso(s.due)}</span>` : ""}</li>`).join("")}</ul>
    ${p.researcherNote ? `<div class="small"><b>הערת החוקר:</b> ${c.esc(p.researcherNote)}</div>` : ""}
    <div class="row" style="margin-top:6px">
      ${coord ? `<button class="link" data-editproj="${p.id}">עריכה</button>` : `<button class="link" data-noteproj="${p.id}">הערה לרכז</button>`}
    </div>
  </div>`;
}

// אירועים משותפים לשתי התצוגות
function bindCommon(c) {
  document.querySelectorAll("[data-task]").forEach((cb) => (cb.onchange = async () => {
    const done = cb.checked;
    try { await updateDoc(doc(db, "tasks", cb.dataset.task), { status: done ? "done" : "open", doneAt: done ? serverTimestamp() : null }); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); cb.checked = !done; }
  }));
  document.querySelectorAll("[data-stage]").forEach((cb) => (cb.onchange = async () => {
    const [pid, sid] = cb.dataset.stage.split("|");
    const p = c.S.projects.get(pid); if (!p) return;
    const stages = (p.stages || []).map((s) => (s.id === sid ? { ...s, done: cb.checked, doneAt: cb.checked ? todayIso() : "" } : s));
    try { await updateDoc(doc(db, "projects", pid), { stages, updatedAt: serverTimestamp() }); }
    catch (e) { c.toast("העדכון נכשל: " + e.code, "bad"); cb.checked = !cb.checked; }
  }));
  document.querySelectorAll("[data-delhour]").forEach((b) => (b.onclick = async () => {
    if (!confirm("למחוק את הרשומה?")) return;
    try { await deleteDoc(doc(db, "hours", b.dataset.delhour)); } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
  }));
  document.querySelectorAll("[data-noteproj]").forEach((b) => (b.onclick = () => {
    const p = c.S.projects.get(b.dataset.noteproj);
    c.openModal(`<div class="head"><h2>הערה לרכז · ${c.esc(p.title)}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
      <div class="field"><label for="pNote">הערה (מצב, שינויים, בקשות)</label><textarea id="pNote">${c.esc(p.researcherNote)}</textarea></div>
      <button class="primary" id="pNoteSave">שמירה</button>`, () => {
      c.$("pNoteSave").onclick = async () => {
        try { await updateDoc(doc(db, "projects", p.id), { researcherNote: c.$("pNote").value.trim(), updatedAt: serverTimestamp() }); c.closeModal(); c.toast("נשמר", "good"); }
        catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
      };
    });
  }));
  document.querySelectorAll("[data-editproj]").forEach((b) => (b.onclick = () => openProject(c, b.dataset.editproj)));
  document.querySelectorAll("[data-edittask]").forEach((b) => (b.onclick = () => openTask(c, b.dataset.edittask)));
  document.querySelectorAll("[data-deltask]").forEach((b) => (b.onclick = async () => {
    if (!confirm("למחוק את המשימה?")) return;
    try { await deleteDoc(doc(db, "tasks", b.dataset.deltask)); } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
  }));
}

// ======================================================
// תצוגת רכז
// ======================================================
function renderCoordinator(c) {
  const tabs = [["overview", "סקירה"], ["projects", "פרויקטים"], ["tasks", "משימות"], ["reports", "דיווחים שבועיים"], ["hours", "שעות"]];
  const rs = researchers(c);
  c.$("main").innerHTML = `
    <div class="row space"><h1>מעקב מחקר</h1>
      <div class="row"><button class="primary" id="newProj">+ פרויקט</button><button id="newTask">+ משימה</button></div></div>
    <div class="tabs" id="rTabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${RS.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${RS.tab !== "overview" ? `<div class="card"><div class="row">
      <label for="rFilter" class="small" style="margin:0">חוקר:</label>
      <select id="rFilter" style="width:auto"><option value="">כל החוקרים</option>${rs.map((r) => `<option value="${c.esc(r.email)}" ${RS.researcher === r.email ? "selected" : ""}>${c.esc(r.name)}</option>`).join("")}</select>
      ${RS.tab === "projects" || RS.tab === "tasks" ? `<label class="check small" style="margin:0"><input type="checkbox" id="showDone" ${RS.showDone ? "checked" : ""}> להציג גם שהושלמו</label>` : ""}
    </div></div>` : ""}
    <div id="rBody"></div>`;
  c.$("rTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => { RS.tab = b.dataset.tab; renderCoordinator(c); }));
  if (c.$("rFilter")) c.$("rFilter").onchange = (e) => { RS.researcher = e.target.value; renderCoordinator(c); };
  if (c.$("showDone")) c.$("showDone").onchange = (e) => { RS.showDone = e.target.checked; renderCoordinator(c); };
  c.$("newProj").onclick = () => openProject(c, null);
  c.$("newTask").onclick = () => openTask(c, null);
  ({ overview: coordOverview, projects: coordProjects, tasks: coordTasks, reports: coordReports, hours: coordHours })[RS.tab](c, rs);
  bindCommon(c);
}

function coordOverview(c, rs) {
  const week = weekStartIso();
  const rows = rs.map((r) => {
    const ps = projectsOf(c, r.email).filter((p) => p.status === "active");
    const avg = ps.length ? Math.round(ps.reduce((a, p) => a + stageProgress(p.stages), 0) / ps.length) : 0;
    const lateStages = ps.reduce((a, p) => a + (p.stages || []).filter((s) => !s.done && overdue(s.due)).length, 0);
    const ts = tasksOf(c, r.email).filter((t) => t.status !== "done");
    const lateT = ts.filter((t) => overdue(t.due)).length;
    const rep = c.S.reports.get(`${r.email}_${week}`);
    const last = [...c.S.reports.values()].filter((x) => x.researcherEmail === r.email).sort((a, b) => b.week.localeCompare(a.week))[0];
    const mh = sum(hoursOf(c, r.email).filter((h) => (h.date || "").startsWith(todayIso().slice(0, 7))));
    return `<tr class="click" data-r="${c.esc(r.email)}">
      <td><b>${c.esc(r.name)}</b></td><td>${ps.length}</td>
      <td><div class="row" style="flex-wrap:nowrap">${bar(avg)}<span class="small">${avg}%</span></div></td>
      <td>${lateStages ? `<span class="badge bad">${lateStages}</span>` : "0"}</td>
      <td>${ts.length}${lateT ? ` <span class="badge bad">${lateT} באיחור</span>` : ""}</td>
      <td>${rep ? '<span class="badge good">הוגש</span>' : '<span class="badge warn">לא הוגש</span>'}${!rep && last ? `<div class="small muted">אחרון: ${fmtIso(last.week)}</div>` : ""}${rep?.blockers ? ' <span class="badge bad">יש קשיים</span>' : ""}</td>
      <td>${mh}</td></tr>`;
  }).join("");
  c.$("rBody").innerHTML = `<div class="card" style="padding:0"><div class="table-wrap"><table>
    <thead><tr><th>חוקר</th><th>פרויקטים פעילים</th><th>התקדמות ממוצעת</th><th>שלבים באיחור</th><th>משימות פתוחות</th><th>דיווח השבוע</th><th>שעות החודש</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="7" class="muted">עדיין אין חוקרים. מוסיפים אותם בלשונית "משתמשים" עם התפקיד "חוקר".</td></tr>`}</tbody></table></div></div>`;
  document.querySelectorAll("tr[data-r]").forEach((tr) => (tr.onclick = () => { RS.researcher = tr.dataset.r; RS.tab = "projects"; renderCoordinator(c); }));
}

function coordProjects(c) {
  const list = projectsOf(c, RS.researcher).filter((p) => RS.showDone || p.status !== "done")
    .sort((a, b) => (a.dueDate || "9").localeCompare(b.dueDate || "9"));
  c.$("rBody").innerHTML = `<div class="grid-cards">${list.map((p) => `<div class="card">${projectCard(c, p, "coord")}</div>`).join("") || '<p class="muted">אין פרויקטים</p>'}</div>`;
}

function coordTasks(c) {
  const list = tasksOf(c, RS.researcher).filter((t) => RS.showDone || t.status !== "done")
    .sort((a, b) => (a.status === "done") - (b.status === "done") || (a.due || "9").localeCompare(b.due || "9"));
  c.$("rBody").innerHTML = `<div class="card">${list.map((t) => taskRow(c, t, false)).join("") || '<p class="muted">אין משימות</p>'}</div>`;
}

function coordReports(c, rs) {
  const w = RS.week;
  const list = (RS.researcher ? rs.filter((r) => r.email === RS.researcher) : rs);
  c.$("rBody").innerHTML = `
    <div class="row" style="margin-bottom:10px"><button id="wPrev" aria-label="שבוע קודם">→</button><b>${weekLabel(w)}</b><button id="wNext" aria-label="שבוע הבא">←</button>
      ${w !== weekStartIso() ? '<button id="wNow" class="link">לשבוע הנוכחי</button>' : ""}</div>
    ${list.map((r) => {
      const rep = c.S.reports.get(`${r.email}_${w}`);
      return `<div class="card"><div class="row space"><h3 style="margin:0">${c.esc(r.name)}</h3>${rep ? '<span class="badge good">הוגש</span>' : '<span class="badge warn">לא הוגש</span>'}</div>
        ${rep ? reportView(c, rep) + `<div class="row" style="margin-top:8px"><input data-comment="${c.esc(rep.id)}" class="grow" placeholder="הערת רכז" value="${c.esc(rep.coordComment)}"><button data-savecomment="${c.esc(rep.id)}">שמירת הערה</button></div>` : ""}
      </div>`;
    }).join("") || '<p class="muted">אין חוקרים</p>'}`;
  c.$("wPrev").onclick = () => { RS.week = addDaysIso(w, -7); renderCoordinator(c); };
  c.$("wNext").onclick = () => { RS.week = addDaysIso(w, 7); renderCoordinator(c); };
  if (c.$("wNow")) c.$("wNow").onclick = () => { RS.week = weekStartIso(); renderCoordinator(c); };
  document.querySelectorAll("[data-comment]").forEach((i) => i.addEventListener("input", () => i.setAttribute("data-editing", "1")));
  document.querySelectorAll("[data-savecomment]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.savecomment;
    const val = document.querySelector(`[data-comment="${CSS.escape(id)}"]`).value.trim();
    try { await updateDoc(doc(db, "reports", id), { coordComment: val, coordAt: serverTimestamp(), coordBy: c.myEmail() }); c.toast("נשמר", "good"); }
    catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
  }));
}

function coordHours(c, rs) {
  const m = RS.month;
  const hs = hoursOf(c, RS.researcher).filter((h) => (h.date || "").startsWith(m));
  const byR = new Map();
  hs.forEach((h) => {
    const k = h.researcherEmail;
    if (!byR.has(k)) byR.set(k, new Map());
    const pk = projTitle(c, h.projectId) || "כללי";
    byR.get(k).set(pk, (byR.get(k).get(pk) || 0) + (Number(h.hours) || 0));
  });
  c.$("rBody").innerHTML = `
    <div class="card"><div class="row">
      <label for="hMonth" class="small" style="margin:0">חודש:</label><input type="month" id="hMonth" value="${m}" style="width:auto">
      <span class="grow"></span><b>סה"כ: ${sum(hs)} שעות</b><button id="hExport">ייצוא ל-Excel</button></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>חוקר</th><th>פרויקט</th><th>שעות</th></tr></thead>
      <tbody>${[...byR.entries()].flatMap(([r, pm]) => [...pm.entries()].map(([p, h]) => `<tr><td>${c.esc(c.userName(r))}</td><td>${c.esc(p)}</td><td>${Math.round(h * 100) / 100}</td></tr>`)).join("") || '<tr><td colspan="3" class="muted">אין דיווחים בחודש הזה</td></tr>'}</tbody>
    </table></div></div>`;
  c.$("hMonth").onchange = (e) => { RS.month = e.target.value || todayIso().slice(0, 7); renderCoordinator(c); };
  c.$("hExport").onclick = () => c.exportXlsx(hs.sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({
    "חוקר": c.userName(h.researcherEmail), "תאריך": fmtIso(h.date), "פרויקט": projTitle(c, h.projectId) || "כללי", "שעות": h.hours, "הערה": h.note || ""
  })), `שעות-מחקר-${m}.xlsx`);
}

// ---------- עריכת פרויקט ----------
function openProject(c, id) {
  const p = id ? c.S.projects.get(id) : { status: "active", stages: [], researcherEmail: RS.researcher };
  let stages = JSON.parse(JSON.stringify(p.stages || []));
  const rs = researchers(c);
  c.openModal(`
    <div class="head"><h2>${id ? "עריכת פרויקט" : "פרויקט חדש"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="pTitle">שם הפרויקט</label><input id="pTitle" value="${c.esc(p.title)}"></div>
      <div class="field"><label for="pR">חוקר</label><select id="pR"><option value="">בחירה...</option>${rs.map((r) => `<option value="${c.esc(r.email)}" ${p.researcherEmail === r.email ? "selected" : ""}>${c.esc(r.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="pStart">התחלה</label><input id="pStart" type="date" value="${p.startDate || ""}"></div>
      <div class="field"><label for="pDue">יעד סיום</label><input id="pDue" type="date" value="${p.dueDate || ""}"></div>
      <div class="field"><label for="pStatus">סטטוס</label><select id="pStatus">${Object.entries(P_STATUS).map(([k, v]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label for="pDesc">תיאור</label><textarea id="pDesc">${c.esc(p.description)}</textarea></div>
    <h3>שלבים</h3>
    <div id="pStages"></div>
    <button id="addStage" style="margin-top:6px">+ שלב</button>
    <div class="row space" style="margin-top:16px"><button class="primary" id="pSave">שמירה</button>${id ? '<button class="danger" id="pDel">מחיקת הפרויקט</button>' : ""}</div>`, () => {
    const draw = () => {
      c.$("pStages").innerHTML = stages.map((s, i) => `<div class="cond" data-i="${i}">
        <input type="checkbox" data-k="done" ${s.done ? "checked" : ""} aria-label="הושלם">
        <input data-k="name" value="${c.esc(s.name)}" placeholder="שם השלב" style="flex:1">
        <input data-k="due" type="date" value="${s.due || ""}" aria-label="תאריך יעד">
        <button data-k="up" ${i === 0 ? "disabled" : ""} aria-label="למעלה">▲</button>
        <button data-k="del" class="danger" aria-label="מחיקה">✕</button></div>`).join("") || '<p class="small muted">אין שלבים. ההתקדמות מחושבת לפי השלבים שהושלמו.</p>';
      c.$("pStages").querySelectorAll(".cond").forEach((row) => {
        const i = Number(row.dataset.i);
        row.querySelector('[data-k="done"]').onchange = (e) => { stages[i].done = e.target.checked; };
        row.querySelector('[data-k="name"]').oninput = (e) => { stages[i].name = e.target.value; };
        row.querySelector('[data-k="due"]').onchange = (e) => { stages[i].due = e.target.value; };
        row.querySelector('[data-k="up"]').onclick = () => { const s = stages.splice(i, 1)[0]; stages.splice(i - 1, 0, s); draw(); };
        row.querySelector('[data-k="del"]').onclick = () => { stages.splice(i, 1); draw(); };
      });
    };
    draw();
    c.$("addStage").onclick = () => { stages.push({ id: uid(), name: "", due: "", done: false }); draw(); };
    c.$("pSave").onclick = async () => {
      const data = {
        title: c.$("pTitle").value.trim(), researcherEmail: c.$("pR").value, startDate: c.$("pStart").value, dueDate: c.$("pDue").value,
        status: c.$("pStatus").value, description: c.$("pDesc").value.trim(),
        stages: stages.filter((s) => s.name.trim()).map((s) => ({ id: s.id || uid(), name: s.name.trim(), due: s.due || "", done: !!s.done, doneAt: s.doneAt || "" })),
        updatedAt: serverTimestamp()
      };
      if (!data.title) return c.toast("נא למלא שם פרויקט", "bad");
      if (!data.researcherEmail) return c.toast("נא לבחור חוקר", "bad");
      try {
        if (id) await updateDoc(doc(db, "projects", id), data);
        else await addDoc(collection(db, "projects"), { ...data, researcherNote: "", createdBy: c.myEmail(), createdAt: serverTimestamp() });
        c.toast("נשמר", "good"); c.closeModal();
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
    if (c.$("pDel")) c.$("pDel").onclick = async () => {
      if (!confirm("למחוק את הפרויקט? משימות ושעות שקשורות אליו יישארו.")) return;
      try { await deleteDoc(doc(db, "projects", id)); c.closeModal(); } catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ---------- עריכת משימה ----------
function openTask(c, id) {
  const t = id ? c.S.tasks.get(id) : { researcherEmail: RS.researcher, status: "open" };
  const rs = researchers(c);
  const projOpts = (email, cur) => `<option value="">ללא פרויקט</option>` + projectsOf(c, email).map((p) => `<option value="${p.id}" ${cur === p.id ? "selected" : ""}>${c.esc(p.title)}</option>`).join("");
  c.openModal(`
    <div class="head"><h2>${id ? "עריכת משימה" : "משימה חדשה"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="grid2">
      <div class="field"><label for="tR">חוקר</label><select id="tR"><option value="">בחירה...</option>${rs.map((r) => `<option value="${c.esc(r.email)}" ${t.researcherEmail === r.email ? "selected" : ""}>${c.esc(r.name)}</option>`).join("")}</select></div>
      <div class="field"><label for="tP">פרויקט</label><select id="tP">${projOpts(t.researcherEmail, t.projectId)}</select></div>
      <div class="field"><label for="tTitle">משימה</label><input id="tTitle" value="${c.esc(t.title)}"></div>
      <div class="field"><label for="tDue">תאריך יעד</label><input id="tDue" type="date" value="${t.due || ""}"></div>
    </div>
    <div class="field"><label for="tDetails">פירוט</label><textarea id="tDetails">${c.esc(t.details)}</textarea></div>
    <button class="primary" id="tSave">שמירה</button>`, () => {
    c.$("tR").onchange = (e) => { c.$("tP").innerHTML = projOpts(e.target.value, ""); };
    c.$("tSave").onclick = async () => {
      const data = { researcherEmail: c.$("tR").value, projectId: c.$("tP").value, title: c.$("tTitle").value.trim(), due: c.$("tDue").value, details: c.$("tDetails").value.trim() };
      if (!data.researcherEmail || !data.title) return c.toast("נא לבחור חוקר ולכתוב משימה", "bad");
      try {
        if (id) await updateDoc(doc(db, "tasks", id), data);
        else await addDoc(collection(db, "tasks"), { ...data, status: "open", doneAt: null, researcherNote: "", createdBy: c.myEmail(), createdAt: serverTimestamp() });
        c.toast("נשמר", "good"); c.closeModal();
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
  });
}
