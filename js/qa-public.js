// ===== כלים משותפים לדפי השו"ת הציבוריים (מאגר, דף שאלה, דפי נושא, טופס שאל את הרב) =====
import { doc, setDoc, addDoc, collection, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, normText, esc } from "./common.js?v=20261108";

// שורש האתר – כך הקישורים עובדים גם מדפים שבתיקיות משנה (q/123.html)
export const ROOT = new URL("../", import.meta.url).href;
export const HIDDEN_TAGS = new Set(["ארכיון"]);
export const tagsOf = (x) => (x.tags || []).filter((g) => !HIDDEN_TAGS.has(g));
export const titleOf = (x) => x.title || (String(x.question || "").length > 120 ? x.question.slice(0, 120) + "…" : (x.question || ""));
export const qPageUrl = (id) => ROOT + `q.html?id=${encodeURIComponent(id)}`;
// קישור לשיתוף: דף סטטי (עם כרטיס שיתוף מלא) אם יוצא, אחרת הדף הרגיל
export const shareUrl = (x) => x.staticPage ? ROOT + `q/${encodeURIComponent(x.id)}.html` : qPageUrl(x.id);
export const topicUrl = (c) => ROOT + `topic.html?c=${encodeURIComponent(c)}`;
export const tagUrl = (t) => ROOT + `topic.html?tag=${encodeURIComponent(t)}`;
export const rabbiUrl = (r) => ROOT + `shut.html?rabbi=${encodeURIComponent(r)}`;
export const askUrl = (refId) => ROOT + `ask.html${refId ? "?ref=" + encodeURIComponent(refId) : ""}`;

// ---------- חיפוש חכם ----------
// שורש מילה בעברית (בקירוב): בלי אותיות שימוש בתחילה ובלי סיומות רבים/נקבה
const PREFIX = /^(וכש|וכשה|ומה|ומש|ושה|שה|וה|וב|ול|ומ|וכ|כש|מה|לה|בה|כה|ו|ה|ב|ל|מ|כ|ש)(?=[֐-׿]{3,})/;
export function stem(w) {
  let s = String(w || "");
  if (!/[֐-׿]/.test(s)) return s;
  s = s.replace(PREFIX, "");
  if (s.length >= 5) s = s.replace(/(ים|ות|יות|ית|ה)$/, "");
  return s.replace(/ך$/, "כ").replace(/ם$/, "מ").replace(/ן$/, "נ").replace(/ף$/, "פ").replace(/ץ$/, "צ");
}
// מילים נרדפות נפוצות במאגר
const SYN = [["שכירות", "שוכר", "משכיר", "שכר דירה", "שכירה"], ["שכנ", "שכן", "שכנים"], ["עובד", "מעביד", "מעסיק", "עבודה", "פועל"],
  ["הלואה", "הלוואה", "מלווה", "לווה", "חוב"], ["ירושה", "יורש", "צוואה", "עיזבון"], ["נזק", "נזיקין", "מזיק", "ניזק"], ["רכב", "מכונית", "אוטו"],
  ["דירה", "בית", "נכס"], ["בוררות", "בורר", "בית דין", "דין תורה"], ["ריבית", "נשך"], ["תיווך", "מתווך", "דמי תיווך"]];
const SYN_MAP = new Map();
SYN.forEach((g) => { const st = g.map((w) => stem(normText(w).trim().split(" ")[0])); st.forEach((s) => SYN_MAP.set(s, st)); });
export const wordsIn = (t) => normText(t).trim().split(" ").filter((w) => w.length >= 2);
export function indexOf(x) {
  const stems = new Set();
  wordsIn(`${x.title || ""} ${x.question || ""} ${x.answer || ""} ${(x.tags || []).join(" ")} ${x.topic || ""} ${x.rabbiName || ""}`).forEach((w) => stems.add(stem(w)));
  return stems;
}
// כל מילת חיפוש צריכה להופיע (בשורש שלה או במילה נרדפת)
export function matches(idx, query) {
  const q = wordsIn(query);
  if (!q.length) return true;
  return q.every((w) => {
    const s = stem(w), alts = SYN_MAP.get(s) || [s];
    return alts.some((a) => idx.has(a) || (a.length >= 3 && [...idx].some((t) => t.startsWith(a))));
  });
}
// סימון המילים שנמצאו (בטקסט שכבר עבר esc)
export function highlight(html, query) {
  const stems = wordsIn(query).map(stem).filter((s) => s.length >= 2);
  if (!stems.length) return html;
  return html.replace(/[֐-׿a-zA-Z0-9"׳״']{2,}/g, (w) => {
    const s = stem(normText(w).trim());
    return stems.some((t) => s === t || (t.length >= 3 && s.startsWith(t))) ? `<mark>${w}</mark>` : w;
  });
}
// "האם התכוונת ל...?" – המילה הקרובה ביותר מאוצר המילים של המאגר
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export function didYouMean(query, vocab) {
  let changed = false;
  const out = wordsIn(query).map((w) => {
    if (vocab.has(w) || w.length < 3) return w;
    let best = w, bd = w.length >= 5 ? 2 : 1;
    vocab.forEach((v) => { const d = lev(w, v); if (d <= bd && d > 0) { bd = d; best = v; } });
    if (best !== w) changed = true;
    return best;
  });
  return changed ? out.join(" ") : "";
}

