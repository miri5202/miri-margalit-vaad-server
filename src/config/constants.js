// הערכים המותרים לשדות הבחירה - מקור אחד לשרת, למסד הנתונים ולצד הלקוח
module.exports = {
  ROLES: ['admin', 'resident'],
  TYPES: ['income', 'expense'], // הכנסה / הוצאה
  CATEGORIES: ['monthly_fee', 'cleaning', 'elevator', 'electricity', 'repairs', 'gardening', 'other'],
  PAYMENT_METHODS: ['cash', 'transfer', 'check', 'credit'],
  STATUSES: ['paid', 'pending', 'late'], // שולם / ממתין / באיחור
};
