// ===== דף שאלה בודדת (q.html?id=...) – כתובת קבועה לכל שאלה, בשביל שיתוף וגוגל =====
import { doc, getDoc, getDocs, collection, query, where, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, sanitizeRich } from "./common.js?v=20261107";
import { tagsOf, titleOf, qPageUrl, similarTo, countView } from "./qa-public.js?v=20261107";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id");
const WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>';

if (!configReady) { setupMissingNotice($("setupView")); $("qa").innerHTML = ""; }
else if (!id) location.replace("shut.html");
else load();

async function load() {
  let x;
  try { const d = await getDoc(doc(db, "publicQA", id)); if (!d.exists()) throw 0; x = { id: d.id, ...d.data() }; }
  catch { $("qa").innerHTML = `<h1>השאלה לא נמצאה</h1><p>ייתכן שהיא הוסרה מהמאגר. <a href="shut.html">למאגר השו"ת</a></p>`; return; }
  const title = titleOf(x), desc = (x.summary || x.question || "").replace(/\s+/g, " ").slice(0, 160);
  // שם הדף ותיאור – בשביל גוגל והשיתוף
  document.title = `${title} – שו"ת מכון משפטי ארץ`;
  document.querySelector('meta[name="description"]').setAttribute("content", desc);
  $("canon").href = qPageUrl(x.id);
  const ld = document.createElement("script"); ld.type = "application/ld+json";
  ld.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "QAPage", mainEntity: { "@type": "Question", name: title, text: x.question, answerCount: 1,
    acceptedAnswer: { "@type": "Answer", text: x.answer, url: qPageUrl(x.id), author: { "@type": "Organization", name: x.rabbiName || "מכון משפטי ארץ" } } } });
  document.head.appendChild(ld);
  if (x.topic) $("crumbCat").innerHTML = `› <a href="shut.html?topic=${encodeURIComponent(x.topic)}">${esc(x.topic)}</a>`;
  const wa = "https://wa.me/?text=" + encodeURIComponent(`שאלה מתוך מאגר השו"ת של מכון משפטי ארץ:\n${title}\n\nלתשובה: ${qPageUrl(x.id)}`);
  $("qa").innerHTML = `
    <h1 class="q-title">${esc(title)}</h1>
    <div class="qa-meta">${x.topic ? `<a class="badge" href="shut.html?topic=${encodeURIComponent(x.topic)}">${esc(x.topic)}</a>` : ""}${x.rabbiName ? `<span class="small muted">${esc(x.rabbiName)}</span>` : ""}${x.publishedAt && !x.archive ? `<span class="small muted">${fmtDate(x.publishedAt)}</span>` : ""}
      ${tagsOf(x).map((g) => `<a class="chip small" href="shut.html?tag=${encodeURIComponent(g)}">${esc(g)}</a>`).join("")}</div>
    ${x.summary ? `<p class="q-summary">${esc(x.summary)}</p>` : ""}
    <h2 class="qa-h">השאלה</h2>
    ${x.askerName ? `<p class="small muted" style="margin:0 0 4px">שאל/ה: ${esc(x.askerName)}</p>` : ""}
    <p class="pre">${esc(x.question)}</p>
    <h2 class="qa-h">התשובה</h2>
    <div class="ans ${x.answerHtml ? "rich" : "pre"}">${x.answerHtml ? sanitizeRich(x.answerHtml) : esc(x.answer)}</div>
    ${x.rabbiName ? `<p class="small muted">— ${esc(x.rabbiName)}</p>` : ""}
    <div class="row no-print" style="margin-top:12px"><a class="share-wa" href="${wa}" target="_blank" rel="noopener">${WA_ICON} שיתוף בוואטסאפ</a>
      <button class="link small" id="copyLink">העתקת קישור</button><button class="link small" id="printQ">הדפסה</button></div>`;
  $("copyLink").onclick = async (e) => { try { await navigator.clipboard.writeText(qPageUrl(x.id)); e.target.textContent = "הקישור הועתק ✓"; } catch { /* */ } };
  $("printQ").onclick = () => window.print();
  countView(x.id);
  // שאלות דומות: מאותה קטגוריה ומאותן תגיות (בלי לטעון את כל המאגר)
  try {
    const pool = new Map();
    const add = (snap) => snap.forEach((d) => pool.set(d.id, { id: d.id, ...d.data() }));
    const tags = tagsOf(x).slice(0, 10);
    const jobs = [];
    if (tags.length) jobs.push(getDocs(query(collection(db, "publicQA"), where("tags", "array-contains-any", tags), limit(60))).then(add));
    if (x.topic) jobs.push(getDocs(query(collection(db, "publicQA"), where("topic", "==", x.topic), limit(40))).then(add));
    await Promise.all(jobs);
    const sim = similarTo(x, [...pool.values()], 6);
    if (sim.length) $("similar").innerHTML = `<div class="card qa-similar"><h2 class="qa-h" style="margin-top:0">שאלות דומות</h2><ul>${sim.map((y) => `<li><a href="q.html?id=${encodeURIComponent(y.id)}">${esc(titleOf(y))}</a>${y.topic ? ` <span class="small muted">· ${esc(y.topic)}</span>` : ""}</li>`).join("")}</ul></div>`;
  } catch { /* */ }
}
