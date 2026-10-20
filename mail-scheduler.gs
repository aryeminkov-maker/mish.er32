/**
 * הסקריפט של מכון משפטי ארץ (Google Apps Script)
 * ------------------------------------------------------------
 * רץ בחשבון ה-Gmail של המכון, כל 5 דקות:
 *  1. שולח את כל המיילים מהתור (mailQueue) – כולל קישור הסרה מרשימת התפוצה, ולא שולח למי שהסיר את עצמו.
 *  2. תזכורת אוטומטית לנרשמים כ-24 שעות לפני כל מפגש (עם קישור הזום).
 *  3. בקשת משוב אחרי המפגש האחרון של השתלמות.
 *  4. התראה לרב על שאלה חדשה, ותזכורת על שאלות שלא נענו.
 *  5. גיבוי שבועי של כל הנתונים לתיקייה ב-Google Drive של המכון.
 *  6. כתובת (Web App) שמקבלת עדכונים מ-Jgive על כל תרומה/תשלום.
 * ההוראות להתקנה: README.md, פרק "שליחת מיילים".
 */

const PROJECT_ID = "dintora-a5e10";     // מזהה פרויקט ה-Firebase
const ORG_NAME = "מכון משפטי ארץ";      // שם השולח שיופיע במייל
const DELAY_MS = 400;                    // הפסקה קצרה בין מייל למייל
const TIME_BUDGET_MS = 4.5 * 60 * 1000;  // Apps Script מוגבל ל-6 דקות לריצה
const TZ = "Asia/Jerusalem";

const FS = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";

// ---------- הפעלה ----------
// מריצים פעם אחת ידנית (Run): יוצר הפעלה אוטומטית כל 5 דקות + גיבוי שבועי
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("processQueue").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("weeklyBackup").timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("JGIVE_KEY")) props.setProperty("JGIVE_KEY", Utilities.getUuid().replace(/-/g, ""));
  saveWebAppUrl_();
  processQueue();
}

// הכתובת שמדביקים ב-Jgive (נשמרת במסמך שרק מנהל המערכת יכול לקרוא)
function saveWebAppUrl_() {
  let url = "";
  try { url = ScriptApp.getService().getUrl() || ""; } catch (e) { /* עוד לא פורסם כ-Web App */ }
  const key = PropertiesService.getScriptProperties().getProperty("JGIVE_KEY") || "";
  try { patch_("private/jgive", { webhookUrl: url ? url + "?key=" + key : "", updatedAt: new Date() }); } catch (e) { /* */ }
}

function processQueue() {
  const started = Date.now();
  let lastError = "";
  const step = function (name, fn) {
    if (Date.now() - started > TIME_BUDGET_MS) return;
    try { fn(); } catch (e) { lastError = (name + ": " + String(e && e.message || e)).slice(0, 500); }
  };
  const site = getSite_();
  step("תזכורות", function () { courseReminders_(site); });
  step("משוב", function () { feedbackRequests_(site); });
  step("שו\"ת", function () { qaNotifications_(site); });
  step("שליחה", function () {
    const jobs = runQuery_({
      from: [{ collectionId: "mailQueue" }],
      where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "scheduled" } } },
      limit: 50
    });
    const due = jobs.filter(function (j) { return Date.parse(j.data.sendAt) <= Date.now(); })
      .sort(function (a, b) { return Date.parse(a.data.sendAt) - Date.parse(b.data.sendAt); });
    if (!due.length) return;
    const blocked = optouts_();
    for (let i = 0; i < due.length; i++) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const err = processJob_(due[i], started, blocked, site);
      if (err) { lastError = err; if (/quota|limit|429/i.test(err)) break; }
    }
  });
  patch_("settings/mailScheduler", { lastRun: new Date(), lastError: lastError, account: Session.getEffectiveUser().getEmail() });
}

// כתובת האתר (נשמרת על ידי המערכת בכניסת מנהל)
function getSite_() {
  try { const d = get_("settings/site"); return String(d && d.url || "").replace(/\/?$/, "/"); } catch (e) { return ""; }
}

