/**
 * מתזמן מיילים – מכון משפטי ארץ
 * ------------------------------------------------------------
 * הסקריפט רץ בחשבון ה-Gmail של המכון (Google Apps Script), בודק כל 5 דקות
 * אם יש מיילים מתוזמנים שהגיע זמנם (אוסף mailQueue ב-Firestore) ושולח אותם.
 * ההוראות להתקנה: README.md, פרק "מיילים מתוזמנים".
 */

const PROJECT_ID = "dintora-a5e10";     // מזהה פרויקט ה-Firebase
const ORG_NAME = "מכון משפטי ארץ";      // שם השולח שיופיע במייל
const DELAY_MS = 400;                    // הפסקה קצרה בין מייל למייל
const TIME_BUDGET_MS = 4.5 * 60 * 1000;  // Apps Script מוגבל ל-6 דקות לריצה

const FS = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";

// ---------- הפעלה ----------
// מריצים פעם אחת ידנית (Run): יוצר הפעלה אוטומטית כל 5 דקות
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("processQueue").timeBased().everyMinutes(5).create();
  processQueue();
}

function processQueue() {
  const started = Date.now();
  let lastError = "";
  try {
    const jobs = runQuery_({
      from: [{ collectionId: "mailQueue" }],
      where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "scheduled" } } },
      limit: 50
    });
    const due = jobs.filter(function (j) { return Date.parse(j.data.sendAt) <= Date.now(); })
      .sort(function (a, b) { return Date.parse(a.data.sendAt) - Date.parse(b.data.sendAt); });
    for (let i = 0; i < due.length; i++) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const err = processJob_(due[i], started);
      if (err) { lastError = err; if (/quota|limit|429/i.test(err)) break; }
    }
  } catch (e) {
    lastError = String(e && e.message || e).slice(0, 500);
  }
  patch_("settings/mailScheduler", { lastRun: new Date(), lastError: lastError });
}

function processJob_(job, started) {
  const d = job.data;
  // תופסים את המשימה (אם מישהו ביטל בינתיים – העדכון ייכשל ונדלג)
  try { patch_(job.path, { status: "sending" }, job.updateTime); } catch (e) { return ""; }
  const sent = (d.sentEmails || []).slice();
  const failed = (d.failed || []).slice();
  let stopReason = "";
  const recipients = d.recipients || [];
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (sent.indexOf(r.email) >= 0) continue;
    if (Date.now() - started > TIME_BUDGET_MS) { stopReason = "time"; break; }
    const subject = fill_(d.subject, r), text = fill_(d.body, r);
    try {
      sendGmail_(r.email, r.name, subject, text);
      sent.push(r.email);
      create_("mailLog", { to: r.email, subject: subject, kind: d.kind || "", ref: r.ref || "", by: d.createdBy || "", scheduled: true, at: new Date() });
      if (r.contactId) create_("activities", { contactId: r.contactId, type: "note", details: "מייל: " + subject, amount: null, date: new Date(), source: "מייל מתוזמן", createdBy: d.createdBy || "", createdAt: new Date() });
      if (d.mark && d.mark.collection && r.ref) {
        const upd = {}; upd[d.mark.field] = new Date();
        try { patch_(d.mark.collection + "/" + r.ref, upd, "exists"); } catch (e) { /* המסמך נמחק */ }
      }
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/quota|limit|429|rate/i.test(msg)) { stopReason = "quota: " + msg.slice(0, 200); break; }
      failed.push(r.email + ": " + msg.slice(0, 150));
      sent.push(r.email); // לא מנסים שוב כתובת שנכשלה
    }
    Utilities.sleep(DELAY_MS);
  }
  const done = !stopReason;
  const okCount = sent.length - failed.length;
  patch_(job.path, {
    sentEmails: sent, failed: failed,
    status: done ? (failed.length === 0 ? "sent" : okCount > 0 ? "partial" : "failed") : "scheduled",
    lastError: stopReason, processedAt: new Date()
  });
  return stopReason.indexOf("quota") === 0 ? stopReason : "";
}

