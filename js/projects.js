// ===== סטטוס פרויקטים (מנהל מערכת + מי שפרויקט שותף איתו) =====
// מסמך: mgmtProjects/{id}
// { title, desc, owner, dueDate, priority, stage, health, tasks:[{id,text,who,due,done}], milestones:[{id,text,done}],
//   links:[{title,url}], tags:[], sharedWith:[emails], log:[{at,by,text,health,next}], updatedAt, updatedBy }
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261106";
import { todayIso, fmtIso, uid, norm } from "./util.js?v=20261106";

export const STAGES = { idea: "רעיון", planning: "בתכנון", doing: "בביצוע", waiting: "ממתין", done: "הושלם" };
export const HEALTH = { ok: "🟢 במסלול", risk: "🟡 בסיכון", stuck: "🔴 תקוע", paused: "⚪ מושהה" };
const HEALTH_BADGE = { ok: "good", risk: "warn", stuck: "bad", paused: "" };
const PRIORITY = { high: "גבוהה", normal: "רגילה", low: "נמוכה" };
const PR_ORDER = { high: 0, normal: 1, low: 2 };
const STALE_DAYS = 14;
const PS = { search: "", stage: "open", health: "", owner: "", tag: "", sort: "due" };

const daysSince = (c, t) => { const d = c.toDate(t); return d ? Math.floor((Date.now() - d.getTime()) / 864e5) : null; };
const progress = (p) => { const m = p.milestones || []; return m.length ? Math.round((m.filter((x) => x.done).length / m.length) * 100) : null; };
const overdue = (p) => p.stage !== "done" && p.dueDate && p.dueDate < todayIso();
const stale = (c, p) => p.stage !== "done" && (daysSince(c, p.updatedAt) ?? 0) > STALE_DAYS;
// משימות לביצוע (פרויקט ישן עם "השלב הבא" בודד – הופך למשימה)
const tasksOf = (p) => p.tasks || (p.nextStep?.text ? [{ id: "ns", text: p.nextStep.text, who: p.nextStep.who || "", due: p.nextStep.due || "", done: false }] : []);
const openTasks = (p) => tasksOf(p).filter((t) => !t.done && t.text).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
const late = (t) => t.due && t.due < todayIso();
const ago = (n) => (n === null ? "" : n === 0 ? "היום" : n === 1 ? "אתמול" : `לפני ${n} ימים`);

