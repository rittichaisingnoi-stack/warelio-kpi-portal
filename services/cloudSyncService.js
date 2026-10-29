const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const scoringEngine = require('./scoringEngine');
const { createSupabaseRestPool } = require('./supabaseSqlBridge');

class CloudSyncService {
  constructor() {
    this.isSyncing = false;
    this.syncTimer = null;
    this.pingTimer = null;
  }

  /**
   * ดึงค่าตั้งค่า Cloud Sync จากฐานข้อมูล หรือ .env
   */
  async getSyncConfig() {
    const configs = await scoringEngine.getSystemConfigs().catch(() => ({}));
    const supabaseUrl = (configs.SUPABASE_URL || process.env.SUPABASE_URL || 'https://mtncniggrijtixrjdbub.supabase.co').trim();
    const supabaseSecretKey = (configs.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const supabaseDbUrl = (configs.SUPABASE_DB_URL || process.env.SUPABASE_DB_URL || '').trim();
    const renderAppUrl = (configs.RENDER_APP_URL || process.env.RENDER_APP_URL || 'https://wh-neo-evaluation-score.onrender.com').trim();
    const autoSyncEnabled = (configs.AUTO_SYNC_ENABLED || process.env.AUTO_SYNC_ENABLED || 'true') !== 'false';
    const syncIntervalMinutes = parseInt(configs.SYNC_INTERVAL_MINUTES || process.env.SYNC_INTERVAL_MINUTES || '5', 10) || 5;
    const lastSyncAt = configs.LAST_CLOUD_SYNC_AT || null;
    const lastSyncSummary = configs.LAST_CLOUD_SYNC_SUMMARY || null;

    const hasCloudConfig = Boolean(supabaseDbUrl || (supabaseUrl && supabaseSecretKey));

    return {
      is_cloud_instance: Boolean(pool.isCloudInstance),
      supabase_url: supabaseUrl,
      supabase_secret_key: supabaseSecretKey,
      supabase_db_url: supabaseDbUrl || `${supabaseUrl} (API Key Mode)`,
      has_supabase_url: hasCloudConfig,
      render_app_url: renderAppUrl,
      auto_sync_enabled: autoSyncEnabled,
      sync_interval_minutes: syncIntervalMinutes,
      last_sync_at: lastSyncAt,
      last_sync_summary: lastSyncSummary
    };
  }

  /**
   * บันทึกการตั้งค่า Cloud Sync ลงในตาราง kpi_system_configs
   */
  async saveSyncConfig({ supabase_url, supabase_secret_key, supabase_db_url, render_app_url, auto_sync_enabled, sync_interval_minutes }) {
    const entries = [];
    if (supabase_url !== undefined) {
      entries.push(['SUPABASE_URL', supabase_url.trim(), 'Supabase Project URL']);
    }
    if (supabase_secret_key !== undefined) {
      entries.push(['SUPABASE_SECRET_KEY', supabase_secret_key.trim(), 'Supabase Secret Key (service_role)']);
    }
    if (supabase_db_url !== undefined && !supabase_db_url.includes('(API Key Mode)')) {
      if (supabase_db_url.startsWith('https://')) {
        entries.push(['SUPABASE_URL', supabase_db_url.trim(), 'Supabase Project URL']);
      } else {
        entries.push(['SUPABASE_DB_URL', supabase_db_url.trim(), 'Supabase PostgreSQL Connection URI']);
      }
    }
    if (render_app_url !== undefined) {
      entries.push(['RENDER_APP_URL', render_app_url.trim().replace(/\/+$/, ''), 'Render Public URL สำหรับ 4G/5G Mobile & Keep-Alive']);
    }
    if (auto_sync_enabled !== undefined) {
      entries.push(['AUTO_SYNC_ENABLED', String(Boolean(auto_sync_enabled)), 'เปิด/ปิด Auto-Sync อัตโนมัติระหว่าง On-Premise กับ Supabase']);
    }
    if (sync_interval_minutes !== undefined) {
      const mins = Math.max(1, parseInt(sync_interval_minutes, 10) || 5);
      entries.push(['SYNC_INTERVAL_MINUTES', String(mins), 'ความถี่ในการ Auto-Sync (นาที)']);
    }

    for (const [key, val, desc] of entries) {
      await pool.query(`
        INSERT INTO kpi_system_configs (config_key, config_value, description, updated_at)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (config_key) DO UPDATE SET
          config_value = EXCLUDED.config_value,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP;
      `, [key, val, desc]);
    }

    this.restartBackgroundTimers();
    return await this.getSyncConfig();
  }

  /**
   * สร้าง Pool เชื่อมต่อไปยัง Supabase Cloud Database (รองรับทั้ง SUPABASE_URL + KEY และ postgresql://)
   */
  createCloudPool(cfgOrUrl) {
    if (typeof cfgOrUrl === 'string' && cfgOrUrl.startsWith('postgres')) {
      return new Pool({
        connectionString: cfgOrUrl,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 15000,
        connectionTimeoutMillis: 12000
      });
    }
    const supabaseUrl = (cfgOrUrl?.supabase_url || process.env.SUPABASE_URL || 'https://mtncniggrijtixrjdbub.supabase.co').trim();
    const supabaseKey = (cfgOrUrl?.supabase_secret_key || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    return createSupabaseRestPool({ supabaseUrl, supabaseKey });
  }

  /**
   * ทดสอบการเชื่อมต่อกับ Supabase
   */
  async testConnection(customUrl) {
    const cfg = await this.getSyncConfig();
    const target = (customUrl && customUrl.startsWith('postgres')) ? customUrl : cfg;
    const cloudPool = this.createCloudPool(target);
    try {
      const res = await cloudPool.query(`SELECT current_database() as db, current_user as usr, NOW() as server_time;`);
      return {
        connected: true,
        database: res.rows[0].db,
        user: res.rows[0].usr,
        server_time: res.rows[0].server_time
      };
    } finally {
      await cloudPool.end().catch(() => {});
    }
  }

  /**
   * สร้างตารางทั้งหมดบน Supabase อัตโนมัติหากยังไม่มี
   */
  async ensureCloudSchema(cloudPool) {
    if (cloudPool.isSupabaseRest) {
      // ตรวจสอบว่าฟังก์ชัน kpi_exec_sql และตารางพร้อมแล้วหรือไม่
      await cloudPool.query(`SELECT 1 as ok;`);
      await cloudPool.query(`ALTER TABLE kpi_score_transactions ALTER COLUMN attachment_url TYPE TEXT;`).catch(() => {});
      await pool.query(`ALTER TABLE kpi_score_transactions ALTER COLUMN attachment_url TYPE TEXT;`).catch(() => {});
      return;
    }
    const sqlPath = path.join(__dirname, '..', 'deploy_supabase_migrations.sql');
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await cloudPool.query(sql);
    }
    await cloudPool.query(`ALTER TABLE kpi_score_transactions ALTER COLUMN attachment_url TYPE TEXT;`).catch(() => {});
    await pool.query(`ALTER TABLE kpi_score_transactions ALTER COLUMN attachment_url TYPE TEXT;`).catch(() => {});
  }

  /**
   * ซิงค์ข้อมูลแบบ 2 ทาง (2-Way Hybrid Sync: On-Premise 10.5.3.242 <-> Cloud Supabase)
   */
  async syncNow() {
    // ถ้ารันอยู่บน Cloud (Render) ให้คำนวณคะแนนบน Cloud DB โดยตรง
    if (pool.isCloudInstance) {
      const calcResult = await scoringEngine.calculateScores();
      return {
        mode: 'CLOUD_INSTANCE',
        message: 'คำนวณและอัปเดตข้อมูลบน Cloud (Supabase) เรียบร้อยแล้ว',
        details: calcResult,
        timestamp: new Date().toISOString()
      };
    }

    const cfg = await this.getSyncConfig();
    if (!cfg.has_supabase_url) {
      await scoringEngine.calculateScores();
      return {
        mode: 'LOCAL_ONLY',
        configured: false,
        message: 'คำนวณคะแนนในเครื่อง (10.5.3.242) สำเร็จแล้ว (หากต้องการซิงค์ขึ้น Cloud Supabase กรุณากดปุ่ม "ตั้งค่า Cloud")',
        timestamp: new Date().toISOString()
      };
    }

    if (this.isSyncing) {
      return {
        mode: 'BUSY',
        message: 'ระบบกำลังดำเนินการซิงค์ข้อมูลอยู่ กรุณารอสักครู่...',
        timestamp: new Date().toISOString()
      };
    }

    this.isSyncing = true;
    const cloudPool = this.createCloudPool(cfg.supabase_db_url.startsWith('postgres') ? cfg.supabase_db_url : cfg);

    const stats = {
      pulled_transactions: 0,
      pulled_station_assignments: 0,
      pushed_employees: 0,
      pushed_users: 0,
      pushed_transactions: 0,
      pushed_summaries: 0
    };

    try {
      // 0. ตรวจสอบและสร้างโครงสร้างตารางบน Supabase อัตโนมัติ
      await this.ensureCloudSchema(cloudPool);

      // 0.1 เติม cloud_sync_id ให้กับรายการในเครื่อง (10.5.3.242) และบน Cloud ที่ยังไม่มี
      await pool.query(`
        UPDATE kpi_score_transactions
        SET cloud_sync_id = 'LOCAL_TX_' || transaction_id::text
        WHERE cloud_sync_id IS NULL OR TRIM(cloud_sync_id) = '';
      `);

      await cloudPool.query(`
        UPDATE kpi_score_transactions
        SET cloud_sync_id = 'CLOUD_TX_' || transaction_id::text
        WHERE cloud_sync_id IS NULL OR TRIM(cloud_sync_id) = '';
      `);

      // =========================================================================
      // STEP 1: PULL จาก Cloud (Supabase) ➔ ลงมาที่ On-Premise (10.5.3.242)
      // (ดึงรายการที่หัวหน้างานกดตัด/บวกคะแนนผ่าน 4G/5G บน Render)
      // =========================================================================
      const cloudTxRes = await cloudPool.query(`
        SELECT period_id, em_code, TO_CHAR(transaction_date, 'YYYY-MM-DD') as tx_date,
               source_type, reason_code, reason_description, points_change,
               attachment_url, created_by, created_at, cloud_sync_id
        FROM kpi_score_transactions
        WHERE cloud_sync_id LIKE 'CLOUD_%';
      `);

      for (const tx of cloudTxRes.rows) {
        const r = await pool.query(`
          INSERT INTO kpi_score_transactions (
            period_id, em_code, transaction_date, source_type,
            reason_code, reason_description, points_change,
            attachment_url, created_by, created_at, cloud_sync_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (period_id, cloud_sync_id) DO UPDATE SET
            transaction_date = EXCLUDED.transaction_date,
            points_change = EXCLUDED.points_change,
            reason_description = EXCLUDED.reason_description,
            attachment_url = COALESCE(EXCLUDED.attachment_url, kpi_score_transactions.attachment_url)
          WHERE kpi_score_transactions.cloud_sync_id LIKE 'CLOUD_%';
        `, [
          tx.period_id, tx.em_code, tx.tx_date, tx.source_type,
          tx.reason_code, tx.reason_description, tx.points_change,
          tx.attachment_url, tx.created_by, tx.created_at, tx.cloud_sync_id
        ]);
        if (r.rowCount > 0) stats.pulled_transactions += r.rowCount;
      }

      // ดึงการมอบหมายจุดงานยาก (ถ้ามีการเพิ่มจากฝั่ง Cloud)
      const cloudAssignRes = await cloudPool.query(`
        SELECT period_id, em_code, station_code, assigned_month, assigned_by, remark,
               TO_CHAR(assigned_date, 'YYYY-MM-DD') as assigned_date, created_at
        FROM kpi_employee_station_assignments;
      `);
      for (const a of cloudAssignRes.rows) {
        const r = await pool.query(`
          INSERT INTO kpi_employee_station_assignments (
            period_id, em_code, station_code, assigned_month, assigned_by, remark, assigned_date, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (period_id, em_code, station_code, assigned_month) DO NOTHING;
        `, [a.period_id, a.em_code, a.station_code, a.assigned_month || 'ALL', a.assigned_by, a.remark, a.assigned_date, a.created_at]);
        if (r.rowCount > 0) stats.pulled_station_assignments += r.rowCount;
      }

      // =========================================================================
      // STEP 2: คำนวณคะแนนรวมและซิงค์วันลาป่วยในเครื่อง On-Premise (10.5.3.242)
      // =========================================================================
      await scoringEngine.calculateScores();

      // =========================================================================
      // STEP 3: PUSH ข้อมูลหลัก, เกณฑ์คะแนน, ประวัติ และคะแนนสรุป ➔ ขึ้น Cloud (Supabase)
      // =========================================================================

      // 3.1 ซิงค์พนักงาน (employee_whc) แบบ Batch Chunk (รวดเร็ว)
      const empRes = await pool.query(`
        SELECT no, id_emp, name_th, name_en, position_name, level_no, team, grp, start_date, end_date, shift_id
        FROM employee_whc
        WHERE id_emp IS NOT NULL;
      `);
      const empChunkSize = 80;
      for (let i = 0; i < empRes.rows.length; i += empChunkSize) {
        const chunk = empRes.rows.slice(i, i + empChunkSize);
        const vals = [];
        const placeholders = chunk.map((e, idx) => {
          const base = idx * 11;
          vals.push(e.no, e.id_emp, e.name_th, e.name_en, e.position_name, e.level_no, e.team, e.grp, e.start_date, e.end_date, e.shift_id);
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11})`;
        }).join(', ');

        await cloudPool.query(`
          INSERT INTO employee_whc (no, id_emp, name_th, name_en, position_name, level_no, team, grp, start_date, end_date, shift_id)
          VALUES ${placeholders}
          ON CONFLICT (id_emp) DO UPDATE SET
            name_th = EXCLUDED.name_th,
            name_en = EXCLUDED.name_en,
            position_name = EXCLUDED.position_name,
            level_no = EXCLUDED.level_no,
            team = EXCLUDED.team,
            grp = EXCLUDED.grp,
            shift_id = EXCLUDED.shift_id;
        `, vals);
      }
      stats.pushed_employees = empRes.rows.length;

      // 3.2 ซิงค์บัญชีผู้ใช้งาน (users -> kpi_users บน Cloud เพื่อไม่ให้ชนกับตาราง users ของโปรเจกต์อื่นใน Supabase)
      const usrRes = await pool.query(`
        SELECT username, password, fullname, email, role, dateupdate, password_expiry, COALESCE(failed_attempts, 0) as failed_attempts, lockout_until
        FROM users
        WHERE username IS NOT NULL;
      `);
      const usrChunkSize = 80;
      for (let i = 0; i < usrRes.rows.length; i += usrChunkSize) {
        const chunk = usrRes.rows.slice(i, i + usrChunkSize);
        const vals = [];
        const placeholders = chunk.map((u, idx) => {
          const base = idx * 9;
          vals.push(u.username, u.password, u.fullname, u.email, u.role, u.dateupdate, u.password_expiry, u.failed_attempts, u.lockout_until);
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9})`;
        }).join(', ');

        await cloudPool.query(`
          INSERT INTO kpi_users (username, password, fullname, email, role, dateupdate, password_expiry, failed_attempts, lockout_until)
          VALUES ${placeholders}
          ON CONFLICT (username) DO UPDATE SET
            password = EXCLUDED.password,
            fullname = EXCLUDED.fullname,
            email = EXCLUDED.email,
            role = EXCLUDED.role;
        `, vals);
      }
      stats.pushed_users = usrRes.rows.length;

      // 3.3 ซิงค์ข้อมูลลาป่วยและข้อมูลมาทำงานวันหยุดนักขัตฤกษ์ (tb_manpower_data) แบบ Batch Chunk
      const mpSickRes = await pool.query(`
        SELECT DISTINCT ON (m.id_emp, m.date_plan)
          m.id_emp, m.date_plan, m.status, m.remark, m.overtime, m.team_sc, m.shift_plan, m.updatetime, m.id_update
        FROM tb_manpower_data m
        LEFT JOIN kpi_public_holidays h ON m.date_plan = TO_CHAR(h.holiday_date, 'DD/MM/YYYY')
        WHERE m.id_emp IS NOT NULL AND m.date_plan IS NOT NULL
          AND (
            m.status = 'ป่วย'
            OR (h.holiday_id IS NOT NULL AND m.status IN ('ทำงาน', 'มาทำงาน', 'มาสาย', 'สาย', 'WFH', 'นอกสถานที่', 'ร่มเกล้า'))
          );
      `).catch(() => ({ rows: [] }));
      const mpChunkSize = 80;
      for (let i = 0; i < mpSickRes.rows.length; i += mpChunkSize) {
        const chunk = mpSickRes.rows.slice(i, i + mpChunkSize);
        const vals = [];
        const placeholders = chunk.map((m, idx) => {
          const base = idx * 9;
          vals.push(m.id_emp, m.date_plan, m.status, m.remark, m.overtime, m.team_sc, m.shift_plan, m.updatetime, m.id_update);
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9})`;
        }).join(', ');

        await cloudPool.query(`
          INSERT INTO tb_manpower_data (id_emp, date_plan, status, remark, overtime, team_sc, shift_plan, updatetime, id_update)
          VALUES ${placeholders}
          ON CONFLICT (id_emp, date_plan) DO UPDATE SET
            status = EXCLUDED.status,
            remark = EXCLUDED.remark,
            updatetime = EXCLUDED.updatetime;
        `, vals);
      }

      // 3.4 ซิงค์รอบประเมิน (kpi_scoring_periods)
      const periodsRes = await pool.query(`
        SELECT period_id, period_name, TO_CHAR(start_date, 'YYYY-MM-DD') as start_date,
               TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, initial_score, is_active, created_at
        FROM kpi_scoring_periods
        ORDER BY period_id ASC;
      `);
      for (const p of periodsRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_scoring_periods (period_id, period_name, start_date, end_date, initial_score, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (period_id) DO UPDATE SET
            period_name = EXCLUDED.period_name,
            start_date = EXCLUDED.start_date,
            end_date = EXCLUDED.end_date,
            initial_score = EXCLUDED.initial_score,
            is_active = EXCLUDED.is_active;
        `, [p.period_id, p.period_name, p.start_date, p.end_date, p.initial_score, p.is_active, p.created_at]);
      }
      if (periodsRes.rows.length > 0) {
        const validIds = periodsRes.rows.map(p => Number(p.period_id)).join(',');
        await cloudPool.query(`DELETE FROM kpi_scoring_periods WHERE period_id NOT IN (${validIds});`);
      }

