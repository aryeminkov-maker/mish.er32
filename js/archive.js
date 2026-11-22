// ===== מאגר שו"ת ציבורי =====
import { collection, getDocs, getDoc, doc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, loadTaxonomy, sanitizeRich, normText } from "./common.js?v=20261107";
import { tagsOf, titleOf, qPageUrl, similarTo, countView } from "./qa-public.js?v=20261107";

const $ = (id) => document.getElementById(id);
const PAGE = 30;
let ALL = [], shown = PAGE, POPULAR = [];
const F = { tag: "" };

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("list").innerHTML = "";
} else {
  loadTaxonomy().then((tx) => {
    $("topic").innerHTML = `<option value="">כל הקטגוריות</option>` + tx.categories.map((t) => `<option>${esc(t)}</option>`).join("");
    const p = new URLSearchParams(location.search);
    if (p.get("topic")) { $("topic").value = p.get("topic"); render(); }
  });
  let tm;
  $("search").oninput = () => { clearTimeout(tm); tm = setTimeout(() => { shown = PAGE; render(); }, 200); };
  $("topic").onchange = () => { shown = PAGE; render(); };
  $("sort").onchange = render;
  const params = new URLSearchParams(location.search);
  if (params.get("q")) $("search").value = params.get("q");
  if (params.get("tag")) F.tag = params.get("tag");
  load();
}

const excerptOf = (x) => { const t = (x.summary || (x.title ? x.question : "") || "").trim(); return t.length > 180 ? t.slice(0, 180) + "…" : t; };

async function load() {
  try {
    const snap = await getDocs(query(collection(db, "publicQA"), orderBy("publishedAt", "desc")));
    ALL = snap.docs.map((d) => {
      const x = { id: d.id, ...d.data() };
      x.question = x.question || ""; x.answer = x.answer || "";
      x._norm = normText(`${x.title || ""} ${x.question} ${x.answer} ${(x.tags || []).join(" ")} ${x.topic || ""}`);
      x._words = new Set(normText(`${x.title || ""} ${x.question}`).split(" ").filter((w) => w.length >= 3)); // למילים משותפות
      return x;
    });
    drawPopular();
    // השאלות הנצפות ביותר (הרשימה מחושבת פעם בכמה שעות; מספרי הצפיות לא מוצגים באתר)
    try { const d = await getDoc(doc(db, "settings", "popularQA")); POPULAR = (d.exists() ? d.data().ids || [] : []).map((i) => ALL.find((x) => x.id === i)).filter(Boolean).slice(0, 6); } catch { /* */ }
    // קישור ישיר לשאלה – לוודא שהיא בתוך מה שמוצג
    const want = new URLSearchParams(location.search).get("id") || (location.hash.startsWith("#q-") ? decodeURIComponent(location.hash.slice(3)) : "");
    if (want) { const i = ALL.findIndex((x) => x.id === want); if (i >= shown) shown = i + 1; }
    render();
  } catch {
    $("list").innerHTML = `<p class="muted">לא הצלחנו לטעון את המאגר.</p>`;
  }
}

// התגיות הנפוצות במאגר – כפתורי סינון מהירים
function drawPopular() {
  const count = new Map();
  ALL.forEach((x) => tagsOf(x).forEach((g) => count.set(g, (count.get(g) || 0) + 1)));
  const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 14);
  $("popular").innerHTML = top.length ? `<span class="small muted">נושאים נפוצים:</span> ` + top.map(([g, n]) => `<button type="button" class="chip" data-tagf="${esc(g)}">${esc(g)} <span class="muted">${n}</span></button>`).join("") : "";
  bindTagButtons($("popular"));
}

function setTag(t) { F.tag = t; shown = PAGE; render(); document.querySelector(".shut-filters")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
function bindTagButtons(root) {
  root.querySelectorAll("[data-tagf]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setTag(b.dataset.tagf); }));
}

function filtered() {
  const words = normText($("search").value).trim().split(" ").filter(Boolean);
  const topic = $("topic").value;
  let list = ALL.filter((x) => (!topic || x.topic === topic) && (!F.tag || (x.tags || []).includes(F.tag)) && words.every((w) => x._norm.includes(w)));
  if ($("sort").value === "abc") list = [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b), "he"));
  return list;
}

const qUrl = (x) => qPageUrl(x.id);
const waLink = (x) => "https://wa.me/?text=" + encodeURIComponent(`שאלה מתוך מאגר השו"ת של מכון משפטי ארץ:\n${titleOf(x)}\n\nלתשובה: ${qUrl(x)}`);
const WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>';

const similar = (x, n = 5) => similarTo(x, ALL, n);

function tagChips(x) { return tagsOf(x).map((g) => `<button type="button" class="chip small" data-tagf="${esc(g)}" title="כל השאלות בנושא ${esc(g)}">${esc(g)}</button>`).join(""); }

