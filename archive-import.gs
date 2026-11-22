// =====================================================================
// ייבוא מאגר השו"ת מהאתר הקיים (dintora.org) – קובץ נפרד באותו פרויקט Apps Script
// שלב 1 (archiveScan): עובר על כל הדפים באתר (Show_article/1 עד האחרון), מזהה את הדפים שיש בהם
//   "שאלה" ו"תשובה", ושומר אותם בגיליון "ייבוא שו\"ת מאתר המכון" ב-Drive. שאר הדפים (מאמרים וכו') –
//   נרשמים בלשונית "דפים אחרים" לבדיקה.
//   לא כותב כלום למערכת. רץ במנות של כ-4 דקות וממשיך לבד עד הסוף (כמה דקות עד חצי שעה).
// שלב 2 (archiveImport): יגיע בהמשך – אחרי שנחליט על המיפוי של התגיות לקטגוריות.
// בדיקה מהירה לפני הכול: archiveTest – מנתח 3 שאלות ומדפיס ליומן (לא שומר כלום).
// =====================================================================
const ARCH_SITE = "https://www.dintora.org";
const ARCH_LIST = ARCH_SITE + "/index.php/Show_articles/20?pn=";
const ARCH_COLS = ["מזהה", "קישור", "כותרת", "רב", "תגיות", "תקציר", "שאלה", "תשובה", "תשובה HTML", "סטטוס", "הערה"];
const ARCH_BUDGET_MS = 4.2 * 60 * 1000;

// ---------- בדיקה ----------
function archiveTest() {
  const ids = [703, 1435, 753, 847, 572, 1455];
  const out = [];
  ids.forEach(function (id) {
    try {
      const html = archFetch_(ARCH_SITE + "/Show_article/" + id);
      const a = archParse_(html);
      out.push("=== " + id + " ===",
        "שו\"ת? " + (a.isQA ? "כן" : "לא – זה מאמר/דף אחר"), "כותרת: " + a.title, "רב: " + a.rabbi, "תגיות: " + a.tags.join(", "), "תקציר: " + a.summary.slice(0, 120),
        "שאלה (" + a.question.length + " תווים): " + a.question.slice(0, 200).replace(/\n/g, " / "),
        "תשובה (" + a.answer.length + " תווים): " + a.answer.slice(0, 200).replace(/\n/g, " / "),
        "סוף התשובה: …" + a.answer.slice(-150).replace(/\n/g, " / "),
        "HTML של התשובה: " + a.answerHtml.length + " תווים", "בעיות: " + (a.problems.join(", ") || "אין"),
        "");
    } catch (e) { out.push("=== " + id + " === שגיאה: " + e.message); }
  });
  console.log(out.join("\n"));
}

