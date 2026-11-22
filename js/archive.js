// ===== מאגר שו"ת ציבורי =====
import { collection, getDocs, getDoc, doc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, loadTaxonomy, sanitizeRich, normText, linkify } from "./common.js?v=20261108";
import { tagsOf, titleOf, qPageUrl, shareUrl, topicUrl, askUrl, similarTo, countView, indexOf, matches, highlight, didYouMean, wordsIn,
  logMiss, saved, saveBtn, bindSave } from "./qa-public.js?v=20261108";

const $ = (id) => document.getElementById(id);
const PAGE = 30;
let ALL = [], shown = PAGE, POPULAR = [], VOCAB = new Set(), CATS = [];
const F = { tag: "", rabbi: "", saved: false };

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("list").innerHTML = "";
} else {
  loadTaxonomy().then((tx) => {
    CATS = tx.categories;
    $("topic").innerHTML = `<option value="">כל הקטגוריות</option>` + tx.categories.map((t) => `<option>${esc(t)}</option>`).join("");
    const p = new URLSearchParams(location.search);
    if (p.get("topic")) $("topic").value = p.get("topic");
    drawTopics(); if (ALL.length) render();
  });
  let tm, missTm;
  $("search").oninput = () => {
    clearTimeout(tm); clearTimeout(missTm);
    tm = setTimeout(() => { shown = PAGE; render(); }, 200);
    // חיפוש בלי תוצאות – נרשם (לממשק הניהול) רק אחרי שהגולש הפסיק להקליד
    missTm = setTimeout(() => { if (ALL.length && !filtered().length) logMiss($("search").value, $("topic").value); }, 2500);
  };
  $("topic").onchange = () => { shown = PAGE; render(); };
  $("sort").onchange = render;
  const params = new URLSearchParams(location.search);
  if (params.get("q")) $("search").value = params.get("q");
  if (params.get("tag")) F.tag = params.get("tag");
  if (params.get("rabbi")) F.rabbi = params.get("rabbi");
  if (params.get("saved")) F.saved = true;
  load();
}

const excerptOf = (x) => { const t = (x.summary || (x.title ? x.question : "") || "").trim(); return t.length > 180 ? t.slice(0, 180) + "…" : t; };

async function load() {
  try {
    const snap = await getDocs(query(collection(db, "publicQA"), orderBy("publishedAt", "desc")));
    ALL = snap.docs.map((d) => {
      const x = { id: d.id, ...d.data() };
      x.question = x.question || ""; x.answer = x.answer || "";
      x._idx = indexOf(x);
      return x;
    });
    ALL.forEach((x) => wordsIn(`${x.title || ""} ${(x.tags || []).join(" ")} ${x.question}`).forEach((w) => { if (w.length >= 3) VOCAB.add(w); }));
    drawPopular();
    // השאלות הנצפות ביותר (הרשימה מחושבת פעם בכמה שעות; מספרי הצפיות לא מוצגים באתר)
    try { const d = await getDoc(doc(db, "settings", "popularQA")); POPULAR = (d.exists() ? d.data().ids || [] : []).map((i) => ALL.find((x) => x.id === i)).filter(Boolean).slice(0, 6); } catch { /* */ }
    const want = new URLSearchParams(location.search).get("id") || (location.hash.startsWith("#q-") ? decodeURIComponent(location.hash.slice(3)) : "");
    if (want) { const i = ALL.findIndex((x) => x.id === want); if (i >= shown) shown = i + 1; }
    drawTopics();
    render();
  } catch {
    $("list").innerHTML = `<p class="muted">לא הצלחנו לטעון את המאגר.</p>`;
  }
}

// קטגוריות – קישורים לדפי הנושא
function drawTopics() {
  if (!$("topics") || !CATS.length) return;
  const cnt = new Map(); ALL.forEach((x) => cnt.set(x.topic, (cnt.get(x.topic) || 0) + 1));
  $("topics").innerHTML = CATS.filter((c) => !ALL.length || cnt.get(c)).map((c) => `<a class="topic-link" href="${topicUrl(c)}">${esc(c)}${cnt.get(c) ? ` <span class="muted">${cnt.get(c)}</span>` : ""}</a>`).join("");
}
// התגיות הנפוצות במאגר – כפתורי סינון מהירים
function drawPopular() {
  const count = new Map();
  ALL.forEach((x) => tagsOf(x).forEach((g) => count.set(g, (count.get(g) || 0) + 1)));
  const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 12);
  $("popular").innerHTML = top.length ? `<span class="small muted">תגיות נפוצות:</span> ` + top.map(([g]) => `<button type="button" class="chip" data-tagf="${esc(g)}">${esc(g)}</button>`).join("") : "";
  bindTagButtons($("popular"));
}

