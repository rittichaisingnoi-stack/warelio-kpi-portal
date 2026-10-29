/**
 * Supabase HTTPS SQL Bridge (pg.Pool-compatible adapter using SUPABASE_URL + SUPABASE_SECRET_KEY)
 * ไม่ต้องใช้รหัสผ่าน PostgreSQL DATABASE_URL และวิ่งผ่านพอร์ต 443 (HTTPS) ทะลุ Firewall 100%
 */

function escapeSqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Array.isArray(val)) {
    if (val.length === 0) return `'{}'`;
    return `ARRAY[${val.map(v => escapeSqlValue(v)).join(', ')}]`;
  }
  if (typeof val === 'object') {
    const jsonStr = JSON.stringify(val).replace(/'/g, "''");
    return `'${jsonStr}'`;
  }
  const str = String(val).replace(/'/g, "''");
  return `'${str}'`;
}

function formatSqlQuery(sql, params = []) {
  if (!params || params.length === 0) return sql;
  return sql.replace(/\$(\d+)\b/g, (match, indexStr) => {
    const idx = parseInt(indexStr, 10) - 1;
    if (idx < 0 || idx >= params.length) return match;
    return escapeSqlValue(params[idx]);
  });
}

function createSupabaseRestPool({ supabaseUrl, supabaseKey }) {
  const cleanUrl = (supabaseUrl || '').trim().replace(/\/+$/, '');
  const cleanKey = (supabaseKey || '').trim();

  const executeQuery = async (sql, params = []) => {
    const trimmed = (sql || '').trim().toUpperCase();
    if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }

    const finalSql = formatSqlQuery(sql, params);
    const rpcUrl = `${cleanUrl}/rest/v1/rpc/kpi_exec_sql`;

    const headers = {
      'Content-Type': 'application/json',
      'apikey': cleanKey
    };
    if (!cleanKey.startsWith('sb_')) {
      headers['Authorization'] = `Bearer ${cleanKey}`;
    }

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query_text: finalSql })
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 404 && errText.includes('kpi_exec_sql')) {
        throw new Error(
          'ยังไม่ได้รันไฟล์ deploy_supabase_migrations.sql บน Supabase SQL Editor (ไม่พบฟังก์ชัน kpi_exec_sql)'
        );
      }
      throw new Error(`Supabase RPC Error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return {
      rows: Array.isArray(data?.rows) ? data.rows : [],
      rowCount: typeof data?.rowCount === 'number' ? data.rowCount : 0
    };
  };

  return {
    isCloudInstance: true,
    isSupabaseRest: true,
    query: executeQuery,
    connect: async () => ({
      query: executeQuery,
      release: () => {}
    }),
    on: () => {},
    end: async () => {}
  };
}

module.exports = {
  createSupabaseRestPool,
  formatSqlQuery
};

