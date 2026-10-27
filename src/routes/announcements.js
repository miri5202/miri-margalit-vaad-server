// לוח הודעות של בניין: /api/buildings/:buildingId/announcements
// כל דיירי הבניין רואים את ההודעות. רק הוועד מפרסם, עורך ומוחק
// הבניין כבר נבדק ונטען ב-loadBuilding (req.building)
const express = require('express');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { validateAnnouncement, sendIfInvalid } = require('../validation/validators');

const router = express.Router({ mergeParams: true });

const COLUMNS = `
  a.id, a.title, a.body, a.pinned,
  a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  u.full_name AS "authorName"`;

// מחזיר הודעה אחת (עם שם הכותב)
async function findOne(id, buildingId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM announcements a LEFT JOIN users u ON u.id = a.created_by
      WHERE a.id = $1 AND a.building_id = $2`,
    [id, buildingId]
  );
  return rows[0];
}

// GET - כל ההודעות: נעוצות קודם, ואז מהחדשה לישנה
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM announcements a LEFT JOIN users u ON u.id = a.created_by
        WHERE a.building_id = $1
        ORDER BY a.pinned DESC, a.created_at DESC`,
      [req.building.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST - פרסום הודעה (ועד). גוף: { title, body, pinned? }
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { data, errors } = validateAnnouncement(req.body);
    if (sendIfInvalid(res, errors)) return;

    const { rows } = await pool.query(
      `INSERT INTO announcements (building_id, title, body, pinned, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.building.id, data.title, data.body, data.pinned, req.user.id]
    );
    res.status(201).json(await findOne(rows[0].id, req.building.id));
  } catch (err) {
    next(err);
  }
});

// PUT /:id - עריכת הודעה (ועד). אפשר לשלוח רק את מה שהשתנה (למשל רק { pinned: true })
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await findOne(req.params.id, req.building.id);
    if (!existing) return res.status(404).json({ message: 'ההודעה לא נמצאה' });

    const { data, errors } = validateAnnouncement({ ...existing, ...req.body });
    if (sendIfInvalid(res, errors)) return;

    await pool.query(
      `UPDATE announcements SET title = $1, body = $2, pinned = $3, updated_at = NOW()
        WHERE id = $4`,
      [data.title, data.body, data.pinned, existing.id]
    );
    res.json(await findOne(existing.id, req.building.id));
  } catch (err) {
    next(err);
  }
});

// DELETE /:id - מחיקת הודעה (ועד)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM announcements WHERE id = $1 AND building_id = $2',
      [req.params.id, req.building.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'ההודעה לא נמצאה' });
    res.json({ message: 'ההודעה נמחקה' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
