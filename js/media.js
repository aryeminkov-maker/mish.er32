// ===== מודעה ורקעי זום להשתלמות – לפי העיצובים השמורים =====
// סדר העדיפות: עיצוב ייחודי להשתלמות (courseMedia) ← תבנית כללית (settings) ← ברירת מחדל
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./common.js?v=20261022";
import { fmtIso, parseIso, HEB_DAYS, toMin } from "./util.js?v=20261022";
import { defaultAd, defaultBg, exportPng } from "./designer.js?v=20261022";

const safe = async (p) => { try { const s = await p; return s.exists() ? s.data() : null; } catch { return null; } };

export async function loadDesigns(courseId) {
  const [media, adT, bgT] = await Promise.all([
    courseId ? safe(getDoc(doc(db, "courseMedia", courseId))) : null,
    safe(getDoc(doc(db, "settings", "adTemplate"))),
    safe(getDoc(doc(db, "settings", "bgTemplate")))
  ]);
  const adTemplate = adT?.design || defaultAd(), bgTemplate = bgT?.design || defaultBg();
  return { ad: media?.ad || adTemplate, bg: media?.bg || bgTemplate, adTemplate, bgTemplate, hasCustomAd: !!media?.ad, hasCustomBg: !!media?.bg };
}

// המשתנים שאפשר לשבץ בעיצוב
export const VAR_NAMES = ["שם ההשתלמות", "כותרת משנה", "תאריכים", "תאריכים מלאים", "מפגשים", "מספר מפגשים במילים", "ימים", "חלק היום", "שעות", "מועד", "מיקום",
  "מרצים", "רשימת מרצים", "רשימת נושאים", "קהל יעד", "עלות", "מלגה", "קישור", "קישור מלא", "שם המרצה", "נושא ההרצאה", "נושא ההשתלמות"];

const NUM_M = ["", "מפגש אחד", "שני מפגשים", "שלושה מפגשים", "ארבעה מפגשים", "חמישה מפגשים", "שישה מפגשים", "שבעה מפגשים", "שמונה מפגשים", "תשעה מפגשים", "עשרה מפגשים",
  "אחד עשר מפגשים", "שנים עשר מפגשים"];
const joinHeb = (list) => list.length < 2 ? (list[0] || "") : list.slice(0, -1).join(", ") + " ו" + list.at(-1);
const shortDate = (iso) => { const [, m, d] = String(iso).split("-").map(Number); return `${d}/${m}`; };
// יום בחודש באותיות (1–30)
function gematria(n) {
  if (n === 15) return "ט״ו"; if (n === 16) return "ט״ז";
  const t = ["", "י", "כ", "ל"][Math.floor(n / 10)] || "", u = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"][n % 10];
  const s = t + u;
  return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
}
// תאריך עברי קצר, למשל "א׳ תמוז"
function hebDate(iso) {
  try {
    const p = new Intl.DateTimeFormat("he-u-ca-hebrew", { day: "numeric", month: "long" }).formatToParts(parseIso(iso));
    const day = p.find((x) => x.type === "day")?.value || "", month = (p.find((x) => x.type === "month")?.value || "").replace(/^ב/, "");
    const dn = Number(day);
    return day && month ? `${dn ? gematria(dn) : day} ${month}` : "";
  } catch { return ""; }
}
const mostCommon = (arr) => { const m = new Map(); arr.forEach((x) => x && m.set(x, (m.get(x) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
const splitNames = (s) => String(s || "").split(/[,،]/).map((x) => x.trim()).filter(Boolean);
const bullets = (list) => list.map((x) => "•  " + x).join("\n");

export function courseVars(course, sessions = [], landingUrl = "") {
  const ss = [...sessions].filter((s) => s.date).sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  const start = course.startDate || ss[0]?.date || "", end = course.endDate || ss.at(-1)?.date || "";
  const dates = start ? (end && end !== start ? `${fmtIso(start)} – ${fmtIso(end)}` : fmtIso(start)) : "";
  const full = (iso) => [hebDate(iso), shortDate(iso)].filter(Boolean).join(", ");
  const fullDates = start ? (end && end !== start ? `${full(start)} – ${full(end)}` : full(start)) : "";
  const days = [...new Set(ss.map((s) => parseIso(s.date).getDay()))].sort().map((i) => HEB_DAYS[i]);
  const startT = mostCommon(ss.map((s) => s.start)), endT = mostCommon(ss.map((s) => s.end));
  const hour = startT ? toMin(startT) / 60 : -1;
  const lecturers = [];
  [...splitNames(course.lecturers), ...ss.flatMap((s) => splitNames(s.lecturer))].forEach((n) => { if (!lecturers.includes(n)) lecturers.push(n); });
  const topics = [...new Set(ss.map((s) => String(s.topic || "").trim()).filter(Boolean))];
  return {
    "שם ההשתלמות": course.title || "", "נושא ההשתלמות": course.title || "", "נושא ההרצאה": course.title || "", "כותרת משנה": course.subtitle || "",
    "תאריכים": dates, "תאריכים מלאים": fullDates,
    "מפגשים": ss.length ? `${ss.length} מפגשים` : "", "מספר מפגשים במילים": NUM_M[ss.length] || (ss.length ? `${ss.length} מפגשים` : ""),
    "ימים": joinHeb(days), "חלק היום": hour < 0 ? "" : hour >= 17 ? "בערב" : hour >= 12 ? "בצהריים" : "בבוקר",
    "שעות": startT ? (endT ? `${startT} עד ${endT}` : startT) : "", "מועד": course.timeText || "",
    "מיקום": course.location || "", "מרצים": course.lecturers || lecturers.join(", "), "רשימת מרצים": bullets(lecturers), "רשימת נושאים": bullets(topics),
    "קהל יעד": course.audience || "", "עלות": course.price || "ההשתתפות ללא עלות", "מלגה": course.scholarshipText || "",
    "קישור": String(landingUrl).replace(/^https?:\/\//, ""), "קישור מלא": landingUrl || "", "שם המרצה": ""
  };
}

// נושא ההרצאה של מרצה: הנושאים של המפגשים שלו (ואם אין – שם ההשתלמות)
export function lectureTopic(course, sessions, name) {
  const n = String(name || "").trim();
  const t = [...new Set(sessions.filter((s) => splitNames(s.lecturer).includes(n)).map((s) => String(s.topic || "").trim()).filter(Boolean))];
  return t.length ? t.slice(0, 2).join(" | ") : (course.title || "");
}

// כתובת דף ההרשמה
export const landingUrlOf = (courseId) => new URL(`course.html?c=${encodeURIComponent(courseId)}`, location.href).href;

const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 40) || "קובץ";

export async function makeAd(course, sessions, landingUrl) {
  const d = await loadDesigns(course.id);
  return exportPng(d.ad, courseVars(course, sessions, landingUrl), `מודעה-${safeName(course.title)}.png`);
}

// רקע זום: אותה תבנית, עם שם המרצה (או שם המשתתף)
export async function makeBackground(course, name, sessions = [], topic = "") {
  const d = await loadDesigns(course.id);
  return exportPng(d.bg, { ...courseVars(course, sessions), "שם המרצה": name || "", "נושא ההרצאה": topic || course.title || "" }, `רקע-זום-${safeName(name)}.png`);
}
