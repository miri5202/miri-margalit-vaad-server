// ממלא את מסד הנתונים בנתוני דוגמה: 2 ועדים, 3 בניינים, דיירים ותנועות של חצי השנה האחרונה
// הרצה: npm run seed   (שימו לב: מוחק את כל הנתונים הקיימים!)
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { markLateFees } = require('../services/fees');
const { normalizePhone } = require('../validation/validators');

// תאריך בפורמט YYYY-MM-DD, יחסית לחודש הנוכחי
function dateStr(monthsBack, day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function insertUser(u, hash) {
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password, role, building_id, apartment, is_unit, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [u.fullName, u.email || null, hash, u.role, u.buildingId || null, u.apartment || null, Boolean(u.isUnit),
     normalizePhone(u.phone)]
  );
  return rows[0].id;
}

async function insertBuilding(b, managerId) {
  const { rows } = await pool.query(
    `INSERT INTO buildings
       (name, address, city, apartments_count, monthly_fee, due_day, unit_fee, unit_apartments, join_code, manager_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int[], $9, $10) RETURNING id`,
    [b.name, b.address, b.city, b.apartmentsCount, b.monthlyFee, b.dueDay, b.unitFee || 0, b.unitApartments || [],
     b.joinCode, managerId]
  );
  return rows[0].id;
}

