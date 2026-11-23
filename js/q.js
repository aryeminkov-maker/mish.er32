// ===== דף שאלה בודדת (q.html?id=... או דף סטטי q/<id>.html) =====
import { doc, getDoc, getDocs, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, sanitizeRich, linkify } from "./common.js?v=20261109";
import { ROOT, tagsOf, titleOf, qPageUrl, shareUrl, topicUrl, tagUrl, rabbiUrl, askUrl, similarTo, countView, cardRow, saveBtn, bindSave } from "./qa-public.js?v=20261109";

const $ = (id) => document.getElementById(id);
const id = window.QID || new URLSearchParams(location.search).get("id");
const WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>';

// קישורי המסגרת – עובדים גם מדף סטטי בתיקיית משנה
[["homeLink", "shut.html"], ["crumbHome", "shut.html"], ["askLink", "ask.html"]].forEach(([k, u]) => { if ($(k)) $(k).href = ROOT + u; });
readerTools();

if (!configReady) { setupMissingNotice($("setupView")); $("qa").innerHTML = ""; }
else if (!id) location.replace(ROOT + "shut.html");
else load();

// ---------- גודל טקסט ותצוגת קריאה (נשמר בדפדפן) ----------
function readerTools() {
  let size = 1;
  try { size = Number(localStorage.getItem("qa_font") || 1); } catch { /* */ }
  const apply = () => { document.documentElement.style.setProperty("--read-size", size); try { localStorage.setItem("qa_font", size); } catch { /* */ } };
  apply();
  $("fontUp").onclick = () => { size = Math.min(1.5, +(size + 0.1).toFixed(1)); apply(); };
  $("fontDown").onclick = () => { size = Math.max(0.8, +(size - 0.1).toFixed(1)); apply(); };
  $("readMode").onclick = () => {
    const on = document.body.classList.toggle("reading");
    $("readMode").setAttribute("aria-pressed", on); $("readMode").textContent = on ? "יציאה מתצוגת קריאה" : "תצוגת קריאה";
  };
}

// תוכן עניינים לתשובה ארוכה (3 כותרות ומעלה)
function addToc(ans) {
  const hs = [...ans.querySelectorAll("h2, h3, h4")].filter((h) => h.textContent.trim());
  if (hs.length < 3) return;
  hs.forEach((h, i) => (h.id = "sec-" + (i + 1)));
  const toc = document.createElement("nav");
  toc.className = "toc no-print"; toc.setAttribute("aria-label", "תוכן התשובה");
  toc.innerHTML = `<b>בתשובה:</b><ol>${hs.map((h) => `<li class="${h.tagName === "H4" ? "sub" : ""}"><a href="#${h.id}">${esc(h.textContent.trim())}</a></li>`).join("")}</ol>`;
  ans.parentNode.insertBefore(toc, ans);
}

