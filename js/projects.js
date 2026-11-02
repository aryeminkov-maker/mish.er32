// ===== סטטוס פרויקטים (מנהל מערכת + מי שפרויקט שותף איתו) =====
// מסמך: mgmtProjects/{id}
// { title, desc, owner, dueDate, priority, stage, health, nextStep:{text,who,due}, milestones:[{id,text,done}],
//   links:[{title,url}], tags:[], sharedWith:[emails], log:[{at,by,text,health,next}], updatedAt, updatedBy }
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261027";
import { todayIso, fmtIso, uid, norm } from "./util.js?v=20261027";

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
const ago = (n) => (n === null ? "" : n === 0 ? "היום" : n === 1 ? "אתמול" : `לפני ${n} ימים`);

export function renderProjects(c, full) {
  if (!full && document.querySelector("[data-editing]")) return;
  const isAdmin = c.can("admin");
  const all = [...c.S.projects.values()];
  const open = all.filter((p) => p.stage !== "done");
  const owners = [...new Set(all.map((p) => p.owner).filter(Boolean))].sort();
  const tags = [...new Set(all.flatMap((p) => p.tags || []))].sort();
  const t = norm(PS.search);
  let list = all.filter((p) => (PS.stage === "all" || (PS.stage === "open" ? p.stage !== "done" : p.stage === PS.stage))
    && (!PS.health || p.health === PS.health) && (!PS.owner || p.owner === PS.owner) && (!PS.tag || (p.tags || []).includes(PS.tag))
    && (!t || norm(`${p.title} ${p.desc} ${p.owner} ${p.nextStep?.text} ${(p.tags || []).join(" ")}`).includes(t)));
  const sorters = {
    due: (a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
    priority: (a, b) => (PR_ORDER[a.priority] ?? 1) - (PR_ORDER[b.priority] ?? 1) || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
    updated: (a, b) => (c.toDate(a.updatedAt)?.getTime() || 0) - (c.toDate(b.updatedAt)?.getTime() || 0),
    health: (a, b) => ["stuck", "risk", "ok", "paused"].indexOf(a.health) - ["stuck", "risk", "ok", "paused"].indexOf(b.health)
  };
  list = list.sort(sorters[PS.sort]);
  const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const dueSoon = open.filter((p) => (p.nextStep?.due && p.nextStep.due <= weekEnd) || (p.dueDate && p.dueDate >= todayIso() && p.dueDate <= weekEnd));
  c.$("main").innerHTML = `
    <div class="row space"><h1>פרויקטים</h1>
      <div class="row">${isAdmin ? '<button class="primary" id="pjNew">+ פרויקט</button>' : ""}<button id="pjExport">ייצוא ל-Excel</button><button id="pjPrint">הדפסה</button></div></div>
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
      ${owners.length ? `<select id="pjOwner" style="width:auto" aria-label="אחראי"><option value="">כל האחראים</option>${owners.map((o) => `<option ${PS.owner === o ? "selected" : ""}>${c.esc(o)}</option>`).join("")}</select>` : ""}
      ${tags.length ? `<select id="pjTag" style="width:auto" aria-label="תגית"><option value="">כל התגיות</option>${tags.map((o) => `<option ${PS.tag === o ? "selected" : ""}>${c.esc(o)}</option>`).join("")}</select>` : ""}
      <span class="grow"></span>
      <label class="small" for="pjSort">מיון</label><select id="pjSort" style="width:auto">${[["due", "תאריך יעד"], ["priority", "עדיפות"], ["health", "מצב (תקועים קודם)"], ["updated", "עודכן הכי מזמן"]].map(([k, v]) => `<option value="${k}" ${PS.sort === k ? "selected" : ""}>${v}</option>`).join("")}</select>
    </div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="pj-table">
      <thead><tr><th>פרויקט</th><th>שלב</th><th>מצב</th><th>התקדמות</th><th>השלב הבא</th><th>אחראי</th><th>יעד</th><th>עדכון אחרון</th></tr></thead>
      <tbody>${list.map((p) => {
        const pr = progress(p), d = daysSince(c, p.updatedAt);
        return `<tr class="click" data-pj="${p.id}">
          <td><b>${c.esc(p.title)}</b>${p.priority === "high" ? ' <span class="badge bad">עדיפות גבוהה</span>' : ""}
            ${(p.tags || []).map((g) => `<span class="badge">${c.esc(g)}</span>`).join(" ")}${(p.sharedWith || []).length ? ` <span class="small muted" title="${c.esc(p.sharedWith.join(", "))}">👥 ${p.sharedWith.length}</span>` : ""}</td>
          <td>${STAGES[p.stage] || ""}</td>
          <td><span class="badge ${HEALTH_BADGE[p.health] || ""}">${HEALTH[p.health] || ""}</span></td>
          <td>${pr === null ? '<span class="muted">—</span>' : `<div class="row" style="flex-wrap:nowrap;gap:6px"><div class="progress"><span style="width:${pr}%"></span></div><span class="small">${pr}%</span></div>`}</td>
          <td>${p.nextStep?.text ? `${c.esc(p.nextStep.text)}<div class="small muted">${[p.nextStep.who, p.nextStep.due ? fmtIso(p.nextStep.due) : ""].filter(Boolean).map(c.esc).join(" · ")}${p.nextStep.due && p.nextStep.due < todayIso() && p.stage !== "done" ? ' <span class="bad-text">באיחור</span>' : ""}</div>` : '<span class="muted">—</span>'}</td>
          <td>${c.esc(p.owner || "")}</td>
          <td class="nowrap ${overdue(p) ? "bad-text" : ""}">${p.dueDate ? fmtIso(p.dueDate) : "—"}</td>
          <td class="small nowrap ${stale(c, p) ? "bad-text" : "muted"}">${ago(d)}</td></tr>`;
      }).join("") || `<tr><td colspan="8" class="muted">${all.length ? "אין פרויקטים שמתאימים לסינון" : "עדיין אין פרויקטים"}</td></tr>`}</tbody></table></div></div>
    <p class="small muted">באדום: יעד שעבר, צעד הבא באיחור, או פרויקט שלא עודכן ${STALE_DAYS} ימים. לחיצה על שורה פותחת את הפרויקט.</p>`;
  const set = (k) => (e) => { PS[k] = e.target.value; renderProjects(c, true); };
  c.$("pjStage").onchange = set("stage"); c.$("pjHealth").onchange = set("health"); c.$("pjSort").onchange = set("sort");
  if (c.$("pjOwner")) c.$("pjOwner").onchange = set("owner");
  if (c.$("pjTag")) c.$("pjTag").onchange = set("tag");
  c.$("pjSearch").oninput = (e) => { PS.search = e.target.value; const pos = e.target.selectionStart; renderProjects(c, true); c.$("pjSearch").focus(); c.$("pjSearch").setSelectionRange(pos, pos); };
  if (c.$("pjNew")) c.$("pjNew").onclick = () => openProject(c, null);
  c.$("pjPrint").onclick = () => window.print();
  c.$("pjExport").onclick = () => c.exportXlsx(list.map((p) => ({
    "פרויקט": p.title, "תיאור": p.desc || "", "שלב": STAGES[p.stage] || "", "מצב": (HEALTH[p.health] || "").replace(/^\S+\s/, ""), "עדיפות": PRIORITY[p.priority] || "",
    "התקדמות": progress(p) === null ? "" : progress(p) + "%", "השלב הבא": p.nextStep?.text || "", "אחראי לשלב הבא": p.nextStep?.who || "", "עד": p.nextStep?.due ? fmtIso(p.nextStep.due) : "",
    "אחראי": p.owner || "", "תאריך יעד": p.dueDate ? fmtIso(p.dueDate) : "", "עדכון אחרון": c.fmtDate(p.updatedAt), "תגיות": (p.tags || []).join(", ")
  })), "פרויקטים.xlsx");
  document.querySelectorAll("[data-pj]").forEach((tr) => (tr.onclick = () => openProject(c, tr.dataset.pj)));
}

function openProject(c, id) {
  const isAdmin = c.can("admin");
  // עותק לעריכה (בלי לשבור את ה-Timestamp שביומן העדכונים)
  const o = id ? c.S.projects.get(id) : null;
  const p = o ? { ...o, milestones: (o.milestones || []).map((m) => ({ ...m })), nextStep: { ...(o.nextStep || {}) }, links: [...(o.links || [])], tags: [...(o.tags || [])], sharedWith: [...(o.sharedWith || [])], log: [...(o.log || [])] } : { stage: "planning", health: "ok", priority: "normal", milestones: [], links: [], tags: [], sharedWith: [], nextStep: {} };
  const team = [...c.S.users.values()].filter((u) => u.id !== c.myEmail()).sort((a, b) => c.userName(a.id).localeCompare(c.userName(b.id), "he"));
  const sel = (idn, obj, cur) => `<select id="${idn}">${Object.entries(obj).map(([k, v]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${v}</option>`).join("")}</select>`;
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
            <datalist id="pjOwners">${[...new Set([...[...c.S.projects.values()].map((x) => x.owner), ...[...c.S.users.values()].map((u) => u.name)].filter(Boolean))].map((o) => `<option value="${c.esc(o)}">`).join("")}</datalist></div>
          <div class="field"><label for="pjDue">תאריך יעד</label><input id="pjDue" type="date" value="${p.dueDate || ""}"></div>
          <div class="field"><label for="pjPr">עדיפות</label>${sel("pjPr", PRIORITY, p.priority)}</div>
          <div class="field"><label for="pjTags">תגיות (מופרדות בפסיק)</label><input id="pjTags" value="${c.esc((p.tags || []).join(", "))}" placeholder="השתלמויות, ספרים..."></div>
        </div>
        <div class="next-step-box">
          <h3 style="margin:0 0 6px">▶ השלב הבא</h3>
          <div class="field"><label for="pjNext">מה עושים עכשיו</label><input id="pjNext" value="${c.esc(p.nextStep?.text || "")}"></div>
          <div class="grid2"><div class="field"><label for="pjNextWho">מי</label><input id="pjNextWho" value="${c.esc(p.nextStep?.who || "")}" list="pjOwners"></div>
            <div class="field"><label for="pjNextDue">עד מתי</label><input id="pjNextDue" type="date" value="${p.nextStep?.due || ""}"></div></div>
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
            <div class="field"><label for="upNext">השלב הבא (רשות)</label><input id="upNext" placeholder="${c.esc(p.nextStep?.text || "")}"></div></div>
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
    c.$("pjMsAdd").onclick = () => { const v = c.$("pjMsNew").value.trim(); if (!v) return; syncMs(); p.milestones.push({ id: uid(), text: v, done: false }); c.$("pjMsNew").value = ""; drawMs(); c.$("pjMsNew").focus(); };
    c.$("pjMsNew").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); c.$("pjMsAdd").click(); } };
    const collect = () => {
      syncMs();
      const links = c.$("pjLinks").value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)\s*\|\s*(https?:\/\/\S+)$/) || l.match(/^()(https?:\/\/\S+)$/); return m ? { title: m[1] || "קישור", url: m[2] } : null; });
      if (links.includes(null)) { c.toast("קישור צריך להיות בצורה: כותרת | https://...", "bad"); return null; }
      const data = {
        title: c.$("pjTitle").value.trim(), desc: c.$("pjDesc").value.trim(), stage: c.$("pjStageS").value, health: c.$("pjHealthS").value,
        owner: c.$("pjOwnerI").value.trim(), dueDate: c.$("pjDue").value, priority: c.$("pjPr").value,
        tags: [...new Set(c.$("pjTags").value.split(",").map((x) => x.trim()).filter(Boolean))],
        nextStep: { text: c.$("pjNext").value.trim(), who: c.$("pjNextWho").value.trim(), due: c.$("pjNextDue").value },
        milestones: (p.milestones || []).filter((m) => m.text.trim()), links, updatedAt: serverTimestamp(), updatedBy: c.myEmail()
      };
      if (isAdmin) data.sharedWith = [...document.querySelectorAll("[data-share]:checked")].map((x) => x.dataset.share);
      if (!data.title) { c.toast("נא למלא שם", "bad"); return null; }
      return data;
    };
    // שורת יומן אוטומטית כשמשהו חשוב השתנה
    const autoLog = (data) => {
      const ch = [];
      if (id && data.stage !== p.stage) ch.push(`שלב: ${STAGES[p.stage]} ← ${STAGES[data.stage]}`);
      if (id && data.health !== p.health) ch.push(`מצב: ${HEALTH[data.health]}`);
      if (id && data.nextStep.text && data.nextStep.text !== p.nextStep?.text) ch.push(`שלב הבא: ${data.nextStep.text}`);
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
      if (next) upd.nextStep = { ...(p.nextStep || {}), text: next };
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
