// תנועות כספיות של בניין: /api/buildings/:buildingId/transactions
// הבניין כבר נבדק ונטען ב-loadBuilding (req.building)
const express = require('express');
const pool = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { validateTransaction, sendIfInvalid } = require('../validation/validators');
const { PAYMENT_METHODS } = require('../config/constants');

const router = express.Router({ mergeParams: true });

// העמודות שחוזרות ללקוח (שמות ב-camelCase, סכום כמספר, תאריך כ-YYYY-MM-DD)
// status: במסד יש 3 סטטוסים (paid / pending / late). ללקוח מוצג גם סטטוס רביעי - partial ("שולם חלקית"):
//   יתרה פתוחה של תשלום חלקי (יש לה partial_of). במסד היא עדיין pending / late, כך שכל חישובי החוב לא משתנים
const DISPLAY_STATUS = `CASE WHEN partial_of IS NOT NULL AND status <> 'paid' THEN 'partial' ELSE status END`;
const COLUMNS = `
  id, building_id AS "buildingId", type, amount::float8 AS amount, to_char(date, 'YYYY-MM-DD') AS date,
  category, apartment, is_unit AS "isUnit", supplier, payment_method AS "paymentMethod",
  ${DISPLAY_STATUS} AS status, partial_of AS "partialOf",
  description, created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`;

// שדות שמותר למיין לפיהם ← שם העמודה בטבלה
const SORT_COLUMNS = {
  date: 'date', amount: 'amount', createdAt: 'created_at',
  apartment: 'apartment', category: 'category', status: DISPLAY_STATUS,
};

// בונה תנאי WHERE מתוך פרמטרי ה-URL
// לדוגמה: ?type=income&status=late&month=2026-10&search=מעלית
// conditions = רשימת תנאים, params = הערכים ($1, $2...) - כך נמנעים מ-SQL Injection
function buildWhere(q, conditions = [], params = []) {
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (q.type) add('type = ?', q.type);
  if (q.category) add('category = ?', q.category);
  // partial = יתרות פתוחות של תשלום חלקי. ממתין / באיחור - בלי היתרות (הן מוצגות כ"שולם חלקית")
  if (q.status === 'partial') conditions.push("(partial_of IS NOT NULL AND status <> 'paid')");
  else if (q.status === 'pending' || q.status === 'late') add('(status = ? AND partial_of IS NULL)', q.status);
  else if (q.status) add('status = ?', q.status);
  if (q.paymentMethod) add('payment_method = ?', q.paymentMethod);
  if (q.apartment && /^\d+$/.test(q.apartment)) add('apartment = ?', Number(q.apartment));

  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    // חודש מסוים: month=2026-10
    add("date >= ?::date", `${q.month}-01`);
    add("date < (?::date + INTERVAL '1 month')", `${q.month}-01`);
  } else {
    // או טווח תאריכים: from=2026-01-01&to=2026-06-30
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) add('date >= ?::date', q.from);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) add('date <= ?::date', q.to);
  }

  // חיפוש חופשי בתיאור ובשם הספק (ILIKE = בלי הבדל בין אותיות גדולות לקטנות)
  if (q.search) {
    params.push(`%${String(q.search)}%`);
    const p = `$${params.length}`;
    conditions.push(`(description ILIKE ${p} OR supplier ILIKE ${p})`);
  }

  return { conditions, params };
}

// מריץ שאילתה עם סינון, מיון ועימוד, ומחזיר { items, total, page, pages }
async function runListQuery(q, conditions, params) {
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortColumn = SORT_COLUMNS[q.sortBy] || 'date';
  const order = q.order === 'asc' ? 'ASC' : 'DESC';

  const page = Math.max(1, parseInt(q.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit) || 20));
  const offset = (page - 1) * limit;

  const [items, count] = await Promise.all([
    pool.query(
      `SELECT ${COLUMNS} FROM transactions ${where}
        ORDER BY ${sortColumn} ${order} NULLS LAST, id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM transactions ${where}`, params),
  ]);

  const total = count.rows[0].total;
  return { items: items.rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

// GET - כל התנועות של הבניין (ועד)
router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const { conditions, params } = buildWhere(req.query, ['building_id = $1'], [req.building.id]);
    res.json(await runListQuery(req.query, conditions, params));
  } catch (err) {
    next(err);
  }
});

