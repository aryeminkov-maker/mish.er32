// ===== חנות הספרים (ציבורי) =====
// הקטלוג נקרא מ-settings/books. ההזמנה נשמרת ב-orders, והתשלום נעשה ב-Jgive.
// כש-Jgive מעדכן את המערכת על תשלום באותו מייל ובאותו סכום – ההזמנה מסומנת "שולמה" אוטומטית.
import { collection, doc, getDoc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, normEmail } from "./common.js?v=20261026";

const $ = (id) => document.getElementById(id);
let BOOKS = [], CFG = {};
const cart = new Map(); // id -> qty
const nis = (n) => "₪" + Number(n || 0).toLocaleString("he-IL");

if (!configReady) { setupMissingNotice($("setupView")); $("shop").innerHTML = ""; }
else load();

async function load() {
  try {
    const d = await getDoc(doc(db, "settings", "books"));
    CFG = d.exists() ? d.data() : {};
    BOOKS = (CFG.items || []).filter((b) => b.name && b.forSale !== false && Number(b.price) > 0);
  } catch { BOOKS = []; }
  render();
}

function render() {
  if (!BOOKS.length) { $("shop").innerHTML = `<div class="card narrow"><p>החנות עדיין לא פתוחה. אפשר ליצור קשר עם המכון.</p></div>`; return; }
  $("shop").innerHTML = `
    <div class="shop-grid">${BOOKS.map((b) => `<div class="card book-card">
      ${b.image ? `<img src="${esc(b.image)}" alt="${esc(b.name)}" loading="lazy" class="book-img">` : '<div class="book-img book-ph" aria-hidden="true">📖</div>'}
      <h2>${esc(b.name)}</h2>${b.desc ? `<p class="small muted">${esc(b.desc)}</p>` : ""}
      <div class="row space"><b class="price">${nis(b.price)}</b>
        <div class="qty-box"><button type="button" data-dec="${esc(b.id)}" aria-label="פחות">−</button><span data-q="${esc(b.id)}" aria-live="polite">${cart.get(b.id) || 0}</span><button type="button" data-inc="${esc(b.id)}" aria-label="עוד עותק של ${esc(b.name)}">+</button></div></div>
    </div>`).join("")}</div>
    <div class="card medium" id="checkout"></div>`;
  document.querySelectorAll("[data-inc]").forEach((x) => (x.onclick = () => setQty(x.dataset.inc, (cart.get(x.dataset.inc) || 0) + 1)));
  document.querySelectorAll("[data-dec]").forEach((x) => (x.onclick = () => setQty(x.dataset.dec, Math.max(0, (cart.get(x.dataset.dec) || 0) - 1))));
  drawCheckout();
}
function setQty(id, q) {
  if (q) cart.set(id, Math.min(q, 50)); else cart.delete(id);
  const el = document.querySelector(`[data-q="${CSS.escape(id)}"]`); if (el) el.textContent = cart.get(id) || 0;
  drawCheckout();
}
const items = () => [...cart].map(([id, qty]) => { const b = BOOKS.find((x) => x.id === id); return { id, name: b.name, price: Number(b.price), qty }; });
const total = () => items().reduce((a, x) => a + x.price * x.qty, 0);

