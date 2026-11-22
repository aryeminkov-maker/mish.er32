// ===== כלים משותפים לדפי השו"ת הציבוריים (מאגר, דף שאלה, טופס שאל את הרב) =====
import { doc, setDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, normText } from "./common.js?v=20261107";

export const HIDDEN_TAGS = new Set(["ארכיון"]);
export const tagsOf = (x) => (x.tags || []).filter((g) => !HIDDEN_TAGS.has(g));
export const titleOf = (x) => x.title || (String(x.question || "").length > 120 ? x.question.slice(0, 120) + "…" : (x.question || ""));
export const qPageUrl = (id) => new URL(`q.html?id=${encodeURIComponent(id)}`, location.href).href;
export const wordsOf = (x) => new Set(normText(`${x.title || ""} ${x.question || ""}`).split(" ").filter((w) => w.length >= 3));

// שאלות דומות: תגיות משותפות, אותה קטגוריה, מילים משותפות בכותרת ובשאלה
export function similarTo(x, pool, n = 5) {
  const tags = new Set(tagsOf(x)), xw = x._words || wordsOf(x);
  return pool.filter((y) => y.id !== x.id).map((y) => {
    let s = 0;
    tagsOf(y).forEach((g) => { if (tags.has(g)) s += 4; });
    if (y.topic && y.topic === x.topic) s += 2;
    let w = 0; (y._words || (y._words = wordsOf(y))).forEach((t) => { if (xw.has(t)) w++; });
    return [s + Math.min(w, 6), y];
  }).filter(([s]) => s >= 4).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, y]) => y);
}

// ספירת צפייה – פעם אחת ביום לכל שאלה בכל דפדפן. המספרים נראים רק בממשק הניהול.
export function countView(id) {
  if (!db || !id) return;
  const key = "qv_" + id, today = new Date().toISOString().slice(0, 10);
  try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { /* */ }
  setDoc(doc(db, "qaViews", id), { count: increment(1), last: serverTimestamp() }, { merge: true }).catch(() => {});
}