// מבנה הדף: כל הכותרות והמילים המודגשות הקצרות (לאבחון)
function archOutline_(html) {
  const h1 = Math.max(0, html.search(/<h1[\s>]/i)), end = html.indexOf("הדפיסו", h1);
  const seg = html.slice(h1, end > 0 ? end : h1 + 60000), out = [];
  const re = /<(h[1-6]|strong|b|u)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(seg)) && out.length < 25) { const t = archText_(m[3]).replace(/^## /, "").replace(/\*\*|__/g, ""); if (t && t.length < 60) out.push(m[1].toLowerCase() + ":" + t); }
  const txt = archText_(seg), around = [];
  ["שאל", "תשוב", "השאלה", "התשובה"].forEach(function (w) {
    const i = txt.indexOf(w, 40);
    if (i >= 0) around.push("[" + w + "] …" + txt.slice(Math.max(0, i - 60), i + 120).replace(/\n/g, " / ") + "…");
    const j = seg.indexOf(w, 200);
    if (j >= 0) around.push("[קוד " + w + "] " + seg.slice(Math.max(0, j - 80), j + 60).replace(/\s+/g, " "));
  });
  return out.join(" | ") + " || תחילת הטקסט: " + txt.slice(0, 200).replace(/\n/g, " / ") + " || " + around.join(" || ");
}
// קטע מקוד הדף (לאבחון בבדיקה)
function archSnip_(html, word) {
  const h1 = Math.max(0, html.search(/<h1[\s>]/i));
  const i = html.indexOf(word, h1);
  return i < 0 ? "(לא נמצא)" : html.slice(Math.max(0, i - 120), i + 220).replace(/\s+/g, " ");
}

// ---------- שלב 1: סריקה לגיליון ----------
function archiveScan() {
  // הרצה אחת בכל פעם – אם כבר רצה סריקה, יוצאים בלי לגעת בכלום
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) { console.log("סריקה אחרת כבר רצה כרגע – ההרצה הזו מדלגת."); return; }
  const started = Date.now();
  const props = PropertiesService.getScriptProperties();
  const ss = archSheet_();
  const sh = ss.getSheetByName("שו\"ת"), other = ss.getSheetByName("דפים אחרים");
  let state = JSON.parse(props.getProperty("ARCH_STATE") || "null");
  archClearTriggers_();
  // רשת ביטחון: אם ההרצה תיעצר באמצע (מגבלת 6 הדקות של גוגל) – היא תמשיך לבד בעוד 8 דקות
  ScriptApp.newTrigger("archiveScan").timeBased().after(8 * 60 * 1000).create();
  try {
    if (!state) state = { next: 1, max: archMaxId_() + 40 };
    const from = state.next; let nQa = 0, nFail = 0;
    // הרצות קודמות שלא התקדמו – עוברים לטעינה של דף אחד בכל פעם
    state.noProg = state.lastNext === state.next ? (state.noProg || 0) + 1 : 0;
    state.lastNext = state.next;
    props.setProperty("ARCH_STATE", JSON.stringify(state));
    const slow = state.noProg >= 1;
    // דף שתקע את הסריקה פעמיים (גוגל עצר את ההרצה בזמן שחיכינו לו) – מדלגים עליו ורושמים אותו
    if (state.stuck && state.stuck.id === state.next && state.stuck.n >= 2) {
      other.appendRow([state.next, ARCH_SITE + "/Show_article/" + state.next, "", "לא נגיש: הדף לא נטען (דולג)"]);
      state.next++; state.stuck = null; nFail++;
      props.setProperty("ARCH_STATE", JSON.stringify(state));
    }
    while (Date.now() - started < ARCH_BUDGET_MS && state.next <= state.max) {
      const ids = [];
      for (let k = 0; k < 12 && state.next + k <= state.max; k++) ids.push(state.next + k);
      const res = archFetchMany_(ids.map(function (id) { return ARCH_SITE + "/Show_article/" + id; }), started + ARCH_BUDGET_MS, slow, function (k) {
        // לפני כל דף שנטען לבד – זוכרים אותו, כדי לזהות דף שתוקע את הסריקה
        const id = ids[k];
        if (state.stuck && state.stuck.id === id && state.stuck.n >= 2) { state.stuck = null; return "skip"; } // תקע פעמיים – מדלגים
        state.stuck = { id: id, n: state.stuck && state.stuck.id === id ? state.stuck.n + 1 : 1 };
        props.setProperty("ARCH_STATE", JSON.stringify(state));
      });
      if (!res.length) break; // נגמר הזמן – נמשיך מאותו דף בהרצה הבאה
      ids.length = res.length; // אם רק חלק מהמנה נטען – שומרים אותו ומתקדמים בהתאם
      const qa = [], rest = [];
      res.forEach(function (r, j) {
        const id = ids[j], url = ARCH_SITE + "/Show_article/" + id;
        if (r.err) { nFail++; rest.push([id, url, "", "לא נגיש: " + r.err]); return; }
        const code = r.code;
        if (code !== 200) { if (code !== 404 && code !== 301 && code !== 302) rest.push([id, url, "", "HTTP " + code]); return; }
        try {
          const a = archParse_(r.text);
          if (!a.title) return; // דף שלא קיים
          if (!a.isQA) { rest.push([id, url, a.title, "אין שאלה ותשובה"]); return; }
          const cut = function (x) { return x.length > 49000 ? x.slice(0, 49000) : x; };
          qa.push([id, url, a.title, a.rabbi, a.tags.join(", "), a.summary, cut(a.question), cut(a.answer), cut(a.answerHtml), a.problems.length ? "לבדיקה" : "תקין", a.problems.join(", ")]);
        } catch (e) { rest.push([id, url, "", "שגיאה: " + String(e.message || e).slice(0, 150)]); }
      });
      nQa += qa.length;
      if (qa.length) sh.getRange(sh.getLastRow() + 1, 1, qa.length, ARCH_COLS.length).setValues(qa);
      if (rest.length) other.getRange(other.getLastRow() + 1, 1, rest.length, 4).setValues(rest);
      state.next += ids.length; // מתקדמים רק אחרי שהמנה נשמרה
      state.stuck = null;
      props.setProperty("ARCH_STATE", JSON.stringify(state));
      Utilities.sleep(300);
    }
    if (state.next > state.max) {
      archClearTriggers_();
      archDedupe_(sh); archDedupe_(other);
      archTagSummary_(ss);
      props.deleteProperty("ARCH_STATE");
      const n = Math.max(0, sh.getLastRow() - 1);
      const st = n ? sh.getRange(2, 10, n, 1).getValues().map(function (r) { return r[0]; }) : [];
      console.log("הסריקה הסתיימה ✓ נבדקו הדפים 1 עד " + state.max + ". נמצאו " + n + " שו\"תים (" + st.filter(function (x) { return x === "לבדיקה"; }).length + " לבדיקה), ועוד "
        + Math.max(0, other.getLastRow() - 1) + " דפים אחרים.\nהגיליון: " + ss.getUrl());
      return;
    }
    props.setProperty("ARCH_STATE", JSON.stringify(state));
    archClearTriggers_();
    ScriptApp.newTrigger("archiveScan").timeBased().after(60 * 1000).create();
    console.log("בהרצה הזו: דפים " + from + "–" + (state.next - 1) + " (" + (state.next - from) + " דפים, " + nQa + " שו\"תים, " + nFail + " לא נגישים, " + Math.round((Date.now() - started) / 1000) + " שניות).\n"
      + "נסרקו עד דף " + (state.next - 1) + " מתוך " + state.max + ". ממשיך אוטומטית בעוד דקה (אפשר לסגור את הדף). הגיליון: " + ss.getUrl());
  } catch (e) {
    if (state) props.setProperty("ARCH_STATE", JSON.stringify(state));
    archClearTriggers_();
    ScriptApp.newTrigger("archiveScan").timeBased().after(2 * 60 * 1000).create();
    console.log("שגיאה זמנית, ינסה שוב בעוד 2 דקות: " + e.message);
  }
}
// הורדת כמה דפים במקביל. אם האתר דוחה בקשה – מנסים כל דף לבד, עם ניסיון חוזר.
function archFetchMany_(urls, deadline, oneByOne, onBefore) {
  const opt = function (u) { return { url: u, muteHttpExceptions: true, followRedirects: false }; };
  try {
    if (oneByOne) throw new Error("one by one");
    return UrlFetchApp.fetchAll(urls.map(opt)).map(function (r) { return { code: r.getResponseCode(), text: r.getContentText() }; });
  } catch (e) {
    // מנה שנכשלה – כל דף לבד. מחזירים רק את מה שהספקנו (המשך בהרצה הבאה)
    const out = [];
    for (let k = 0; k < urls.length; k++) {
      if (deadline && Date.now() > deadline - 70 * 1000) break; // צריך מרווח: בקשה תקועה יכולה לקחת עד דקה
      if (onBefore && onBefore(k) === "skip") { out.push({ err: "הדף לא נטען פעמיים (דולג)" }); continue; }
      try { const r = UrlFetchApp.fetch(urls[k], opt(urls[k])); out.push({ code: r.getResponseCode(), text: r.getContentText() }); }
      catch (e2) { out.push({ err: String(e2.message || e2).slice(0, 120) }); }
    }
    return out;
  }
}
// ---------- בדיקה חוזרת עם הזיהוי המשופר ----------
// עובר על "דפים אחרים" (ועל שו"תים שזוהו לפי טקסט), ומעביר ל"שו\"ת" כל דף שמתברר כשאלה ותשובה.
// ממשיך לבד ברקע עד הסוף, כמו הסריקה. אפשר להריץ שוב בבטחה – מה שכבר נבדק מסומן ולא נבדק שוב.
function archiveRecheck() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) { console.log("בדיקה אחרת כבר רצה כרגע – ההרצה הזו מדלגת."); return; }
  const started = Date.now(), deadline = started + ARCH_BUDGET_MS;
  const ss = archSheet_(), sh = ss.getSheetByName("שו\"ת"), other = ss.getSheetByName("דפים אחרים");
  const clear = function () { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "archiveRecheck") ScriptApp.deleteTrigger(t); }); };
  clear();
  ScriptApp.newTrigger("archiveRecheck").timeBased().after(8 * 60 * 1000).create(); // רשת ביטחון
  const cut = function (x) { return x.length > 49000 ? x.slice(0, 49000) : x; };
  const rowOf = function (id, url, a) { return [id, url, a.title, a.rabbi, a.tags.join(", "), a.summary, cut(a.question), cut(a.answer), cut(a.answerHtml), a.problems.length ? "לבדיקה" : "תקין", a.problems.join(", ")]; };
  let moved = 0, fixed = 0, checked = 0;
  // א. דפים אחרים
  const on = other.getLastRow() - 1;
  const orows = on > 0 ? other.getRange(2, 1, on, 4).getValues() : [];
  const todo = [];
  orows.forEach(function (r, i) { if (r[3] === "אין שאלה ותשובה" || /^לא נגיש/.test(String(r[3]))) todo.push(i); });
  for (let p = 0; p < todo.length && Date.now() < deadline; p += 12) {
    const part = todo.slice(p, p + 12);
    const res = archFetchMany_(part.map(function (i) { return orows[i][1]; }), deadline, false, null);
    const add = [];
    res.forEach(function (r, j) {
      const i = part[j], cell = other.getRange(i + 2, 4);
      checked++;
      if (r.err || r.code !== 200) { cell.setValue("לא נגיש: " + (r.err || "HTTP " + r.code)); return; }
      const a = archParse_(r.text);
      if (a.isQA) { add.push(rowOf(orows[i][0], orows[i][1], a)); cell.setValue("הועבר לשו\"ת"); moved++; }
      else cell.setValue(a.title ? "נבדק שוב – לא שו\"ת" : "דף ריק");
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, ARCH_COLS.length).setValues(add);
    if (res.length < part.length) break;
  }
  // ב. שו"תים שזוהו לפי טקסט – עכשיו עם העיצוב
  if (Date.now() < deadline) {
    const qn = sh.getLastRow() - 1;
    const qrows = qn > 0 ? sh.getRange(2, 1, qn, 11).getValues() : [];
    const redo = [];
    qrows.forEach(function (r, i) { if (/זוהה לפי טקסט/.test(String(r[10]))) redo.push(i); });
    for (let p = 0; p < redo.length && Date.now() < deadline; p += 12) {
      const part = redo.slice(p, p + 12);
      const res = archFetchMany_(part.map(function (i) { return qrows[i][1]; }), deadline, false, null);
      res.forEach(function (r, j) {
        const i = part[j];
        if (r.err || r.code !== 200) { sh.getRange(i + 2, 11).setValue("בדיקה חוזרת נכשלה (הדף לא נטען) – נשאר בלי עיצוב"); return; }
        const a = archParse_(r.text);
        if (a.isQA) { sh.getRange(i + 2, 1, 1, 11).setValues([rowOf(qrows[i][0], qrows[i][1], a)]); fixed++; }
        else sh.getRange(i + 2, 11).setValue("בדיקה חוזרת לא זיהתה – לבדוק ידנית");
      });
      if (res.length < part.length) break;
    }
  }
  // סיום?
  const left = other.getLastRow() > 1 ? other.getRange(2, 4, other.getLastRow() - 1, 1).getValues().filter(function (r) { return r[0] === "אין שאלה ותשובה"; }).length : 0;
  const leftQ = sh.getLastRow() > 1 ? sh.getRange(2, 11, sh.getLastRow() - 1, 1).getValues().filter(function (r) { return /זוהה לפי טקסט/.test(String(r[0])); }).length : 0;
  if (!left && !leftQ) {
    clear();
    // מוחקים מ"דפים אחרים" את מה שהועבר, מסדרים את השו"ת לפי מספר ומעדכנים את התגיות
    const vals = other.getRange(2, 4, Math.max(1, other.getLastRow() - 1), 1).getValues();
    for (let k = vals.length - 1; k >= 0; k--) if (vals[k][0] === "הועבר לשו\"ת") other.deleteRow(k + 2);
    archDedupe_(sh);
    if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, ARCH_COLS.length).sort(1);
    archTagSummary_(ss);
    const total = sh.getLastRow() - 1;
    const st = sh.getRange(2, 10, total, 1).getValues().filter(function (r) { return r[0] === "לבדיקה"; }).length;
    console.log("הבדיקה החוזרת הסתיימה ✓ בהרצה הזו: " + moved + " דפים הועברו לשו\"ת, " + fixed + " שו\"תים עודכנו.\nסה\"כ בלשונית שו\"ת: " + total + " (" + st + " לבדיקה). נשארו " + (other.getLastRow() - 1) + " דפים אחרים.\nהגיליון: " + ss.getUrl());
    return;
  }
  clear();
  ScriptApp.newTrigger("archiveRecheck").timeBased().after(60 * 1000).create();
  console.log("בהרצה הזו: נבדקו " + checked + " דפים, " + moved + " הועברו לשו\"ת, " + fixed + " שו\"תים עודכנו. נשארו " + left + " דפים ו-" + leftQ + " שו\"תים לבדיקה. ממשיך אוטומטית בעוד דקה.");
}