async function load() {
  let x;
  try { const d = await getDoc(doc(db, "publicQA", id)); if (!d.exists()) throw 0; x = { id: d.id, ...d.data() }; }
  catch { if (!document.querySelector("#qa[data-static]")) $("qa").innerHTML = `<h1>השאלה לא נמצאה</h1><p>ייתכן שהיא הוסרה מהמאגר. <a href="${ROOT}shut.html">למאגר השו"ת</a></p>`; return; }
  const title = titleOf(x), desc = (x.summary || x.question || "").replace(/\s+/g, " ").slice(0, 160);
  document.title = `${title} – שו"ת מכון משפטי ארץ`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", desc);
  if ($("canon")) $("canon").href = shareUrl(x);
  if (!document.querySelector('script[type="application/ld+json"]')) {
    const ld = document.createElement("script"); ld.type = "application/ld+json";
    ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "QAPage", mainEntity: { "@type": "Question", name: title, text: x.question, answerCount: 1,
      acceptedAnswer: { "@type": "Answer", text: x.answer, url: shareUrl(x), author: { "@type": "Organization", name: x.rabbiName || "מכון משפטי ארץ" } } } });
    document.head.appendChild(ld);
  }
  if (x.topic) $("crumbCat").innerHTML = `› <a href="${topicUrl(x.topic)}">${esc(x.topic)}</a>`;
  const wa = "https://wa.me/?text=" + encodeURIComponent(`שאלה מתוך מאגר השו"ת של מכון משפטי ארץ:\n${title}\n\nלתשובה: ${shareUrl(x)}`);
  $("qa").innerHTML = `
    <h1 class="q-title">${esc(title)}</h1>
    <div class="qa-meta">${x.topic ? `<a class="badge" href="${topicUrl(x.topic)}">${esc(x.topic)}</a>` : ""}${x.rabbiName ? `<a class="small rabbi-link" href="${rabbiUrl(x.rabbiName)}" title="כל התשובות של ${esc(x.rabbiName)}">${esc(x.rabbiName)}</a>` : ""}${x.publishedAt && !x.archive ? `<span class="small muted">${fmtDate(x.publishedAt)}</span>` : ""}
      ${tagsOf(x).map((g) => `<a class="chip small" href="${tagUrl(g)}">${esc(g)}</a>`).join("")}</div>
    ${x.summary ? `<p class="q-summary">${esc(x.summary)}</p>` : ""}
    <h2 class="qa-h">השאלה</h2>
    ${x.askerName ? `<p class="small muted" style="margin:0 0 4px">שאל/ה: ${esc(x.askerName)}</p>` : ""}
    <p class="pre q-text">${linkify(x.question)}</p>
    <h2 class="qa-h">התשובה</h2>
    <div class="ans q-text ${x.answerHtml ? "rich" : "pre"}" id="ans">${x.answerHtml ? sanitizeRich(x.answerHtml) : linkify(x.answer)}</div>
    ${x.rabbiName ? `<p class="small muted">— <a href="${rabbiUrl(x.rabbiName)}">${esc(x.rabbiName)}</a></p>` : ""}
    <div class="qa-actions no-print"><a class="share-wa" href="${wa}" target="_blank" rel="noopener">${WA_ICON} שיתוף בוואטסאפ</a>
      <button class="link small" id="copyLink">העתקת קישור</button>${saveBtn(x.id)}<button class="link small" id="printQ">הדפסה</button>
      <a class="small follow-up" href="${askUrl(x.id)}">יש לי שאלה דומה ←</a></div>`;
  addToc($("ans"));
  if ($("printUrl")) $("printUrl").textContent = `מתוך מאגר השו"ת של מכון משפטי ארץ · ${shareUrl(x)}`;
  $("copyLink").onclick = async (e) => { try { await navigator.clipboard.writeText(shareUrl(x)); e.target.textContent = "הקישור הועתק ✓"; } catch { /* */ } };
  $("printQ").onclick = () => window.print();
  bindSave($("qa"));
  countView(x.id);
  related(x);
}

// שורה אחת של שאלות דומות, ואחריה שורה של עוד מאותו רב
async function related(x) {
  try {
    const pool = new Map(), byRabbi = new Map();
    const add = (m) => (snap) => snap.forEach((d) => m.set(d.id, { id: d.id, ...d.data() }));
    const tags = tagsOf(x).slice(0, 10), jobs = [];
    if (tags.length) jobs.push(getDocs(query(collection(db, "publicQA"), where("tags", "array-contains-any", tags), limit(60))).then(add(pool)));
    if (x.topic) jobs.push(getDocs(query(collection(db, "publicQA"), where("topic", "==", x.topic), limit(40))).then(add(pool)));
    if (x.rabbiName) jobs.push(getDocs(query(collection(db, "publicQA"), where("rabbiName", "==", x.rabbiName), limit(30))).then(add(byRabbi)));
    await Promise.all(jobs);
    const sim = similarTo(x, [...pool.values()], 4);
    const seen = new Set([x.id, ...sim.map((y) => y.id)]);
    const fromRabbi = [...byRabbi.values()].filter((y) => !seen.has(y.id));
    // מאותו רב: קודם הקרובות לנושא, ואחריהן השאר
    const rel = similarTo(x, fromRabbi, 4), rest = fromRabbi.filter((y) => !rel.includes(y));
    const rabbiList = [...rel, ...rest].slice(0, 4);
    $("related").innerHTML = cardRow("שאלות דומות", sim)
      + (x.rabbiName ? cardRow(`עוד מ${esc(x.rabbiName)}`, rabbiList, `<a class="small" href="${rabbiUrl(x.rabbiName)}">לכל התשובות ←</a>`) : "");
  } catch { /* */ }
}