      // 3.5 ซิงค์การตั้งค่าระบบ (kpi_system_configs ยกเว้น Connection String / Secret Key ลับ)
      const sysCfgRes = await pool.query(`
        SELECT config_key, config_value, description, updated_at
        FROM kpi_system_configs
        WHERE config_key NOT IN ('SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'LAST_CLOUD_SYNC_AT', 'LAST_CLOUD_SYNC_SUMMARY');
      `);
      for (const c of sysCfgRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_system_configs (config_key, config_value, description, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (config_key) DO UPDATE SET
            config_value = EXCLUDED.config_value,
            description = EXCLUDED.description,
            updated_at = EXCLUDED.updated_at;
        `, [c.config_key, c.config_value, c.description, c.updated_at]);
      }

      // 3.6 ซิงค์นโยบายคะแนน (kpi_scoring_policies & kpi_late_tiers)
      const polRes = await pool.query(`SELECT * FROM kpi_scoring_policies ORDER BY policy_id ASC;`);
      for (const pol of polRes.rows) {
        const upPol = await cloudPool.query(`
          INSERT INTO kpi_scoring_policies (
            policy_id, period_id, dept_code, position_name, late_penalty_type, late_fixed_points,
            absent_penalty_points, unannounced_leave_points, sick_leave_points,
            weekly_holiday_bonus, weekly_off_days, public_holiday_bonus, is_enabled, created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT (period_id, dept_code, position_name) DO UPDATE SET
            late_penalty_type = EXCLUDED.late_penalty_type,
            late_fixed_points = EXCLUDED.late_fixed_points,
            absent_penalty_points = EXCLUDED.absent_penalty_points,
            unannounced_leave_points = EXCLUDED.unannounced_leave_points,
            sick_leave_points = EXCLUDED.sick_leave_points,
            weekly_holiday_bonus = EXCLUDED.weekly_holiday_bonus,
            weekly_off_days = EXCLUDED.weekly_off_days,
            public_holiday_bonus = EXCLUDED.public_holiday_bonus,
            is_enabled = EXCLUDED.is_enabled
          RETURNING policy_id;
        `, [
          pol.policy_id, pol.period_id, pol.dept_code, pol.position_name || 'ALL',
          pol.late_penalty_type, pol.late_fixed_points, pol.absent_penalty_points,
          pol.unannounced_leave_points, pol.sick_leave_points || 0,
          pol.weekly_holiday_bonus, pol.weekly_off_days || 'SUN', pol.public_holiday_bonus,
          pol.is_enabled, pol.created_at
        ]);

        const cloudPolId = upPol.rows[0].policy_id;
        const tiersRes = await pool.query(`SELECT min_minutes, max_minutes, deduct_points FROM kpi_late_tiers WHERE policy_id = $1 ORDER BY min_minutes;`, [pol.policy_id]);
        await cloudPool.query(`DELETE FROM kpi_late_tiers WHERE policy_id = $1;`, [cloudPolId]);
        for (const t of tiersRes.rows) {
          await cloudPool.query(`
            INSERT INTO kpi_late_tiers (policy_id, min_minutes, max_minutes, deduct_points)
            VALUES ($1, $2, $3, $4);
          `, [cloudPolId, t.min_minutes, t.max_minutes, t.deduct_points]);
        }
      }

      // ซิงค์เหตุผลมาตรฐาน (kpi_manual_reason_presets)
      const presetRes = await pool.query(`SELECT * FROM kpi_manual_reason_presets;`);
      for (const pr of presetRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_manual_reason_presets (reason_code, reason_name, point_type, default_points, dept_scope, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (reason_code) DO UPDATE SET
            reason_name = EXCLUDED.reason_name,
            point_type = EXCLUDED.point_type,
            default_points = EXCLUDED.default_points,
            dept_scope = EXCLUDED.dept_scope,
            is_active = EXCLUDED.is_active;
        `, [pr.reason_code, pr.reason_name, pr.point_type, pr.default_points, pr.dept_scope, pr.is_active, pr.created_at]);
      }

      // ซิงค์วันหยุดนักขัตฤกษ์ (kpi_public_holidays)
      const holRes = await pool.query(`
        SELECT period_id, holiday_year, TO_CHAR(holiday_date, 'YYYY-MM-DD') as holiday_date, holiday_name, description, created_at
        FROM kpi_public_holidays;
      `);
      for (const h of holRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_public_holidays (period_id, holiday_year, holiday_date, holiday_name, description, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (period_id, holiday_date) DO UPDATE SET
            holiday_year = EXCLUDED.holiday_year,
            holiday_name = EXCLUDED.holiday_name,
            description = EXCLUDED.description;
        `, [h.period_id, h.holiday_year || new Date(h.holiday_date).getFullYear(), h.holiday_date, h.holiday_name, h.description, h.created_at]);
      }

      // ซิงค์จุดงานยากและการมอบหมาย (kpi_station_point_configs & kpi_employee_station_assignments)
      const stCfgRes = await pool.query(`SELECT * FROM kpi_station_point_configs;`);
      for (const sc of stCfgRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_station_point_configs (station_code, station_name, bonus_points, bonus_frequency, is_active, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (station_code) DO UPDATE SET
            station_name = EXCLUDED.station_name,
            bonus_points = EXCLUDED.bonus_points,
            bonus_frequency = EXCLUDED.bonus_frequency,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at;
        `, [sc.station_code, sc.station_name, sc.bonus_points, sc.bonus_frequency, sc.is_active, sc.created_at, sc.updated_at]);
      }

      const stAssRes = await pool.query(`
        SELECT period_id, em_code, station_code, assigned_month, assigned_by, remark,
               TO_CHAR(assigned_date, 'YYYY-MM-DD') as assigned_date, created_at
        FROM kpi_employee_station_assignments;
      `);
      for (const sa of stAssRes.rows) {
        await cloudPool.query(`
          INSERT INTO kpi_employee_station_assignments (period_id, em_code, station_code, assigned_month, assigned_by, remark, assigned_date, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (period_id, em_code, station_code, assigned_month) DO UPDATE SET
            assigned_by = EXCLUDED.assigned_by,
            remark = EXCLUDED.remark;
        `, [sa.period_id, sa.em_code, sa.station_code, sa.assigned_month || 'ALL', sa.assigned_by, sa.remark, sa.assigned_date, sa.created_at]);
      }

      // 3.7 ซิงค์ประวัติการปรับคะแนนทั้งหมดขึ้น Cloud (kpi_score_transactions) แบบ Batch Chunk
      const localTxRes = await pool.query(`
        SELECT DISTINCT ON (period_id, cloud_sync_id)
               period_id, em_code, TO_CHAR(transaction_date, 'YYYY-MM-DD') as tx_date,
               source_type, reason_code, reason_description, points_change,
               attachment_url, created_by, created_at, cloud_sync_id
        FROM kpi_score_transactions
        WHERE cloud_sync_id IS NOT NULL;
      `);
      const txChunkSize = 50;
      for (let i = 0; i < localTxRes.rows.length; i += txChunkSize) {
        const chunk = localTxRes.rows.slice(i, i + txChunkSize);
        const vals = [];
        const placeholders = chunk.map((tx, idx) => {
          const base = idx * 11;
          vals.push(
            tx.period_id, tx.em_code, tx.tx_date, tx.source_type,
            tx.reason_code, tx.reason_description, tx.points_change,
            tx.attachment_url, tx.created_by, tx.created_at, tx.cloud_sync_id
          );
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9}, $${base+10}, $${base+11})`;
        }).join(', ');

        await cloudPool.query(`
          INSERT INTO kpi_score_transactions (
            period_id, em_code, transaction_date, source_type,
            reason_code, reason_description, points_change,
            attachment_url, created_by, created_at, cloud_sync_id
          )
          VALUES ${placeholders}
          ON CONFLICT (period_id, cloud_sync_id) DO UPDATE SET
            points_change = EXCLUDED.points_change,
            reason_description = EXCLUDED.reason_description,
            attachment_url = COALESCE(EXCLUDED.attachment_url, kpi_score_transactions.attachment_url);
        `, vals);
      }
      stats.pushed_transactions = localTxRes.rows.length;

      // 3.8 ซิงค์ตารางสรุปคะแนนและเกรดรายบุคคลขึ้น Cloud (kpi_employee_summary) แบบ Batch Chunk
      const sumRes = await pool.query(`SELECT * FROM kpi_employee_summary;`);
      const sumChunkSize = 80;
      for (let i = 0; i < sumRes.rows.length; i += sumChunkSize) {
        const chunk = sumRes.rows.slice(i, i + sumChunkSize);
        const vals = [];
        const placeholders = chunk.map((s, idx) => {
          const base = idx * 9;
          vals.push(s.period_id, s.em_code, s.dept_code, s.initial_score, s.total_deducted, s.total_added, s.net_score, s.current_grade, s.last_recalculated);
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8}, $${base+9})`;
        }).join(', ');