// ---------- מייל ----------
function fill_(tpl, r) {
  const vars = Object.assign({ "שם": r.name || "", "שם פרטי": r.firstName || String(r.name || "").split(" ")[0] || "" }, r.vars || {});
  return String(tpl || "").replace(/\{([^{}]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m; });
}
function b64_(s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); }
function encHeader_(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64_(s) + "?="; }
function wrap76_(s) { return s.replace(/.{1,76}/g, "$&\r\n"); }
function escHtml_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function toHtml_(text) {
  const body = escHtml_(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#85661a">$1</a>').replace(/\r?\n/g, "<br>");
  return '<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0"><div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1c1b19;max-width:640px;padding:16px">'
    + body + '<div style="margin-top:24px;padding-top:10px;border-top:2px solid #c19937;font-size:13px;color:#6b6456">' + escHtml_(ORG_NAME) + "</div></div></body></html>";
}
function sendGmail_(to, toName, subject, text) {
  const from = Session.getEffectiveUser().getEmail();
  const boundary = "mx" + Utilities.getUuid().replace(/-/g, "");
  const mime = [
    "From: " + encHeader_(ORG_NAME) + " <" + from + ">",
    "To: " + (toName ? encHeader_(toName) + " <" + to + ">" : to),
    "Subject: " + encHeader_(subject), "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', "",
    "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76_(b64_(text)),
    "--" + boundary, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76_(b64_(toHtml_(text))),
    "--" + boundary + "--", ""
  ].join("\r\n");
  const raw = Utilities.base64EncodeWebSafe(Utilities.newBlob(mime).getBytes()).replace(/=+$/, "");
  const res = UrlFetchApp.fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "post", contentType: "application/json", payload: JSON.stringify({ raw: raw }),
    headers: authHeaders_(), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error("Gmail " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
}

// ---------- Firestore (REST) ----------
function authHeaders_() {
  return { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Goog-User-Project": PROJECT_ID };
}
function call_(method, url, body) {
  const res = UrlFetchApp.fetch(url, {
    method: method, contentType: "application/json", payload: body ? JSON.stringify(body) : undefined,
    headers: authHeaders_(), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error("Firestore " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || "{}");
}
function runQuery_(structuredQuery) {
  const out = call_("post", FS + ":runQuery", { structuredQuery: structuredQuery });
  return out.filter(function (x) { return x.document; }).map(function (x) {
    return { path: x.document.name.split("/documents/")[1], updateTime: x.document.updateTime, data: fromFields_(x.document.fields || {}) };
  });
}
// ifUpdateTime: לעדכן רק אם המסמך לא השתנה; "exists": לעדכן רק מסמך קיים (לא ליצור חדש)
function patch_(path, data, ifUpdateTime) {
  const mask = Object.keys(data).map(function (k) { return "updateMask.fieldPaths=" + encodeURIComponent("`" + k + "`"); }).join("&");
  let url = FS + "/" + path + "?" + mask;
  if (ifUpdateTime === "exists") url += "&currentDocument.exists=true";
  else if (ifUpdateTime) url += "&currentDocument.updateTime=" + encodeURIComponent(ifUpdateTime);
  return call_("patch", url, { fields: toFields_(data) });
}
function create_(collection, data) { return call_("post", FS + "/" + collection, { fields: toFields_(data) }); }

function toValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue_) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "object") return { mapValue: { fields: toFields_(v) } };
  return { stringValue: String(v) };
}
function toFields_(o) { const f = {}; Object.keys(o).forEach(function (k) { f[k] = toValue_(o[k]); }); return f; }
function fromValue_(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromValue_);
  if ("mapValue" in v) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) { const o = {}; Object.keys(f).forEach(function (k) { o[k] = fromValue_(f[k]); }); return o; }