// לסרוק שוב רק את הדפים שהיו "לא נגישים" (אחרי שהסריקה הסתיימה)
function archiveRetryFailed() {
  const ss = archSheet_(), sh = ss.getSheetByName("שו\"ת"), other = ss.getSheetByName("דפים אחרים");
  const n = other.getLastRow() - 1;
  if (n < 1) return console.log("אין דפים לבדיקה חוזרת");
  const rows = other.getRange(2, 1, n, 4).getValues();
  let fixed = 0, still = 0;
  const started = Date.now();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (Date.now() - started > ARCH_BUDGET_MS) { console.log("נגמר הזמן – מריצים שוב את archiveRetryFailed כדי להמשיך"); break; }
    if (!/^לא נגיש|^HTTP 5/.test(String(rows[i][3]))) continue;
    const r = archFetchMany_([rows[i][1]])[0];
    if (r.err || r.code !== 200) { still++; continue; }
    const a = archParse_(r.text);
    if (a.isQA) { const cut = function (x) { return x.length > 49000 ? x.slice(0, 49000) : x; };
      sh.appendRow([rows[i][0], rows[i][1], a.title, a.rabbi, a.tags.join(", "), a.summary, cut(a.question), cut(a.answer), cut(a.answerHtml), a.problems.length ? "לבדיקה" : "תקין", a.problems.join(", ")]); }
    if (a.title) { other.deleteRow(i + 2); if (!a.isQA) other.appendRow([rows[i][0], rows[i][1], a.title, "אין שאלה ותשובה"]); }
    else other.deleteRow(i + 2);
    fixed++; Utilities.sleep(800);
  }
  archTagSummary_(ss);
  console.log("נבדקו שוב: " + fixed + " הצליחו, " + still + " עדיין לא נגישים");
}

