// ===== הסרה מרשימת התפוצה (קישור שמופיע בכל מייל) =====
// הקישור כולל מזהה אישי (t) שנוצר על ידי סקריפט השליחה. ההסרה נשמרת ב-optouts,
// כרטיס איש הקשר מתעדכן ל"ביקש הסרה", והסקריפט לא שולח יותר מיילים לכתובת הזו.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, configReady, esc, setupMissingNotice, normEmail } from "./common.js?v=20261026";

const $ = (id) => document.getElementById(id);
const p = new URLSearchParams(location.search);
const token = (p.get("t") || "").replace(/[^A-Za-z0-9]/g, "");
const email = normEmail(p.get("e") || "");

if (!configReady) { setupMissingNotice($("setupView")); $("box").innerHTML = ""; }
else if (!token || !email) {
  $("box").innerHTML = `<h2>הקישור לא שלם</h2><p>כדי להסיר את עצמך מרשימת התפוצה, לחצו על הקישור שבתחתית המייל שקיבלתם.</p>`;
} else {
  // לא מסירים אוטומטית בטעינת הדף (תוכנות סינון דואר "לוחצות" על קישורים) – רק בלחיצה
  $("box").innerHTML = `<h2>להסיר את הכתובת מרשימת התפוצה?</h2>
    <p>הכתובת <b dir="ltr">${esc(email)}</b> לא תקבל יותר מיילים ממכון משפטי ארץ.</p>
    <div class="field"><label for="why">סיבה (רשות)</label><select id="why">
      <option value="">—</option><option>יותר מדי מיילים</option><option>התוכן לא רלוונטי לי</option><option>לא נרשמתי לרשימה</option><option>אחר</option></select></div>
    <button class="primary" id="go" style="width:100%;padding:11px">הסרה מרשימת התפוצה</button>`;
  $("go").onclick = async () => {
    $("go").disabled = true;
    try {
      await setDoc(doc(db, "optouts", token), { email, reason: $("why").value, at: serverTimestamp() });
      done();
    } catch (e) {
      // כבר הוסר בעבר (המסמך קיים) – גם זו הצלחה מבחינת המשתמש
      if (e.code === "permission-denied") {
        $("box").innerHTML = `<h2>לא הצלחנו לאמת את הקישור</h2><p>ייתכן שהכתובת כבר הוסרה, או שהקישור לא הועתק במלואו. אפשר גם להשיב למייל במילה "הסר" ונטפל בזה.</p>`;
      } else { $("go").disabled = false; alert("ההסרה נכשלה, נסו שוב"); }
    }
  };
}
function done() {
  $("box").innerHTML = `<h2>הוסרת מרשימת התפוצה ✓</h2>
    <p>הכתובת <b dir="ltr">${esc(email)}</b> לא תקבל יותר מיילים מהמכון.</p>
    <p class="small muted">אם תשאל/י שאלה או תירשם/י להשתלמות בעתיד ותסמנ/י שוב הסכמה לקבלת מיילים – נוכל לשלוח לך שוב.</p>`;
}
