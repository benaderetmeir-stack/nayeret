/*
 * הגדרות חיבור ל-Firebase
 * -------------------------------------------------------------
 * כל עוד firebase נשאר null, האתר עובד ב"מצב תצוגה" עם נתונים לדוגמה
 * שלא נשמרים. אחרי יצירת פרויקט Firebase, מדביקים כאן את ה-config
 * שלו (ראו מדריך-התקנה.md).
 */
window.NAYERET_CONFIG = {
  // הדביקי כאן את firebaseConfig מתוך Firebase Console → Project settings → Your apps
  firebase: {
    apiKey: "AIzaSyCJzLtsOCm3t-8tKxdTNLt8c8eB8mxB-XM",
    authDomain: "nayeret-f030f.firebaseapp.com",
    projectId: "nayeret-f030f",
    storageBucket: "nayeret-f030f.firebasestorage.app",
    messagingSenderId: "665210926166",
    appId: "1:665210926166:web:1e3ffc4a1259296d07f7f7"
  },
  /* דוגמה:
  firebase: {
    apiKey: "AIza...",
    authDomain: "nayeret-inbar.firebaseapp.com",
    projectId: "nayeret-inbar",
    storageBucket: "nayeret-inbar.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:abc123"
  },
  */

  // המשתמש המשותף שנוצר ב-Firebase Authentication. בכניסה מקלידים רק את הסיסמה.
  sharedEmail: "office@inbar.app",

  // מזהה העסק. כרגע עסק אחד; מוכן להוספת עסקים בעתיד.
  businessId: "nayeret",

  // (לא חובה) מפתח reCAPTCHA Enterprise להפעלת App Check, כמו במשמרות
  appCheckSiteKey: ""
};
