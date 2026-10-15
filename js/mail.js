// ===== שליחת מיילים מחשבון ה-Gmail של המכון (Gmail API) =====
// השליחה נעשית מהדפדפן: מי ששולח מתחבר פעם בשעה לחשבון המכון בחלון של Google.
import { collection, addDoc, doc, updateDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261022";
import { MAIL_CLIENT_ID, MAIL_FROM, ORG_NAME } from "./config.js?v=20261022";

const SCOPE = "https://www.googleapis.com/auth/gmail.send email";
const FROM = String(MAIL_FROM || "").trim().toLowerCase();
let client = null, token = null, tokenExp = 0;

export const mailConfigured = () => !!(MAIL_CLIENT_ID && FROM);
export const mailFrom = () => FROM;
export const mailConnected = () => !!token && Date.now() < tokenExp - 60000;

// טעינת רכיב ההתחברות של Google מראש (כדי שהחלון ייפתח מיד בלחיצה)
export function preloadMail() {
  if (!mailConfigured() || window.google?.accounts?.oauth2 || document.getElementById("gsiScript")) return;
  const s = document.createElement("script");
  s.id = "gsiScript"; s.src = "https://accounts.google.com/gsi/client"; s.async = true;
  document.head.appendChild(s);
}

// חייב להיקרא ישירות מלחיצת כפתור (אחרת הדפדפן חוסם את החלון)
export function connectMail() {
  return new Promise((resolve, reject) => {
    if (mailConnected()) return resolve(token);
    if (!mailConfigured()) return reject(new Error("שליחת מיילים עוד לא הוגדרה (config.js)"));
    if (!window.google?.accounts?.oauth2) { preloadMail(); return reject(new Error("רכיב ההתחברות של Google עדיין נטען – נסו שוב בעוד כמה שניות")); }
    if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: MAIL_CLIENT_ID, scope: SCOPE, hint: FROM, callback: () => {} });
    client.callback = async (resp) => {
      if (resp.error) return reject(new Error("ההתחברות נכשלה: " + (resp.error_description || resp.error)));
      if (!google.accounts.oauth2.hasGrantedAllScopes(resp, "https://www.googleapis.com/auth/gmail.send")) return reject(new Error("לא ניתנה הרשאה לשליחת מיילים – צריך לסמן את התיבה בחלון של Google"));
      try {
        const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + resp.access_token } });
        const who = String((await r.json()).email || "").toLowerCase();
        if (who !== FROM) return reject(new Error(`התחברת עם ${who || "חשבון אחר"} – צריך להתחבר עם ${FROM}`));
        token = resp.access_token;
        tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(token);
      } catch (e) { reject(new Error("לא הצלחנו לאמת את החשבון")); }
    };
    client.error_callback = (e) => reject(new Error(e?.type === "popup_closed" ? "חלון ההתחברות נסגר" : "חלון ההתחברות נחסם – אפשרו חלונות קופצים לאתר"));
    client.requestAccessToken({ prompt: "" });
  });
}

// ---------- בניית המייל (MIME) ----------
const b64 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin); };
const b64url = (str) => b64(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/.{1,76}/g, "$&\r\n");
const escHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

export function textToHtml(text) {
  const body = escHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#85661a">$1</a>')
    .replace(/\r?\n/g, "<br>");
  return `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0">
<div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1c1b19;max-width:640px;padding:16px">
${body}
<div style="margin-top:24px;padding-top:10px;border-top:2px solid #c19937;font-size:13px;color:#6b6456">${escHtml(ORG_NAME)}</div>
</div></body></html>`;
}

export function buildMime({ to, toName, subject, text }) {
  const boundary = "mx" + Math.random().toString(36).slice(2);
  const from = `${encHeader(ORG_NAME)} <${FROM}>`;
  const toH = toName ? `${encHeader(toName)} <${to}>` : to;
  return [
    `From: ${from}`, `To: ${toH}`, `Subject: ${encHeader(subject)}`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(b64(text)),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76(b64(textToHtml(text))),
    `--${boundary}--`, ""
  ].join("\r\n");
}

export async function sendMail(msg) {
  if (!mailConnected()) throw new Error("not-connected");
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: b64url(buildMime(msg)) })
  });
  if (r.status === 401) { token = null; throw new Error("פג תוקף ההתחברות – התחברו שוב"); }
  if (!r.ok) { let m = ""; try { m = (await r.json()).error?.message || ""; } catch { /* */ } throw new Error(`השליחה נכשלה (${r.status}) ${m}`); }
  return r.json();
}

