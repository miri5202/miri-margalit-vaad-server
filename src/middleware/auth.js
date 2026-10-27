const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// בודק שהמשתמש מחובר: קורא את הטוקן מהכותרת Authorization: Bearer <token>
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'יש להתחבר למערכת' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'ההתחברות פגה או לא תקינה, יש להתחבר מחדש' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name AS "fullName", email, role, building_id AS "buildingId", apartment, is_unit AS "isUnit", phone
         FROM users WHERE id = $1`,
      [payload.id]
    );
    if (!rows[0]) return res.status(401).json({ message: 'המשתמש לא נמצא' });

    req.user = rows[0]; // זמין מעכשיו בכל נתיב
    next();
  } catch (err) {
    next(err);
  }
}

// בודק שלמשתמש יש אחד מהתפקידים המותרים
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'אין לך הרשאה לפעולה זו' });
    }
    next();
  };
}

const requireAdmin = requireRole('admin');

module.exports = { requireAuth, requireRole, requireAdmin };
