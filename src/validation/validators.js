// ולידציה של נתונים שמגיעים מהלקוח, לפני שמירה במסד
// כל פונקציה מחזירה { data, errors } - אם errors ריק, data מוכן לשמירה
const { TYPES, CATEGORIES, PAYMENT_METHODS, STATUSES } = require('../config/constants');

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';

// טלפון נשמר תמיד באותה צורה - ספרות בלבד: "050-123 4567" / "+972501234567" ← "0501234567"
// כך אפשר להתחבר עם הטלפון בכל צורת כתיבה
function normalizePhone(value) {
  if (isEmpty(value)) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('972')) digits = '0' + digits.slice(3);
  return digits;
}
const isValidPhone = (phone) => /^0\d{8,9}$/.test(phone);
const isValidEmail = (email) => /^\S+@\S+\.\S+$/.test(email);
const toText = (v) => (isEmpty(v) ? null : String(v).trim());
const toNumber = (v) => (isEmpty(v) ? null : Number(v));

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(value))) return false;
  return !Number.isNaN(new Date(value).getTime());
}

// בודק מספר דירה מול כמות הדירות בבניין. isUnit = יחידת הדיור של הדירה (למשל "3א")
function checkApartment(apartment, building, isUnit = false) {
  if (!Number.isInteger(apartment) || apartment < 1) return 'מספר דירה לא תקין';
  if (apartment > building.apartmentsCount) return `בבניין יש ${building.apartmentsCount} דירות בלבד`;
  if (isUnit && !(building.unitApartments || []).includes(apartment)) {
    return `לדירה ${apartment} אין יחידת דיור`;
  }
  return null;
}

// true/false מכל צורה: true, "true", "on", 1
const toBool = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

// בניין
function validateBuilding(input) {
  const errors = {};
  const data = {
    name: toText(input.name),
    address: toText(input.address),
    city: toText(input.city),
    apartmentsCount: toNumber(input.apartmentsCount),
    monthlyFee: isEmpty(input.monthlyFee) ? 0 : Number(input.monthlyFee),
    dueDay: isEmpty(input.dueDay) ? 10 : Number(input.dueDay),
    unitFee: isEmpty(input.unitFee) ? 0 : Number(input.unitFee),
    // מקבלים מערך [3, 5] או טקסט "3, 5". שומרים ממוין ובלי כפילויות
    unitApartments: [...new Set(
      (Array.isArray(input.unitApartments) ? input.unitApartments : String(input.unitApartments ?? '').split(','))
        .filter((v) => !isEmpty(v))
        .map(Number)
    )].sort((a, b) => a - b),
  };

  if (!data.name) errors.name = 'שם הבניין הוא שדה חובה';
  else if (data.name.length > 100) errors.name = 'עד 100 תווים';
  if (!data.address) errors.address = 'כתובת היא שדה חובה';
  if (!data.city) errors.city = 'עיר היא שדה חובה';
  if (!Number.isInteger(data.apartmentsCount) || data.apartmentsCount < 1 || data.apartmentsCount > 500) {
    errors.apartmentsCount = 'מספר הדירות חייב להיות בין 1 ל-500';
  }
  if (!(data.monthlyFee >= 0)) errors.monthlyFee = 'דמי הוועד חייבים להיות מספר אפס או חיובי';
  if (!Number.isInteger(data.dueDay) || data.dueDay < 1 || data.dueDay > 28) {
    errors.dueDay = 'יום התשלום חייב להיות בין 1 ל-28';
  }
  if (!(data.unitFee >= 0)) errors.unitFee = 'דמי הוועד ליחידה חייבים להיות מספר אפס או חיובי';
  const badUnit = data.unitApartments.find(
    (apt) => !Number.isInteger(apt) || apt < 1 || apt > (data.apartmentsCount || 0)
  );
  if (badUnit !== undefined) errors.unitApartments = 'מספרי הדירות של היחידות חייבים להיות דירות קיימות בבניין';

  return { data, errors };
}