// ---------- שליחת התור ----------
function processJob_(job, started, blocked, site) {
  const d = job.data;
  // תופסים את המשימה (אם מישהו ביטל בינתיים – העדכון ייכשל ונדלג)
  try { patch_(job.path, { status: "sending" }, job.updateTime); } catch (e) { return ""; }
  const sent = (d.sentEmails || []).slice();
  const failed = (d.failed || []).slice();
  const base = String(d.siteUrl || site || "").replace(/\/?$/, "/");
  let stopReason = "";
  const recipients = d.recipients || [];
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const email = String(r.email || "").trim().toLowerCase();
    if (sent.indexOf(r.email) >= 0) continue;
    if (Date.now() - started > TIME_BUDGET_MS) { stopReason = "time"; break; }
    // מיילים פנימיים לצוות (התראות) – בלי קישור הסרה ובלי חסימה
    if (!d.internal && blocked[email]) { sent.push(r.email); failed.push(r.email + ": הסיר/ה את עצמו/ה מרשימת התפוצה – לא נשלח"); continue; }
    const subject = fill_(d.subject, r), text = fill_(d.body, r);
    try {
      const unsub = !d.internal && base && email ? base + "unsubscribe.html?t=" + unsubToken_(email) + "&e=" + encodeURIComponent(email) : "";
      sendGmail_(r.email, r.name, subject, text, unsub);
      sent.push(r.email);
      create_("mailLog", { to: r.email, subject: subject, kind: d.kind || "", ref: r.ref || "", by: d.createdBy || "", at: new Date() });
      if (r.contactId) create_("activities", { contactId: r.contactId, type: "note", details: "מייל: " + subject, amount: null, date: new Date(), source: "מייל מהמערכת", createdBy: d.createdBy || "", createdAt: new Date() });
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

// מי שהסיר את עצמו מרשימת התפוצה
function optouts_() {
  const out = {};
  listAll_("optouts").forEach(function (d) { const e = String(d.data.email || "").toLowerCase(); if (e) out[e] = true; });
  return out;
}
// מזהה אישי קבוע לכל כתובת (לקישור ההסרה). שמור ב-unsubByEmail ו-unsubTokens (לא נגישים מהאתר)
const tokenCache_ = {};
function unsubToken_(email) {
  if (tokenCache_[email]) return tokenCache_[email];
  let t = "";
  try { const d = get_("unsubByEmail/" + encodeURIComponent(email)); t = d && d.token || ""; } catch (e) { /* */ }
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "").slice(0, 8);
    patch_("unsubTokens/" + t, { email: email, createdAt: new Date() });
    patch_("unsubByEmail/" + encodeURIComponent(email), { token: t });
  }
  tokenCache_[email] = t;
  return t;
}

// הוספת מייל לתור מתוך הסקריפט (תזכורות, משוב, התראות)
function enqueue_(o) {
  if (!o.recipients || !o.recipients.length) return;
  for (let i = 0; i < o.recipients.length; i += 400) {
    create_("mailQueue", {
      status: "scheduled", sendAt: new Date(), subject: o.subject, body: o.body, kind: o.kind || "", title: o.title || "",
      recipients: o.recipients.slice(i, i + 400), total: Math.min(400, o.recipients.length - i), sentEmails: [], failed: [],
      mark: null, siteUrl: o.site || "", internal: !!o.internal, createdBy: "מערכת", createdAt: new Date()
    });
  }
}

