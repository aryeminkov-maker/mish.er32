// ===== הגדרות המערכת =====
// 1. הדביקו כאן את פרטי הפרויקט מ-Firebase (Project settings → Your apps → Web app → Config)
export const firebaseConfig = {// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC48Tpo8EZ9dpQ73WuAz9SfrUKlKUNk0yo",
  authDomain: "dintora-a5e10.firebaseapp.com",
  projectId: "dintora-a5e10",
  storageBucket: "dintora-a5e10.firebasestorage.app",
  messagingSenderId: "879998104108",
  appId: "1:879998104108:web:646c9109f2b49c35bd1789"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
};

// 2. שם הארגון שיופיע בכותרות
export const ORG_NAME = "מכון משפטי ארץ";

// 3. נושאי שאלות בטופס השו"ת ובמאגר (אפשר לערוך, להוסיף ולמחוק)
export const TOPICS = [
  "שמיטה",
  "תרומות ומעשרות",
  "ערלה ונטע רבעי",
  "כלאיים",
  "חקלאות ומקדש",
  "אחר"
];