// החלפת משתנים בתבנית: {שם}, {שם פרטי} ומשתנים נוספים לכל נמען
export function fill(tpl, rec) {
  const vars = { "שם": rec.name || "", "שם פרטי": rec.firstName || (rec.name || "").split(" ")[0] || "", ...(rec.vars || {}) };
  return String(tpl).replace(/\{([^{}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// ---------- חלון כתיבה ושליחה ----------
// recipients: [{ email, name, firstName, vars, contactId, ref, consent }]
//   consent: true = אישר דיוור, false = לא אישר, undefined = לא ידוע
// mark: { collection, field } – אחרי שליחה מוצלחת מסמנים תאריך במסמך rec.ref (למשל approvalSentAt)
const pad2 = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export function composeMail(c, { title, recipients, subject, body, kind, warning, mark }) {
  const all = recipients.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.email || "")));
  // אותה כתובת פעם אחת בלבד
  const seen = new Set();
  const valid = all.filter((r) => { const e = r.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true; });
  const skipped = recipients.length - all.length;
  const isGroup = valid.length > 1;
  const consenting = valid.filter((r) => r.consent === true);
  const varNames = [...new Set(valid.flatMap((r) => Object.keys(r.vars || {})))];
  let onlyConsent = isGroup; // בשליחה לקבוצה – ברירת המחדל: רק למי שאישר דיוור
  const target = () => (isGroup && onlyConsent ? consenting : valid);
  const tomorrow = new Date(Date.now() + 864e5);
  const status = () => !mailConfigured()
    ? `<div class="conflict-box">שליחה מיידית עוד לא הוגדרה (README, פרק "שליחת מיילים"). אפשר לתזמן – המיילים יישלחו אם הוגדר המתזמן.</div>`
    : mailConnected() ? `<span class="badge good">מחובר ל-${c.esc(FROM)}</span>` : `<span class="badge warn">לא מחובר</span> <span class="small muted">בשליחה מיידית ייפתח חלון התחברות לחשבון ${c.esc(FROM)}</span>`;

  c.openModal(`
    <div class="head"><h2>${c.esc(title || "שליחת מייל")}</h2><button class="close" data-close aria-label="סגירה">×</button></div>
    <div id="mStatus" style="margin-bottom:10px">${status()}</div>
    ${warning ? `<div class="conflict-box">${c.esc(warning)}</div>` : ""}
    <div class="small"><b>אל:</b> <span id="mTo"></span>
      ${skipped ? ` <span class="badge warn">${skipped} בלי כתובת מייל תקינה</span>` : ""}</div>
    ${isGroup ? `<label class="check" style="margin:6px 0"><input type="checkbox" id="mOnlyConsent" checked> <span>לשלוח רק למי שאישר קבלת דיוור (${consenting.length} מתוך ${valid.length})</span></label>` : ""}
    ${!isGroup && valid[0] && valid[0].consent === false ? `<div class="small" style="color:var(--warn)">הנמען לא אישר קבלת דיוור.</div>` : ""}
    <div class="field" style="margin-top:8px"><label for="mSubject">נושא</label><input id="mSubject" value="${c.esc(subject || "")}"></div>
    <div class="field"><label for="mBody">תוכן</label><textarea id="mBody" style="min-height:220px">${c.esc(body || "")}</textarea></div>
    <p class="small muted">משתנים שמוחלפים לכל נמען: {שם}, {שם פרטי}${varNames.map((v) => `, {${c.esc(v)}}`).join("")}</p>
    <fieldset class="when-box"><legend class="small">מתי לשלוח</legend>
      <label class="check"><input type="radio" name="mWhen" value="now" checked> <span>עכשיו</span></label>
      <label class="check"><input type="radio" name="mWhen" value="later"> <span>לתזמן ל:</span>
        <input type="date" id="mDate" value="${localIso(tomorrow)}" min="${localIso(new Date())}" style="width:auto" aria-label="תאריך שליחה">
        <input type="time" id="mTime" value="09:00" style="width:auto" aria-label="שעת שליחה"></label>
    </fieldset>
    <div class="row" style="margin-top:10px"><button class="primary" id="mSend"></button>
      <button id="mCopy">העתקת הכתובות</button><span id="mProgress" class="small muted"></span></div>
    <div id="mResult"></div>`, () => {
    const btn = c.$("mSend");
    const when = () => document.querySelector('input[name="mWhen"]:checked').value;
    const draw = () => {
      const t = target();
      c.$("mTo").innerHTML = t.length === 1 ? `${c.esc(t[0].name || "")} &lt;${c.esc(t[0].email)}&gt;`
        : `${t.length} נמענים – כל אחד מקבל מייל נפרד <details><summary class="small">הצגת הנמענים</summary><div class="small muted">${t.map((r) => c.esc(r.name ? `${r.name} <${r.email}>` : r.email)).join(" · ") || "אין"}</div></details>`;
      const later = when() === "later";
      btn.textContent = (later ? "תזמון" : "שליחה") + (t.length > 1 ? ` (${t.length})` : "");
      btn.disabled = !t.length || (!later && !mailConfigured());
    };
    draw();
    if (c.$("mOnlyConsent")) c.$("mOnlyConsent").onchange = (e) => { onlyConsent = e.target.checked; draw(); };
    document.querySelectorAll('input[name="mWhen"]').forEach((r) => (r.onchange = draw));
    ["mDate", "mTime"].forEach((id) => c.$(id).addEventListener("focus", () => { document.querySelector('input[name="mWhen"][value="later"]').checked = true; draw(); }));
    c.$("mCopy").onclick = async () => { try { await navigator.clipboard.writeText(target().map((r) => r.email).join(", ")); c.toast("הכתובות הועתקו", "good"); } catch { /* */ } };

    const sent = new Set(); // בשליחה חוזרת אחרי תקלה – לא שולחים שוב למי שכבר קיבל
    btn.onclick = () => {
      const subj = c.$("mSubject").value.trim(), text = c.$("mBody").value, list = target();
      if (!subj || !text.trim()) return c.toast("נא למלא נושא ותוכן", "bad");
      if (!list.length) return c.toast("אין נמענים", "bad");
      if (list.length > 400) return c.toast("יותר מ-400 נמענים – מעבר למכסה היומית של Gmail. מומלץ לחלק לכמה ימים", "bad");
      if (when() === "later") return schedule(subj, text, list);
      if (list.length > 20 && !confirm(`לשלוח ${list.length} מיילים?`)) return;
      btn.disabled = true;
      // ההתחברות נפתחת מתוך הלחיצה עצמה
      const ready = mailConnected() ? Promise.resolve() : connectMail();
      ready.then(() => { c.$("mStatus").innerHTML = status(); return run(subj, text, list); })
        .catch((e) => { c.toast(e.message, "bad"); btn.disabled = false; });
    };

    async function schedule(subj, text, list) {
      const at = new Date(`${c.$("mDate").value}T${c.$("mTime").value || "09:00"}`);
      if (isNaN(at)) return c.toast("נא לבחור תאריך ושעה", "bad");
      if (at.getTime() < Date.now() - 60000) return c.toast("המועד שבחרת כבר עבר", "bad");
      btn.disabled = true;
      try {
        await addDoc(collection(db, "mailQueue"), {
          status: "scheduled", sendAt: Timestamp.fromDate(at), subject: subj, body: text, kind: kind || "",
          recipients: list.map((r) => ({ email: r.email, name: r.name || "", firstName: r.firstName || "", vars: r.vars || {}, contactId: r.contactId || "", ref: r.ref || "" })),
          total: list.length, sentEmails: [], failed: [], mark: mark || null, title: title || "",
          createdBy: c.myEmail(), createdAt: serverTimestamp()
        });
        c.toast(`תוזמן ל-${at.toLocaleDateString("he-IL")} ${c.$("mTime").value} (${list.length} נמענים)`, "good");
        c.closeModal();
      } catch (e) { c.toast("התזמון נכשל: " + e.code, "bad"); btn.disabled = false; }
    }

    async function run(subj, text, list) {
      let ok = 0; const failed = [];
      for (const [i, rec] of list.entries()) {
        if (sent.has(rec.email)) { ok++; continue; }
        c.$("mProgress").textContent = `שולח ${i + 1} מתוך ${list.length}...`;
        try {
          await sendMail({ to: rec.email, toName: rec.name, subject: fill(subj, rec), text: fill(text, rec) });
          ok++; sent.add(rec.email);
          addDoc(collection(db, "mailLog"), { to: rec.email, subject: fill(subj, rec), kind: kind || "", ref: rec.ref || "", by: c.myEmail(), at: serverTimestamp() }).catch(() => {});
          if (rec.contactId && c.inGroup(c.EDIT_ROLES)) {
            addDoc(collection(db, "activities"), { contactId: rec.contactId, type: "note", details: "מייל: " + fill(subj, rec), amount: null, date: serverTimestamp(), source: "מייל מהמערכת", createdBy: c.myEmail(), createdAt: serverTimestamp() }).catch(() => {});
          }
          if (mark && rec.ref) updateDoc(doc(db, mark.collection, rec.ref), { [mark.field]: serverTimestamp() }).catch(() => {});
        } catch (e) {
          failed.push(`${rec.email}: ${e.message}`);
          if (/התחברו שוב|not-connected/.test(e.message)) break;
        }
        if (list.length > 1) await new Promise((r) => setTimeout(r, 300));
      }
      c.$("mProgress").textContent = "";
      c.$("mResult").innerHTML = `<div class="context"><b>נשלחו ${ok} מתוך ${list.length}.</b>
        ${failed.length ? `<details open><summary>${failed.length} נכשלו</summary><div class="small">${failed.map(c.esc).join("<br>")}</div></details>` : ""}</div>`;
      if (!failed.length) { c.toast(`נשלחו ${ok} מיילים`, "good"); setTimeout(() => c.closeModal(), 900); }
      else btn.disabled = false;
    }
  });
}
