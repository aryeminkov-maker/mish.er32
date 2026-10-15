// ===== הגדרות המערכת =====
// 1. פרטי פרויקט ה-Firebase
export const firebaseConfig = {
  apiKey: "AIzaSyC48Tpo8EZ9dpQ73WuAz9SfrUKlKUNk0yo",
  authDomain: "dintora-a5e10.firebaseapp.com",
  projectId: "dintora-a5e10",
  storageBucket: "dintora-a5e10.firebasestorage.app",
  messagingSenderId: "879998104108",
  appId: "1:879998104108:web:646c9109f2b49c35bd1789"
};

// 2. שם הארגון שיופיע בכותרות
export const ORG_NAME = "מכון משפטי ארץ";

// 3. קטגוריות ברירת מחדל לשאלות – משמשות רק עד שמגדירים קטגוריות במסך "הגדרות" במערכת
//    הקטגוריה הראשונה ברשימה היא ברירת המחדל בטופס
export const TOPICS = [
  "דיני ממונות",
  "עובד ומעביד",
  "הדירה והבית",
  "רכב",
  "אחר"
];

// 4. שליחת מיילים מחשבון ה-Gmail של המכון (ההוראות ב-README, פרק "שליחת מיילים")
//    השאירו ריק כדי לבטל את השליחה מהמערכת
export const MAIL_FROM = "";        // כתובת ה-Gmail של המכון, למשל "mishpetei.eretz@gmail.com"
export const MAIL_CLIENT_ID = "";   // מזהה ה-OAuth Client מ-Google Cloud (מסתיים ב-.apps.googleusercontent.com)
