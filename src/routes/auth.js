const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validateUser, sendIfInvalid, normalizePhone } = require('../validation/validators');
const { normalizeJoinCode } = require('../services/joinCode');

const router = express.Router();

function createToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

// מה שמוחזר ללקוח על המשתמש (בלי סיסמה)
// buildingId: לדייר - הבניין שלו. לוועד - null (הבניינים שלו ב-GET /api/buildings)
function publicUser(u) {
  return {
    id: u.id, fullName: u.fullName, email: u.email, role: u.role,
    buildingId: u.buildingId, apartment: u.apartment, isUnit: u.isUnit, phone: u.phone,
  };
}

const USER_COLUMNS = `id, full_name AS "fullName", email, role, building_id AS "buildingId", apartment, is_unit AS "isUnit", phone`;

// POST /api/auth/register - הרשמה של ועד בית חדש
// גוף: { fullName, email?, phone?, password }  (חובה אימייל או טלפון)  ←  מחזיר: { token, user }
// דיירים נרשמים דרך /join עם קוד הבניין, או שהוועד מוסיף אותם
router.post('/register', async (req, res, next) => {
  try {
    const { data, errors } = validateUser(req.body, { isNew: true });
    if (sendIfInvalid(res, errors)) return;

    const hash = await bcrypt.hash(data.password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password, role, phone)
       VALUES ($1, $2, $3, 'admin', $4)
       RETURNING ${USER_COLUMNS}`,
      [data.fullName, data.email, hash, data.phone]
    );
    res.status(201).json({ token: createToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/join - הצטרפות של דייר לבניין עם קוד ההצטרפות
// גוף: { joinCode, apartment, isUnit?, fullName, phone, password, email? }  ←  מחזיר: { token, user }
//   isUnit: true = מצטרף ליחידת הדיור של הדירה (למשל "3א")
// את הקוד הוועד מעביר לשכנים (למשל בקבוצת הוואטסאפ של הבניין)
router.post('/join', async (req, res, next) => {
  try {
    const code = normalizeJoinCode(req.body.joinCode);
    const { rows: buildings } = await pool.query(
      'SELECT id, apartments_count AS "apartmentsCount", unit_apartments AS "unitApartments" FROM buildings WHERE join_code = $1',
      [code]
    );
    const building = buildings[0];
    if (!building) return sendIfInvalid(res, { joinCode: 'קוד הבניין שגוי' });

    const { data, errors } = validateUser(req.body, { isNew: true, building, requirePhone: true });
    if (sendIfInvalid(res, errors)) return;

    const hash = await bcrypt.hash(data.password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password, role, building_id, apartment, is_unit, phone)
       VALUES ($1, $2, $3, 'resident', $4, $5, $6, $7)
       RETURNING ${USER_COLUMNS}`,
      [data.fullName, data.email, hash, building.id, data.apartment, data.isUnit, data.phone]
    );
    res.status(201).json({ token: createToken(rows[0]), user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
// גוף: { login, password }  - login = אימייל או טלפון (השדה email עדיין נתמך, בשביל לקוחות ישנים)
// ←  מחזיר: { token, user }
router.post('/login', async (req, res, next) => {
  try {
    const login = String(req.body.login ?? req.body.email ?? '').trim();
    const { password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ message: 'יש להזין אימייל או טלפון, וסיסמה' });
    }

    // יש @ ← אימייל. אחרת ← טלפון (בכל צורת כתיבה: 050-1234567 / 0501234567)
    const isEmail = login.includes('@');
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS}, password FROM users WHERE ${isEmail ? 'email' : 'phone'} = $1`,
      [isEmail ? login.toLowerCase() : normalizePhone(login)]
    );
    const user = rows[0];

    if (!user || !(await bcrypt.compare(String(password), user.password))) {
      return res.status(401).json({ message: 'פרטי ההתחברות שגויים' });
    }

    res.json({ token: createToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me - מחזיר את המשתמש המחובר (שימושי בטעינת האפליקציה)
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
module.exports.publicUser = publicUser;
