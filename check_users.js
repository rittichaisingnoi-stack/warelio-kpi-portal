const pool = require('./db');

async function checkUsers() {
  try {
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';");
    console.log('users columns:', cols.rows);
    const sample = await pool.query('SELECT username, role FROM users LIMIT 10;');
    console.log('users sample:', sample.rows);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit();
  }
}
checkUsers();
