// מטפל שגיאות מרכזי - כל שגיאה בשרת מגיעה לכאן ומוחזרת בפורמט אחיד
// הפורמט: { message: string, errors?: { fieldName: message } }
function errorHandler(err, req, res, next) {
  // קודי שגיאה של PostgreSQL
  switch (err.code) {
    case '23505': { // ערך כפול בשדה ייחודי (אימייל או טלפון שכבר רשומים)
      const constraint = err.constraint || '';
      if (constraint.includes('phone')) {
        return res.status(409).json({ message: 'מספר הטלפון כבר רשום במערכת', errors: { phone: 'כבר רשום במערכת' } });
      }
      if (constraint.includes('email')) {
        return res.status(409).json({ message: 'האימייל כבר רשום במערכת', errors: { email: 'כבר רשום במערכת' } });
      }
      return res.status(409).json({ message: 'הערך כבר קיים במערכת' });
    }
    case '23503': // קשר לרשומה שלא קיימת או שעדיין בשימוש (למשל ועד שמנהל בניינים)
      return res.status(409).json({ message: 'לא ניתן לבצע - הרשומה קשורה לנתונים אחרים' });
    case '22P02': // ערך מסוג לא נכון (למשל /transactions/abc)
    case '22007': // תאריך לא תקין
    case '22008':
      return res.status(400).json({ message: 'ערך לא תקין' });
    case '23514': // הפרת אחד מתנאי ה-CHECK בטבלה
      return res.status(400).json({ message: 'הנתונים לא עומדים בכללי המערכת' });
  }

  // JSON לא תקין בגוף הבקשה
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'גוף הבקשה אינו JSON תקין' });
  }

  console.error(err);
  res.status(500).json({ message: 'שגיאת שרת' });
}

module.exports = errorHandler;
