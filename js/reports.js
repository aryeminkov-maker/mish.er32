// ===== דוחות וסטטיסטיקות – לפי חודשים =====
import { HEB_MONTHS, todayIso } from "./util.js?v=20261026";

const RS = { year: Number(todayIso().slice(0, 4)) };
const ym = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "");

export function renderReports(c) {
  const T = (v) => c.toDate(v);
  const months = Array.from({ length: 12 }, (_, i) => `${RS.year}-${String(i + 1).padStart(2, "0")}`);
  const by = (list, dateOf, val = () => 1) => { const m = Object.fromEntries(months.map((k) => [k, 0])); list.forEach((x) => { const k = ym(dateOf(x)); if (k in m) m[k] += Number(val(x)) || 0; }); return m; };
  const S = c.S;
  const qs = [...S.questions.values()], acts = [...S.activities.values()], regs = [...S.regs.values()];
  const sessions = [...S.sessions.values()], dists = [...S.dists.values()], contacts = [...S.contacts.values()];
  // זמן מענה ממוצע (ימים) לשאלות שנענו בכל חודש
  const answered = qs.filter((q) => q.status === "answered" && T(q.answeredAt) && T(q.createdAt));
  const respSum = by(answered, (q) => T(q.answeredAt), (q) => (T(q.answeredAt) - T(q.createdAt)) / 864e5);
  const respCnt = by(answered, (q) => T(q.answeredAt));
  // נוכחות: לכל מפגש שהתקיים – כמה מהמאושרים בהשתלמות סומנו נוכחים
  const past = sessions.filter((s) => s.date && s.date <= todayIso());
  const attOf = (s) => { const rs = regs.filter((r) => r.courseId === s.courseId && r.status === "registered"); return rs.length ? rs.filter((r) => r.attendance?.[s.id]).length / rs.length : null; };
  const attSum = by(past.filter((s) => attOf(s) !== null), (s) => new Date(s.date + "T12:00"), (s) => attOf(s) * 100);
  const attCnt = by(past.filter((s) => attOf(s) !== null), (s) => new Date(s.date + "T12:00"));
  const rows = [
    ["שו\"ת", null],
    ["שאלות שהתקבלו", by(qs, (q) => T(q.createdAt))],
    ["שאלות שנענו", respCnt],
    ["זמן מענה ממוצע (ימים)", Object.fromEntries(months.map((k) => [k, respCnt[k] ? Math.round((respSum[k] / respCnt[k]) * 10) / 10 : "—"]))],
    ["פורסמו במאגר", by(qs.filter((q) => q.publish), (q) => T(q.publishedAt))],
    ["השתלמויות", null],
    ["הרשמות חדשות", by(regs, (r) => T(r.createdAt))],
    ["מפגשים שהתקיימו", by(past, (s) => new Date(s.date + "T12:00"))],
    ["נוכחות ממוצעת (%)", Object.fromEntries(months.map((k) => [k, attCnt[k] ? Math.round(attSum[k] / attCnt[k]) : "—"]))],
    ["ספרים", null],
    ["עותקים שחולקו למוסדות", by(dists, (d) => (d.date ? new Date(d.date + "T12:00") : null), (d) => d.qty)],
    ["מוסדות שקיבלו", Object.fromEntries(months.map((k) => [k, new Set(dists.filter((d) => (d.date || "").startsWith(k)).map((d) => d.institutionId)).size]))],
    ["חלוקות לאנשים (מהייבוא)", by(acts.filter((a) => a.type === "book_received"), (a) => T(a.date))],
    ["רכישות ספרים", by(acts.filter((a) => a.type === "book_purchase"), (a) => T(a.date))],
    ["הכנסות מספרים (₪)", by(acts.filter((a) => a.type === "book_purchase"), (a) => T(a.date), (a) => a.amount)],
    ["תרומות", null],
    ["מספר תרומות", by(acts.filter((a) => a.type === "donation"), (a) => T(a.date))],
    ["סכום תרומות (₪)", by(acts.filter((a) => a.type === "donation"), (a) => T(a.date), (a) => a.amount)],
    ["אנשי קשר", null],
    ["אנשי קשר חדשים", by(contacts, (x) => T(x.createdAt))],
    ["אישרו דיוור (חדשים)", by(contacts.filter((x) => x.consentEmail?.status === "yes"), (x) => T(x.consentEmail.at))]
  ];
  const total = (m, label) => {
    const v = Object.values(m).filter((x) => typeof x === "number");
    if (/ממוצע|ממוצעת/.test(label)) return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : "—";
    if (/מוסדות שקיבלו/.test(label)) return new Set(dists.filter((d) => (d.date || "").startsWith(String(RS.year))).map((d) => d.institutionId)).size;
    return Math.round(v.reduce((a, b) => a + b, 0));
  };
  const fmt = (v) => (typeof v === "number" ? v.toLocaleString("he-IL") : v);
  const years = [...new Set([RS.year, Number(todayIso().slice(0, 4)), ...qs.map((q) => T(q.createdAt)?.getFullYear()), ...regs.map((r) => T(r.createdAt)?.getFullYear())].filter(Boolean))].sort((a, b) => b - a);
  const chart = (m, label) => {
    const max = Math.max(1, ...months.map((k) => Number(m[k]) || 0));
    return `<div class="mini-chart" role="img" aria-label="${c.esc(label)} לפי חודש">${months.map((k, i) => `<div class="mc-col" title="${HEB_MONTHS[i]}: ${fmt(m[k])}"><span class="mc-bar" style="height:${Math.round(((Number(m[k]) || 0) / max) * 100)}%"></span><span class="mc-lbl">${HEB_MONTHS[i].slice(0, 3)}</span></div>`).join("")}</div>`;
  };
  // סיכום לפי השתלמות
  const courses = [...S.courses.values()].filter((x) => (x.startDate || "").startsWith(String(RS.year)) || (x.endDate || "").startsWith(String(RS.year)));
  c.$("main").innerHTML = `
    <div class="row space"><h1>דוחות</h1>
      <div class="row"><label for="rYear" class="small">שנה</label><select id="rYear" style="width:auto">${years.map((y) => `<option ${y === RS.year ? "selected" : ""}>${y}</option>`).join("")}</select>
        <button id="rExport">ייצוא ל-Excel</button><button id="rPrint">הדפסה / PDF</button></div></div>
    <div class="stats">
      <div class="stat"><div class="num">${fmt(total(rows[1][1], ""))}</div><div class="lbl">שאלות שהתקבלו</div></div>
      <div class="stat"><div class="num">${fmt(total(rows[6][1], ""))}</div><div class="lbl">הרשמות להשתלמויות</div></div>
      <div class="stat"><div class="num">${fmt(total(rows[10][1], ""))}</div><div class="lbl">עותקים שחולקו</div></div>
      <div class="stat"><div class="num">₪${fmt(total(rows[17][1], ""))}</div><div class="lbl">תרומות</div></div>
    </div>
    <div class="split">
      <div class="card"><h3 style="margin-top:0">שאלות לפי חודש</h3>${chart(rows[1][1], "שאלות")}</div>
      <div class="card"><h3 style="margin-top:0">הרשמות לפי חודש</h3>${chart(rows[6][1], "הרשמות")}</div>
    </div>
    <div class="card" style="padding:0"><div class="table-wrap"><table class="report-table">
      <thead><tr><th></th>${months.map((k, i) => `<th>${HEB_MONTHS[i]}</th>`).join("")}<th>סה"כ ${RS.year}</th></tr></thead>
      <tbody>${rows.map(([label, m]) => m ? `<tr><th scope="row">${c.esc(label)}</th>${months.map((k) => `<td>${fmt(m[k]) || ""}</td>`).join("")}<td><b>${fmt(total(m, label))}</b></td></tr>`
        : `<tr class="sec"><th colspan="${months.length + 2}">${c.esc(label)}</th></tr>`).join("")}</tbody></table></div></div>
    <h2>השתלמויות ${RS.year}</h2>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>השתלמות</th><th>נרשמו</th><th>אושרו</th><th>מפגשים</th><th>נוכחות ממוצעת</th></tr></thead>
      <tbody>${courses.map((x) => {
        const rs = regs.filter((r) => r.courseId === x.id), ok = rs.filter((r) => r.status === "registered");
        const ps = past.filter((s) => s.courseId === x.id), all = sessions.filter((s) => s.courseId === x.id);
        const att = ps.length && ok.length ? Math.round((ps.reduce((a, s) => a + ok.filter((r) => r.attendance?.[s.id]).length, 0) / (ps.length * ok.length)) * 100) : null;
        return `<tr><td>${c.esc(x.title)}</td><td>${rs.length}</td><td>${ok.length}</td><td>${ps.length}/${all.length}</td><td>${att === null ? "—" : att + "%"}</td></tr>`;
      }).join("") || '<tr><td colspan="5" class="muted">אין השתלמויות בשנה הזו</td></tr>'}</tbody></table></div></div>
    <p class="small muted">הנתונים מחושבים מכל המידע שבמערכת. חלוקות למוסדות – מלשונית "ספרים"; חלוקות ורכישות של אנשים – מהייבוא ומכרטיסי אנשי הקשר.</p>`;
  c.$("rYear").onchange = (e) => { RS.year = Number(e.target.value); renderReports(c); };
  c.$("rPrint").onclick = () => window.print();
  c.$("rExport").onclick = () => c.exportXlsx(rows.filter(([, m]) => m).map(([label, m]) => ({ "מדד": label, ...Object.fromEntries(months.map((k, i) => [HEB_MONTHS[i], m[k]])), [`סה"כ ${RS.year}`]: total(m, label) })), `דוח-${RS.year}.xlsx`);
}