// תנועה כספית - מקבל אובייקט מלא (בעריכה: הישן ממוזג עם החדש) ואת הבניין
function validateTransaction(input, building) {
  const errors = {};
  const data = {
    type: input.type,
    amount: Number(input.amount),
    date: isEmpty(input.date) ? null : String(input.date).slice(0, 10),
    category: input.category,
    apartment: toNumber(input.apartment),
    isUnit: toBool(input.isUnit),
    supplier: toText(input.supplier),
    paymentMethod: input.paymentMethod || 'transfer',
    status: input.status || 'paid',
    description: toText(input.description),
  };

  if (!TYPES.includes(data.type)) errors.type = 'יש לבחור הכנסה או הוצאה';
  if (isEmpty(input.amount) || !(data.amount > 0)) errors.amount = 'הסכום חייב להיות מספר חיובי';
  if (!data.date || !isValidDate(data.date)) errors.date = 'תאריך לא תקין';
  if (!CATEGORIES.includes(data.category)) errors.category = 'יש לבחור קטגוריה';
  if (!PAYMENT_METHODS.includes(data.paymentMethod)) errors.paymentMethod = 'אמצעי תשלום לא תקין';
  if (!STATUSES.includes(data.status)) errors.status = 'סטטוס לא תקין';
  if (data.description && data.description.length > 500) errors.description = 'עד 500 תווים';

  // הכנסה: חובה דירה (שקיימת בבניין), ואין ספק. הוצאה: חובה ספק, ואין דירה.
  if (data.type === 'income') {
    if (data.apartment === null) errors.apartment = 'בהכנסה חובה לציין מספר דירה';
    else {
      const aptError = checkApartment(data.apartment, building, data.isUnit);
      if (aptError) errors.apartment = aptError;
    }
    data.supplier = null;
  }
  if (data.type === 'expense') {
    if (!data.supplier) errors.supplier = 'בהוצאה חובה לציין שם ספק';
    data.apartment = null;
    data.isUnit = false;
  }

  return { data, errors };
}

// משתמש
//   building קיים ← דייר בבניין: חובה מספר דירה שקיים בבניין
//   building חסר ← הרשמת ועד חדש: בלי דירה
//   isNew: בהוספה הסיסמה חובה, בעדכון רק אם נשלחה
//   requirePhone: בהצטרפות עם קוד - הטלפון חובה (איתו הדייר מתחבר)
// אימייל וטלפון - כל אחד מהם לא חובה, אבל חייב להיות לפחות אחד (כדי שאפשר יהיה להתחבר)
function validateUser(input, { isNew, building, requirePhone = false }) {
  const errors = {};
  const data = {
    fullName: toText(input.fullName),
    email: isEmpty(input.email) ? null : String(input.email).trim().toLowerCase(),
    password: isEmpty(input.password) ? null : String(input.password),
    apartment: building ? toNumber(input.apartment) : null,
    isUnit: building ? toBool(input.isUnit) : false,
    phone: normalizePhone(input.phone),
  };

  if (!data.fullName) errors.fullName = 'שם מלא הוא שדה חובה';
  if (data.email && !isValidEmail(data.email)) errors.email = 'כתובת אימייל לא תקינה';
  if (data.phone && !isValidPhone(data.phone)) errors.phone = 'מספר טלפון לא תקין';
  if (requirePhone && !data.phone) errors.phone = 'יש להזין מספר טלפון';
  if (!data.email && !data.phone) {
    errors.email = errors.email || 'יש להזין אימייל או טלפון';
    errors.phone = errors.phone || 'יש להזין אימייל או טלפון';
  }
  if (isNew && !data.password) errors.password = 'סיסמה היא שדה חובה';
  if (data.password && data.password.length < 6) errors.password = 'סיסמה חייבת להכיל לפחות 6 תווים';

  if (building) {
    if (data.apartment === null) errors.apartment = 'חובה לציין מספר דירה';
    else {
      const aptError = checkApartment(data.apartment, building, data.isUnit);
      if (aptError) errors.apartment = aptError;
    }
  }

  return { data, errors };
}

// חיוב חודשי: { month: 'YYYY-MM', amount? } - אם אין סכום, לוקחים את דמי הוועד של הבניין
function validateCharge(input, building) {
  const errors = {};
  const data = {
    month: toText(input.month),
    amount: isEmpty(input.amount) ? building.monthlyFee : Number(input.amount),
  };

  if (!data.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(data.month)) errors.month = 'יש לבחור חודש (YYYY-MM)';
  if (!(data.amount > 0)) {
    errors.amount = isEmpty(input.amount)
      ? 'לא הוגדרו דמי ועד לבניין - יש להזין סכום'
      : 'הסכום חייב להיות מספר חיובי';
  }

  return { data, errors };
}

// הודעה בלוח ההודעות: { title, body, pinned? }
function validateAnnouncement(input) {
  const errors = {};
  const data = {
    title: toText(input.title),
    body: toText(input.body),
    pinned: toBool(input.pinned),
  };

  if (!data.title) errors.title = 'יש להזין כותרת';
  else if (data.title.length > 120) errors.title = 'עד 120 תווים';
  if (!data.body) errors.body = 'יש להזין את תוכן ההודעה';
  else if (data.body.length > 2000) errors.body = 'עד 2000 תווים';

  return { data, errors };
}

// שולח תשובת שגיאה בפורמט האחיד אם יש שגיאות; מחזיר true אם נשלחה
function sendIfInvalid(res, errors) {
  if (Object.keys(errors).length === 0) return false;
  res.status(400).json({ message: 'יש שדות לא תקינים', errors });
  return true;
}

module.exports = {
  validateBuilding, validateTransaction, validateUser, validateCharge, validateAnnouncement,
  sendIfInvalid, normalizePhone,
};