const toTop = () => document.querySelector(".shut-filters")?.scrollIntoView({ behavior: "smooth", block: "start" });
function setRabbi(r) { F.rabbi = r; shown = PAGE; render(); toTop(); }
function setTag(t) { F.tag = t; shown = PAGE; render(); toTop(); }
function bindTagButtons(root) {
  root.querySelectorAll("[data-tagf]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setTag(b.dataset.tagf); }));
  root.querySelectorAll("[data-rabbif]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); setRabbi(b.dataset.rabbif); }));
}

function filtered() {
  const q = $("search").value, topic = $("topic").value, sv = F.saved ? new Set(saved.all()) : null;
  let list = ALL.filter((x) => (!topic || x.topic === topic) && (!F.tag || (x.tags || []).includes(F.tag)) && (!F.rabbi || x.rabbiName === F.rabbi)
    && (!sv || sv.has(x.id)) && matches(x._idx, q));
  if ($("sort").value === "abc") list = [...list].sort((a, b) => titleOf(a).localeCompare(titleOf(b), "he"));
  return list;
}

const waLink = (x) => "https://wa.me/?text=" + encodeURIComponent(`שאלה מתוך מאגר השו"ת של מכון משפטי ארץ:\n${titleOf(x)}\n\nלתשובה: ${shareUrl(x)}`);
const WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>';
const tagChips = (x) => tagsOf(x).map((g) => `<button type="button" class="chip small" data-tagf="${esc(g)}" title="כל השאלות בנושא ${esc(g)}">${esc(g)}</button>`).join("");

function drawChips() {
  const chips = [];
  if (F.saved) chips.push(`<button type="button" class="chip on" id="clearSaved">★ השמורים שלי ✕</button>`);
  if (F.rabbi) chips.push(`<span class="small muted">תשובות של:</span> <button type="button" class="chip on" id="clearRabbi" aria-label="ביטול הסינון לפי ${esc(F.rabbi)}">${esc(F.rabbi)} ✕</button>`);
  if (F.tag) chips.push(`<span class="small muted">תגית:</span> <button type="button" class="chip on" id="clearTag" aria-label="ביטול הסינון לפי ${esc(F.tag)}">${esc(F.tag)} ✕</button>`);
  const nSaved = saved.all().length;
  if (!F.saved && nSaved) chips.push(`<button type="button" class="chip" id="showSaved">★ השמורים שלי (${nSaved})</button>`);
  $("active").innerHTML = chips.join(" ");
  if ($("clearTag")) $("clearTag").onclick = () => setTag("");
  if ($("clearRabbi")) $("clearRabbi").onclick = () => setRabbi("");
  if ($("clearSaved")) $("clearSaved").onclick = () => { F.saved = false; render(); };
  if ($("showSaved")) $("showSaved").onclick = () => { F.saved = true; shown = PAGE; render(); };
}

function render() {
  const list = filtered(), q = $("search").value.trim();
  drawChips();

  const noFilter = !F.tag && !F.rabbi && !F.saved && !$("topic").value && !q;
  $("popularBox").innerHTML = noFilter && POPULAR.length ? `<div class="card popular-box"><b>השאלות הנצפות ביותר</b><ol>${POPULAR.map((y) => `<li><a href="${qPageUrl(y.id)}" data-goto="${esc(y.id)}">${esc(titleOf(y))}</a></li>`).join("")}</ol></div>` : "";
  $("popularBox").querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); goTo(a.dataset.goto); }));

  $("count").textContent = `${list.length} שאלות` + (list.length > shown ? ` · מוצגות ${shown} הראשונות` : "");
  const hl = (s) => (q ? highlight(esc(s), q) : esc(s));
  const dym = !list.length && q ? didYouMean(q, VOCAB) : "";
  $("list").innerHTML = list.slice(0, shown).map((x) => `
    <details class="qa" id="q-${esc(x.id)}" data-id="${esc(x.id)}">
      <summary>
        <span class="qa-title">${hl(titleOf(x))}</span>
        <span class="qa-meta">${x.topic ? `<a class="badge" href="${topicUrl(x.topic)}" onclick="event.stopPropagation()">${esc(x.topic)}</a>` : ""}${x.rabbiName ? `<button type="button" class="link small rabbi-link" data-rabbif="${esc(x.rabbiName)}" title="כל התשובות של ${esc(x.rabbiName)}">${esc(x.rabbiName)}</button>` : ""}${x.publishedAt && !x.archive ? `<span class="small muted">${fmtDate(x.publishedAt)}</span>` : ""}${tagChips(x)}</span>
        ${excerptOf(x) ? `<span class="qa-excerpt">${hl(excerptOf(x))}</span>` : ""}
      </summary>
      <div class="qa-body"></div>
    </details>`).join("") || `<div class="card empty-res"><p><b>לא נמצאו שאלות.</b></p>
      ${dym ? `<p>האם התכוונת ל: <button type="button" class="link" id="dym">${esc(dym)}</button>?</p>` : ""}
      <p class="muted">נסו מילים אחרות או פחות מילים – או <a href="${askUrl()}">שלחו את השאלה לרבני המכון</a>.</p></div>`;
  if ($("dym")) $("dym").onclick = () => { $("search").value = dym; render(); };
  $("more").innerHTML = list.length > shown ? `<button id="moreBtn">הצגת עוד ${Math.min(PAGE, list.length - shown)} שאלות</button>` : "";
  if ($("moreBtn")) $("moreBtn").onclick = () => { shown += PAGE; render(); };
  bindTagButtons($("list"));
  document.querySelectorAll("details.qa").forEach((d) => d.addEventListener("toggle", () => { if (d.open) fillBody(d); }));
  const want = new URLSearchParams(location.search).get("id") || (location.hash.startsWith("#q-") ? decodeURIComponent(location.hash.slice(3)) : "");
  if (want) { const el = document.getElementById("q-" + want); if (el && !el.dataset.jumped) { el.dataset.jumped = "1"; el.open = true; fillBody(el); el.scrollIntoView(); } }
}

