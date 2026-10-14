// ===== פונקציות משותפות לכל הדפים =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, ORG_NAME, TOPICS } from "./config.js?v=20261015";

export { ORG_NAME, TOPICS };

export const configReady = !!firebaseConfig.projectId && !String(firebaseConfig.apiKey).startsWith("הדבק");

export const app = configReady ? initializeApp(firebaseConfig) : null;
export const db = configReady ? getFirestore(app) : null;
export const auth = configReady ? getAuth(app) : null;

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const normEmail = (e) => String(e || "").trim().toLowerCase();

export function normPhone(p) {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  if (d.length === 9 && !d.startsWith("0")) d = "0" + d;
  return d.length >= 9 ? d : "";
}

export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export function fmtDate(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString("he-IL") : "";
}

export function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export function setupMissingNotice(target) {
  target.innerHTML = `<div class="card narrow"><h2>המערכת עוד לא מחוברת</h2>
  <p>צריך להדביק את פרטי פרויקט ה-Firebase בקובץ <code>js/config.js</code>. ההוראות המלאות בקובץ README.md.</p></div>`;
}
