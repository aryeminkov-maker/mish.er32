// ===== שליחת מיילים =====
// כל המיילים נשלחים מחשבון ה-Gmail של המכון על ידי הסקריפט (mail-scheduler.gs) שרץ כל 5 דקות.
// המערכת רק כותבת את המייל לתור (mailQueue) – אף אחד לא צריך להתחבר ל-Gmail.
// בכל מייל הסקריפט מוסיף קישור הסרה מרשימת התפוצה. מי שהסיר את עצמו (optouts) לא מקבל מיילים.
import { collection, addDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, toDate, normEmail } from "./common.js?v=20261027";
import { ORG_NAME } from "./config.js?v=20261027";

const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
// סימון קל בגוף המייל: "## כותרת", "### כותרת משנה", **מודגש**, __קו תחתון__
function markupToHtml(text) {
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#85661a">$1</a>');
  const lines = escHtml(text).split(/\r?\n/);
  let out = "";
  lines.forEach((l, i) => {
    if (/^####\s+/.test(l)) out += `<h5 style="font-size:15px;margin:10px 0 2px;color:#1c1b19;text-decoration:underline">${inline(l.replace(/^####\s+/, ""))}</h5>`;
    else if (/^###\s+/.test(l)) out += `<h4 style="font-size:16px;margin:12px 0 2px;color:#1c1b19">${inline(l.replace(/^###\s+/, ""))}</h4>`;
    else if (/^##\s+/.test(l)) out += `<h3 style="font-size:19px;margin:16px 0 4px;color:#85661a">${inline(l.replace(/^##\s+/, ""))}</h3>`;
    else out += inline(l) + (i < lines.length - 1 && !/^#{2,4}\s+/.test(lines[i + 1] || "") ? "<br>" : "");
  });
  return out;
}
export const stripMarkup = (text) => String(text).replace(/^#{2,4}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");



export function textToHtml(text) {
  const body = markupToHtml(text);
  return `<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1c1b19">${body}</div>`;
}

// החלפת משתנים בתבנית: {שם}, {שם פרטי} ומשתנים נוספים לכל נמען
export function fill(tpl, rec) {
  const vars = { "שם": rec.name || "", "שם פרטי": rec.firstName || (rec.name || "").split(" ")[0] || "", ...(rec.vars || {}) };
  return String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// מצב המתזמן (הסקריפט מעדכן settings/mailScheduler בכל ריצה)
export function schedulerState(s) {
  const last = toDate(s?.lastRun);
  if (!last) return { ok: false, text: "הסקריפט ששולח את המיילים עוד לא הותקן (README, פרק \"שליחת מיילים\"). המיילים יישמרו בתור וייצאו כשיותקן." };
  const min = Math.round((Date.now() - last.getTime()) / 60000);
  if (min > 20) return { ok: false, text: `הסקריפט ששולח את המיילים לא רץ כבר ${min} דקות – המיילים יחכו בתור. כדאי לבדוק אותו.` };
  return { ok: true, text: "" };
}
// ---------- חלון כתיבה ושליחה ----------
// recipients: [{ email, name, firstName, vars, contactId, ref, consent }]
//   consent: true = אישר דיוור, false = לא אישר, undefined = לא ידוע
// mark: { collection, field } – אחרי שליחה מוצלחת מסמנים תאריך במסמך rec.ref (למשל approvalSentAt)
const pad2 = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// חסימה: מי שהסיר את עצמו מרשימת התפוצה (c.S.optouts) או שבכרטיס שלו מסומן "הוסר"
export function isBlocked(c, r) {
  const e = normEmail(r.email);
  if (c.S?.optouts?.has(e)) return true;
  const ct = r.contactId && c.S?.contacts?.get(r.contactId);
  return ct?.consentEmail?.status === "removed";
}

export function composeMail(c, { title, recipients, subject, body, kind, warning, mark }) {
  const all = recipients.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email || "")));
  // אותה כתובת פעם אחת בלבד
  const seen = new Set();
  const uniq = all.filter((r) => { const e = r.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true; });
  const blocked = uniq.filter((r) => isBlocked(c, r));
  const valid = uniq.filter((r) => !isBlocked(c, r));
  const skipped = recipients.length - all.length;
  const isGroup = valid.length > 1;
  const consenting = valid.filter((r) => r.consent === true);
  const varNames = [...new Set(valid.flatMap((r) => Object.keys(r.vars || {})))];
  let onlyConsent = isGroup; // בשליחה לקבוצה – ברירת המחדל: רק למי שאישר דיוור
  const target = () => (isGroup && onlyConsent ? consenting : valid);
  const tomorrow = new Date(Date.now() + 864e5);
  const st = schedulerState(c.S?.scheduler);

  c.openModal(`
    <div class="head"><h2>${c.esc(title || "שליחת מייל")}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    ${st.ok ? "" : `<div class="conflict-box">${c.esc(st.text)}</div>`}
    ${warning ? `<div class="conflict-box">${c.esc(warning)}</div>` : ""}
    <div class="small"><b>אל:</b> <span id="mTo"></span>
      ${skipped ? ` <span class="badge warn">${skipped} בלי כתובת מייל תקינה</span>` : ""}
      ${blocked.length ? ` <span class="badge bad" title="${c.esc(blocked.map((r) => r.email).join(", "))}">${blocked.length} הסירו את עצמם מרשימת התפוצה – לא יקבלו</span>` : ""}</div>
    ${isGroup ? `<label class="check" style="margin:6px 0"><input type="checkbox" id="mOnlyConsent" checked> <span>לשלוח רק למי שאישר קבלת דיוור (${consenting.length} מתוך ${valid.length})</span></label>` : ""}
    ${!isGroup && valid[0] && valid[0].consent === false ? `<div class="small" style="color:var(--warn)">הנמען לא אישר קבלת דיוור.</div>` : ""}
    <div class="field" style="margin-top:8px"><label for="mSubject">נושא</label><input id="mSubject" value="${c.esc(subject || "")}"></div>
    <div class="field"><label for="mBody">תוכן</label><textarea id="mBody" style="min-height:220px">${c.esc(body || "")}</textarea></div>
    <p class="small muted">משתנים שמוחלפים לכל נמען: {שם}, {שם פרטי}${varNames.map((v) => `, {${c.esc(v)}}`).join("")}<br>
      עיצוב: שורה שמתחילה ב-<b dir="ltr">## </b> = כותרת, <b dir="ltr">### </b> / <b dir="ltr">#### </b> = כותרות משנה, <b dir="ltr">**טקסט**</b> = מודגש, <b dir="ltr">__טקסט__</b> = קו תחתון<br>
      בסוף כל מייל מתווסף אוטומטית קישור להסרה מרשימת התפוצה.</p>
    <fieldset class="when-box"><legend class="small">מתי לשלוח</legend>
      <label class="check"><input type="radio" name="mWhen" value="now" checked> <span>עכשיו (המייל ייצא תוך כמה דקות)</span></label>
      <label class="check"><input type="radio" name="mWhen" value="later"> <span>לתזמן ל:</span>
        <input type="date" id="mDate" value="${localIso(tomorrow)}" min="${localIso(new Date())}" style="width:auto" aria-label="תאריך שליחה">
        <input type="time" id="mTime" value="09:00" style="width:auto" aria-label="שעת שליחה"></label>
    </fieldset>
    <div class="row" style="margin-top:10px"><button class="primary" id="mSend"></button>
      <button id="mCopy">העתקת הכתובות</button></div>`, () => {
    const btn = c.$("mSend");
    const when = () => document.querySelector('input[name="mWhen"]:checked').value;
    const draw = () => {
      const t = target();
      c.$("mTo").innerHTML = t.length === 1 ? `${c.esc(t[0].name || "")} &lt;${c.esc(t[0].email)}&gt;`
        : `${t.length} נמענים – כל אחד מקבל מייל נפרד <details><summary class="small">הצגת הנמענים</summary><div class="small muted">${t.map((r) => c.esc(r.name ? `${r.name} <${r.email}>` : r.email)).join(" · ") || "אין"}</div></details>`;
      btn.textContent = (when() === "later" ? "תזמון" : "שליחה") + (t.length > 1 ? ` (${t.length})` : "");
      btn.disabled = !t.length;
    };
    draw();
    if (c.$("mOnlyConsent")) c.$("mOnlyConsent").onchange = (e) => { onlyConsent = e.target.checked; draw(); };
    document.querySelectorAll('input[name="mWhen"]').forEach((r) => (r.onchange = draw));
    ["mDate", "mTime"].forEach((id) => c.$(id).addEventListener("focus", () => { document.querySelector('input[name="mWhen"][value="later"]').checked = true; draw(); }));
    c.$("mCopy").onclick = async () => { try { await navigator.clipboard.writeText(target().map((r) => r.email).join(", ")); c.toast("הכתובות הועתקו", "good"); } catch { /* */ } };

    btn.onclick = async () => {
      const subj = c.$("mSubject").value.trim(), text = c.$("mBody").value, list = target();
      if (!subj || !text.trim()) return c.toast("נא למלא נושא ותוכן", "bad");
      if (!list.length) return c.toast("אין נמענים", "bad");
      if (list.length > 400) return c.toast("יותר מ-400 נמענים – מעבר למכסה היומית של Gmail. מומלץ לחלק לכמה ימים", "bad");
      let at = new Date();
      if (when() === "later") {
        at = new Date(`${c.$("mDate").value}T${c.$("mTime").value || "09:00"}`);
        if (isNaN(at)) return c.toast("נא לבחור תאריך ושעה", "bad");
        if (at.getTime() < Date.now() - 60000) return c.toast("המועד שבחרת כבר עבר", "bad");
      } else if (list.length > 20 && !confirm(`לשלוח ${list.length} מיילים?`)) return;
      btn.disabled = true;
      try {
        await queueMail(c, { subject: subj, body: text, list, at, kind, mark, title });
        c.toast(when() === "later" ? `תוזמן ל-${at.toLocaleDateString("he-IL")} ${c.$("mTime").value} (${list.length} נמענים)` : `נשלח לתור – ${list.length > 1 ? `${list.length} המיילים ייצאו` : "המייל ייצא"} תוך כמה דקות`, "good");
        c.closeModal();
      } catch (e) { c.toast("השליחה נכשלה: " + (e.code || e.message), "bad"); btn.disabled = false; }
    };
  });
}

// כתיבת מייל לתור (גם ממקומות אחרים במערכת, בלי חלון)
export async function queueMail(c, { subject, body, list, at, kind, mark, title }) {
  const ok = list.filter((r) => !isBlocked(c, r));
  if (!ok.length) return null;
  for (let i = 0; i < ok.length; i += 400) {
    await addDoc(collection(db, "mailQueue"), {
      status: "scheduled", sendAt: Timestamp.fromDate(at || new Date()), subject, body, kind: kind || "",
      recipients: ok.slice(i, i + 400).map((r) => ({ email: normEmail(r.email), name: r.name || "", firstName: r.firstName || "", vars: r.vars || {}, contactId: r.contactId || "", ref: r.ref || "" })),
      total: Math.min(400, ok.length - i), sentEmails: [], failed: [], mark: mark || null, title: title || "",
      siteUrl: new URL(".", location.href).href, createdBy: c.myEmail(), createdAt: serverTimestamp()
    });
  }
  return ok.length;
}