function fillBody(d) {
  const box = d.querySelector(".qa-body");
  if (box.dataset.done) return;
  const x = ALL.find((y) => y.id === d.dataset.id);
  if (!x) return;
  const sim = similarTo(x, ALL, 4);
  box.dataset.done = "1";
  countView(x.id);
  box.innerHTML = `
    <h3 class="qa-h">השאלה</h3>
    ${x.askerName ? `<p class="small muted" style="margin:0 0 4px">שאל/ה: ${esc(x.askerName)}</p>` : ""}
    <p class="pre">${linkify(x.question)}</p>
    <h3 class="qa-h">התשובה</h3>
    <div class="ans ${x.answerHtml ? "rich" : ""}">${x.answerHtml ? sanitizeRich(x.answerHtml) : linkify(x.answer)}${x.rabbiName ? `<p class="small muted">— <a href="shut.html?rabbi=${encodeURIComponent(x.rabbiName)}" data-rabbif="${esc(x.rabbiName)}">${esc(x.rabbiName)}</a></p>` : ""}</div>
    <div class="qa-actions"><a class="share-wa" href="${waLink(x)}" target="_blank" rel="noopener">${WA_ICON} שיתוף</a>
      <button class="link small" data-copylink>העתקת קישור</button>${saveBtn(x.id)}
      <a class="small" href="${qPageUrl(x.id)}">לדף השאלה ↗</a><a class="small" href="${askUrl(x.id)}">יש לי שאלה דומה</a></div>
    ${sim.length ? `<div class="qa-similar-inline"><span class="small muted">שאלות דומות:</span> ${sim.map((y) => `<a href="${qPageUrl(y.id)}" data-goto="${esc(y.id)}">${esc(titleOf(y))}</a>`).join(" · ")}</div>` : ""}`;
  box.querySelector("[data-copylink]").onclick = async (e) => {
    try { await navigator.clipboard.writeText(shareUrl(x)); e.target.textContent = "הקישור הועתק ✓"; } catch { /* */ }
  };
  bindTagButtons(box);
  bindSave(box, drawChips);
  box.querySelectorAll("[data-goto]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); goTo(a.dataset.goto); }));
}

function goTo(id) {
  let el = document.getElementById("q-" + id);
  if (!el) {
    $("search").value = ""; $("topic").value = ""; F.tag = ""; F.rabbi = ""; F.saved = false;
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
