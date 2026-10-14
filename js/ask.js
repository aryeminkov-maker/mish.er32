// ===== טופס שאלה ציבורי =====
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, toast, setupMissingNotice, TOPICS } from "./common.js?v=20261015";

const $ = (id) => document.getElementById(id);

if (!configReady) {
  setupMissingNotice($("setupView"));
  $("formCard").classList.add("hidden");
} else {
  $("topic").innerHTML = TOPICS.map((t) => `<option>${esc(t)}</option>`).join("");
  $("askForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("send");
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
    } catch (err) {
      toast("השליחה נכשלה, נסו שוב", "bad");
      btn.disabled = false;
    }
  });
}