// המספר הגבוה ביותר של דף שמופיע בעמוד הבית או בעמודי הרשימות
function archMaxId_() {
  let max = 0;
  [ARCH_SITE + "/", ARCH_LIST + 1].forEach(function (u) {
    try { const h = archFetch_(u); const re = /Show_article\/(\d+)/g; let m; while ((m = re.exec(h))) max = Math.max(max, Number(m[1])); } catch (e) { /* */ }
  });
  return max || 1500;
}
// להתחיל את הסריקה מחדש מאפס (מוחק את הגיליון הקיים)
function archiveReset() {
  archClearTriggers_();
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("ARCH_SHEET"); props.deleteProperty("ARCH_STATE");
  console.log("אופס. בהרצה הבאה של archiveScan ייווצר גיליון חדש (את הישן אפשר למחוק ידנית מ-Drive).");
}

// ---------- עזר ----------
function archSheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("ARCH_SHEET");
  if (id) {
    // גיליון גדול נפתח לפעמים לאט – כמה ניסיונות לפני שמוותרים (לא יוצרים גיליון חדש בגלל עיכוב)
    for (let t = 0; t < 4; t++) {
      try { return SpreadsheetApp.openById(id); }
      catch (e) {
        if (!/זמן|timed out|time/i.test(String(e.message)) && t === 0) break; // הגיליון נמחק – ייווצר חדש
        if (t === 3) throw new Error("הגיליון לא נפתח (עומס זמני בגוגל). נסו שוב בעוד כמה דקות.");
        Utilities.sleep(5000 * (t + 1));
      }
    }
  }
  const ss = SpreadsheetApp.create("ייבוא שו\"ת מאתר המכון");
  const sh = ss.getSheets()[0].setName("שו\"ת");
  sh.getRange(1, 1, 1, ARCH_COLS.length).setValues([ARCH_COLS]).setFontWeight("bold");
  sh.setFrozenRows(1); sh.setRightToLeft(true);
  const o = ss.insertSheet("דפים אחרים");
  o.getRange(1, 1, 1, 4).setValues([["מזהה", "קישור", "כותרת", "סיבה"]]).setFontWeight("bold");
  o.setFrozenRows(1); o.setRightToLeft(true);
  props.setProperty("ARCH_SHEET", ss.getId());
  return ss;
}
function archClearTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "archiveScan") ScriptApp.deleteTrigger(t); });
}
function archFetch_(url) {
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error("HTTP " + r.getResponseCode());
  return r.getContentText();
}
function archDecode_(s) {
  return String(s || "").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(Number(d)); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }).replace(/&amp;/g, "&");
}
// HTML ← טקסט עם סימון פשוט (**מודגש**, __קו תחתון__, ## כותרת) – הסימון שהמערכת מבינה
function archText_(html) {
  let s = String(html || "").replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<h[1-4][^>]*>/gi, "\n## ").replace(/<\/h[1-6]>/gi, "\n").replace(/<h[56][^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<(p|div|blockquote|table|ul|ol)(\s[^>]*)?>/gi, "\n").replace(/<\/(p|div|li|tr|blockquote|ul|ol|table)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
    .replace(/<(b|strong)(\s[^>]*)?>/gi, "**").replace(/<\/(b|strong)>/gi, "**").replace(/<u(\s[^>]*)?>/gi, "__").replace(/<\/u>/gi, "__")
    .replace(/<[^>]+>/g, "");
  s = archDecode_(s).replace(/\*\*(\s*)\*\*/g, "$1").replace(/__(\s*)__/g, "$1").replace(/\*\*\s*\*\*/g, "");
  return s.split("\n").map(function (l) { return l.replace(/[ \t ]+/g, " ").trim(); }).join("\n").replace(/\n## \n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// ניקוי HTML של התשובה (המערכת מנקה שוב בתצוגה)
function archCleanHtml_(html) {
  return String(html || "").replace(/<(script|style|noscript|iframe|form|button|img|svg)[\s\S]*?(<\/\1>|\/?>)/gi, "").replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s(style|class|id|on\w+|data-[\w-]+)="[^"]*"/gi, "").replace(/<[^>]*$/, "").replace(/(<[a-z][^>]*>\s*)+$/i, "").trim();
}
function archListIds_(html) {
  const out = [], seen = {};
  const re = /href="[^"]*\/Show_article\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = archText_(m[2]).replace(/^## /, "");
    if (!seen[m[1]] && t && !/קראו עוד/.test(t)) { seen[m[1]] = 1; out.push({ id: Number(m[1]), title: t }); }
  }
  // "שו"תים אחרונים" בצד מופיעים בכל עמוד – מסננים לפי הופעה בגוף הרשימה בלבד (נבדק בכמות: עמוד ריק יחזיר רק אותם)
  return out;
}
function archParse_(html) {
  const problems = [];
  const h1 = html.search(/<h1[\s>]/i);
  if (h1 < 0) problems.push("אין כותרת");
  let end = html.indexOf("הדפיסו", Math.max(0, h1));
  if (end < 0) { end = html.length; problems.push("לא נמצא סוף התשובה"); }
  const seg = html.slice(Math.max(0, h1), end);
  const title = archText_((seg.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "").replace(/^## /, "");
  const rabbi = archText_((seg.match(/href\s*=\s*["']?[^"'\s>]*\/Writers\/\d+[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || "");
  const summary = archDecode_((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1] || "").trim();
  // סימון "שאלה"/"השאלה" ו"תשובה"/"התשובה"/"תשובה בקצרה" – ככותרת, בהדגשה, או כפסקה ("השאלה:<br>...")
  const h1e = Math.max(0, seg.search(/<\/h1>/i));
  const Q = />(?:\s|&nbsp;|<[^>\/][^>]*>)*ה?שאלה\s*:?(?:\s|&nbsp;)*(?=<)/g;
  const A = />(?:\s|&nbsp;|<[^>\/][^>]*>)*ה?תשובה(?:\s+(?:בקצרה|קצרה|בהרחבה|מלאה|מקוצרת))?\s*:?(?:\s|&nbsp;)*(?=<)/g;
  Q.lastIndex = h1e;
  const qm = Q.exec(seg);
  let question = "", answer = "", answerHtml = "", tagZone = seg;
  if (qm) {
    A.lastIndex = qm.index + qm[0].length;
    const am = A.exec(seg);
    if (am) {
      const stripEnd = function (t) { return t.replace(/(\n\s*(## ?)?\s*)+$/, "").trim(); };
      const dropClosers = function (h) { return h.replace(/^(\s*<\/[^>]+>)+/, ""); };
      question = stripEnd(archText_(dropClosers(seg.slice(qm.index + qm[0].length, am.index + 1))));
      answerHtml = dropClosers(archCleanHtml_(seg.slice(am.index + am[0].length))).trim();
      if (/בקצרה|קצרה|מקוצרת/.test(am[0])) answerHtml = "<h3>תשובה בקצרה</h3>" + answerHtml; // יש גם "תשובה בהרחבה" בהמשך
      answer = stripEnd(archText_(answerHtml));
      tagZone = seg.slice(0, qm.index);
    }
  }
  const isQA = !!(question && answer);
  const tags = [], re = /href\s*=\s*["']?[^"'\s>]*\/Tags\/\d+[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(tagZone))) { const t = archText_(m[1]); if (t && tags.indexOf(t) < 0) tags.push(t); }
  if (isQA && answer.length < 30) problems.push("תשובה קצרה מדי");
  return { isQA: isQA, title: title, rabbi: rabbi, summary: summary, tags: tags, question: question, answer: answer, answerHtml: answerHtml, problems: problems };
}
// מחיקת שורות כפולות (אותו מזהה) – שומרים את הראשונה
function archDedupe_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 2) return 0;
  const ids = sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
  const seen = {}, del = [];
  ids.forEach(function (id, i) { if (seen[id]) del.push(i + 2); else seen[id] = 1; });
  for (let k = del.length - 1; k >= 0; k--) sh.deleteRow(del[k]);
  return del.length;
}
function archTagSummary_(ss) {
  const sh = ss.getSheetByName("שו\"ת");
  const rows = sh.getRange(2, 5, sh.getLastRow() - 1, 1).getValues();
  const count = {};
  let none = 0;
  rows.forEach(function (r) { const t = String(r[0] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); if (!t.length) none++; t.forEach(function (x) { count[x] = (count[x] || 0) + 1; }); });
  let tg = ss.getSheetByName("תגיות");
  const prev = {}; // קטגוריות שכבר נקבעו – נשמרות
  if (tg && tg.getLastRow() > 1) tg.getRange(2, 1, tg.getLastRow() - 1, 3).getValues().forEach(function (r) { if (String(r[2]).trim()) prev[r[0]] = r[2]; });
  if (!tg) tg = ss.insertSheet("תגיות"); else tg.clear();
  tg.setRightToLeft(true);
  const list = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; }).map(function (t) { return [t, count[t], prev[t] || ""]; });
  list.push(["(בלי תגית)", none, prev["(בלי תגית)"] || ""]);
  tg.getRange(1, 1, 1, 3).setValues([["תגית", "מספר שאלות", "קטגוריה במערכת (למלא)"]]).setFontWeight("bold");
  tg.getRange(2, 1, list.length, 3).setValues(list);
  tg.setFrozenRows(1);
}

// =====================================================================
// שלב 2: קטגוריות וייבוא למערכת
// =====================================================================
// סדר העדיפות: שאלה עם כמה תגיות נכנסת לקטגוריה הראשונה ברשימה שמתאימה לאחת מהן.
// שאלה בלי תגית מתאימה – "אחר". את הקטגוריה של כל תגית קובעים בלשונית "תגיות" (עמודה C).
const ARCH_CATS = [
  ["שכנים ובית משותף", "שכנים, וועד הבית, תקנון בית משותף, היזק ראיה, הסגת גבול"],
  ["עובד ומעביד", "דיני עבודה, חוזה עבודה וקבלנות, קבלן, סמכות עובד, פיטורי עובד"],
  ["רכב", "השכרת רכב, שכירות רכב"],
  ["הדירה והבית", "שכירות דירה, חוזה שכירות, תיווך, מכר דירה, רישום בטאבו, מקרקעין, בר מצרא"],
  ["משפחה, ירושה וצדקה", "ירושה, צוואה, מזונות, כתובה, חלוקת רכוש, צדקה, מעשר כספים, הקדש ונאמני הקדש"],
  ["הלוואות, ריבית וחובות", "ריבית, הלוואה, היתר עיסקא, הצמדה, גביית חוב, הוצאה לפועל, המחאה / שיק, התיישנות"],
  ["עסקים, חברות וזכויות יוצרים", "שותפות, דיני חברות, זכויות יוצרים, תחרות, שוק ההון, אתיקה עסקית, כלכלה יהודית"],
  ["בית דין, בוררות וראיות", "בתי המשפט, סדר הדין, בית הדין לממונות, בוררות, סמכות בית הדין ומקום הדיון, כתב סירוב, בתי הדין הרבניים, עריכת דין, פסולי דין, עביד איניש דינא לנפשיה, דיני ראיות, עדות, עד פסול, הודאת בעל דין, הוצאות משפט, חיוב גבוה מסכום התביעה"],
  ["נזיקין, גזל ושמירה", "נזיקין, גזל, גרמא ומניעת רווח, אבידה ומציאה, שומרים, דין נהנה, ביטוח, הוצאת דיבה ולשון הרע, רמאות וגנבת דעת, הפקר, אונס ואיומים, מכת מדינה"],
  ["חוזים, מכר וקניין", "דיני חוזים, מיקח טעות, חזרה מהתחייבות, הפרת חוזה, מכר, אונאה, קניין, מתנה, דיני תנאים, פרשנות חוזה, אסמכתא, חוזה, חוזים משפטי ארץ, שטר, תום לב, הסתמכות, קנסות, מחילה"],
  ["מדינה וציבור", "דינא דמלכותא, חוקי המדינה, מיסים וארנונה, כספי ציבור, מדינה כהלכה, קורונה, ערבות הדדית"],
  ["אחר", "סיוע לדבר עבירה ולפני עוור, מנהג, דוגמא אישית, גבורה, שו\"ת משפטי ארץ חלק א"]
];
const ARCH_TAG = "ארכיון";
const ARCH_SKIP = "לא לייבא"; // כותבים בעמודת "סטטוס" בלשונית שו"ת כדי לדלג על שאלה

// ממלא בלשונית "תגיות" (עמודה C) את הקטגוריה המוצעת – רק איפה שעוד ריק
function archiveFillCategories() {
  const ss = archSheet_();
  archTagSummary_(ss); // מוודא שהלשונית מעודכנת
  const tg = ss.getSheetByName("תגיות");
  const map = {};
  ARCH_CATS.forEach(function (c) { c[1].split(", ").forEach(function (t) { map[t] = c[0]; }); });
  const n = tg.getLastRow() - 1;
  const vals = tg.getRange(2, 1, n, 3).getValues();
  let filled = 0, unknown = [];
  vals.forEach(function (r) {
    if (String(r[2]).trim()) return;
    if (r[0] === "(בלי תגית)") { r[2] = "אחר"; return; }
    if (map[r[0]]) { r[2] = map[r[0]]; filled++; } else { r[2] = "אחר"; unknown.push(r[0]); }
  });
  tg.getRange(2, 1, n, 3).setValues(vals);
  // לשונית עזר: רשימת הקטגוריות לפי סדר העדיפות
  let ct = ss.getSheetByName("קטגוריות");
  if (!ct) ct = ss.insertSheet("קטגוריות"); else ct.clear();
  ct.setRightToLeft(true);
  ct.getRange(1, 1, 1, 2).setValues([["קטגוריה (לפי סדר עדיפות)", "תגיות"]]).setFontWeight("bold");
  ct.getRange(2, 1, ARCH_CATS.length, 2).setValues(ARCH_CATS);
  console.log("מולאו " + filled + " תגיות." + (unknown.length ? " תגיות חדשות שסומנו 'אחר' (כדאי לבדוק): " + unknown.join(", ") : "") + "\nאפשר לשנות כל קטגוריה בלשונית 'תגיות', עמודה C, ואז להריץ archiveImportPreview.");
}

// חישוב הקטגוריה לכל שאלה לפי המיפוי בלשונית "תגיות"
function archPlan_() {
  const ss = archSheet_(), sh = ss.getSheetByName("שו\"ת"), tg = ss.getSheetByName("תגיות");
  if (!tg) throw new Error("אין לשונית תגיות – מריצים קודם archiveFillCategories");
  const map = {};
  tg.getRange(2, 1, tg.getLastRow() - 1, 3).getValues().forEach(function (r) { if (String(r[2]).trim()) map[r[0]] = String(r[2]).trim(); });
  const order = ARCH_CATS.map(function (c) { return c[0]; });
  Object.keys(map).forEach(function (t) { if (order.indexOf(map[t]) < 0) order.splice(order.length - 1, 0, map[t]); }); // קטגוריה חדשה – לפני "אחר"
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues();
  return rows.filter(function (r) { return r[0] && r[9] !== ARCH_SKIP && r[6] && r[7]; }).map(function (r) {
    const tags = String(r[4] || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    const cats = tags.map(function (t) { return map[t]; }).filter(Boolean);
    cats.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return { id: Number(r[0]), url: r[1], title: String(r[2]), rabbi: String(r[3]), tags: tags, summary: String(r[5]), question: String(r[6]), answer: String(r[7]), answerHtml: String(r[8]), category: cats[0] || map["(בלי תגית)"] || "אחר" };
  }).concat([]).map(function (x) { x.order = order; return x; });
}

// תצוגה מקדימה – לא כותב כלום. מראה כמה שאלות ייכנסו לכל קטגוריה ומה כבר קיים במערכת
function archiveImportPreview() {
  const plan = archPlan_();
  const count = {};
  plan.forEach(function (x) { count[x.category] = (count[x.category] || 0) + 1; });
  const existing = archExistingIds_();
  const fresh = plan.filter(function (x) { return !existing["dintora-" + x.id]; }).length;
  const tax = (get_("settings/taxonomy") || {}).categories || [];
  const order = plan.length ? plan[0].order : [];
  const missing = order.filter(function (c) { return tax.indexOf(c) < 0; });
  console.log("ייבוא מתוכנן: " + plan.length + " שו\"תים (" + fresh + " חדשים, " + (plan.length - fresh) + " כבר במערכת וידולגו).\n"
    + order.filter(function (c) { return count[c]; }).map(function (c) { return "• " + c + ": " + count[c]; }).join("\n")
    + (missing.length ? "\nקטגוריות שיתווספו למערכת: " + missing.join(", ") : "")
    + "\nכדי לייבא בפועל: archiveImport");
}

// הייבוא עצמו: שאלה (נענתה) + פרסום במאגר בעילום שם. שאלה שכבר יובאה – לא נוגעים בה.
// לא נשלח שום מייל: השאלות נכנסות במצב "נענתה" ומסומנות כאילו כבר נשלחה עליהן התראה.
function archiveImport() {
  const plan = archPlan_();
  const existing = archExistingIds_();
  const todo = plan.filter(function (x) { return !existing["dintora-" + x.id]; });
  // קטגוריות חסרות – מוסיפים לרשימת הקטגוריות במערכת (לפני "אחר" אם קיים)
  // רשימת הקטגוריות במערכת: לפי סדר ההצעה, ואחריהן קטגוריות קיימות אחרות (למשל "דיני ממונות") – לפני "אחר".
  // קטגוריה קיימת לא נמחקת כאן: מוחקים אותה ממסך ההגדרות, שם בוחרים לאן להעביר את השאלות שלה.
  const taxDoc = get_("settings/taxonomy") || {};
  const old = (taxDoc.categories || []).slice();
  const order = plan.length ? plan[0].order : [];
  const tax = order.filter(function (c) { return c !== "אחר"; })
    .concat(old.filter(function (c) { return order.indexOf(c) < 0 && c !== "אחר"; }))
    .concat(["אחר"]);
  if (JSON.stringify(tax) !== JSON.stringify(old)) patch_("settings/taxonomy", { categories: tax, updatedAt: new Date(), updatedBy: "ייבוא מהאתר" });
  const now = new Date();
  // סדר במאגר: שאלות חדשות מהמערכת יופיעו לפני הארכיון; בתוך הארכיון – החדשות קודם (לפי מספר הדף)
  const archDate = function (id) { return new Date(Date.UTC(2010, 0, 1) + id * 3600 * 1000); };
  let writes = [], done = 0;
  const flush = function () {
    if (!writes.length) return;
    call_("post", FS.replace(/\/documents$/, "/documents:commit"), { writes: writes });
    writes = [];
  };
  todo.forEach(function (x) {
    const docId = "dintora-" + x.id;
    const tags = x.tags.concat([ARCH_TAG]).filter(function (t, i, a) { return a.indexOf(t) === i; });
    const q = {
      title: x.title, text: x.question, firstName: "", lastName: "", email: "", phone: "", consentEmail: false, contactId: null,
      topic: x.category, tags: tags, autoTags: [], status: "answered", answer: x.answer, answerHtml: x.answerHtml,
      rabbiEmail: "", rabbiName: x.rabbi, origin: "ארכיון האתר", sourceUrl: x.url, oldId: x.id, summary: x.summary,
      publish: true, publishMode: "anon", publicText: x.question, publishedAt: archDate(x.id), imported: true,
      createdAt: archDate(x.id), answeredAt: archDate(x.id), notifiedAt: now, updatedAt: now
    };
    const pub = {
      title: x.title, question: x.question, answer: x.answer, answerHtml: x.answerHtml, topic: x.category, tags: tags,
      askerName: "", rabbiName: x.rabbi, summary: x.summary, sourceUrl: x.url, oldId: x.id, archive: true, publishedAt: archDate(x.id)
    };
    writes.push({ update: { name: FS.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, "") + "/questions/" + docId, fields: toFields_(q) } });
    writes.push({ update: { name: FS.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, "") + "/publicQA/" + docId, fields: toFields_(pub) } });
    done++;
    if (writes.length >= 300) flush();
  });
  flush();
  console.log("הייבוא הסתיים ✓ נוספו " + done + " שו\"תים למערכת ולמאגר. דולגו " + (plan.length - done) + " שכבר היו במערכת.");
}

// מזהי השאלות שכבר יובאו
function archExistingIds_() {
  const out = {};
  runQuery_({ from: [{ collectionId: "questions" }], where: { fieldFilter: { field: { fieldPath: "imported" }, op: "EQUAL", value: { booleanValue: true } } }, select: { fields: [{ fieldPath: "oldId" }] } })
    .forEach(function (d) { out[d.path.split("/").pop()] = 1; });
  return out;
}
