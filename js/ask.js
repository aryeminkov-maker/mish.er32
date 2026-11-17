// ===== טופס שאלה ציבורי =====
import { collection, doc, setDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261104";

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

// שליחה מהירה: בקשת HTTPS אחת ישירות ל-Firestore (בלי פתיחת ערוץ של הספרייה, שלוקחת כמה שניות).
// אם היא נכשלת – ניסיון נוסף דרך הספרייה הרגילה, עם אותו מזהה (כך שלא תיווצר שאלה כפולה).
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62]).join("");
async function fastCreate(id, data) {
  const { projectId, apiKey } = db.app.options;
  const name = `projects/${projectId}/databases/(default)/documents/questions/${id}`;
  const val = (v) => (v === null ? { nullValue: null } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: String(v) });
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctl.signal,
      body: JSON.stringify({ writes: [{
        update: { name, fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, val(v)])) },
        updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
        currentDocument: { exists: false }
      }] })
    });
    if (!res.ok) throw new Error("http " + res.status);
  } finally { clearTimeout(t); }
}

async function send() {
  const btn = $("send");
  if (btn.disabled) return;
  btn.disabled = true;
  const data = {
    firstName: $("firstName").value.trim(),
    lastName: $("lastName").value.trim(),
    email: $("email").value.trim(),
    phone: $("phone").value.trim(),
    topic: $("topic").value,
    text: $("text").value.trim(),
    consentEmail: $("consent").checked,
    status: "new",
    contactId: null,
    origin: "טופס באתר"
  };
  $("formCard").classList.add("hidden");
  $("sending").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
  const id = newId();
  try {
    try { await fastCreate(id, data); }
    catch { await setDoc(doc(db, "questions", id), { ...data, createdAt: serverTimestamp() }); }
    $("sending").classList.add("hidden");
    $("thanks").classList.remove("hidden");
    $("thanksText").textContent = data.consentEmail
      ? "התשובה תישלח אליך למייל, ותודה שאישרת קבלת עדכונים – שאלתך תקבל עדיפות במענה."
      : "התשובה תישלח אליך למייל כשתהיה מוכנה.";
    $("thanks").querySelector("h2").focus?.();
  } catch (err) {
    $("sending").classList.add("hidden");
    $("formCard").classList.remove("hidden");
    toast("השליחה נכשלה, בדקו את החיבור ונסו שוב", "bad");
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