async function insertTx(buildingId, createdBy, t) {
  await pool.query(
    `INSERT INTO transactions
       (building_id, type, amount, date, category, apartment, is_unit, supplier, payment_method, status, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [buildingId, t.type, t.amount, t.date, t.category, t.apartment || null, Boolean(t.isUnit), t.supplier || null,
     t.paymentMethod || 'transfer', t.status || 'paid', t.description || null, createdBy]
  );
}

// דמי ועד ל-6 החודשים האחרונים. unpaid = { monthsBack: [דירות שלא שילמו] }
async function seedFees(buildingId, adminId, apartmentsCount, fee, unpaid) {
  let count = 0;
  for (let back = 5; back >= 0; back--) {
    for (let apt = 1; apt <= apartmentsCount; apt++) {
      const date = dateStr(back, 1);
      const isUnpaid = (unpaid[back] || []).includes(apt);
      await insertTx(buildingId, adminId, {
        type: 'income', amount: fee, date, category: 'monthly_fee', apartment: apt,
        paymentMethod: apt % 2 ? 'transfer' : 'cash',
        status: isUnpaid ? 'pending' : 'paid', // "ממתין" שעבר את יום התשלום יהפוך אוטומטית ל"באיחור"
        description: `דמי ועד ${date.slice(5, 7)}/${date.slice(0, 4)}`,
      });
      count++;
    }
  }
  return count;
}

async function seed() {
  await pool.query('TRUNCATE announcements, transactions, buildings, users RESTART IDENTITY CASCADE');
  const hash = await bcrypt.hash('123456', 10);
  let txCount = 0;

  // --- ועד ראשון: מנהל שני בניינים ---
  const adminId = await insertUser(
    { fullName: 'גזבר הוועד', email: 'admin@vaad.test', role: 'admin', phone: '050-0000001' }, hash);

  const b1 = await insertBuilding(
    { name: 'הזית 8', address: 'רחוב הזית 8', city: 'בני ברק', apartmentsCount: 6, monthlyFee: 150, dueDay: 10, joinCode: 'ZAYIT8',
      unitFee: 80, unitApartments: [3] }, adminId); // לדירה 3 יש יחידת דיור: "3א"
  const b2 = await insertBuilding(
    { name: 'הרימון 3', address: 'רחוב הרימון 3', city: 'בני ברק', apartmentsCount: 4, monthlyFee: 200, dueDay: 5, joinCode: 'RIMON3' }, adminId);

  // דיירי הזית 8 (דירה 6 - בלי משתמש במערכת). משפחת פרידמן - רק טלפון, בלי אימייל
  const b1Residents = [
    { fullName: 'משפחת כהן', apartment: 1, phone: '050-1111111', email: 'apt1@vaad.test' },
    { fullName: 'משפחת לוי', apartment: 2, phone: '050-2222222', email: 'apt2@vaad.test' },
    { fullName: 'משפחת פרידמן', apartment: 3, phone: '050-3333333' },
    { fullName: 'משפחת גולדברג', apartment: 4, phone: '050-4444444', email: 'apt4@vaad.test' },
    { fullName: 'משפחת שטרן', apartment: 5, phone: '050-5555555', email: 'apt5@vaad.test' },
  ];
  for (const r of b1Residents) {
    await insertUser({ ...r, role: 'resident', buildingId: b1 }, hash);
  }
  // יחידת הדיור של דירה 3 ("3א")
  await insertUser({ fullName: 'משפחת אדלר', phone: '050-3333300', role: 'resident', buildingId: b1, apartment: 3, isUnit: true }, hash);
  // דיירי הרימון 3
  await insertUser({ fullName: 'משפחת ברגר', email: 'rimon1@vaad.test', role: 'resident', buildingId: b2, apartment: 1 }, hash);
  await insertUser({ fullName: 'משפחת וייס', email: 'rimon2@vaad.test', role: 'resident', buildingId: b2, apartment: 2, phone: '052-2222222' }, hash);

  // דמי ועד: בהזית 8 - דירות 4,5 לא שילמו החודש, דירה 5 גם לא בחודש שעבר
  txCount += await seedFees(b1, adminId, 6, 150, { 0: [4, 5], 1: [5] });
  // דמי ועד ליחידה 3א - 80 ₪, החודש עוד לא שולם
  for (let back = 5; back >= 0; back--) {
    const date = dateStr(back, 1);
    await insertTx(b1, adminId, {
      type: 'income', amount: 80, date, category: 'monthly_fee', apartment: 3, isUnit: true,
      status: back === 0 ? 'pending' : 'paid', description: `דמי ועד ${date.slice(5, 7)}/${date.slice(0, 4)} - יחידת דיור`,
    });
    txCount++;
  }
  // ברימון 3 - דירה 3 לא שילמה חודשיים
  txCount += await seedFees(b2, adminId, 4, 200, { 0: [3], 1: [3] });

  // הוצאות קבועות כל חודש
  for (let back = 5; back >= 0; back--) {
    await insertTx(b1, adminId, { type: 'expense', amount: 400, date: dateStr(back, 10), category: 'cleaning',
      supplier: 'ניקיון הבניין בע"מ', description: 'ניקיון חודשי' });
    await insertTx(b1, adminId, { type: 'expense', amount: 120, date: dateStr(back, 15), category: 'electricity',
      supplier: 'חברת החשמל', paymentMethod: 'credit', description: 'חשמל שטחים משותפים' });
    await insertTx(b2, adminId, { type: 'expense', amount: 300, date: dateStr(back, 12), category: 'cleaning',
      supplier: 'ניקיון הבניין בע"מ', description: 'ניקיון חודשי' });
    txCount += 3;
  }

  // הוצאות חד-פעמיות
  await insertTx(b1, adminId, { type: 'expense', amount: 850, date: dateStr(2, 20), category: 'elevator',
    supplier: 'מעליות השרון', paymentMethod: 'check', description: 'טיפול שנתי במעלית' });
  await insertTx(b1, adminId, { type: 'expense', amount: 300, date: dateStr(1, 8), category: 'repairs',
    supplier: 'יוסי חשמלאי', paymentMethod: 'cash', description: 'החלפת נורות בחדר המדרגות' });
  await insertTx(b1, adminId, { type: 'expense', amount: 250, date: dateStr(0, 12), category: 'gardening',
    supplier: 'גינון ירוק', status: 'pending', description: 'גיזום שיחים בכניסה' });
  await insertTx(b2, adminId, { type: 'expense', amount: 600, date: dateStr(3, 7), category: 'repairs',
    supplier: 'אינסטלציה מהירה', description: 'תיקון נזילה בגג' });
  txCount += 4;

  // --- ועד שני: בניין אחד (לבדיקה שכל ועד רואה רק את הבניינים שלו) ---
  const admin2Id = await insertUser({ fullName: 'ועד האלון', email: 'admin2@vaad.test', role: 'admin' }, hash);
  const b3 = await insertBuilding(
    { name: 'האלון 15', address: 'רחוב האלון 15', city: 'ירושלים', apartmentsCount: 8, monthlyFee: 120, dueDay: 10, joinCode: 'ALON15' }, admin2Id);
  await insertUser({ fullName: 'משפחת רוזן', email: 'alon1@vaad.test', role: 'resident', buildingId: b3, apartment: 1 }, hash);
  txCount += await seedFees(b3, admin2Id, 8, 120, {});

  // לוח הודעות
  const announcements = [
    [b1, 'ניקיון חדר המדרגות', 'ביום רביעי הקרוב בשעה 10:00 יתבצע ניקיון יסודי של חדר המדרגות. נא לא להשאיר חפצים במעברים.', false],
    [b1, 'תזכורת: דמי ועד', 'דמי הוועד לחודש הנוכחי יש לשלם עד ה-10 בחודש. תודה לכל מי שכבר שילם!', true],
    [b2, 'החלפת נורות', 'בשבוע הבא תוחלפנה כל הנורות בלובי לנורות חסכוניות.', false],
  ];
  for (const [buildingId, title, body, pinned] of announcements) {
    await pool.query(
      'INSERT INTO announcements (building_id, title, body, pinned, created_by) VALUES ($1, $2, $3, $4, $5)',
      [buildingId, title, body, pinned, adminId]
    );
  }

  // מסמן "באיחור" את מה שעבר את יום התשלום
  await markLateFees({ managerId: adminId }, pool, { force: true });
  await markLateFees({ managerId: admin2Id }, pool, { force: true });

  console.log(`✅ נוצרו 3 בניינים ו-${txCount} תנועות`);
  console.log('   כל הסיסמאות: 123456. אפשר להתחבר עם אימייל או עם טלפון');
  console.log('   ועד (הזית 8 + הרימון 3):  admin@vaad.test  או 0500000001');
  console.log('   ועד (האלון 15):           admin2@vaad.test');
  console.log('   דייר בהזית 8:            apt2@vaad.test   או 0502222222  (וכך גם דירות 1, 4, 5)');
  console.log('   דייר בלי אימייל:          0503333333  (משפחת פרידמן, הזית 8 דירה 3)');
  console.log('   יחידת דיור:              0503333300  (משפחת אדלר, הזית 8 יחידה 3א, 80 ₪ לחודש)');
  console.log('   דייר בהרימון 3:          rimon1@vaad.test');
  console.log('   קודי הצטרפות: הזית 8 = ZAYIT8, הרימון 3 = RIMON3, האלון 15 = ALON15');
  await pool.end();
}

seed().catch((err) => {
  console.error('❌', err.message);
  if (err.code === '42P01') console.error('   הטבלאות לא קיימות - יש להריץ קודם: npm run db:init');
  process.exit(1);
});
