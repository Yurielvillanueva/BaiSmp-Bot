const locales = require('./locales.json');

function t(db, key, vars = {}) {
  const locale = (db && db.config.get('locale')) || 'en';
  const table = locales[locale] || locales.en;
  let text = table[key] || locales.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

module.exports = { t };
