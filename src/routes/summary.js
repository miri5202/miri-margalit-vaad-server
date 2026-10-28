// סיכומים של בניין: /api/buildings/:buildingId/summary
// הבניין כבר נבדק ונטען ב-loadBuilding (req.building)
const express = require('express');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// GET - נתונים ללוח הראשי
// יתרת קופה, הכנסות והוצאות החודש, הוצאות לפי קטגוריה.
// לוועד - סך החובות בבניין. לדייר - החוב של הדירה שלו
router.get('/', async (req, res, next) => {
  try {
    const buildingId = req.building.id;

    const isResident = req.user.role === 'resident';

    // שלוש השאילתות לא תלויות זו בזו - מריצים אותן במקביל (Promise.all) ולא אחת אחרי השנייה
    const [totals, byCategory, debt] = await Promise.all([
      // FILTER = סכום רק של השורות שעונות לתנאי - כך מקבלים הכול בשאילתה אחת
      pool.query(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'income'),  0)::float8 AS "totalIncome",
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0)::float8 AS "totalExpense",
          COALESCE(SUM(amount) FILTER (WHERE type = 'income'
                   AND date >= date_trunc('month', CURRENT_DATE)), 0)::float8 AS "monthIncome",
          COALESCE(SUM(amount) FILTER (WHERE type = 'expense'
                   AND date >= date_trunc('month', CURRENT_DATE)), 0)::float8 AS "monthExpense"
        FROM transactions
        WHERE building_id = $1 AND status = 'paid'`, [buildingId]),

      pool.query(`
        SELECT category, SUM(amount)::float8 AS total
          FROM transactions
         WHERE building_id = $1 AND type = 'expense' AND status = 'paid'
         GROUP BY category
         ORDER BY total DESC`, [buildingId]),

      // חובות: תשלומים שממתינים או באיחור. לדייר - רק של הדירה שלו
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float8 AS debt
           FROM transactions
          WHERE building_id = $1 AND type = 'income' AND status IN ('pending', 'late')
            ${isResident ? 'AND apartment = $2 AND is_unit = $3' : ''}`,
        isResident ? [buildingId, req.user.apartment, req.user.isUnit] : [buildingId]
      ),
    ]);

    const t = totals.rows[0];
    res.json({
      building: { id: req.building.id, name: req.building.name },
      balance: t.totalIncome - t.totalExpense,
      totalIncome: t.totalIncome,
      totalExpense: t.totalExpense,
      thisMonth: { income: t.monthIncome, expense: t.monthExpense },
      expensesByCategory: byCategory.rows,
      [isResident ? 'myDebt' : 'totalDebt']: debt.rows[0].debt,
    });
  } catch (err) {
    next(err);
  }
});

// GET /payments-grid?year=2026 - טבלת "מי שילם" (ועד)
// שורה לכל דירה ולכל יחידת דיור: שמות הדיירים ו-12 חודשים, בכל חודש: paid / partial / pending / late / none
// יחידת דיור מופיעה מיד אחרי הדירה שלה (isUnit = true, למשל "3א")
router.get('/payments-grid', requireAdmin, async (req, res, next) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const buildingId = req.building.id;

    // כל הדירות (1 עד apartments_count) + כל יחידות הדיור, עם שמות הדיירים
    const apartments = await pool.query(`
      SELECT s.apt AS apartment, s.is_unit AS "isUnit",
             COALESCE(array_agg(u.full_name ORDER BY u.full_name) FILTER (WHERE u.id IS NOT NULL), '{}') AS residents
        FROM (
          SELECT apt, FALSE AS is_unit FROM generate_series(1, $2::int) AS apt
          UNION ALL
          SELECT apt, TRUE FROM unnest($3::int[]) AS apt
        ) s
        LEFT JOIN users u ON u.building_id = $1 AND u.apartment = s.apt AND u.is_unit = s.is_unit
       GROUP BY s.apt, s.is_unit
       ORDER BY s.apt, s.is_unit`, [buildingId, req.building.apartmentsCount, req.building.unitApartments]);

    // לכל דירה/יחידה וחודש - סטטוס אחד מכל התשלומים של אותו חודש:
    //   הכול שולם ← paid.  חלק שולם וחלק פתוח (תשלום חלקי) ← partial.
    //   שום דבר לא שולם ← late אם יש חיוב באיחור, אחרת pending
    const fees = await pool.query(`
      SELECT apartment, is_unit AS "isUnit",
             EXTRACT(MONTH FROM date)::int AS month,
             CASE WHEN BOOL_AND(status = 'paid') THEN 'paid'
                  WHEN BOOL_OR(status = 'paid') THEN 'partial'
                  WHEN BOOL_OR(status = 'late') THEN 'late'
                  ELSE 'pending' END AS status
        FROM transactions
       WHERE building_id = $1 AND type = 'income' AND category = 'monthly_fee'
         AND EXTRACT(YEAR FROM date) = $2
       GROUP BY apartment, is_unit, month`, [buildingId, year]);

    // מפתח לכל שורה: "3" לדירה, "3u" ליחידה
    const key = (apartment, isUnit) => `${apartment}${isUnit ? 'u' : ''}`;
    const grid = {};
    for (const a of apartments.rows) grid[key(a.apartment, a.isUnit)] = Array(12).fill('none');
    for (const f of fees.rows) {
      const months = grid[key(f.apartment, f.isUnit)];
      if (months) months[f.month - 1] = f.status;
    }

    res.json({
      year,
      rows: apartments.rows.map((a) => ({ ...a, months: grid[key(a.apartment, a.isUnit)] })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /debtors - רשימת חייבים (ועד): כל דירה / יחידת דיור שיש לה תשלומים ממתינים או באיחור
// מחזיר לכל דירה: סכום החוב, כמה חיובים פתוחים, כמה מהם באיחור, ופרטי הדיירים - שם, טלפון ואימייל (לשליחת תזכורת)
router.get('/debtors', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.apartment, d.is_unit AS "isUnit", d.debt, d."openCount", d."lateCount", d."oldestDate",
             COALESCE(
               (SELECT json_agg(json_build_object('fullName', u.full_name, 'phone', u.phone, 'email', u.email) ORDER BY u.full_name)
                  FROM users u WHERE u.building_id = $1 AND u.apartment = d.apartment AND u.is_unit = d.is_unit),
               '[]') AS residents
        FROM (
          SELECT apartment, is_unit,
                 SUM(amount)::float8 AS debt,
                 COUNT(*)::int AS "openCount",
                 COUNT(*) FILTER (WHERE status = 'late')::int AS "lateCount",
                 to_char(MIN(date), 'YYYY-MM-DD') AS "oldestDate"
            FROM transactions
           WHERE building_id = $1 AND type = 'income' AND status IN ('pending', 'late')
           GROUP BY apartment, is_unit
        ) d
       ORDER BY d.debt DESC, d.apartment, d.is_unit`, [req.building.id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
