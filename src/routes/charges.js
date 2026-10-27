// חיובים חודשיים: /api/buildings/:buildingId/charges
// הבניין כבר נבדק ונטען ב-loadBuilding (req.building)
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { createMonthlyCharges } = require('../services/fees');
const { validateCharge, sendIfInvalid } = require('../validation/validators');

const router = express.Router({ mergeParams: true });
router.use(requireAdmin);

// POST - יצירת חיובי דמי ועד לכל הדירות בחודש מסוים
// גוף: { month: '2026-10', amount? }  (בלי amount ← דמי הוועד שהוגדרו לבניין)
// מחזיר: { month, amount, created, skipped }
//   created = כמה חיובים נוצרו, skipped = כמה דירות כבר היו מחויבות באותו חודש
router.post('/', async (req, res, next) => {
  try {
    const { data, errors } = validateCharge(req.body, req.building);
    if (sendIfInvalid(res, errors)) return;

    const result = await createMonthlyCharges({
      building: req.building,
      month: data.month,
      amount: data.amount,
      userId: req.user.id,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