// ---------- השתלמויות: תזכורת לפני מפגש ומשוב בסוף ----------
function ymd_(d) { return Utilities.formatDate(d, TZ, "yyyy-MM-dd"); }
function sessionStart_(s) { return Utilities.parseDate(s.date + " " + (s.start || "00:00"), TZ, "yyyy-MM-dd HH:mm"); }
function sessionEnd_(s) { return Utilities.parseDate(s.date + " " + (s.end || s.start || "23:59"), TZ, "yyyy-MM-dd HH:mm"); }
const HEB_DAYS_ = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function fmtDate_(iso) { const p = String(iso).split("-"); return p[2] + "." + p[1] + "." + p[0]; }
function dayName_(iso) { return HEB_DAYS_[Utilities.parseDate(iso + " 12:00", TZ, "yyyy-MM-dd HH:mm").getDay()]; }
function gcalUrl_(course, s, link) {
  const f = function (d) { return Utilities.formatDate(d, "UTC", "yyyyMMdd'T'HHmmss'Z'"); };
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(course.title + (s.topic ? " – " + s.topic : ""))
    + "&dates=" + f(sessionStart_(s)) + "/" + f(sessionEnd_(s)) + "&details=" + encodeURIComponent(link ? "קישור לזום: " + link : "") + "&ctz=" + TZ;
}
function registered_(courseId) {
  return runQuery_({
    from: [{ collectionId: "registrations" }],
    where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "courseId" }, op: "EQUAL", value: { stringValue: courseId } } },
      { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "registered" } } }] } }
  }).map(function (r) {
    return { email: r.data.email, name: [r.data.firstName, r.data.lastName].filter(String).join(" "), firstName: r.data.firstName || "", vars: {}, contactId: r.data.contactId || "", ref: r.path.split("/")[1] };
  });
}

function courseReminders_(site) {
  const now = new Date();
  const from = ymd_(now), to = ymd_(new Date(now.getTime() + 2 * 864e5));
  const sessions = runQuery_({
    from: [{ collectionId: "sessions" }],
    where: { compositeFilter: { op: "AND", filters: [
      { fieldFilter: { field: { fieldPath: "date" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: from } } },
      { fieldFilter: { field: { fieldPath: "date" }, op: "LESS_THAN_OR_EQUAL", value: { stringValue: to } } }] } }
  });
  const courses = {};
  sessions.forEach(function (sd) {
    const s = sd.data, sid = sd.path.split("/")[1];
    if (s.remindedAt) return;
    const start = sessionStart_(s);
    const hours = (start.getTime() - now.getTime()) / 36e5;
    if (hours <= 0 || hours > 24) return;
    const course = courses[s.courseId] || (courses[s.courseId] = get_("courses/" + s.courseId) || {});
    patch_(sd.path, { remindedAt: new Date() });
    if (!course.title || course.status === "draft" || course.remindersOn === false) return;
    let link = "";
    try { const p = get_("sessionPrivate/" + sid); link = p && p.zoomLink || ""; } catch (e) { /* */ }
    // חסר קישור זום – מתריעים לרכזים
    if (!link && (course.managerEmails || []).length) {
      enqueue_({ site: site, internal: true, kind: "course-zoom-missing", title: "חסר קישור זום", recipients: course.managerEmails.map(function (e) { return { email: e, name: "", firstName: "", vars: {} }; }),
        subject: "חסר קישור זום למפגש מחר – " + course.title,
        body: "שלום,\n\nלמפגש בהשתלמות \"" + course.title + "\" ביום " + dayName_(s.date) + " " + fmtDate_(s.date) + " בשעה " + s.start + " עדיין לא הוזן קישור זום.\nהתזכורת למשתלמים נשלחה בלי הקישור. כדאי להוסיף אותו במערכת (השתלמויות ← לו\"ז) – הוא יופיע להם באזור האישי.\n\n" + (site ? site + "index.html#courses" : "") });
    }
    const all = sessionsOfCourse_(s.courseId);
    const n = all.indexOf(s.date + s.start + sid) + 1;
    const when = (ymd_(now) === s.date ? "היום" : "ביום " + dayName_(s.date)) + " " + fmtDate_(s.date) + " בשעה " + s.start;
    const body = "שלום {שם פרטי},\n\nתזכורת: " + (n ? "המפגש ה-" + n + " " : "המפגש הבא ") + "בהשתלמות \"" + course.title + "\" יתקיים " + when + "."
      + (s.topic ? "\nנושא: " + s.topic : "") + (s.lecturer ? "\nמרצה: " + s.lecturer : "")
      + "\n\n" + (link ? "**להצטרפות לזום:** " + link : "קישור ההצטרפות יופיע באזור האישי.")
      + (course.calendarOn !== false ? "\n\nהוספה ליומן Google: " + gcalUrl_(course, s, link) : "")
      + (site ? "\n\nהאזור האישי (לו\"ז, קישורים והקלטות): " + site + "my.html" : "")
      + "\n\nבברכה,\n" + ORG_NAME;
    enqueue_({ site: site, kind: "course-reminder", title: "תזכורת אוטומטית · " + course.title, recipients: registered_(s.courseId),
      subject: "תזכורת: " + course.title + " – " + when, body: body });
  });
}
const sessCache_ = {};
function sessionsOfCourse_(courseId) {
  if (!sessCache_[courseId]) {
    sessCache_[courseId] = runQuery_({ from: [{ collectionId: "sessions" }],
      where: { fieldFilter: { field: { fieldPath: "courseId" }, op: "EQUAL", value: { stringValue: courseId } } } })
      .map(function (x) { return x.data.date + x.data.start + x.path.split("/")[1]; }).sort();
  }
  return sessCache_[courseId];
}

