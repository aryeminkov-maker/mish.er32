// ===== מאגר שו"ת ציבורי =====
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, loadTaxonomy, sanitizeRich } from "./common.js?v=20261026";

const $ = (id) => document.getElementById(id);
let ALL = [];

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("list").innerHTML = "";
} else {
  loadTaxonomy().then((tx) => {
    $("topic").innerHTML = `<option value="">כל הקטגוריות</option>` + tx.categories.map((t) => `<option>${esc(t)}</option>`).join("");
  });
  $("search").oninput = render;
  $("topic").onchange = render;
  const params = new URLSearchParams(location.search);
  if (params.get("q")) $("search").value = params.get("q");
  load();
}

async function load() {
  try {
    const snap = await getDocs(query(collection(db, "publicQA"), orderBy("publishedAt", "desc")));
    ALL = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  } catch {
    $("list").innerHTML = `<p class="muted">לא הצלחנו לטעון את המאגר.</p>`;
  }
}

const qUrl = (x) => new URL(`shut.html?id=${encodeURIComponent(x.id)}#q-${encodeURIComponent(x.id)}`, location.href).href;
const waLink = (x) => "https://wa.me/?text=" + encodeURIComponent(`שאלה מתוך מאגר השו"ת של מכון משפטי ארץ:\n${x.question.length > 200 ? x.question.slice(0, 200) + "…" : x.question}\n\nלתשובה: ${qUrl(x)}`);
const WA_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.4.4 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z"/></svg>';

function render() {
  const t = $("search").value.trim().toLowerCase();
  const topic = $("topic").value;
  const list = ALL.filter((x) => (!topic || x.topic === topic) && (!t || `${x.question} ${x.answer} ${(x.tags || []).join(" ")}`.toLowerCase().includes(t)));
  $("count").textContent = `${list.length} שאלות`;
  $("list").innerHTML = list.map((x) => `
    <details class="qa" id="q-${x.id}">
      <summary>${esc(x.question.length > 140 ? x.question.slice(0, 140) + "…" : x.question)}</summary>
      <div class="small muted" style="margin-top:6px">${esc(x.topic || "")}${x.publishedAt ? " · " + fmtDate(x.publishedAt) : ""} ${(x.tags || []).map((g) => `<span class="badge">${esc(g)}</span>`).join("")}</div>
      ${x.question.length > 140 ? `<p class="pre">${esc(x.question)}</p>` : ""}
      <div class="ans ${x.answerHtml ? "rich" : ""}">${x.answerHtml ? sanitizeRich(x.answerHtml) : esc(x.answer)}${x.rabbiName ? `<p class="small muted">— ${esc(x.rabbiName)}</p>` : ""}</div>
      <div class="row" style="margin-top:8px"><a class="share-wa" href="${waLink(x)}" target="_blank" rel="noopener">${WA_ICON} שיתוף בוואטסאפ</a>
        <button class="link small" data-copylink="${esc(x.id)}">העתקת קישור</button></div>
    </details>`).join("") || `<p class="muted">לא נמצאו שאלות.</p>`;
  document.querySelectorAll("[data-copylink]").forEach((b) => (b.onclick = async () => {
    try { await navigator.clipboard.writeText(qUrl({ id: b.dataset.copylink })); b.textContent = "הקישור הועתק ✓"; } catch { /* */ }
  }));
  if (location.hash.startsWith("#q-")) { const el = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (el) { el.open = true; el.scrollIntoView(); } }
}
