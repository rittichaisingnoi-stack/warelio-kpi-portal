require('dotenv').config();
const { Pool } = require('pg');
const { createSupabaseRestPool } = require('./services/supabaseSqlBridge');

const isCloudInstance = Boolean(process.env.DATABASE_URL || process.env.IS_CLOUD === 'true');
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();

let pool;

if (isCloudInstance && !process.env.DATABASE_URL && supabaseUrl && supabaseKey) {
  // รันบน Render โดยใช้ SUPABASE_URL + SUPABASE_SECRET_KEY (ไม่ต้องใช้รหัสผ่าน DATABASE_URL)
  pool = createSupabaseRestPool({ supabaseUrl, supabaseKey });
} else {
  const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 15,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      }
    : {
        host: process.env.DB_HOST || '10.5.3.242',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'LogiTrackDB',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '103136',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      };

  pool = new Pool(poolConfig);
  pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
  });
  pool.isCloudInstance = isCloudInstance;
}

module.exports = pool;