function render() {
  const list = filtered();
  $("active").innerHTML = F.tag ? `<span class="small muted">מסונן לפי תגית:</span> <button type="button" class="chip on" id="clearTag" aria-label="ביטול הסינון לפי ${esc(F.tag)}">${esc(F.tag)} ✕</button>` : "";
  if ($("clearTag")) $("clearTag").onclick = () => setTag("");
  const noFilter = !F.tag && !$("topic").value && !$("search").value.trim();
  $("popularBox").innerHTML = noFilter && POPULAR.length ? `<div class="card popular-box"><b>השאלות הנצפות ביותר</b><ol>${POPULAR.map((y) => `<li><a href="q.html?id=${encodeURIComponent(y.id)}" data-goto="${esc(y.id)}">${esc(titleOf(y))}</a></li>`).join("")}</ol></div>` : "";
  $("popularBox").querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); goTo(a.dataset.goto); }));
  $("count").textContent = `${list.length} שאלות` + (list.length > shown ? ` · מוצגות ${shown} הראשונות` : "");
  $("list").innerHTML = list.slice(0, shown).map((x) => `
    <details class="qa" id="q-${esc(x.id)}" data-id="${esc(x.id)}">
      <summary>
        <span class="qa-title">${esc(titleOf(x))}</span>
        <span class="qa-meta">${x.topic ? `<span class="badge">${esc(x.topic)}</span>` : ""}${x.rabbiName ? `<span class="small muted">${esc(x.rabbiName)}</span>` : ""}${x.publishedAt && !x.archive ? `<span class="small muted">${fmtDate(x.publishedAt)}</span>` : ""}${tagChips(x)}</span>
        ${excerptOf(x) ? `<span class="qa-excerpt">${esc(excerptOf(x))}</span>` : ""}
      </summary>
      <div class="qa-body"></div>
    </details>`).join("") || `<p class="muted">לא נמצאו שאלות. נסו מילים אחרות, או <a href="ask.html">שאלו את הרב</a>.</p>`;
  $("more").innerHTML = list.length > shown ? `<button id="moreBtn">הצגת עוד ${Math.min(PAGE, list.length - shown)} שאלות</button>` : "";
  if ($("moreBtn")) $("moreBtn").onclick = () => { shown += PAGE; render(); };
  bindTagButtons($("list"));
  // תוכן השאלה נבנה רק כשפותחים אותה (מהיר גם עם אלף שאלות)
  document.querySelectorAll("details.qa").forEach((d) => d.addEventListener("toggle", () => { if (d.open) fillBody(d); }));
  const want = new URLSearchParams(location.search).get("id") || (location.hash.startsWith("#q-") ? decodeURIComponent(location.hash.slice(3)) : "");
  if (want) { const el = document.getElementById("q-" + want); if (el && !el.dataset.jumped) { el.dataset.jumped = "1"; el.open = true; fillBody(el); el.scrollIntoView(); } }
}

function fillBody(d) {
  const box = d.querySelector(".qa-body");
  if (box.dataset.done) return;
  const x = ALL.find((y) => y.id === d.dataset.id);
  if (!x) return;
  const sim = similar(x);
  box.dataset.done = "1";
  countView(x.id);
  box.innerHTML = `
    <h3 class="qa-h">השאלה</h3>
    ${x.askerName ? `<p class="small muted" style="margin:0 0 4px">שאל/ה: ${esc(x.askerName)}</p>` : ""}
    <p class="pre">${esc(x.question)}</p>
    <h3 class="qa-h">התשובה</h3>
    <div class="ans ${x.answerHtml ? "rich" : ""}">${x.answerHtml ? sanitizeRich(x.answerHtml) : esc(x.answer)}${x.rabbiName ? `<p class="small muted">— ${esc(x.rabbiName)}</p>` : ""}</div>
    <div class="row" style="margin-top:8px"><a class="share-wa" href="${waLink(x)}" target="_blank" rel="noopener">${WA_ICON} שיתוף בוואטסאפ</a>
      <button class="link small" data-copylink>העתקת קישור</button><a class="small" href="q.html?id=${encodeURIComponent(x.id)}">לדף השאלה ↗</a></div>
    ${sim.length ? `<div class="qa-similar"><h3 class="qa-h">שאלות דומות</h3><ul>${sim.map((y) => `<li><a href="#q-${esc(y.id)}" data-goto="${esc(y.id)}">${esc(titleOf(y))}</a>${y.topic ? ` <span class="small muted">· ${esc(y.topic)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}`;
  box.querySelector("[data-copylink]").onclick = async (e) => {
    try { await navigator.clipboard.writeText(qUrl(x)); e.target.textContent = "הקישור הועתק ✓"; } catch { /* */ }
  };
  box.querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); goTo(a.dataset.goto); }));
}

// מעבר לשאלה דומה: אם היא מסוננת או לא מוצגת – מנקים סינון ומרחיבים את הרשימה
function goTo(id) {
  let el = document.getElementById("q-" + id);
  if (!el) {
    $("search").value = ""; $("topic").value = ""; F.tag = "";
    const i = ALL.findIndex((x) => x.id === id);
    if (i >= shown) shown = i + 1;
    render();
    el = document.getElementById("q-" + id);
  }
  if (!el) return;
  el.open = true; fillBody(el);
  history.replaceState(null, "", `?id=${encodeURIComponent(id)}#q-${encodeURIComponent(id)}`);
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}
