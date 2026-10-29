-- מבנה מסד הנתונים של ועד הבית
-- נוצר על ידי: npm run db:init   (מוחק טבלאות קיימות ויוצר מחדש!)

DROP TABLE IF EXISTS announcements, transactions, buildings, users CASCADE;

-- משתמשים: ועד/גזבר (admin) ודיירים (resident)
-- admin: מנהל בניין אחד או יותר (ראו buildings.manager_id), בלי דירה
-- resident: שייך לבניין אחד ולדירה בו
-- התחברות: עם אימייל או עם טלפון - לכן לוועד חייב להיות לפחות אחד מהם.
-- דייר שהוועד הוסיף יכול להיות בלי שניהם (רשום רק לפי שם ודירה, ולא מתחבר)
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  full_name   TEXT        NOT NULL,
  email       TEXT        UNIQUE,                -- לא חובה (לא לכל שכן יש אימייל)
  password    TEXT        NOT NULL,              -- מוצפנת ב-bcrypt
  role        TEXT        NOT NULL DEFAULT 'resident'
                          CHECK (role IN ('admin', 'resident')),
  building_id INTEGER,                           -- הקשר לטבלת buildings נוסף למטה
  apartment   INTEGER     CHECK (apartment > 0),
  is_unit     BOOLEAN     NOT NULL DEFAULT FALSE,  -- true = יחידת הדיור של הדירה (למשל "3א")
  phone       TEXT        UNIQUE,                -- נשמר בספרות בלבד, למשל 0501234567
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- דייר חייב בניין ודירה
  CONSTRAINT resident_has_home CHECK (role <> 'resident' OR (building_id IS NOT NULL AND apartment IS NOT NULL)),
  -- לוועד חייב להיות אימייל או טלפון (כדי שיוכל להתחבר)
  CONSTRAINT admin_has_login CHECK (role <> 'admin' OR email IS NOT NULL OR phone IS NOT NULL)
);

-- בניינים: כל ועד יכול לנהל כמה בניינים
CREATE TABLE buildings (
  id                SERIAL PRIMARY KEY,
  name              TEXT          NOT NULL,                    -- שם לתצוגה, למשל "הזית 8"
  address           TEXT          NOT NULL,
  city              TEXT          NOT NULL,
  apartments_count  INTEGER       NOT NULL CHECK (apartments_count BETWEEN 1 AND 500),
  monthly_fee       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),  -- דמי ועד לדירה
  unit_fee          NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (unit_fee >= 0),     -- דמי ועד ליחידת דיור
  unit_apartments   INTEGER[]     NOT NULL DEFAULT '{}',       -- לאילו דירות יש יחידת דיור, למשל {3,5}
  due_day           INTEGER       NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28), -- עד איזה יום בחודש משלמים
  join_code         TEXT          NOT NULL UNIQUE,             -- קוד הצטרפות לדיירים, למשל K7P4QX
  manager_id        INTEGER       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- הקשר מדייר לבניין (נוסף אחרי שהטבלה buildings קיימת). מחיקת בניין מוחקת את הדיירים שלו
ALTER TABLE users
  ADD CONSTRAINT users_building_fk FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE;

-- תנועות כספיות: האובייקט המרכזי. כל תנועה שייכת לבניין
CREATE TABLE transactions (
  id              SERIAL PRIMARY KEY,
  building_id     INTEGER       NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  type            TEXT          NOT NULL CHECK (type IN ('income', 'expense')),
  amount          NUMERIC(10,2) NOT NULL CHECK (amount > 0),   -- NUMERIC = מדויק לכסף
  date            DATE          NOT NULL,
  category        TEXT          NOT NULL CHECK (category IN
                    ('monthly_fee','cleaning','elevator','electricity','repairs','gardening','other')),
  apartment       INTEGER       CHECK (apartment > 0),          -- בהכנסה: הדירה ששילמה
  is_unit         BOOLEAN       NOT NULL DEFAULT FALSE,         -- true = התשלום של יחידת הדיור (למשל "3א")
  supplier        TEXT,                                         -- בהוצאה: הספק
  payment_method  TEXT          NOT NULL DEFAULT 'transfer'
                    CHECK (payment_method IN ('cash','transfer','check','credit')),
  status          TEXT          NOT NULL DEFAULT 'paid'
                    CHECK (status IN ('paid','pending','late')),
  description     TEXT          CHECK (char_length(description) <= 500),
  partial_of      INTEGER       REFERENCES transactions(id) ON DELETE SET NULL, -- יתרה של תשלום חלקי: מזהה התשלום ששולם
  created_by      INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- הכנסה חייבת דירה, הוצאה חייבת ספק
  CONSTRAINT income_has_apartment CHECK (type <> 'income'  OR apartment IS NOT NULL),
  CONSTRAINT expense_has_supplier CHECK (type <> 'expense' OR supplier  IS NOT NULL)
);

-- לוח הודעות: הוועד מפרסם הודעות לכל דיירי הבניין
CREATE TABLE announcements (
  id          SERIAL PRIMARY KEY,
  building_id INTEGER     NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  title       TEXT        NOT NULL CHECK (char_length(title) <= 120),
  body        TEXT        NOT NULL CHECK (char_length(body) <= 2000),
  pinned      BOOLEAN     NOT NULL DEFAULT FALSE,          -- הודעה נעוצה מופיעה ראשונה
  created_by  INTEGER     REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- אינדקסים לסינון ומיון מהירים
CREATE INDEX idx_users_building ON users (building_id, apartment);
CREATE INDEX idx_buildings_manager ON buildings (manager_id);
CREATE INDEX idx_transactions_building_date ON transactions (building_id, date DESC);
CREATE INDEX idx_transactions_building_apartment ON transactions (building_id, apartment, date DESC);
CREATE INDEX idx_announcements_building ON announcements (building_id, pinned DESC, created_at DESC);
