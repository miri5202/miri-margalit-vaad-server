// יוצר את הטבלאות לפי src/db/schema.sql
// הרצה: npm run db:init   (שימו לב: מוחק טבלאות קיימות!)
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ הטבלאות נוצרו');
  await pool.end();
}

init().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
