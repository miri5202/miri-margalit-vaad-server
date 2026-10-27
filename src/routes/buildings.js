const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { loadBuilding, BUILDING_COLUMNS } = require('../middleware/building');
const { markLateFees } = require('../services/fees');
const { generateJoinCode } = require('../services/joinCode');
const { validateBuilding, sendIfInvalid } = require('../validation/validators');

const router = express.Router();
router.use(requireAuth);

// עמודות הבניין + נתונים מהירים לכרטיס בניין ברשימה
const LIST_COLUMNS = `${BUILDING_COLUMNS},
  (SELECT COUNT(*) FROM users u WHERE u.building_id = b.id)::int AS "residentsCount",
  (SELECT COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END), 0)
     FROM transactions t WHERE t.building_id = b.id AND t.status = 'paid')::float8 AS balance,
  (SELECT COALESCE(SUM(t.amount), 0)
     FROM transactions t WHERE t.building_id = b.id AND t.type = 'income'
      AND t.status IN ('pending', 'late'))::float8 AS "totalDebt"`;

// GET /api/buildings - ועד: כל הבניינים שהוא מנהל. דייר: הבניין שלו
router.get('/', async (req, res, next) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      await markLateFees({ managerId: req.user.id }); // כדי ש-totalDebt יהיה מעודכן
      ({ rows } = await pool.query(
        `SELECT ${LIST_COLUMNS} FROM buildings b WHERE b.manager_id = $1 ORDER BY b.name`,
        [req.user.id]
      ));
    } else {
      await markLateFees({ buildingId: req.user.buildingId });
      ({ rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM buildings b WHERE b.id = $1`, [req.user.buildingId]));
      rows.forEach((b) => delete b.joinCode); // קוד ההצטרפות - רק לוועד
    }
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/buildings - הוספת בניין חדש (ועד). הוועד שיצר אותו הוא המנהל שלו
// גוף: { name, address, city, apartmentsCount, monthlyFee?, dueDay?, unitFee?, unitApartments? }
//   unitApartments: לאילו דירות יש יחידת דיור, למשל [3, 5] ← יחידות "3א" ו-"5א" 
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { data, errors } = validateBuilding(req.body);
    if (sendIfInvalid(res, errors)) return;

    const joinCode = await generateJoinCode();
    const { rows } = await pool.query(
      `INSERT INTO buildings
         (name, address, city, apartments_count, monthly_fee, due_day, unit_fee, unit_apartments, join_code, manager_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int[], $9, $10)
       RETURNING id`,
      [data.name, data.address, data.city, data.apartmentsCount, data.monthlyFee, data.dueDay,
       data.unitFee, data.unitApartments, joinCode, req.user.id]
    );
    const created = await pool.query(`SELECT ${LIST_COLUMNS} FROM buildings b WHERE b.id = $1`, [rows[0].id]);
    res.status(201).json(created.rows[0]);
  } catch (err) {
    next(err);
  }
});

// מכאן והלאה כל נתיב מתחיל ב-/:buildingId - קודם בודקים הרשאה לבניין
router.use('/:buildingId', loadBuilding);

// GET /api/buildings/:buildingId
router.get('/:buildingId', (req, res) => {
  res.json(req.building);
});

// PUT /api/buildings/:buildingId - עריכת פרטי בניין (ועד). אפשר לשלוח רק את מה שהשתנה
router.put('/:buildingId', requireAdmin, async (req, res, next) => {
  try {
    const { data, errors } = validateBuilding({ ...req.building, ...req.body });
    if (sendIfInvalid(res, errors)) return;

    // אי אפשר להקטין את מספר הדירות מתחת לדירה שיש בה דייר או תשלום
    const used = await pool.query(
      `SELECT COALESCE(MAX(apartment), 0) AS max FROM (
         SELECT apartment FROM users WHERE building_id = $1
         UNION ALL
         SELECT apartment FROM transactions WHERE building_id = $1
       ) a`,
      [req.building.id]
    );
    if (used.rows[0].max > data.apartmentsCount) {
      return sendIfInvalid(res, {
        apartmentsCount: `יש נתונים לדירה ${used.rows[0].max} - אי אפשר להקטין מתחת למספר הזה`,
      });
    }

    // אי אפשר להוריד יחידת דיור שיש בה דייר או תשלום
    const unitsInUse = await pool.query(
      `SELECT DISTINCT apartment FROM (
         SELECT apartment FROM users WHERE building_id = $1 AND is_unit
         UNION ALL
         SELECT apartment FROM transactions WHERE building_id = $1 AND is_unit
       ) a ORDER BY apartment`,
      [req.building.id]
    );
    const removed = unitsInUse.rows.map((r) => r.apartment).filter((apt) => !data.unitApartments.includes(apt));
    if (removed.length) {
      return sendIfInvalid(res, {
        unitApartments: `יש נתונים ליחידה של דירה ${removed.join(', ')} - אי אפשר להוריד אותה`,
      });
    }

    await pool.query(
      `UPDATE buildings
          SET name = $1, address = $2, city = $3, apartments_count = $4, monthly_fee = $5, due_day = $6,
              unit_fee = $7, unit_apartments = $8::int[]
        WHERE id = $9`,
      [data.name, data.address, data.city, data.apartmentsCount, data.monthlyFee, data.dueDay,
       data.unitFee, data.unitApartments, req.building.id]
    );
    const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} FROM buildings b WHERE b.id = $1`, [req.building.id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/buildings/:buildingId/join-code - יצירת קוד הצטרפות חדש (ועד)
// למשל אם הקוד הישן הגיע למי שלא צריך. הקוד הישן מפסיק לעבוד מיד
router.post('/:buildingId/join-code', requireAdmin, async (req, res, next) => {
  try {
    const joinCode = await generateJoinCode();
    await pool.query('UPDATE buildings SET join_code = $1 WHERE id = $2', [joinCode, req.building.id]);
    res.json({ joinCode });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/buildings/:buildingId - מחיקת בניין (ועד). מוחק גם את הדיירים והתנועות שלו!
router.delete('/:buildingId', requireAdmin, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM buildings WHERE id = $1', [req.building.id]);
    res.json({ message: 'הבניין נמחק' });
  } catch (err) {
    next(err);
  }
});

// נתיבים פנימיים של בניין
router.use('/:buildingId/users', require('./users'));
router.use('/:buildingId/transactions', require('./transactions'));
router.use('/:buildingId/summary', require('./summary'));
router.use('/:buildingId/charges', require('./charges'));
router.use('/:buildingId/announcements', require('./announcements'));

module.exports = router;
