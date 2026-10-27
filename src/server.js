require('dotenv').config();
const express = require('express');
const cors = require('cors');
const pool = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// CORS - מאילו כתובות מותר לפנות לשרת:
//   כתובות שמופיעות ב-CLIENT_URL (אפשר כמה, מופרדות בפסיק - למשל הכתובת של האתר בענן)
//   וגם כל פורט של localhost - כך שצד הלקוח יעבוד גם אם Vite עלה על 5174 במקום 5173
const allowedOrigins = (process.env.CLIENT_URL || '')
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    const allowed = !origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || isLocalhost;
    callback(null, allowed);
  },
}));
app.use(express.json());

// בדיקת חיים - לבדוק שהשרת והמסד עובדים (גם אחרי העלאה לענן)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch {
    res.status(500).json({ ok: false, db: 'disconnected' });
  }
});

// ערכים אפשריים לשדות הבחירה (לטפסים ולסינון בצד הלקוח) - לא דורש התחברות
const { TYPES, CATEGORIES, PAYMENT_METHODS, STATUSES } = require('./config/constants');
app.get('/api/options', (req, res) => {
  res.json({ types: TYPES, categories: CATEGORIES, paymentMethods: PAYMENT_METHODS, statuses: STATUSES });
});

app.use('/api/auth', require('./routes/auth'));
// כל השאר נמצא בתוך בניין: /api/buildings/:buildingId/(users|transactions|summary|charges)
app.use('/api/buildings', require('./routes/buildings'));

// נתיב שלא קיים
app.use((req, res) => res.status(404).json({ message: 'הנתיב לא נמצא' }));

app.use(errorHandler);

async function start() {
  if (!process.env.JWT_SECRET) throw new Error('חסר JWT_SECRET בקובץ .env');
  await pool.query('SELECT 1'); // בודק שהמסד זמין לפני שמתחילים
  console.log('✅ מחובר למסד הנתונים');

  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`🚀 השרת רץ על פורט ${port}`));
}

// מאפשר לייבא את app בבדיקות בלי להפעיל את השרת
if (require.main === module) {
  start().catch((err) => {
    console.error('❌ השרת לא עלה:', err.message);
    process.exit(1);
  });
}

module.exports = app;