function feedbackRequests_(site) {
  const now = new Date();
  const courses = runQuery_({ from: [{ collectionId: "courses" }],
    where: { fieldFilter: { field: { fieldPath: "status" }, op: "IN", value: { arrayValue: { values: [{ stringValue: "open" }, { stringValue: "closed" }, { stringValue: "done" }] } } } } });
  courses.forEach(function (cd) {
    const c = cd.data, cid = cd.path.split("/")[1];
    if (c.feedbackSentAt || c.feedbackOn === false) return;
    const ss = runQuery_({ from: [{ collectionId: "sessions" }],
      where: { fieldFilter: { field: { fieldPath: "courseId" }, op: "EQUAL", value: { stringValue: cid } } } }).map(function (x) { return x.data; });
    if (!ss.length) return;
    ss.sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); });
    const last = ss[ss.length - 1];
    if (sessionEnd_(last).getTime() > now.getTime()) return;
    // לא שולחים בקשת משוב על השתלמות שהסתיימה לפני יותר משבוע (למשל השתלמויות ישנות)
    if (now.getTime() - sessionEnd_(last).getTime() > 7 * 864e5) { patch_(cd.path, { feedbackSentAt: new Date(0) }); return; }
    patch_(cd.path, { feedbackSentAt: new Date() });
    enqueue_({ site: site, kind: "course-feedback", title: "בקשת משוב · " + c.title, recipients: registered_(cid),
      subject: "נשמח לשמוע מה חשבת – " + c.title,
      body: "שלום {שם פרטי},\n\nתודה שהשתתפת בהשתלמות \"" + c.title + "\".\nנשמח מאוד אם תקדיש/י דקה למשוב קצר – הוא עוזר לנו לשפר את ההשתלמויות הבאות:\n"
        + (site ? site + "my.html#feedback-" + cid : "") + "\n\nבברכה,\n" + ORG_NAME });
  });
}

