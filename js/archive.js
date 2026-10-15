// ===== מאגר שו"ת ציבורי =====
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, fmtDate, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261020";

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
      <div class="ans">${esc(x.answer)}${x.rabbiName ? `<p class="small muted">— ${esc(x.rabbiName)}</p>` : ""}</div>
    </details>`).join("") || `<p class="muted">לא נמצאו שאלות.</p>`;
  if (location.hash.startsWith("#q-")) { const el = document.querySelector(location.hash); if (el) el.open = true; }
}
