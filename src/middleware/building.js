const pool = require('../config/db');
const { markLateFees } = require('../services/fees');

// העמודות של בניין שחוזרות ללקוח (camelCase)
const BUILDING_COLUMNS = `
  b.id, b.name, b.address, b.city, b.apartments_count AS "apartmentsCount",
  b.monthly_fee::float8 AS "monthlyFee", b.due_day AS "dueDay",
  b.unit_fee::float8 AS "unitFee", b.unit_apartments AS "unitApartments",
  b.join_code AS "joinCode", b.manager_id AS "managerId", b.created_at AS "createdAt"`;

// טוען את הבניין מה-URL (/api/buildings/:buildingId/...) ובודק שלמשתמש מותר לגשת אליו:
//   ועד  - רק לבניינים שהוא מנהל
//   דייר - רק לבניין שהוא גר בו
// אם מותר: req.building זמין בכל הנתיבים שאחריו
async function loadBuilding(req, res, next) {
  try {
    const id = req.params.buildingId;
    if (!/^\d+$/.test(id)) return res.status(404).json({ message: 'הבניין לא נמצא' });

    const { rows } = await pool.query(`SELECT ${BUILDING_COLUMNS} FROM buildings b WHERE b.id = $1`, [id]);
    const building = rows[0];

    const allowed =
      building &&
      ((req.user.role === 'admin' && building.managerId === req.user.id) ||
        (req.user.role === 'resident' && building.id === req.user.buildingId));

    // לבניין של מישהו אחר מחזירים 404 (ולא 403) - כדי לא לחשוף שהוא קיים
    if (!allowed) return res.status(404).json({ message: 'הבניין לא נמצא' });

    await markLateFees({ buildingId: building.id });
    // קוד ההצטרפות - רק לוועד (דייר לא צריך אותו)
    if (req.user.role !== 'admin') delete building.joinCode;
    req.building = building;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { loadBuilding, BUILDING_COLUMNS };