function drawCheckout() {
  const box = $("checkout"), list = items();
  const keep = {}; box.querySelectorAll("input, textarea, select").forEach((el) => (keep[el.id] = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value));
  if (!list.length) { box.innerHTML = `<h2>ההזמנה שלך</h2><p class="muted">בוחרים ספרים בכפתור +</p>`; return; }
  box.innerHTML = `<h2>ההזמנה שלך</h2>
    <ul class="cart">${list.map((x) => `<li><span>${esc(x.name)} × ${x.qty}</span><b>${nis(x.price * x.qty)}</b></li>`).join("")}<li class="sum"><span>סה"כ</span><b>${nis(total())}</b></li></ul>
    <form id="oForm" novalidate>
      <div class="grid2">
        <div class="field"><label for="oFirst">שם פרטי *</label><input id="oFirst" required maxlength="60" autocomplete="given-name"></div>
        <div class="field"><label for="oLast">שם משפחה *</label><input id="oLast" required maxlength="60" autocomplete="family-name"></div>
        <div class="field"><label for="oEmail">מייל *</label><input id="oEmail" type="email" required maxlength="120" dir="ltr" autocomplete="email"></div>
        <div class="field"><label for="oPhone">טלפון *</label><input id="oPhone" type="tel" required maxlength="20" autocomplete="tel"></div>
      </div>
      <fieldset class="when-box"><legend class="small">משלוח</legend>
        <label class="check"><input type="radio" name="oDel" id="oShip" value="ship" checked> <span>משלוח לכתובת</span></label>
        <label class="check"><input type="radio" name="oDel" id="oPick" value="pickup"> <span>איסוף עצמי מהמכון</span></label></fieldset>
      <div class="field" id="oAddrBox"><label for="oAddr">כתובת למשלוח *</label><input id="oAddr" maxlength="300" autocomplete="street-address" placeholder="רחוב, מספר, יישוב"></div>
      <div class="field"><label for="oNote">הערות (רשות)</label><textarea id="oNote" maxlength="1000" style="min-height:60px"></textarea></div>
      <label class="check" for="oConsent"><input type="checkbox" id="oConsent"> <span>אני מאשר/ת לקבל עדכונים מהמכון במייל (אפשר להסיר בכל עת)</span></label>
      <p class="small muted">פרטיך ישמשו לטיפול בהזמנה. פרטים נוספים ב<a href="privacy.html">מדיניות הפרטיות</a>.</p>
      <div class="hp" aria-hidden="true"><label for="oWebsite">אתר</label><input id="oWebsite" tabindex="-1" autocomplete="off"></div>
      <button class="primary" type="submit" id="oSend" style="width:100%;padding:11px">המשך לתשלום – ${nis(total())}</button>
    </form>`;
  Object.entries(keep).forEach(([id, v]) => { const el = $(id); if (!el) return; if (el.type === "checkbox" || el.type === "radio") el.checked = v; else el.value = v; });
  const delBox = () => $("oAddrBox").classList.toggle("hidden", $("oPick").checked);
  $("oShip").onchange = delBox; $("oPick").onchange = delBox; delBox();
  $("oForm").onsubmit = submit;
}

async function submit(e) {
  e.preventDefault();
  if ($("oWebsite").value) return;
  const email = normEmail($("oEmail").value), first = $("oFirst").value.trim(), last = $("oLast").value.trim(), phone = $("oPhone").value.trim();
  const pickup = $("oPick").checked, address = $("oAddr").value.trim();
  if (!first || !last) return toast("נא למלא שם פרטי ושם משפחה", "bad");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("oEmail").focus(); return toast("כתובת המייל לא תקינה", "bad"); }
  if (phone.replace(/\D/g, "").length < 9) { $("oPhone").focus(); return toast("מספר הטלפון לא תקין", "bad"); }
  if (!pickup && address.length < 5) { $("oAddr").focus(); return toast("נא למלא כתובת למשלוח", "bad"); }
  const list = items(), sum = total();
  $("oSend").disabled = true;
  try {
    await addDoc(collection(db, "orders"), {
      items: list.map((x) => ({ name: x.name, price: x.price, qty: x.qty })), total: sum,
      firstName: first, lastName: last, email, phone, address: pickup ? "" : address, delivery: pickup ? "pickup" : "ship",
      note: $("oNote").value.trim(), consentEmail: $("oConsent").checked, status: "new", createdAt: serverTimestamp()
    });
  } catch { toast("השליחה נכשלה, נסו שוב", "bad"); $("oSend").disabled = false; return; }
  // קישור התשלום: ספר אחד עם קישור ייעודי – אליו; אחרת הקישור הכללי
  const single = list.length === 1 ? BOOKS.find((b) => b.id === list[0].id)?.jgiveUrl : "";
  const pay = single || CFG.jgiveUrl || "";
  $("shop").innerHTML = `<div class="card narrow">
    <h2>ההזמנה נקלטה ✓</h2>
    <p>תודה ${esc(first)}! סכום לתשלום: <b>${nis(sum)}</b>.</p>
    ${pay ? `<p>נשאר רק לשלם בדף התשלום המאובטח של Jgive. <b>חשוב:</b> בדף התשלום יש להזין את הסכום <b>${nis(sum)}</b> ואת אותה כתובת מייל (<span dir="ltr">${esc(email)}</span>) – כך ההזמנה תסומן כשולמה אוטומטית.</p>
      <a class="btn primary-link" href="${esc(pay)}" target="_blank" rel="noopener" style="display:block;text-align:center;padding:12px">לתשלום ב-Jgive</a>`
      : `<p>ניצור איתך קשר בהקדם לתיאום התשלום ${pickup ? "והאיסוף" : "והמשלוח"}.</p>`}
  </div>`;
}
