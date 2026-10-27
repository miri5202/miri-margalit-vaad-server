require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ חסר DATABASE_URL בקובץ .env (האם יצרת קובץ .env מתוך .env.example?)');
  process.exit(1);
}

// בענן (Neon / Render) חובה חיבור מוצפן, במחשב המקומי לא
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

// Pool = מאגר חיבורים למסד הנתונים, שכל הקוד משתמש בו
// idleTimeoutMillis: חיבור פתוח נשמר 5 דקות. פתיחת חיבור חדש למסד בענן (עם הצפנה) לוקחת זמן,
// ולכן עדיף להשתמש שוב בחיבורים קיימים במקום לסגור אותם אחרי 10 שניות (ברירת המחדל)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 5 * 60 * 1000,
  keepAlive: true,
});

module.exports = pool;