// ---------- שאלות דומות ----------
export const wordsOf = (x) => new Set(normText(`${x.title || ""} ${x.question || ""}`).split(" ").filter((w) => w.length >= 3).map(stem));
export function similarTo(x, pool, n = 5) {
  const tags = new Set(tagsOf(x)), xw = x._words || (x._words = wordsOf(x));
  return pool.filter((y) => y.id !== x.id).map((y) => {
    let s = 0;
    tagsOf(y).forEach((g) => { if (tags.has(g)) s += 4; });
    if (y.topic && y.topic === x.topic) s += 2;
    let w = 0; (y._words || (y._words = wordsOf(y))).forEach((t) => { if (xw.has(t)) w++; });
    return [s + Math.min(w, 6), y];
  }).filter(([s]) => s >= 4).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, y]) => y);
}
// כרטיס קטן (לשורות "שאלות דומות" / "עוד מאותו רב")
export function miniCard(y) {
  return `<a class="mini-card" href="${qPageUrl(y.id)}"><span class="mini-t">${esc(titleOf(y))}</span>${y.topic ? `<span class="mini-c">${esc(y.topic)}</span>` : ""}</a>`;
}
export const cardRow = (title, list, more) => list.length ? `<section class="card-row"><div class="row space"><h2 class="qa-h" style="margin:0">${title}</h2>${more || ""}</div><div class="mini-cards">${list.map(miniCard).join("")}</div></section>` : "";

// ---------- צפיות (רק לממשק הניהול) ----------
export function countView(id) {
  if (!db || !id) return;
  const key = "qv_" + id, today = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { /* */ }
  setDoc(doc(db, "qaViews", id), { count: increment(1), last: serverTimestamp() }, { merge: true }).catch(() => {});
}
// ---------- חיפושים בלי תוצאות (רק לממשק הניהול) ----------
const missSent = new Set();
export function logMiss(q, topic) {
  const t = String(q || "").trim().slice(0, 100);
  if (!db || t.length < 3 || missSent.has(t)) return;
  missSent.add(t);
  try { const k = "qm_" + t; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* */ }
  addDoc(collection(db, "qaSearchMisses"), { q: t, topic: String(topic || "").slice(0, 60), at: serverTimestamp() }).catch(() => {});
}

// ---------- "שמור לקריאה" – נשמר רק בדפדפן של הקורא ----------
export const saved = {
  all() { try { return JSON.parse(localStorage.getItem("qa_saved") || "[]"); } catch { return []; } },
  has(id) { return this.all().includes(id); },
  toggle(id) { const a = this.all(), i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.unshift(id); try { localStorage.setItem("qa_saved", JSON.stringify(a.slice(0, 200))); } catch { /* */ } return i < 0; }
};
export const saveBtn = (id) => `<button type="button" class="link small save-btn" data-save="${esc(id)}" aria-pressed="${saved.has(id)}">${saved.has(id) ? "★ נשמר" : "☆ שמירה לקריאה"}</button>`;
export function bindSave(root, after) {
  root.querySelectorAll("[data-save]").forEach((b) => (b.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    const on = saved.toggle(b.dataset.save);
    document.querySelectorAll(`[data-save="${CSS.escape(b.dataset.save)}"]`).forEach((x) => { x.textContent = on ? "★ נשמר" : "☆ שמירה לקריאה"; x.setAttribute("aria-pressed", on); });
    after?.();
  }));
}