// ---------- שו"ת: התראה על שאלה חדשה ותזכורת על שאלות פתוחות ----------
function qaNotifications_(site) {
  const cfg = get_("settings/qaNotify");
  if (!cfg) return;
  const since = Date.parse(cfg.enabledAt || 0) || 0;
  const users = {};
  listAll_("allowedEmails").forEach(function (u) { users[u.path.split("/")[1]] = u.data; });
  const rec = function (emails) {
    const seen = {};
    return (emails || []).map(function (e) { return String(e).toLowerCase().trim(); }).filter(function (e) { if (!e || seen[e]) return false; seen[e] = true; return true; })
      .map(function (e) { const n = users[e] && users[e].name || ""; return { email: e, name: n, firstName: n.split(" ")[0] || "", vars: {} }; });
  };
  const forTopic = function (topic) { const m = cfg.byCategory || {}; return (m[topic] && m[topic].length ? m[topic] : cfg.emails) || []; };
  const link = site ? site + "index.html#questions" : "";
  const open = ["new", "in_progress"].reduce(function (acc, st) {
    return acc.concat(runQuery_({ from: [{ collectionId: "questions" }], where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: st } } } }));
  }, []);
  // 1. שאלה חדשה
  if (cfg.notifyNew !== false) {
    open.forEach(function (q) {
      const d = q.data;
      if (d.status !== "new" || d.notifiedAt || (Date.parse(d.createdAt) || 0) < since) return;
      patch_(q.path, { notifiedAt: new Date() });
      const to = d.rabbiEmail ? [d.rabbiEmail] : forTopic(d.topic);
      enqueue_({ site: site, internal: true, kind: "qa-new", title: "התראה על שאלה חדשה", recipients: rec(to),
        subject: "שאלה חדשה" + (d.topic ? " בנושא " + d.topic : "") + " – שו\"ת משפטי ארץ",
        body: "שלום {שם פרטי},\n\nהתקבלה שאלה חדשה" + (d.topic ? " בקטגוריה \"" + d.topic + "\"" : "") + ":\n\n" + String(d.text || "").slice(0, 1500)
          + "\n\nלמענה במערכת: " + link + "\n\nבברכה,\nמערכת " + ORG_NAME });
    });
  }
  // 2. תזכורת על שאלות שממתינות יותר מ-X ימים (מקבץ אחד לכל נמען)
  const days = Number(cfg.remindDays) || 0;
  if (cfg.remind !== false && days > 0) {
    const cutoff = Date.now() - days * 864e5;
    const byTo = {};
    open.forEach(function (q) {
      const d = q.data;
      if ((Date.parse(d.createdAt) || Date.now()) > cutoff || (Date.parse(d.lastRemindAt) || 0) > cutoff || (Date.parse(d.createdAt) || 0) < since) return;
      const to = (d.rabbiEmail ? [d.rabbiEmail] : forTopic(d.topic)).concat(cfg.remindAlso || []);
      to.forEach(function (e) { e = String(e).toLowerCase(); byTo[e] = byTo[e] || []; if (byTo[e].indexOf(q) < 0) byTo[e].push(q); });
      patch_(q.path, { lastRemindAt: new Date() });
    });
    Object.keys(byTo).forEach(function (e) {
      const list = byTo[e];
      enqueue_({ site: site, internal: true, kind: "qa-remind", title: "תזכורת על שאלות פתוחות", recipients: rec([e]),
        subject: (list.length === 1 ? "שאלה אחת ממתינה" : list.length + " שאלות ממתינות") + " למענה – שו\"ת משפטי ארץ",
        body: "שלום {שם פרטי},\n\n" + (list.length === 1 ? "שאלה אחת ממתינה" : list.length + " שאלות ממתינות") + " למענה יותר מ-" + days + " ימים:\n\n"
          + list.map(function (q) { return "• " + (q.data.topic ? "[" + q.data.topic + "] " : "") + String(q.data.text || "").replace(/\s+/g, " ").slice(0, 140); }).join("\n")
          + "\n\nלמענה במערכת: " + link + "\n\nבברכה,\nמערכת " + ORG_NAME });
    });
  }
}

// ---------- גיבוי שבועי ל-Google Drive ----------
const BACKUP_COLLECTIONS = ["contacts", "activities", "questions", "publicQA", "allowedEmails", "savedLists", "courses", "sessions", "sessionPrivate",
  "recordings", "materials", "registrations", "courseAccess", "courseMedia", "feedback", "monthly", "settings", "optouts", "orders", "institutions",
  "distributions", "jgiveInbox", "auditLog", "mailLog"];
