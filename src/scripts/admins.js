// ניהול ועדים מהטרמינל (למפתחת - לא חלק מהאתר)
//   npm run admins              ← רשימת כל הוועדים
//   npm run admins -- delete 7  ← מחיקת ועד מספר 7, כולל הבניינים שלו (והדיירים והתנועות שבהם)
const pool = require('../config/db');

async function list() {
  const { rows } = await pool.query(`
    SELECT u.id, u.full_name, u.email, u.phone,
           COUNT(b.id)::int AS buildings
      FROM users u
      LEFT JOIN buildings b ON b.manager_id = u.id
     WHERE u.role = 'admin'
     GROUP BY u.id
     ORDER BY u.id`);
  console.log('\nהוועדים במערכת:\n');
  for (const a of rows) {
    console.log(`  #${a.id}  ${a.full_name}  |  ${a.email || '-'}  |  ${a.phone || '-'}  |  בניינים: ${a.buildings}`);
  }
  console.log('\nלמחיקה: npm run admins -- delete <מספר>\n');
}

async function remove(id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // הכול או כלום - אם משהו נכשל, שום דבר לא נמחק
    const { rows } = await client.query(
      "SELECT full_name FROM users WHERE id = $1 AND role = 'admin'", [id]);
    if (!rows[0]) {
      console.log(`❌ לא נמצא ועד מספר ${id}`);
      await client.query('ROLLBACK');
      return;
    }
    const buildings = await client.query('DELETE FROM buildings WHERE manager_id = $1', [id]);
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await client.query('COMMIT');
    console.log(`✅ נמחק: ${rows[0].full_name} (וגם ${buildings.rowCount} בניינים שלו)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const [command, id] = process.argv.slice(2);
  if (command === 'delete') {
    if (!/^\d+$/.test(id || '')) throw new Error('יש לכתוב מספר ועד, למשל: npm run admins -- delete 7');
    await remove(Number(id));
  } else {
    await list();
  }
  await pool.end();
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
