// ===== דף נושא: קטגוריה (topic.html?c=...) או תגית (topic.html?tag=...) =====
import { collection, getDocs, getDoc, doc, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261108";
import { tagsOf, titleOf, qPageUrl, topicUrl, tagUrl, indexOf, matches, highlight, logMiss } from "./qa-public.js?v=20261108";

const $ = (id) => document.getElementById(id);
const P = new URLSearchParams(location.search), CAT = P.get("c") || "", TAG = P.get("tag") || "";
const PAGE = 30;
let LIST = [], shown = PAGE;

if (!configReady) setupMissingNotice($("setupView"));
else if (!CAT && !TAG) location.replace("shut.html");
else load();

async function load() {
  const name = CAT || TAG;
  const tx = await loadTaxonomy().catch(() => ({ categories: [] }));
  const desc = CAT ? (tx.catDesc?.[CAT] || `כל השאלות והתשובות בנושא ${CAT} ממאגר השו"ת של מכון משפטי ארץ.`) : `שאלות ותשובות בנושא "${TAG}" ממאגר השו"ת של מכון משפטי ארץ.`;
  $("tTitle").textContent = CAT ? CAT : `תגית: ${TAG}`;
  $("crumb").textContent = name;
  $("tDesc").textContent = desc;
  document.title = `${name} – מאגר השו"ת של מכון משפטי ארץ`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", desc.slice(0, 160));
  $("canon").href = CAT ? topicUrl(CAT) : tagUrl(TAG);
  try {
    const snap = await getDocs(query(collection(db, "publicQA"), CAT ? where("topic", "==", CAT) : where("tags", "array-contains", TAG)));
    LIST = snap.docs.map((d) => ({ id: d.id, ...d.data() })).map((x) => ({ ...x, _idx: indexOf(x) }))
      .sort((a, b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0));
  } catch { $("tList").innerHTML = '<p class="muted">לא הצלחנו לטעון.</p>'; return; }
  // הנצפות ביותר בנושא (רק הסדר – בלי מספרים)
  try {
    const pd = await getDoc(doc(db, "settings", "popularQA"));
    const ids = pd.exists() ? (CAT ? pd.data().byTopic?.[CAT] : pd.data().byTag?.[TAG]) || [] : [];
    const top = ids.map((i) => LIST.find((x) => x.id === i)).filter(Boolean).slice(0, 5);
    if (top.length) $("tPopular").innerHTML = `<div class="card popular-box"><b>הנצפות ביותר בנושא</b><ol>${top.map((y) => `<li><a href="${qPageUrl(y.id)}">${esc(titleOf(y))}</a></li>`).join("")}</ol></div>`;
  } catch { /* */ }
  // תגיות נפוצות בתוך הנושא
  const cnt = new Map(); LIST.forEach((x) => tagsOf(x).forEach((g) => { if (g !== TAG) cnt.set(g, (cnt.get(g) || 0) + 1); }));
  const top = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("tTags").innerHTML = top.length ? `<span class="small muted">${CAT ? "תגיות בנושא:" : "תגיות קשורות:"}</span> ` + top.map(([g]) => `<a class="chip" href="${tagUrl(g)}">${esc(g)}</a>`).join("") : "";
  // נושאים אחרים
  $("tOther").innerHTML = (tx.categories || []).filter((c) => c !== CAT).map((c) => `<a class="topic-link" href="${topicUrl(c)}">${esc(c)}</a>`).join("");
  let tm, mt;
  $("tSearch").oninput = () => { clearTimeout(tm); clearTimeout(mt); tm = setTimeout(() => { shown = PAGE; render(); }, 200); mt = setTimeout(() => { if (!filtered().length) logMiss($("tSearch").value, CAT); }, 2500); };
  render();
}

const filtered = () => LIST.filter((x) => matches(x._idx, $("tSearch").value));
const excerptOf = (x) => { const t = (x.summary || (x.title ? x.question : "") || "").trim(); return t.length > 200 ? t.slice(0, 200) + "…" : t; };

function render() {
  const list = filtered(), q = $("tSearch").value.trim();
  const hl = (s) => (q ? highlight(esc(s), q) : esc(s));
  $("tCount").textContent = `${list.length} שאלות` + (list.length > shown ? ` · מוצגות ${shown} הראשונות` : "");
  $("tList").innerHTML = list.slice(0, shown).map((x) => `
    <a class="topic-item" href="${qPageUrl(x.id)}">
      <span class="qa-title">${hl(titleOf(x))}</span>
      ${excerptOf(x) ? `<span class="qa-excerpt">${hl(excerptOf(x))}</span>` : ""}
      <span class="qa-meta">${!CAT && x.topic ? `<span class="badge">${esc(x.topic)}</span>` : ""}${x.rabbiName ? `<span class="small muted">${esc(x.rabbiName)}</span>` : ""}${tagsOf(x).filter((g) => g !== TAG).slice(0, 4).map((g) => `<span class="chip small">${esc(g)}</span>`).join("")}</span>
    </a>`).join("") || `<p class="muted">לא נמצאו שאלות. <a href="ask.html">שאלו את הרב</a></p>`;
  $("tMore").innerHTML = list.length > shown ? `<button id="tMoreBtn">הצגת עוד</button>` : "";
  if ($("tMoreBtn")) $("tMoreBtn").onclick = () => { shown += PAGE; render(); };
}