        await cloudPool.query(`
          INSERT INTO kpi_employee_summary (
            period_id, em_code, dept_code, initial_score,
            total_deducted, total_added, net_score, current_grade, last_recalculated
          )
          VALUES ${placeholders}
          ON CONFLICT (period_id, em_code) DO UPDATE SET
            dept_code = EXCLUDED.dept_code,
            initial_score = EXCLUDED.initial_score,
            total_deducted = EXCLUDED.total_deducted,
            total_added = EXCLUDED.total_added,
            net_score = EXCLUDED.net_score,
            current_grade = EXCLUDED.current_grade,
            last_recalculated = EXCLUDED.last_recalculated;
        `, vals);
      }
      stats.pushed_summaries = sumRes.rows.length;

      const nowIso = new Date().toISOString();
      const summaryText = `ดึงรายการใหม่จาก Cloud: ${stats.pulled_transactions} รายการ | อัปเดตพนักงาน: ${stats.pushed_employees} คน | ซิงค์ประวัติรวม: ${stats.pushed_transactions} รายการ`;

      await pool.query(`
        INSERT INTO kpi_system_configs (config_key, config_value, description, updated_at)
        VALUES 
          ('LAST_CLOUD_SYNC_AT', $1, 'วันเวลาที่ซิงค์กับ Supabase ล่าสุด', CURRENT_TIMESTAMP),
          ('LAST_CLOUD_SYNC_SUMMARY', $2, 'สรุปผลการซิงค์กับ Supabase ล่าสุด', CURRENT_TIMESTAMP)
        ON CONFLICT (config_key) DO UPDATE SET
          config_value = EXCLUDED.config_value,
          updated_at = CURRENT_TIMESTAMP;
      `, [nowIso, summaryText]);

      return {
        mode: 'HYBRID_2WAY_SYNC',
        configured: true,
        message: `ซิงค์ข้อมูล 2 ทาง (On-Premise <-> Supabase Cloud) สำเร็จ!\n• ${summaryText}`,
        stats,
        timestamp: nowIso
      };
    } finally {
      this.isSyncing = false;
      await cloudPool.end().catch(() => {});
    }
  }

  /**
   * ยิงปลุก Render (Wake-up Ping) ให้ตื่นพร้อมใช้งานก่อนถึงเวลา Auto-Sync
   */
  async wakeUpRender(renderAppUrl) {
    const targetUrl = (renderAppUrl || '').trim().replace(/\/+$/, '');
    if (!targetUrl) return false;
    try {
      const healthUrl = `${targetUrl}/api/health`;
      console.log(`[CloudSync] Sending Pre-Sync Wake-Up Ping to Render: ${healthUrl}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000); // รอ Cold Start สูงสุด 45 วินาที
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch (err) {
      console.warn(`[CloudSync] Render Wake-Up Ping warning:`, err.message);
      return false;
    }
  }

  /**
   * เริ่มต้นระบบ Auto-Sync เบื้องหลัง โดยยิงปลุก Render ล่วงหน้าก่อนถึงเวลา Auto-Sync ทุกครั้ง
   */
  async restartBackgroundTimers() {
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.pingTimer) clearTimeout(this.pingTimer);

    if (pool.isCloudInstance) return;

    const cfg = await this.getSyncConfig().catch(() => null);
    if (!cfg) return;

    if ((cfg.has_supabase_url || cfg.render_app_url) && cfg.auto_sync_enabled) {
      const intervalMs = Math.max(1, cfg.sync_interval_minutes) * 60 * 1000;
      // เวลายิงปลุก Render ล่วงหน้าก่อนถึงเวลา Auto-Sync (เช่น ล่วงหน้า 45 วินาที เพื่อให้ Render ตื่นทันพอดี)
      const wakeUpLeadMs = Math.min(45 * 1000, Math.floor(intervalMs * 0.25));
      const delayUntilWakeUpMs = Math.max(1000, intervalMs - wakeUpLeadMs);

      const schedulePreSyncWakeUp = () => {
        if (this.pingTimer) clearTimeout(this.pingTimer);
        if (!cfg.render_app_url) return;
        this.pingTimer = setTimeout(async () => {
          await this.wakeUpRender(cfg.render_app_url);
        }, delayUntilWakeUpMs);
      };

      // ตั้งเวลายิงปลุกสำหรับรอบแรก
      schedulePreSyncWakeUp();

      this.syncTimer = setInterval(async () => {
        try {
          // ถ้ายิงปลุกล่วงหน้าแล้วยังไม่ตื่น หรือถึงเวลา Sync พอดี ให้เช็คปลุกอีกครั้งก่อน Sync
          if (cfg.render_app_url) {
            await this.wakeUpRender(cfg.render_app_url);
          }
          if (cfg.has_supabase_url) {
            await this.syncNow();
            console.log(`[CloudSync] Auto-synced with Supabase at ${new Date().toLocaleTimeString()}`);
          }
        } catch (err) {
          console.error('[CloudSync] Auto-sync error:', err.message);
        } finally {
          // ตั้งเวลายิงปลุก Render ล่วงหน้าสำหรับรอบถัดไป
          schedulePreSyncWakeUp();
        }
      }, intervalMs);
    }
  }
}

module.exports = new CloudSyncService();
