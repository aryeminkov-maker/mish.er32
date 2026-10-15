// ===== טופס שאלה ציבורי =====
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, loadTaxonomy } from "./common.js?v=20261020";

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