function weeklyBackup() {
  const data = { exportedAt: new Date().toISOString(), project: PROJECT_ID, collections: {} };
  BACKUP_COLLECTIONS.forEach(function (c) {
    try { data.collections[c] = listAll_(c).map(function (d) { const o = d.data; o._id = d.path.split("/").slice(1).join("/"); return o; }); }
    catch (e) { data.collections[c] = { error: String(e.message || e).slice(0, 200) }; }
  });
  const folder = backupFolder_();
  const name = "גיבוי-משפטי-ארץ-" + Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd") + ".json";
  driveUpload_(folder, name, JSON.stringify(data));
  // משאירים 12 גיבויים אחרונים
  const files = driveCall_("get", "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent("'" + folder + "' in parents and trashed=false") + "&orderBy=createdTime desc&fields=files(id,name)").files || [];
  files.slice(12).forEach(function (f) { try { driveCall_("delete", "https://www.googleapis.com/drive/v3/files/" + f.id); } catch (e) { /* */ } });
  patch_("settings/mailScheduler", { lastBackup: new Date(), lastBackupFile: name });
}
function backupFolder_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty("BACKUP_FOLDER");
  if (id) { try { const f = driveCall_("get", "https://www.googleapis.com/drive/v3/files/" + id + "?fields=id,trashed"); if (!f.trashed) return id; } catch (e) { /* */ } }
  id = driveCall_("post", "https://www.googleapis.com/drive/v3/files", { name: "גיבוי מערכת משפטי ארץ", mimeType: "application/vnd.google-apps.folder" }).id;
  props.setProperty("BACKUP_FOLDER", id);
  return id;
}
function driveUpload_(folder, name, content) {
  const boundary = "b" + Utilities.getUuid().replace(/-/g, "");
  const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify({ name: name, parents: [folder] })
    + "\r\n--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + content + "\r\n--" + boundary + "--";
  const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "post", contentType: "multipart/related; boundary=" + boundary, payload: Utilities.newBlob(body).getBytes(),
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("Drive " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
}
function driveCall_(method, url, body) {
  const res = UrlFetchApp.fetch(url, { method: method, contentType: "application/json", payload: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) throw new Error("Drive " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || "{}");
}

// ---------- Jgive: עדכון על כל תרומה/תשלום (Webhook) ----------
// ב-Jgive: אזור הארגון ← הגדרות חשבון ← Integrations ← Webhook URL = הכתובת שמופיעה במערכת (הגדרות ← Jgive)
function doPost(e) {
  const key = PropertiesService.getScriptProperties().getProperty("JGIVE_KEY");
  if (!key || !e || !e.parameter || e.parameter.key !== key) return ContentService.createTextOutput("forbidden");
  let body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || "{}"); } catch (err) { body = { raw: String(e.postData && e.postData.contents || "") }; }
  const pick = function (obj, path) { return path.split(".").reduce(function (o, k) { return o && o[k] !== undefined ? o[k] : undefined; }, obj); };
  const first = function () { for (let i = 0; i < arguments.length; i++) { const v = pick(body, arguments[i]); if (v !== undefined && v !== null && v !== "") return v; } return ""; };
  const id = String(first("donation.donation_id", "donation_id", "transfer.id", "id") || Utilities.getUuid());
  const rec = {
    jgiveId: id,
    email: String(first("donor.email", "email")).toLowerCase(),
    firstName: String(first("donor.first_name", "first_name")), lastName: String(first("donor.last_name", "last_name")),
    fullName: String(first("donor.full_name", "full_name")), phone: String(first("donor.phone_number", "phone_number", "phone")),
    amount: Number(first("transfer.amount", "donation.amount", "amount")) || 0,
    currency: String(first("transfer.currency", "donation.amount_currency", "currency") || "ILS"),
    date: String(first("transfer.completed_at", "donation.created_at", "created_at")),
    purpose: String(first("donation.purpose_he", "donation_target.name_he", "donation.purpose_en", "donation_target.name_en", "purpose")),
    comment: String(first("donation.comment", "comment")), recurring: !!first("donation.recurring"),
    receiveUpdates: !!first("donation.receive_updates_from_charities"),
    refunded: !!first("transfer.refunded_at"),
    raw: JSON.stringify(body).slice(0, 20000), receivedAt: new Date(), processed: false
  };
  try { patch_("jgiveInbox/" + encodeURIComponent(id.replace(/\//g, "_")), rec); }
  catch (err) { return ContentService.createTextOutput("error"); }
  return ContentService.createTextOutput("ok");
}
function doGet() { return ContentService.createTextOutput("מכון משפטי ארץ – הכתובת פעילה"); }

// ---------- מייל ----------
function fill_(tpl, r) {
  const vars = Object.assign({ "שם": r.name || "", "שם פרטי": r.firstName || String(r.name || "").split(" ")[0] || "" }, r.vars || {});
  return String(tpl || "").replace(/\{([^{}]+)\}/g, function (m, k) { return Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m; });
}
function b64_(s) { return Utilities.base64Encode(s, Utilities.Charset.UTF_8); }
function encHeader_(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + b64_(s) + "?="; }
function wrap76_(s) { return s.replace(/.{1,76}/g, "$&\r\n"); }
function escHtml_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
// סימון קל בגוף המייל: "## כותרת", "### כותרת משנה", **מודגש**, __קו תחתון__
function markupToHtml_(text) {
  const inline = function (x) {
    return x.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#85661a">$1</a>');
  };
  const lines = escHtml_(text).split(/\r?\n/);
  let out = "";
  lines.forEach(function (l, i) {
    if (/^####\s+/.test(l)) out += '<h5 style="font-size:15px;margin:10px 0 2px;color:#1c1b19;text-decoration:underline">' + inline(l.replace(/^####\s+/, "")) + "</h5>";
    else if (/^###\s+/.test(l)) out += '<h4 style="font-size:16px;margin:12px 0 2px;color:#1c1b19">' + inline(l.replace(/^###\s+/, "")) + "</h4>";
    else if (/^##\s+/.test(l)) out += '<h3 style="font-size:19px;margin:16px 0 4px;color:#85661a">' + inline(l.replace(/^##\s+/, "")) + "</h3>";
    else out += inline(l) + (i < lines.length - 1 && !/^#{2,4}\s+/.test(lines[i + 1] || "") ? "<br>" : "");
  });
  return out;
}
function stripMarkup_(text) {
  return String(text).replace(/^#{2,4}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
}
function toHtml_(text, unsub) {
  const body = markupToHtml_(text);
  return '<!doctype html><html dir="rtl" lang="he"><body style="margin:0;padding:0"><div dir="rtl" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#1c1b19;max-width:640px;padding:16px">'
    + body + '<div style="margin-top:24px;padding-top:10px;border-top:2px solid #c19937;font-size:13px;color:#6b6456">' + escHtml_(ORG_NAME)
    + (unsub ? '<div style="margin-top:6px;font-size:12px">לא רוצים לקבל מאיתנו מיילים? <a href="' + escHtml_(unsub) + '" style="color:#6b6456">להסרה מרשימת התפוצה</a></div>' : "")
    + "</div></div></body></html>";
}
function sendGmail_(to, toName, subject, text, unsub) {
  const from = Session.getEffectiveUser().getEmail();
  const boundary = "mx" + Utilities.getUuid().replace(/-/g, "");
  const mime = [
    "From: " + encHeader_(ORG_NAME) + " <" + from + ">",
    "To: " + (toName ? encHeader_(toName) + " <" + to + ">" : to),
    "Subject: " + encHeader_(subject), "MIME-Version: 1.0",
    unsub ? "List-Unsubscribe: <" + unsub + ">" : "X-Mailer: Mishpetei-Eretz",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', "",
    "--" + boundary, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76_(b64_(stripMarkup_(text) + (unsub ? "\n\n--\nלהסרה מרשימת התפוצה: " + unsub : ""))),
    "--" + boundary, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap76_(b64_(toHtml_(text, unsub))),
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
function get_(path) {
  const res = UrlFetchApp.fetch(FS + "/" + path, { method: "get", headers: authHeaders_(), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return null;
  if (res.getResponseCode() >= 300) throw new Error("Firestore " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
  return fromFields_(JSON.parse(res.getContentText()).fields || {});
}
// כל המסמכים באוסף (בדפים)
function listAll_(collection) {
  const out = [];
  let token = "";
  do {
    const r = call_("get", FS + "/" + collection + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : ""));
    (r.documents || []).forEach(function (d) { out.push({ path: d.name.split("/documents/")[1], data: fromFields_(d.fields || {}) }); });
    token = r.nextPageToken || "";
  } while (token);
  return out;
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