// GET /mine - התשלומים של הדירה שלי (דייר)
router.get('/mine', async (req, res, next) => {
  try {
    if (!req.user.apartment) {
      return res.status(400).json({ message: 'לא משויך מספר דירה למשתמש זה' });
    }
    // התנאים הקבועים באים ראשונים, ואחריהם הסינון מה-URL (בלי type ו-apartment)
    const { type, apartment, ...rest } = req.query;
    const { conditions, params } = buildWhere(
      rest,
      ['building_id = $1', "type = 'income'", 'apartment = $2', 'is_unit = $3'],
      [req.building.id, req.user.apartment, req.user.isUnit]
    );
    res.json(await runListQuery(req.query, conditions, params));
  } catch (err) {
    next(err);
  }
});

// GET /expenses - הוצאות הבניין (גלוי לכל הדיירים - שקיפות)
router.get('/expenses', async (req, res, next) => {
  try {
    const { type, apartment, ...rest } = req.query;
    const { conditions, params } = buildWhere(rest, ['building_id = $1', "type = 'expense'"], [req.building.id]);
    res.json(await runListQuery(req.query, conditions, params));
  } catch (err) {
    next(err);
  }
});

// GET /:id - תנועה אחת (ועד: הכול, דייר: רק מה שמותר לו)
router.get('/:id', async (req, res, next) => {
  try {
    let sql = `SELECT ${COLUMNS} FROM transactions WHERE id = $1 AND building_id = $2`;
    const params = [req.params.id, req.building.id];

    if (req.user.role !== 'admin') {
      // דייר: רק הכנסות של הדירה שלו או הוצאות
      sql += ` AND (type = 'expense' OR (type = 'income' AND apartment = $3 AND is_unit = $4))`;
      params.push(req.user.apartment, req.user.isUnit);
    }

    const { rows } = await pool.query(sql, params);
    if (!rows[0]) return res.status(404).json({ message: 'התנועה לא נמצאה' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST - הוספה (ועד)
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { data, errors } = validateTransaction(req.body, req.building);
    if (sendIfInvalid(res, errors)) return;

    const { rows } = await pool.query(
      `INSERT INTO transactions
         (building_id, type, amount, date, category, apartment, is_unit, supplier, payment_method, status, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${COLUMNS}`,
      [req.building.id, data.type, data.amount, data.date, data.category, data.apartment, data.isUnit, data.supplier,
       data.paymentMethod, data.status, data.description, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PUT /:id - עריכה (ועד). אפשר לשלוח רק את השדות שהשתנו
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await pool.query(
      `SELECT ${COLUMNS}, status AS "dbStatus" FROM transactions WHERE id = $1 AND building_id = $2`,
      [req.params.id, req.building.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ message: 'התנועה לא נמצאה' });

    // ממזגים את הישן עם החדש ובודקים את התוצאה המלאה
    // "שולם חלקית" הוא סטטוס תצוגה בלבד - אם הוא נשלח, משאירים את הסטטוס שבמסד
    const current = { ...existing.rows[0], status: existing.rows[0].dbStatus };
    const changes = { ...req.body };
    if (changes.status === 'partial') delete changes.status;
    const { data, errors } = validateTransaction({ ...current, ...changes }, req.building);
    if (sendIfInvalid(res, errors)) return;

    const { rows } = await pool.query(
      `UPDATE transactions
          SET type = $1, amount = $2, date = $3, category = $4, apartment = $5, is_unit = $6, supplier = $7,
              payment_method = $8, status = $9, description = $10, updated_at = NOW()
        WHERE id = $11
        RETURNING ${COLUMNS}`,
      [data.type, data.amount, data.date, data.category, data.apartment, data.isUnit, data.supplier,
       data.paymentMethod, data.status, data.description, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /:id/pay - "סמן כשולם" בלחיצה אחת (ועד)
// גוף (לא חובה): { paymentMethod, amount }
//   התאריך לא משתנה, כדי שהחיוב יישאר משויך לחודש שלו
//   amount - תשלום חלקי: אם הדייר שילם פחות מהחיוב (למשל 100 מתוך 150), החיוב מתפצל לשניים:
//            100 ← "שולם",  50 ← חיוב חדש עם הסטטוס הקודם (ממתין / באיחור) והתיאור "(יתרה)"
//   מחזיר: התשלום ששולם. בתשלום חלקי יש בו גם remainder = חיוב היתרה החדש
router.patch('/:id/pay', requireAdmin, async (req, res, next) => {
  const method = req.body.paymentMethod;
  if (method !== undefined && !PAYMENT_METHODS.includes(method)) {
    return sendIfInvalid(res, { paymentMethod: 'אמצעי תשלום לא תקין' });
  }
  const hasAmount = req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== '';
  const amount = Number(req.body.amount);
  if (hasAmount && !(amount > 0)) {
    return sendIfInvalid(res, { amount: 'הסכום חייב להיות מספר חיובי' });
  }

  const client = await pool.connect(); // שתי הפעולות (עדכון + יתרה) בטרנזקציה אחת
  try {
    await client.query('BEGIN');
    // FOR UPDATE - נועל את השורה, כדי ששתי לחיצות במקביל לא יפצלו את אותו חיוב פעמיים
    const found = await client.query(
      `SELECT ${COLUMNS}, status AS "dbStatus" FROM transactions
        WHERE id = $1 AND building_id = $2 AND type = 'income'
        FOR UPDATE`,
      [req.params.id, req.building.id]
    );
    const tx = found.rows[0];
    if (!tx) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'התשלום לא נמצא' });
    }

    const isPartial = hasAmount && amount < tx.amount;
    if (hasAmount) {
      let error = null;
      if (tx.dbStatus === 'paid') error = 'התשלום הזה כבר שולם';
      else if (amount > tx.amount) error = `הסכום גדול מהחיוב (${tx.amount} ₪)`;
      if (error) {
        await client.query('ROLLBACK');
        return sendIfInvalid(res, { amount: error });
      }
    }

    const { rows } = await client.query(
      `UPDATE transactions
          SET status = 'paid', payment_method = COALESCE($1, payment_method),
              amount = CASE WHEN $2::numeric IS NULL THEN amount ELSE $2::numeric END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING ${COLUMNS}`,
      [method || null, isPartial ? amount : null, tx.id]
    );
    const paid = rows[0];

    if (isPartial) {
      // חיוב היתרה: אותה דירה, אותו תאריך ואותו סטטוס - כך הוא נשאר חוב של אותו חודש
      // partial_of = התשלום ששולם עכשיו, כך שהיתרה מוצגת כ"שולם חלקית"
      const remainder = Math.round((tx.amount - amount) * 100) / 100;
      const description = `${tx.description || 'דמי ועד'} (יתרה)`.slice(0, 500);
      const created = await client.query(
        `INSERT INTO transactions
           (building_id, type, amount, date, category, apartment, is_unit, payment_method, status, description,
            created_by, partial_of)
         VALUES ($1, 'income', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${COLUMNS}`,
        [req.building.id, remainder, tx.date, tx.category, tx.apartment, tx.isUnit, tx.paymentMethod,
         tx.dbStatus, description, req.user.id, tx.id]
      );
      paid.remainder = created.rows[0];
    }

    await client.query('COMMIT');
    res.json(paid);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /:id - מחיקה (ועד)
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND building_id = $2',
      [req.params.id, req.building.id]
    );
    if (!rowCount) return res.status(404).json({ message: 'התנועה לא נמצאה' });
    res.json({ message: 'התנועה נמחקה' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
