// ===== סטטוס פרויקטים (מנהל מערכת + מי שפרויקט שותף איתו) =====
// מסמך: mgmtProjects/{id}
// { title, desc, owner, dueDate, priority, stage, health, tasks:[{id,text,who,due,done}], milestones:[{id,text,done}],
//   links:[{title,url}], tags:[], sharedWith:[emails], log:[{at,by,text,health,next}], updatedAt, updatedBy }
import { collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261028";
import { todayIso, fmtIso, uid, norm } from "./util.js?v=20261028";

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
  c.openModal(`
    <div class="head"><h2>${id ? c.esc(p.title) : "פרויקט חדש"}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div class="split" data-editing-root>
      <div>
        <div class="field"><label for="pjTitle">שם הפרויקט</label><input id="pjTitle" value="${c.esc(p.title || "")}"></div>
        <div class="field"><label for="pjDesc">תיאור / מטרה</label><textarea id="pjDesc" style="min-height:70px">${c.esc(p.desc || "")}</textarea></div>
        <div class="grid2">
          <div class="field"><label for="pjStageS">שלב</label>${sel("pjStageS", STAGES, p.stage)}</div>
          <div class="field"><label for="pjHealthS">מצב</label>${sel("pjHealthS", HEALTH, p.health)}</div>
          <div class="field"><label for="pjOwnerI">אחראי</label><input id="pjOwnerI" value="${c.esc(p.owner || "")}" list="pjOwners">
            <datalist id="pjOwners">${people.map((o) => `<option value="${c.esc(o)}">`).join("")}</datalist></div>
          <div class="field"><label for="pjDue">תאריך יעד</label><input id="pjDue" type="date" value="${p.dueDate || ""}"></div>
          <div class="field"><label for="pjPr">עדיפות</label>${sel("pjPr", PRIORITY, p.priority)}</div>
          <div class="field"><label for="pjTags">תגיות (מופרדות בפסיק)</label><input id="pjTags" value="${c.esc((p.tags || []).join(", "))}" placeholder="השתלמויות, ספרים..."></div>
        </div>
        <div class="next-step-box">
          <h3 style="margin:0 0 6px">▶ משימות לביצוע</h3>
          <div id="pjTasks">${tkHtml()}</div>
          <div class="task-row new"><span style="width:20px"></span><input id="tkNew" placeholder="משימה חדשה" class="grow" aria-label="משימה חדשה">
            <input id="tkNewWho" list="pjOwners" placeholder="מי" aria-label="מי" class="tk-who"><input id="tkNewDue" type="date" aria-label="עד מתי" class="tk-due">
            <button id="tkAdd">הוספה</button></div>
        </div>
        <h3>אבני דרך</h3>
        <div id="pjMs">${msHtml()}</div>
        <div class="row"><input id="pjMsNew" placeholder="אבן דרך חדשה" class="grow" aria-label="אבן דרך חדשה"><button id="pjMsAdd">הוספה</button></div>
        <h3>קישורים</h3>
        <div class="field"><label for="pjLinks">שורה לכל קישור: כותרת | קישור</label><textarea id="pjLinks" style="min-height:60px" dir="auto">${c.esc((p.links || []).map((l) => `${l.title} | ${l.url}`).join("\n"))}</textarea></div>
        ${isAdmin ? `<details ${(p.sharedWith || []).length ? "open" : ""}><summary><b>שיתוף עם אנשי צוות</b> <span class="small muted">(יראו ויוכלו לעדכן את הפרויקט הזה בלבד)</span></summary>
          <div class="share-list">${team.map((u) => `<label class="check"><input type="checkbox" data-share="${c.esc(u.id)}" ${(p.sharedWith || []).includes(u.id) ? "checked" : ""}> <span>${c.esc(c.userName(u.id))} <span class="small muted">${c.esc(u.id)}</span></span></label>`).join("") || '<p class="muted small">אין אנשי צוות נוספים</p>'}</div></details>` : ""}
        <div class="row space" style="margin-top:12px"><button class="primary" id="pjSave">שמירה</button>${id && isAdmin ? '<button class="danger" id="pjDel">מחיקה</button>' : ""}</div>
      </div>
      <div>
        ${id ? `<div class="card" style="background:var(--surface-2)">
          <h3 style="margin-top:0">עדכון מהיר</h3>
          <div class="field"><label for="upText">מה נעשה / מה חדש</label><textarea id="upText" style="min-height:70px"></textarea></div>
          <div class="grid2"><div class="field"><label for="upHealth">מצב עכשיו</label>${sel("upHealth", HEALTH, p.health)}</div>
            <div class="field"><label for="upNext">משימה חדשה (רשות)</label><input id="upNext"></div></div>
          <div class="field"><label for="upNextWho">מי</label><input id="upNextWho" list="pjOwners"></div>
          <div class="field"><label for="upNextDue">עד מתי</label><input id="upNextDue" type="date"></div>
          <button class="primary" id="upSave">שמירת העדכון</button></div>` : ""}
        <h3>היסטוריית עדכונים</h3>
        <ul class="timeline">${(p.log || []).slice().reverse().map((l) => `<li><div class="when">${c.fmtDate(l.at)} · ${c.esc(c.userName(l.by))}${l.health ? ` · ${HEALTH[l.health] || ""}` : ""}</div>
          ${c.esc(l.text || "")}${l.next ? `<div class="small">▶ ${c.esc(l.next)}</div>` : ""}</li>`).join("") || '<li class="muted">עדיין אין עדכונים</li>'}</ul>
      </div>
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
        if (id) await updateDoc(doc(db, "mgmtProjects", id), { ...data, log: [...(p.log || []), ...autoLog(data)].slice(-200) });
        else {
          await addDoc(collection(db, "mgmtProjects"), { ...data, sharedWith: data.sharedWith || [], createdAt: serverTimestamp(), createdBy: c.myEmail(),
            log: [{ at: Timestamp.now(), by: c.myEmail(), text: "הפרויקט נפתח", health: data.health }] });
          c.audit("פתיחת פרויקט", data.title);
        }
        if (id && isAdmin && JSON.stringify((p.sharedWith || []).slice().sort()) !== JSON.stringify((data.sharedWith || []).slice().sort())) c.audit("שינוי שיתוף פרויקט", data.title, (data.sharedWith || []).join(", ") || "ללא שיתוף");
        c.toast("נשמר", "good"); c.closeModal(); renderProjects(c, true);
      } catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
    };
    if (c.$("upSave")) c.$("upSave").onclick = async () => {
      const text = c.$("upText").value.trim(), health = c.$("upHealth").value, next = c.$("upNext").value.trim();
      if (!text && health === p.health && !next) return c.toast("כתבו מה חדש", "bad");
      const upd = { health, updatedAt: serverTimestamp(), updatedBy: c.myEmail(),
        log: [...(p.log || []), { at: Timestamp.now(), by: c.myEmail(), text: text || (health !== p.health ? "עדכון מצב" : ""), health: health !== p.health ? health : "", next }].slice(-200) };
      if (next) {
        upd.tasks = [...(p.tasks || []), { id: uid(), text: next, who: c.$("upNextWho").value.trim(), due: c.$("upNextDue").value, done: false }];
        const first = openTasks({ tasks: upd.tasks })[0];
        upd.nextStep = { text: first.text, who: first.who || "", due: first.due || "" };
      }
      try { await updateDoc(doc(db, "mgmtProjects", id), upd); c.toast("העדכון נשמר", "good"); c.closeModal(); renderProjects(c, true); }
      catch (e) { c.toast("השמירה נכשלה: " + e.code, "bad"); }
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
function taskMessage(name, groups) {
  const n = groups.reduce((a, g) => a + g.tasks.length, 0);
  return `שלום ${name.split(" ")[0]} 👋\nהמשימות הפתוחות שלך בפרויקטים של מכון משפטי ארץ:\n\n`
    + groups.map((g) => `*${g.project}*\n` + g.tasks.map((t) => `• ${t.text}${t.due ? ` – עד ${fmtIso(t.due)}` : ""}${late(t) ? " ⚠️ באיחור" : ""}`).join("\n")).join("\n\n")
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
  const userPhone = (w) => phones[w] || "";
  c.openModal(`
    <div class="head"><h2>📲 סיכום משימות לכל אחראי</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <p class="small muted">לכל אחראי – כל המשימות הפתוחות שלו מכל הפרויקטים. "שליחה בוואטסאפ" פותח את וואטסאפ עם ההודעה מוכנה אליו. מספר הטלפון נשמר לפעם הבאה (רק מנהל המערכת רואה אותו).</p>
    ${people.map((w, i) => { const gs = groupsOf(w), n = gs.reduce((a, g) => a + g.tasks.length, 0), lateN = gs.reduce((a, g) => a + g.tasks.filter(late).length, 0); return `
      <div class="card wa-card">
        <div class="row space"><div><b>${c.esc(w)}</b> <span class="badge">${n === 1 ? "משימה אחת" : n + " משימות"}</span>${lateN ? ` <span class="badge bad">${lateN} באיחור</span>` : ""}</div>
          <div class="row"><input data-waph="${i}" value="${c.esc(userPhone(w))}" placeholder="טלפון (050...)" dir="ltr" style="width:150px" aria-label="טלפון של ${c.esc(w)}">
            <button class="primary" data-wasend="${i}">שליחה בוואטסאפ</button><button data-wacopy="${i}">העתקה</button></div></div>
        <details><summary class="small">תצוגת ההודעה</summary><pre class="wa-pre">${c.esc(taskMessage(w, gs))}</pre></details>
      </div>`; }).join("") || '<p class="muted">אין משימות פתוחות עם אחראי.</p>'}
    ${byWho.has("—") ? `<p class="small muted">⚠ ${[...byWho.get("—").values()].reduce((a, t) => a + t.length, 0)} משימות פתוחות בלי אחראי – כדאי לשייך אותן בתוך הפרויקט.</p>` : ""}`, () => {
    const save = async (w, ph) => {
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