export function renderProjects(c, full) {
  if (!full && document.querySelector("[data-editing]")) return;
  const isAdmin = c.can("admin");
  const all = [...c.S.projects.values()];
  const open = all.filter((p) => p.stage !== "done");
  const owners = [...new Set([...all.map((p) => p.owner), ...all.flatMap((p) => openTasks(p).map((t) => t.who))].filter(Boolean))].sort();
  const tags = [...new Set(all.flatMap((p) => p.tags || []))].sort();
  const t = norm(PS.search);
  let list = all.filter((p) => (PS.stage === "all" || (PS.stage === "open" ? p.stage !== "done" : p.stage === PS.stage))
    && (!PS.health || p.health === PS.health) && (!PS.owner || p.owner === PS.owner || openTasks(p).some((t) => t.who === PS.owner)) && (!PS.tag || (p.tags || []).includes(PS.tag))
    && (!t || norm(`${p.title} ${p.desc} ${p.owner} ${tasksOf(p).map((x) => `${x.text} ${x.who}`).join(" ")} ${(p.tags || []).join(" ")}`).includes(t)));
  const sorters = {
    due: (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
    priority: (a, b) => (PR_ORDER[a.priority] ?? 1) - (PR_ORDER[b.priority] ?? 1) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
    updated: (a, b) => (c.toDate(a.updatedAt)?.getTime() || 0) - (c.toDate(b.updatedAt)?.getTime() || 0),
    health: (a, b) => ["stuck", "risk", "ok", "paused"].indexOf(a.health) - ["stuck", "risk", "ok", "paused"].indexOf(b.health)
  };
  list = list.sort(sorters[PS.sort]);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const dueSoon = open.filter((p) => openTasks(p).some((t) => t.due && t.due <= weekEnd) || (p.dueDate && p.dueDate >= todayIso() && p.dueDate <= weekEnd));
  c.$("main").innerHTML = `
    <div class="row space"><h1>פרויקטים</h1>
      <div class="row">${isAdmin ? '<button class="primary" id="pjNew">+ פרויקט</button><button id="pjWa">📲 סיכום משימות לכל אחד (וואטסאפ)</button>' : ""}<button id="pjExport">ייצוא ל-Excel</button><button id="pjPrint">הדפסה</button></div></div>
    <details class="card pj-howto no-print"><summary><b>איך עובדים עם המסך הזה?</b></summary>
      <ul>
        <li><b>פרויקט</b> – כל יוזמה גדולה (פודקאסט, כנס, ספר). לוחצים על שורה כדי לפתוח ולעדכן.</li>
        <li><b>שלב</b> – איפה הפרויקט עומד (בתכנון, בביצוע, ממתין, הושלם). <b>מצב</b> – האם הוא מתקדם כמו שצריך (במסלול / בסיכון / תקוע).</li>
        <li><b>משימות לביצוע</b> – הפעולות הקרובות, לכל אחת אחראי ותאריך. מהן נבנה <b>סיכום המשימות בוואטסאפ</b> לכל אחד.</li>
        <li><b>אבני דרך</b> – השלבים הגדולים בדרך לסיום; מהן מחושב אחוז ה<b>התקדמות</b>.</li>
        <li><b>יומן עדכונים</b> – מה קרה ומתי. שינויים נרשמים בו גם אוטומטית.</li>
        <li>המספרים למעלה מראים מה דורש תשומת לב: תקועים, באיחור ופרויקטים שלא עודכנו זמן רב.</li>
      </ul></details>
    <div class="stats">
      <div class="stat"><div class="num">${open.length}</div><div class="lbl">פרויקטים פתוחים</div></div>
      <div class="stat"><div class="num ${open.some((p) => ["stuck", "risk"].includes(p.health)) ? "bad-text" : ""}">${open.filter((p) => ["stuck", "risk"].includes(p.health)).length}</div><div class="lbl">תקועים / בסיכון</div></div>
      <div class="stat"><div class="num ${open.some(overdue) ? "bad-text" : ""}">${open.filter(overdue).length}</div><div class="lbl">עבר תאריך היעד</div></div>
      <div class="stat"><div class="num">${open.filter((p) => stale(c, p)).length}</div><div class="lbl">לא עודכנו ${STALE_DAYS}+ ימים</div></div>
      <div class="stat"><div class="num">${dueSoon.length}</div><div class="lbl">יעדים בשבוע הקרוב</div></div>
    </div>
    <div class="card no-print"><div class="row">
      <input id="pjSearch" placeholder="חיפוש" value="${c.esc(PS.search)}" style="width:170px" aria-label="חיפוש פרויקטים">
      <select id="pjStage" style="width:auto" aria-label="שלב"><option value="open" ${PS.stage === "open" ? "selected" : ""}>כל הפתוחים</option><option value="all" ${PS.stage === "all" ? "selected" : ""}>הכול (כולל שהושלמו)</option>
        ${Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${PS.stage === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <select id="pjHealth" style="width:auto" aria-label="מצב"><option value="">כל המצבים</option>${Object.entries(HEALTH).map(([k, v]) => `<option value="${k}" ${PS.health === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      ${owners.length ? `<select id="pjOwner" style="width:auto" aria-label="אחראי"><option value="">כל האחראים (פרויקט או משימה)</option>${owners.map((o) => `<option ${PS.owner === o ? "selected" : ""}>${c.esc(o)}</option>`).join("")}</select>` : ""}
      ${tags.length ? `<select id="pjTag" style="width:auto" aria-label="תגית"><option value="">כל התגיות</option>${tags.map((o) => `<option ${PS.tag === o ? "selected" : ""}>${c.esc(o)}</option>`).join("")}</select>` : ""}
      <span class="grow"></span>
      <label class="small" for="pjSort">מיון</label><select id="pjSort" style="width:auto">${[["due", "תאריך יעד"], ["priority", "עדיפות"], ["health", "מצב (תקועים קודם)"], ["updated", "עודכן הכי מזמן"]].map(([k, v]) => `<option value="${k}" ${PS.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    </div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="pj-table">
      <thead><tr><th>פרויקט</th><th>שלב</th><th>מצב</th><th>התקדמות</th><th>משימות לביצוע</th><th>אחראי</th><th>יעד</th><th>עדכון אחרון</th></tr></thead>
      <tbody>${list.map((p) => {
        const pr = progress(p), d = daysSince(c, p.updatedAt);
        return `<tr class="click" data-pj="${p.id}">
          <td><b>${c.esc(p.title)}</b>${p.priority === "high" ? ' <span class="badge bad">עדיפות גבוהה</span>' : ""}
            ${(p.tags || []).map((g) => `<span class="badge">${c.esc(g)}</span>`).join(" ")}${(p.sharedWith || []).length ? ` <span class="small muted" title="${c.esc(p.sharedWith.join(", "))}">👥 ${p.sharedWith.length}</span>` : ""}</td>
          <td>${STAGES[p.stage] || ""}</td>
          <td><span class="badge ${HEALTH_BADGE[p.health] || ""}">${HEALTH[p.health] || ""}</span></td>
          <td>${pr === null ? '<span class="muted">—</span>' : `<div class="row" style="flex-wrap:nowrap;gap:6px"><div class="progress"><span style="width:${pr}%"></span></div><span class="small">${pr}%</span></div>`}</td>
          <td>${(() => { const ot = openTasks(p); return ot.length ? `<ul class="task-mini">${ot.slice(0, 3).map((t) => `<li>${c.esc(t.text)}<span class="small muted">${t.who ? " · " + c.esc(t.who) : ""}${t.due ? " · " + fmtIso(t.due).slice(0, 5) : ""}</span>${late(t) && p.stage !== "done" ? ' <span class="bad-text small">באיחור</span>' : ""}</li>`).join("")}</ul>${ot.length > 3 ? `<span class="small muted">ועוד ${ot.length - 3}</span>` : ""}` : '<span class="muted">—</span>'; })()}</td>
          <td>${c.esc(p.owner || "")}</td>
          <td class="nowrap ${overdue(p) ? "bad-text" : ""}">${p.dueDate ? fmtIso(p.dueDate) : "—"}</td>
          <td class="small nowrap ${stale(c, p) ? "bad-text" : "muted"}">${ago(d)}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="muted">${all.length ? "אין פרויקטים שמתאימים לסינון" : "עדיין אין פרויקטים"}</td></tr>`}</tbody></table></div></div>
    <p class="small muted">באדום: יעד שעבר, משימה באיחור, או פרויקט שלא עודכן ${STALE_DAYS} ימים. לחיצה על שורה פותחת את הפרויקט.</p>`;
  const set = (k) => (e) => { PS[k] = e.target.value; renderProjects(c, true); };
  c.$("pjStage").onchange = set("stage"); c.$("pjHealth").onchange = set("health"); c.$("pjSort").onchange = set("sort");
  if (c.$("pjOwner")) c.$("pjOwner").onchange = set("owner");
  if (c.$("pjTag")) c.$("pjTag").onchange = set("tag");
  c.$("pjSearch").oninput = (e) => { PS.search = e.target.value; const pos = e.target.selectionStart; renderProjects(c, true); c.$("pjSearch").focus(); c.$("pjSearch").setSelectionRange(pos, pos); };
  if (c.$("pjNew")) c.$("pjNew").onclick = () => openProject(c, null);
  if (c.$("pjWa")) c.$("pjWa").onclick = () => openTasksSummary(c);
  c.$("pjPrint").onclick = () => window.print();
  c.$("pjExport").onclick = () => c.exportXlsx(list.map((p) => ({
    "פרויקט": p.title, "תיאור": p.desc || "", "שלב": STAGES[p.stage] || "", "מצב": (HEALTH[p.health] || "").replace(/^\S+\s/, ""), "עדיפות": PRIORITY[p.priority] || "",
    "התקדמות": progress(p) === null ? "" : progress(p) + "%",
    "משימות פתוחות": openTasks(p).map((t) => `${t.text}${t.who ? ` (${t.who}` + (t.due ? `, עד ${fmtIso(t.due)})` : ")") : t.due ? ` (עד ${fmtIso(t.due)})` : ""}`).join("; "),
    "אחראי": p.owner || "", "תאריך יעד": p.dueDate ? fmtIso(p.dueDate) : "", "עדכון אחרון": c.fmtDate(p.updatedAt), "תגיות": (p.tags || []).join(", ")
  })), "פרויקטים.xlsx");
  document.querySelectorAll("[data-pj]").forEach((tr) => (tr.onclick = () => openProject(c, tr.dataset.pj)));
}

function openProject(c, id) {
  const isAdmin = c.can("admin");
  // עותק לעריכה (בלי לשבור את ה-Timestamp שביומן העדכונים)
  const o = id ? c.S.projects.get(id) : null;
  const p = o ? { ...o, milestones: (o.milestones || []).map((m) => ({ ...m })), tasks: tasksOf(o).map((t) => ({ ...t, id: t.id === "ns" ? uid() : t.id })), links: [...(o.links || [])], tags: [...(o.tags || [])], sharedWith: [...(o.sharedWith || [])], log: [...(o.log || [])] } : { stage: "planning", health: "ok", priority: "normal", milestones: [], links: [], tags: [], sharedWith: [], tasks: [] };
  const team = [...c.S.users.values()].filter((u) => u.id !== c.myEmail()).sort((a, b) => c.userName(a.id).localeCompare(c.userName(b.id), "he"));
  const sel = (idn, obj, cur) => `<select id="${idn}">${Object.entries(obj).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
  const people = [...new Set([...[...c.S.projects.values()].flatMap((x) => [x.owner, ...tasksOf(x).map((t) => t.who)]), ...[...c.S.users.values()].map((u) => u.name)].filter(Boolean))].sort();
  const tkHtml = () => (p.tasks || []).map((t) => `<div class="task-row ${t.done ? "done" : ""}"><input type="checkbox" data-tkdone="${t.id}" ${t.done ? "checked" : ""} aria-label="בוצע">
      <input data-tktext="${t.id}" value="${c.esc(t.text)}" aria-label="משימה" class="grow">
      <input data-tkwho="${t.id}" value="${c.esc(t.who || "")}" list="pjOwners" placeholder="מי" aria-label="אחראי למשימה" class="tk-who">
      <input data-tkdue="${t.id}" type="date" value="${t.due || ""}" aria-label="עד מתי" class="tk-due ${late(t) && !t.done ? "late" : ""}">
      <button class="link danger" data-tkdel="${t.id}" aria-label="מחיקת המשימה">✕</button></div>`).join("") || '<p class="small muted" style="margin:0 0 6px">אין משימות פתוחות</p>';
  const msHtml = () => (p.milestones || []).map((m) => `<div class="row ms-row" style="flex-wrap:nowrap"><input type="checkbox" data-msdone="${m.id}" ${m.done ? "checked" : ""} aria-label="הושלם">
      <input data-mstext="${m.id}" value="${c.esc(m.text)}" aria-label="אבן דרך" class="grow"><button class="link danger" data-msdel="${m.id}" aria-label="מחיקה">✕</button></div>`).join("");
  const sec = (n, title, help, body, cls = "") => `<section class="pj-sec ${cls}"><h3><span class="pj-n">${n}</span>${title}</h3><p class="pj-help">${help}</p>${body}</section>`;
  c.openModal(`
    <div class="head"><h2>${id ? c.esc(p.title) : "פרויקט חדש"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="pj-form" data-editing-root>
      ${sec(1, "פרטי הפרויקט", "מה הפרויקט, מי אחראי עליו ועד מתי הוא אמור להסתיים.", `
        <div class="field"><label for="pjTitle">שם הפרויקט</label><input id="pjTitle" value="${c.esc(p.title || "")}"></div>
        <div class="field"><label for="pjDesc">תיאור / מטרה</label><textarea id="pjDesc" style="min-height:60px">${c.esc(p.desc || "")}</textarea></div>
        <div class="grid3">
          <div class="field"><label for="pjOwnerI">אחראי על הפרויקט</label><input id="pjOwnerI" value="${c.esc(p.owner || "")}" list="pjOwners">
            <datalist id="pjOwners">${people.map((o) => `<option value="${c.esc(o)}">`).join("")}</datalist></div>
          <div class="field"><label for="pjDue">תאריך יעד לסיום</label><input id="pjDue" type="date" value="${p.dueDate || ""}"></div>
          <div class="field"><label for="pjPr">עדיפות</label>${sel("pjPr", PRIORITY, p.priority)}</div>
          <div class="field"><label for="pjStageS">שלב <span class="small muted">(איפה הפרויקט עומד)</span></label>${sel("pjStageS", STAGES, p.stage)}</div>
          <div class="field"><label for="pjHealthS">מצב <span class="small muted">(האם הוא מתקדם כמו שצריך)</span></label>${sel("pjHealthS", HEALTH, p.health)}</div>
          <div class="field"><label for="pjTags">תגיות <span class="small muted">(בפסיקים, לסינון)</span></label><input id="pjTags" value="${c.esc((p.tags || []).join(", "))}" placeholder="השתלמויות, ספרים..."></div>
        </div>`)}
      ${sec(2, "משימות לביצוע", "הפעולות הקרובות: מה צריך לעשות, מי עושה ועד מתי. מסמנים ✓ כשבוצע. מהמשימות נבנה הסיכום שנשלח בוואטסאפ לכל אחד.", `
        <div id="pjTasks">${tkHtml()}</div>
        <div class="task-row new"><span style="width:20px"></span><input id="tkNew" placeholder="משימה חדשה" class="grow" aria-label="משימה חדשה">
          <input id="tkNewWho" list="pjOwners" placeholder="מי" aria-label="מי" class="tk-who"><input id="tkNewDue" type="date" aria-label="עד מתי" class="tk-due">
          <button id="tkAdd">הוספה</button></div>`, "pj-tasks")}
      ${sec(3, "אבני דרך", "השלבים הגדולים בדרך לסיום (למשל: \"תסריט מוכן\", \"צילומים הסתיימו\"). מהן מחושב אחוז ההתקדמות שברשימה.", `
        <div id="pjMs">${msHtml()}</div>
        <div class="row"><input id="pjMsNew" placeholder="אבן דרך חדשה" class="grow" aria-label="אבן דרך חדשה"><button id="pjMsAdd">הוספה</button></div>`)}
      ${sec(4, "קישורים", "מסמכים, תיקיות בדרייב, טפסים – כל מה ששייך לפרויקט. שורה לכל קישור: כותרת | קישור", `
        <textarea id="pjLinks" style="min-height:56px" dir="auto" aria-label="קישורים" placeholder="תיקיית הפרויקט | https://drive.google.com/...">${c.esc((p.links || []).map((l) => `${l.title} | ${l.url}`).join("\n"))}</textarea>
        ${(p.links || []).length ? `<div class="row small" style="margin-top:6px">${p.links.map((l) => `<a href="${c.esc(l.url)}" target="_blank" rel="noopener">${c.esc(l.title)} ↗</a>`).join(" · ")}</div>` : ""}`)}
      ${isAdmin ? sec(5, "שיתוף", "אנשי צוות שיסומנו יראו את הפרויקט הזה (רק אותו) ויוכלו לעדכן אותו.", `
        <div class="share-list">${team.map((u) => `<label class="check"><input type="checkbox" data-share="${c.esc(u.id)}" ${(p.sharedWith || []).includes(u.id) ? "checked" : ""}> <span>${c.esc(c.userName(u.id))}</span></label>`).join("") || '<p class="muted small">אין אנשי צוות נוספים</p>'}</div>`) : ""}
      ${id ? sec(isAdmin ? 6 : 5, "יומן עדכונים", "כאן רושמים מה קרה בפרויקט (פגישה, החלטה, עיכוב). שינויים בשלב, במשימות ובאבני הדרך נרשמים כאן אוטומטית.", `
        <div class="field"><label for="upText">עדכון חדש (רשות – יישמר יחד עם לחיצה על "שמירה")</label><textarea id="upText" style="min-height:56px" placeholder="למשל: נפגשנו עם יוסף, סוכם על 6 פרקים"></textarea></div>
        <ul class="timeline">${(p.log || []).slice().reverse().map((l) => `<li><div class="when">${c.fmtDate(l.at)} · ${c.esc(c.userName(l.by))}${l.health ? ` · ${HEALTH[l.health] || ""}` : ""}</div>
          ${c.esc(l.text || "")}${l.next ? `<div class="small">משימה: ${c.esc(l.next)}</div>` : ""}</li>`).join("") || '<li class="muted">עדיין אין עדכונים</li>'}</ul>`) : ""}
      <div class="pj-actions"><button class="primary" id="pjSave">שמירה</button>${id && isAdmin ? '<button class="danger" id="pjDel">מחיקת הפרויקט</button>' : ""}</div>
    </div>`, () => {
    document.querySelectorAll("#modalRoot input, #modalRoot textarea, #modalRoot select").forEach((el) => el.addEventListener("input", () => document.querySelector("[data-editing-root]")?.setAttribute("data-editing", "1")));
    const syncMs = () => { (p.milestones || []).forEach((m) => { const t = document.querySelector(`[data-mstext="${m.id}"]`); const d = document.querySelector(`[data-msdone="${m.id}"]`); if (t) m.text = t.value; if (d) m.done = d.checked; }); };
    const drawMs = () => {
      c.$("pjMs").innerHTML = msHtml();
      document.querySelectorAll("[data-msdel]").forEach((b) => (b.onclick = () => { syncMs(); p.milestones = p.milestones.filter((m) => m.id !== b.dataset.msdel); drawMs(); }));
    };
    drawMs();
    const syncTk = () => { (p.tasks || []).forEach((t) => { const q = (k) => document.querySelector(`[data-tk${k}="${t.id}"]`); if (q("text")) { t.text = q("text").value; t.who = q("who").value.trim(); t.due = q("due").value; t.done = q("done").checked; } }); };
    const drawTk = () => {
      c.$("pjTasks").innerHTML = tkHtml();
      document.querySelectorAll("[data-tkdel]").forEach((b) => (b.onclick = () => { syncTk(); p.tasks = p.tasks.filter((t) => t.id !== b.dataset.tkdel); drawTk(); }));
      document.querySelectorAll("[data-tkdone]").forEach((b) => (b.onchange = () => b.closest(".task-row").classList.toggle("done", b.checked)));
    };
    drawTk();
    c.$("tkAdd").onclick = () => {
      const v = c.$("tkNew").value.trim(); if (!v) return c.$("tkNew").focus();
      syncTk(); p.tasks.push({ id: uid(), text: v, who: c.$("tkNewWho").value.trim(), due: c.$("tkNewDue").value, done: false });
      c.$("tkNew").value = ""; c.$("tkNewDue").value = ""; drawTk(); c.$("tkNew").focus();
      document.querySelector("[data-editing-root]")?.setAttribute("data-editing", "1");
    };
    c.$("tkNew").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); c.$("tkAdd").click(); } };
    c.$("pjMsAdd").onclick = () => { const v = c.$("pjMsNew").value.trim(); if (!v) return; syncMs(); p.milestones.push({ id: uid(), text: v, done: false }); c.$("pjMsNew").value = ""; drawMs(); c.$("pjMsNew").focus(); };
    c.$("pjMsNew").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); c.$("pjMsAdd").click(); } };
    const collect = () => {
      syncMs(); syncTk();
      if (c.$("tkNew").value.trim()) c.$("tkAdd").click(); // משימה שנכתבה ולא נלחץ "הוספה"
      const links = c.$("pjLinks").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/) || l.match(/^()(https?:\/\/\S+)$/); return m ? { title: m[1] || "קישור", url: m[2] } : null; });
      if (links.includes(null)) { c.toast("קישור צריך להיות בצורה: כותרת | https://...", "bad"); return null; }
      const data = {
        title: c.$("pjTitle").value.trim(), desc: c.$("pjDesc").value.trim(), stage: c.$("pjStageS").value, health: c.$("pjHealthS").value,
        owner: c.$("pjOwnerI").value.trim(), dueDate: c.$("pjDue").value, priority: c.$("pjPr").value,
        tags: [...new Set(c.$("pjTags").value.split(",").map((x) => x.trim()).filter(Boolean))],
        tasks: (p.tasks || []).filter((t) => t.text.trim()),
        milestones: (p.milestones || []).filter((m) => m.text.trim()), links, updatedAt: serverTimestamp(), updatedBy: c.myEmail()
      };
      // תאימות: "השלב הבא" = המשימה הפתוחה הקרובה
      const first = openTasks(data)[0];
      data.nextStep = first ? { text: first.text, who: first.who || "", due: first.due || "" } : {};
      if (isAdmin) data.sharedWith = [...document.querySelectorAll("[data-share]:checked")].map((x) => x.dataset.share);
      if (!data.title) { c.toast("נא למלא שם", "bad"); return null; }
      return data;
    };
    // שורת יומן אוטומטית כשמשהו חשוב השתנה
    const autoLog = (data) => {
      const ch = [];
      if (id && data.stage !== p.stage) ch.push(`שלב: ${STAGES[p.stage]} ← ${STAGES[data.stage]}`);
      if (id && data.health !== p.health) ch.push(`מצב: ${HEALTH[data.health]}`);
      const before = tasksOf(c.S.projects.get(id) || {});
      const added = (data.tasks || []).filter((t) => !before.find((b) => b.id === t.id || b.text === t.text)).map((t) => t.text);
      const doneT = (data.tasks || []).filter((t) => t.done && !before.find((b) => (b.id === t.id || b.text === t.text) && b.done)).map((t) => t.text);
      if (id && added.length) ch.push(`משימה חדשה: ${added.join(", ")}`);
      if (id && doneT.length) ch.push(`בוצע: ${doneT.join(", ")}`);
      const done = (data.milestones || []).filter((m) => m.done && !(c.S.projects.get(id)?.milestones || []).find((o) => o.id === m.id && o.done)).map((m) => m.text);
      if (id && done.length) ch.push(`הושלם: ${done.join(", ")}`);
      return ch.length ? [{ at: Timestamp.now(), by: c.myEmail(), text: ch.join(" · "), auto: true }] : [];
    };
    c.$("pjSave").onclick = async () => {
      const data = collect(); if (!data) return;
      try {
        const note = c.$("upText")?.value.trim();
        const noteLog = note ? [{ at: Timestamp.now(), by: c.myEmail(), text: note, health: data.health !== p.health ? data.health : "" }] : [];
        if (id) await updateDoc(doc(db, "mgmtProjects", id), { ...data, log: [...(p.log || []), ...autoLog(data), ...noteLog].slice(-200) });
        else {
          await addDoc(collection(db, "mgmtProjects"), { ...data, sharedWith: data.sharedWith || [], createdAt: serverTimestamp(), createdBy: c.myEmail(),
            log: [{ at: Timestamp.now(), by: c.myEmail(), text: "הפרויקט נפתח", health: data.health }] });
          c.audit("פתיחת פרויקט", data.title);
        }
        if (id && isAdmin && JSON.stringify((p.sharedWith || []).slice().sort()) !== JSON.stringify((data.sharedWith || []).slice().sort())) c.audit("שינוי שיתוף פרויקט", data.title, (data.sharedWith || []).join(", ") || "ללא שיתוף");
        c.toast("נשמר", "good"); c.closeModal(); renderProjects(c, true);
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
    if (c.$("pjDel")) c.$("pjDel").onclick = async () => {
      if (!confirm(`למחוק את "${p.title}" לצמיתות?`)) return;
      try { await deleteDoc(doc(db, "mgmtProjects", id)); c.audit("מחיקת פרויקט", p.title); c.closeModal(); renderProjects(c, true); }
      catch (e) { c.toast("המחיקה נכשלה: " + e.code, "bad"); }
    };
  });
}

// ---------- סיכום משימות לכל אחראי – שליחה בוואטסאפ ----------
// טלפונים של אנשי הצוות נשמרים ב-private/teamPhones (רק מנהל המערכת קורא וכותב)
const waPhone = (ph) => { let d = String(ph || "").replace(/\D/g, ""); if (d.startsWith("0")) d = "972" + d.slice(1); return d.length >= 11 ? d : ""; };
// "הרב עדו רכניץ" ← "הרב עדו"; "נועה כהן" ← "נועה"
const TITLES = ["הרב", "הרבנית", "הרה\"ג", "הגאון", "רבי", "ר'", "מר", "גב'", "גברת", "ד\"ר", "דר'", "פרופ'", "עו\"ד", "רו\"ח", "הגב'"];
function greetName(name) {
  const w = String(name || "").trim().split(/\s+/);
  let k = 0; while (k < w.length - 1 && TITLES.includes(w[k])) k++;
  return w.slice(0, k + 1).join(" ");
}
function taskMessage(name, groups) {
  const n = groups.reduce((a, g) => a + g.tasks.length, 0);
  return `שלום ${greetName(name)},\nהמשימות הפתוחות שלך בפרויקטים של מכון משפטי ארץ:\n\n`
    + groups.map((g) => `*${g.project}*\n` + g.tasks.map((t) => `- ${t.text}${t.due ? ` (עד ${fmtIso(t.due)})` : ""}${late(t) ? " *באיחור*" : ""}`).join("\n")).join("\n\n")
    + `\n\nסה"כ ${n} ${n === 1 ? "משימה" : "משימות"}. תודה!`;
}
async function openTasksSummary(c) {
  let phones = {};
  try { const d = await getDoc(doc(db, "private", "teamPhones")); phones = d.exists() ? d.data().phones || {} : {}; } catch { /* */ }
  // אחראי ← פרויקטים ← משימות פתוחות (רק בפרויקטים שלא הושלמו)
  const byWho = new Map();
  [...c.S.projects.values()].filter((p) => p.stage !== "done").sort((a, b) => (a.title || "").localeCompare(b.title || "", "he")).forEach((p) => {
    openTasks(p).forEach((t) => {
      const who = (t.who || "").trim() || "—";
      if (!byWho.has(who)) byWho.set(who, new Map());
      const m = byWho.get(who); if (!m.has(p.title)) m.set(p.title, []); m.get(p.title).push(t);
    });
  });
  const people = [...byWho.keys()].filter((w) => w !== "—").sort((a, b) => a.localeCompare(b, "he"));
  const groupsOf = (w) => [...byWho.get(w)].map(([project, tasks]) => ({ project, tasks }));
  // טלפון: קודם מרשימת המשתמשים (לפי שם), אחר כך טלפון שנשמר כאן בעבר
  const userOf = (w) => {
    const us = [...c.S.users.values()], exact = us.find((u) => (u.name || "").trim() === w);
    if (exact) return exact;
    const part = us.filter((u) => (u.name || "").trim().split(/\s+/)[0] === w); // שם פרטי בלבד – רק אם יש משתמש אחד כזה
    return part.length === 1 ? part[0] : null;
  };
  const userPhone = (w) => userOf(w)?.phone || phones[w] || "";
  c.openModal(`
    <div class="head"><h2>📲 סיכום משימות לכל אחראי</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <p class="small muted">לכל אחראי – כל המשימות הפתוחות שלו מכל הפרויקטים. "שליחה בוואטסאפ" פותח את וואטסאפ עם ההודעה מוכנה אליו.
      הטלפון נלקח אוטומטית ממסך "משתמשים" (לפי השם). למי שאינו משתמש במערכת – מקלידים פעם אחת והמספר נשמר.</p>
    ${people.map((w, i) => { const gs = groupsOf(w), n = gs.reduce((a, g) => a + g.tasks.length, 0), lateN = gs.reduce((a, g) => a + g.tasks.filter(late).length, 0); return `
      <div class="card wa-card">
        <div class="row space"><div><b>${c.esc(w)}</b> <span class="badge">${n === 1 ? "משימה אחת" : n + " משימות"}</span>${lateN ? ` <span class="badge bad">${lateN} באיחור</span>` : ""}</div>
          <div class="row"><input data-waph="${i}" value="${c.esc(userPhone(w))}" placeholder="טלפון (050...)" dir="ltr" style="width:150px" aria-label="טלפון של ${c.esc(w)}">
            <button class="primary" data-wasend="${i}">שליחה בוואטסאפ</button><button data-wacopy="${i}">העתקה</button></div></div>
        <details><summary class="small">תצוגת ההודעה</summary><pre class="wa-pre">${c.esc(taskMessage(w, gs))}</pre></details>
      </div>`; }).join("") || '<p class="muted">אין משימות פתוחות עם אחראי.</p>'}
    ${byWho.has("—") ? `<p class="small muted">⚠ ${[...byWho.get("—").values()].reduce((a, t) => a + t.length, 0)} משימות פתוחות בלי אחראי – כדאי לשייך אותן בתוך הפרויקט.</p>` : ""}`, () => {
    const save = async (w, ph) => {
      const u = userOf(w);
      if (u) { if ((u.phone || "") !== ph) { try { await updateDoc(doc(db, "allowedEmails", u.id), { phone: ph }); } catch { /* */ } } return; }
      if ((phones[w] || "") === ph) return;
      phones[w] = ph;
      try { await setDoc(doc(db, "private", "teamPhones"), { phones, updatedAt: serverTimestamp() }); } catch { /* */ }
    };
    document.querySelectorAll("[data-wasend]").forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.wasend), w = people[i], ph = document.querySelector(`[data-waph="${i}"]`).value.trim();
      const num = waPhone(ph);
      if (ph && !num) return c.toast("מספר הטלפון לא תקין", "bad");
      save(w, ph);
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(taskMessage(w, groupsOf(w)))}`, "_blank", "noopener");
      b.textContent = "נשלח ✓";
    }));
    document.querySelectorAll("[data-wacopy]").forEach((b) => (b.onclick = async () => {
      const w = people[Number(b.dataset.wacopy)];
      try { await navigator.clipboard.writeText(taskMessage(w, groupsOf(w))); c.toast("ההודעה הועתקה", "good"); } catch { /* */ }
    }));
  });
}
