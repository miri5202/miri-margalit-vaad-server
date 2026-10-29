// עדכונים קטנים למבנה של מסד נתונים קיים - בלי למחוק נתונים
// רץ אוטומטית בכל הפעלה של השרת (server.js), כך שגם המסד בענן מתעדכן לבד.
// כל פקודה כאן בטוחה להרצה חוזרת (IF NOT EXISTS / רק על שורות שעוד לא עודכנו).
// (במסד חדש לגמרי - npm run db:init יוצר הכול מ-schema.sql)

async function migrate(pool) {
  // דיירים בלי אימייל וטלפון: החובה לפרטי התחברות נשארת רק לוועד
  await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS has_login');
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_has_login') THEN
        ALTER TABLE users ADD CONSTRAINT admin_has_login
          CHECK (role <> 'admin' OR email IS NOT NULL OR phone IS NOT NULL);
      END IF;
    END $$`);

  // תשלום חלקי: קישור מחיוב היתרה לתשלום ששולם
  await pool.query(`
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS partial_of INTEGER REFERENCES transactions(id) ON DELETE SET NULL`);

  // יתרות שנוצרו לפני שהיה הקישור (מזוהות לפי "(יתרה)" בתיאור) - מקשרים לתשלום ששולם
  // באותו בניין, אותה דירה / יחידה, אותו תאריך ואותה קטגוריה
  await pool.query(`
    UPDATE transactions t
       SET partial_of = (
             SELECT p.id FROM transactions p
              WHERE p.building_id = t.building_id AND p.apartment = t.apartment AND p.is_unit = t.is_unit
                AND p.date = t.date AND p.category = t.category AND p.status = 'paid' AND p.id <> t.id
              ORDER BY p.id DESC LIMIT 1)
     WHERE t.partial_of IS NULL AND t.type = 'income' AND t.description LIKE '%(יתרה)'`);
}

module.exports = { migrate };
