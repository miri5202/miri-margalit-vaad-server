// ניהול הדיירים של בניין: /api/buildings/:buildingId/users
// הבניין כבר נבדק ונטען ב-loadBuilding (req.building)
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { validateUser, sendIfInvalid } = require('../validation/validators');

const router = express.Router({ mergeParams: true });

// כל הנתיבים כאן - לוועד בלבד
router.use(requireAdmin);

const USER_COLUMNS = `id, full_name AS "fullName", email, role, building_id AS "buildingId", apartment, is_unit AS "isUnit", phone`;

// דייר בלי פרטי התחברות מקבל סיסמה אקראית שאף אחד לא יודע (העמודה במסד היא חובה)
const randomPasswordHash = () => bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

// GET - רשימת הדיירים בבניין, ממוינת לפי מספר דירה
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE building_id = $1 ORDER BY apartment, is_unit, full_name`,
      [req.building.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST - הוספת דייר לבניין
// גוף: { fullName, email?, phone?, password?, apartment, isUnit? }
//   אימייל וטלפון לא חובה. אם יש אחד מהם - חובה סיסמה (כדי שהדייר יוכל להתחבר).
//   בלי שניהם - הדייר רשום רק לפי שם ודירה, ולא מתחבר למערכת
router.post('/', async (req, res, next) => {
  try {
    const { data, errors } = validateUser(req.body, { isNew: true, building: req.building, requireLogin: false });
    if (sendIfInvalid(res, errors)) return;

    const hash = data.password ? await bcrypt.hash(data.password, 10) : await randomPasswordHash();
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password, role, building_id, apartment, is_unit, phone)
       VALUES ($1, $2, $3, 'resident', $4, $5, $6, $7)
       RETURNING ${USER_COLUMNS}`,
      [data.fullName, data.email, hash, req.building.id, data.apartment, data.isUnit, data.phone]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /:id - עדכון פרטי דייר (סיסמה רק אם נשלחה)
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND building_id = $2`,
      [req.params.id, req.building.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ message: 'הדייר לא נמצא' });

    // ממזגים: מה שלא נשלח נשאר כמו שהיה
    const old = existing.rows[0];
    const { data, errors } = validateUser({ ...old, ...req.body }, { isNew: false, building: req.building, requireLogin: false });
    // לדייר שלא היו לו פרטי התחברות מוסיפים עכשיו אימייל / טלפון - צריך גם סיסמה, אחרת לא יוכל להתחבר
    if (!old.email && !old.phone && (data.email || data.phone) && !data.password) {
      errors.password = 'יש להזין סיסמה, כדי שהדייר יוכל להתחבר';
    }
    if (sendIfInvalid(res, errors)) return;

    const hash = data.password ? await bcrypt.hash(data.password, 10) : null;
    const { rows } = await pool.query(
      `UPDATE users
          SET full_name = $1, email = $2, apartment = $3, is_unit = $4, phone = $5,
              password = COALESCE($6, password)
        WHERE id = $7
        RETURNING ${USER_COLUMNS}`,
      [data.fullName, data.email, data.apartment, data.isUnit, data.phone, hash, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM users WHERE id = $1 AND building_id = $2',
      [req.params.id, req.building.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'הדייר לא נמצא' });
    res.json({ message: 'הדייר נמחק' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
