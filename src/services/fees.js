// לוגיקה של דמי ועד: יצירת חיובים חודשיים וסימון חובות באיחור
const pool = require('../config/db');

// מסמן "באיחור" חיובי דמי ועד שעדיין ממתינים אחרי יום התשלום של הבניין.
// לדוגמה: due_day = 10 ← חיוב של אוקטובר שלא שולם עד 10/10 הופך ל-late ב-11/10.
// נקרא בכל כניסה לבניין, כך שהסטטוס תמיד מעודכן בלי צורך בתזמון (cron).
// filter: { buildingId } לבניין אחד, או { managerId } לכל הבניינים של ועד
// כדי לא להאט כל בקשה, הבדיקה רצה לכל היותר פעם בדקה לכל בניין / ועד (אלא אם force)
const lastRun = new Map();
const LATE_CHECK_INTERVAL = 60 * 1000;

async function markLateFees(filter, db = pool, { force = false } = {}) {
  const [column, value] = filter.buildingId ? ['b.id', filter.buildingId] : ['b.manager_id', filter.managerId];

  const key = `${column}:${value}`;
  const now = Date.now();
  if (!force && now - (lastRun.get(key) || 0) < LATE_CHECK_INTERVAL) return;
  lastRun.set(key, now);

  await db.query(
    `UPDATE transactions t
        SET status = 'late', updated_at = NOW()
       FROM buildings b
      WHERE b.id = t.building_id
        AND ${column} = $1
        AND t.type = 'income' AND t.category = 'monthly_fee' AND t.status = 'pending'
        AND CURRENT_DATE > date_trunc('month', t.date)::date + (b.due_day - 1)`,
    [value]
  );
}

// יוצר חיוב "ממתין" של דמי ועד לכל דירה בבניין, לחודש מסוים (month = 'YYYY-MM').
// לדירות - amount (בדרך כלל דמי הוועד של הבניין). ליחידות הדיור - unit_fee של הבניין (אם הוגדר)
// דירה/יחידה שכבר יש לה דמי ועד באותו חודש (בכל סטטוס) - מדלגים עליה, כך שאפשר ללחוץ שוב בלי כפילויות.
async function createMonthlyCharges({ building, month, amount, userId }) {
  const client = await pool.connect(); // חיבור אחד לכל הפעולות, כדי שירוצו כטרנזקציה אחת
  try {
    await client.query('BEGIN');
    // נועל את שורת הבניין: שתי לחיצות מקבילות לא ייצרו חיובים כפולים
    await client.query('SELECT id FROM buildings WHERE id = $1 FOR UPDATE', [building.id]);

    const [year, mm] = month.split('-');
    const units = building.unitFee > 0 ? building.unitApartments || [] : [];

    // s = כל מה שצריך לחייב: הדירות (1 עד apartments_count) + יחידות הדיור
    const { rowCount } = await client.query(
      `INSERT INTO transactions
         (building_id, type, amount, date, category, apartment, is_unit, payment_method, status, description, created_by)
       SELECT $1::int, 'income', s.amount, $3::date, 'monthly_fee', s.apt, s.is_unit, 'transfer', 'pending',
              $4::text || CASE WHEN s.is_unit THEN ' - יחידת דיור' ELSE '' END, $5::int
         FROM (
           SELECT apt, FALSE AS is_unit, $2::numeric AS amount FROM generate_series(1, $6::int) AS apt
           UNION ALL
           SELECT apt, TRUE, $7::numeric FROM unnest($8::int[]) AS apt
         ) s
        WHERE NOT EXISTS (
          SELECT 1 FROM transactions t
           WHERE t.building_id = $1::int AND t.type = 'income' AND t.category = 'monthly_fee'
             AND t.apartment = s.apt AND t.is_unit = s.is_unit
             AND t.date >= $3::date AND t.date < ($3::date + INTERVAL '1 month'))`,
      [building.id, amount, `${month}-01`, `דמי ועד ${mm}/${year}`, userId,
       building.apartmentsCount, building.unitFee, units]
    );

    // אם החודש כבר עבר את יום התשלום - החיובים החדשים יסומנו מיד "באיחור"
    await markLateFees({ buildingId: building.id }, client, { force: true });
    await client.query('COMMIT');

    const total = building.apartmentsCount + units.length;
    return { month, amount, unitAmount: building.unitFee, created: rowCount, skipped: total - rowCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { markLateFees, createMonthlyCharges };
