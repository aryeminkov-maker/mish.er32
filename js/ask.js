// ===== טופס שאלה ציבורי =====
import { collection, doc, setDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261109";
import { tagsOf, titleOf, qPageUrl } from "./qa-public.js?v=20261109";

const $ = (id) => document.getElementById(id);

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("formCard").classList.add("hidden");
} else {
  loadTaxonomy().then((tx) => {
    $("topic").innerHTML = tx.categories.map((t) => `<option ${t === tx.defaultCategory ? "selected" : ""}>${esc(t)}</option>`).join("");
    if (REF?.topic && tx.categories.includes(REF.topic)) $("topic").value = REF.topic;
  });
  loadRef();
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

// "יש לי שאלה דומה" – שאלה בהמשך לשאלה קיימת במאגר (ask.html?ref=...)
let REF = null;
async function loadRef() {
  const ref = new URLSearchParams(location.search).get("ref");
  if (!ref) return;
  try {
    const d = await getDoc(doc(db, "publicQA", ref));
    if (!d.exists()) return;
    REF = { id: d.id, title: titleOf({ id: d.id, ...d.data() }), topic: d.data().topic || "" };
    $("refBox").innerHTML = `בהמשך לשאלה: <a href="${qPageUrl(REF.id)}" target="_blank" rel="noopener">${esc(REF.title)}</a>
      <button type="button" class="link small" id="refClear" aria-label="ביטול הקישור לשאלה הקודמת">✕</button>`;
    $("refBox").classList.remove("hidden");
    $("refClear").onclick = () => { REF = null; $("refBox").classList.add("hidden"); };
    $("text").placeholder = "מה שונה במקרה שלך? כתבו את הפרטים והשאלה";
  } catch { /* */ }
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
    ...(REF ? { refId: REF.id, refTitle: REF.title.slice(0, 200) } : {}),
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
    try { archive = (await getDocs(collection(db, "publicQA"))).docs.map((d) => ({ id: d.id, ...d.data(), w: words(`${d.data().title || ""} ${d.data().question} ${(d.data().tags || []).join(" ")}`) })); }
    catch { archive = []; }
  }
  const scored = archive.map((x) => ({ x, s: qw.filter((w) => x.w.some((v) => v === w || (w.length >= 4 && (v.startsWith(w) || w.startsWith(v))))).length / Math.sqrt(qw.length) }))
    .filter((r) => r.s >= 0.75).sort((a, b) => b.s - a.s).slice(0, 4);
  if (!scored.length) { box.classList.add("hidden"); return; }
  box.innerHTML = `<b>אולי התשובה כבר נמצאת במאגר:</b><ul class="sim-list">${scored.map(({ x }) => `<li><a href="q.html?id=${encodeURIComponent(x.id)}" target="_blank" rel="noopener"><b>${esc(titleOf(x))}</b></a>
      <div class="sim-meta">${x.topic ? `<span class="badge">${esc(x.topic)}</span>` : ""}${tagsOf(x).slice(0, 4).map((g) => `<span class="chip small">${esc(g)}</span>`).join("")}</div>
      ${x.title ? `<div class="small muted sim-ex">${esc((x.summary || x.question || "").slice(0, 140))}${(x.summary || x.question || "").length > 140 ? "…" : ""}</div>` : ""}</li>`).join("")}</ul>
    <span class="small muted">לא מצאת? המשיכו ושלחו את השאלה.</span>`;
  box.classList.remove("hidden");
}
