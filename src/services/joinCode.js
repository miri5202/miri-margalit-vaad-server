// קוד הצטרפות לבניין: 6 תווים, למשל K7P4QX
// בלי תווים שקל להתבלבל ביניהם (0/O, 1/I/L) - כי מקלידים אותו ידנית
const pool = require('../config/db');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

// מחזיר קוד שעוד לא קיים במסד
async function generateJoinCode(db = pool) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomCode();
    const { rowCount } = await db.query('SELECT 1 FROM buildings WHERE join_code = $1', [code]);
    if (rowCount === 0) return code;
  }
  throw new Error('לא הצלחנו ליצור קוד הצטרפות ייחודי');
}

// "k7p4-qx " ← "K7P4QX" (מקבלים את הקוד בכל צורת כתיבה)
function normalizeJoinCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = { generateJoinCode, normalizeJoinCode };
