// ===== טופס שאלה ציבורי =====
import { collection, addDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261027";

const $ = (id) => document.getElementById(id);

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("formCard").classList.add("hidden");
} else {
  loadTaxonomy().then((tx) => {
    $("topic").innerHTML = tx.categories.map((t) => `<option ${t === tx.defaultCategory ? "selected" : ""}>${esc(t)}</option>`).join("");
  });
  const dlg = $("consentDialog");
  $("askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("consent").checked) send();
    else dlg.showModal();
  });
  $("text").addEventListener("input", () => { clearTimeout(simTimer); simTimer = setTimeout(showSimilar, 600); });
  $("cdYes").onclick = () => { $("consent").checked = true; dlg.close(); send(); };
  $("cdNo").onclick = () => { dlg.close(); send(); };
  $("cdBack").onclick = () => dlg.close();
}

async function send() {
  const btn = $("send");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await addDoc(collection(db, "questions"), {
      firstName: $("firstName").value.trim(),
      lastName: $("lastName").value.trim(),
      email: $("email").value.trim(),
      phone: $("phone").value.trim(),
      topic: $("topic").value,
      text: $("text").value.trim(),
      consentEmail: $("consent").checked,
      status: "new",
      contactId: null,
      origin: "טופס באתר",
      createdAt: serverTimestamp()
    });
    $("formCard").classList.add("hidden");
    $("thanks").classList.remove("hidden");
    $("thanksText").textContent = $("consent").checked
      ? "התשובה תישלח אליך למייל."
      : "לא אישרת קבלת דיוור, ולכן לא נשלח אליך את התשובה במייל.";
  } catch (err) {
    toast("השליחה נכשלה, נסו שוב", "bad");
    btn.disabled = false;
  }
}

// ---------- שאלות דומות מהמאגר (לפני ששולחים) ----------
let simTimer = null, archive = null;
const STOP = new Set("של את על עם אם זה זו או גם לא כן מה מי איך האם יש אין כל הוא היא הם הן אני אנחנו לי לו לה להם אבל כי רק עוד כמו אחד אחת אותו אותה בין אצל לפני אחרי מותר אסור צריך האם".split(" "));
const words = (t) => [...new Set(String(t).replace(/[^\u0590-\u05FFa-zA-Z0-9\s]/g, " ").split(/\s+/)
  .map((w) => w.replace(/^[והבכלמש](?=[\u0590-\u05FF]{3,})/, "")).filter((w) => w.length >= 3 && !STOP.has(w)))];
async function showSimilar() {
  const q = $("text").value.trim(), box = $("similar");
  const qw = words(q);
  if (qw.length < 2) { box.classList.add("hidden"); return; }
  if (!archive) {
    try { archive = (await getDocs(collection(db, "publicQA"))).docs.map((d) => ({ id: d.id, ...d.data(), w: words(`${d.data().question} ${(d.data().tags || []).join(" ")}`) })); }
    catch { archive = []; }
  }
  const scored = archive.map((x) => ({ x, s: qw.filter((w) => x.w.some((v) => v === w || (w.length >= 4 && (v.startsWith(w) || w.startsWith(v))))).length / Math.sqrt(qw.length) }))
    .filter((r) => r.s >= 0.75).sort((a, b) => b.s - a.s).slice(0, 3);
  if (!scored.length) { box.classList.add("hidden"); return; }
  box.innerHTML = `<b>אולי התשובה כבר נמצאת במאגר:</b><ul>${scored.map(({ x }) => `<li><a href="shut.html?id=${encodeURIComponent(x.id)}#q-${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${esc(x.question.length > 120 ? x.question.slice(0, 120) + "…" : x.question)}</a></li>`).join("")}</ul>
    <span class="small muted">לא מצאת? המשיכו ושלחו את השאלה.</span>`;
  box.classList.remove("hidden");
}
