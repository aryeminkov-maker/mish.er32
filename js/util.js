// ===== פונקציות עזר טהורות (בלי Firebase) – תאריכים, שעות והתנגשויות =====

export const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => isoDate(new Date());
export const parseIso = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const fmtIso = (s) => (s ? String(s).split("-").reverse().join(".") : "");
export const addDaysIso = (s, n) => { const d = parseIso(s); d.setDate(d.getDate() + n); return isoDate(d); };
// שבוע מתחיל ביום ראשון
export const weekStartIso = (s) => { const d = parseIso(s || todayIso()); d.setDate(d.getDate() - d.getDay()); return isoDate(d); };
export const HEB_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const HEB_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
export const dayName = (iso) => HEB_DAYS[parseIso(iso).getDay()];

export const toMin = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const norm = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

// שני מפגשים חופפים בזמן: אותו תאריך והשעות נחתכות (מפגש שמסתיים ב-20:00 לא מתנגש בזה שמתחיל ב-20:00)
export function timeOverlap(a, b) {
  if (!a.date || a.date !== b.date) return false;
  const as = toMin(a.start), ae = toMin(a.end) || as + 60;
  const bs = toMin(b.start), be = toMin(b.end) || bs + 60;
  return as < be && bs < ae;
}

// מרצים במפגש (אפשר כמה, מופרדים בפסיק)
export const lecturersOf = (s) => String(s.lecturer || "").split(",").map(norm).filter(Boolean);

// סיבות ההתנגשות בין שני מפגשים: אותו מרצה ו/או אותו חשבון זום באותו זמן
export function conflictReasons(a, b) {
  if (a.id && a.id === b.id) return [];
  if (!timeOverlap(a, b)) return [];
  const reasons = [];
  const la = lecturersOf(a), lb = lecturersOf(b);
  const shared = la.filter((x) => lb.includes(x));
  if (shared.length) reasons.push("מרצה: " + shared.join(", "));
  if (a.zoomAccount && a.zoomAccount === b.zoomAccount) reasons.push("חשבון זום: " + a.zoomAccount);
  return reasons;
}

// כל ההתנגשויות של מפגש אחד מול רשימה
export function conflictsFor(s, all) {
  return all.map((o) => ({ other: o, reasons: conflictReasons(s, o) })).filter((x) => x.reasons.length);
}

// כל זוגות ההתנגשות ברשימה (כל זוג פעם אחת)
export function allConflicts(sessions) {
  const out = [];
  const byDate = new Map();
  sessions.forEach((s) => { if (!byDate.has(s.date)) byDate.set(s.date, []); byDate.get(s.date).push(s); });
  for (const list of byDate.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const reasons = conflictReasons(list.at(i), list.at(j));
      if (reasons.length) out.push({ a: list.at(i), b: list.at(j), reasons });
    }
  }
  return out.sort((x, y) => (x.a.date + x.a.start).localeCompare(y.a.date + y.a.start));
}

// התקדמות פרויקט לפי שלבים שהושלמו
export function stageProgress(stages) {
  const list = stages || [];
  if (!list.length) return 0;
  return Math.round((list.filter((s) => s.done).length / list.length) * 100);
}

// מזהה קצר
export const uid = () => Math.random().toString(36).slice(2, 10);

// קישור יוטיוב תקין
export const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || "").trim());
