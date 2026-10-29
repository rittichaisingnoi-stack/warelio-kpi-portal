-- ==============================================================================
-- WARELIO KPI PORTAL: SUPABASE CLOUD DATABASE SETUP (HYBRID 2-DATABASE MODE)
-- วิธีใช้: คัดลอกโค้ดทั้งหมดไปวางในเมนู "SQL Editor" บนหน้าเว็บ Supabase แล้วกด "Run"
-- (หรือให้ระบบ On-Premise สร้างตารางอัตโนมัติเมื่อกดปุ่ม Sync ตอนนี้)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0.1 ตารางข้อมูลพนักงานหลัก (Synced from On-Premise employee_whc)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_whc (
    no INT,
    id_emp VARCHAR(50) PRIMARY KEY,
    name_th VARCHAR(200),
    name_en VARCHAR(200),
    position_name VARCHAR(150),
    level_no VARCHAR(50),
    team VARCHAR(100),
    grp VARCHAR(100),
    start_date VARCHAR(50),
    end_date VARCHAR(50),
    shift_id VARCHAR(50),
    team_extra TEXT[]
);
CREATE INDEX IF NOT EXISTS idx_emp_whc_team_grp ON employee_whc(team, grp);

-- ------------------------------------------------------------------------------
-- 0.2 ตารางบัญชีผู้ใช้งานสำหรับหัวหน้างาน/Admin (Synced from On-Premise users)
-- ใช้ชื่อ kpi_users เพื่อไม่ให้ชนกับตาราง users ของโปรเจกต์อื่นใน Supabase เดียวกัน
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    fullname VARCHAR(200),
    email VARCHAR(200),
    role VARCHAR(50) DEFAULT 'User',
    dateupdate TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    password_expiry TIMESTAMPTZ,
    failed_attempts INT DEFAULT 0,
    lockout_until TIMESTAMPTZ
);

-- ------------------------------------------------------------------------------
-- 0.3 ตารางข้อมูลกำลังคนและวันลาป่วย (Synced from On-Premise tb_manpower_data)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tb_manpower_data (
    no BIGSERIAL PRIMARY KEY,
    id_emp VARCHAR(50) NOT NULL,
    date_plan VARCHAR(50) NOT NULL,
    status VARCHAR(100),
    remark TEXT,
    overtime DOUBLE PRECISION,
    team_sc VARCHAR(100),
    shift_plan VARCHAR(100),
    updatetime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_update VARCHAR(100),
    CONSTRAINT uq_tb_manpower_emp_date UNIQUE (id_emp, date_plan)
);

-- ------------------------------------------------------------------------------
-- 1. ตารางรอบการประเมินคะแนน (Scoring Periods)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_scoring_periods (
    period_id SERIAL PRIMARY KEY,
    period_name VARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    initial_score NUMERIC(5,2) DEFAULT 100.00 NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kpi_periods_active ON kpi_scoring_periods(is_active);
CREATE INDEX IF NOT EXISTS idx_kpi_periods_dates ON kpi_scoring_periods(start_date, end_date);

-- ------------------------------------------------------------------------------
-- 2. ตารางเกณฑ์การคิดคะแนนตามแผนกและตำแหน่ง (Scoring Policies)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_scoring_policies (
    policy_id SERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    dept_code VARCHAR(50) NOT NULL,
    position_name VARCHAR(100) DEFAULT 'ALL' NOT NULL,
    late_penalty_type VARCHAR(20) DEFAULT 'TIER' NOT NULL,
    late_fixed_points NUMERIC(5,2) DEFAULT 1.00 NOT NULL,
    absent_penalty_points NUMERIC(5,2) DEFAULT 5.00 NOT NULL,
    unannounced_leave_points NUMERIC(5,2) DEFAULT 3.00 NOT NULL,
    sick_leave_points NUMERIC(5,2) DEFAULT 0.00 NOT NULL,
    weekly_holiday_bonus NUMERIC(5,2) DEFAULT 2.00 NOT NULL,
    weekly_off_days VARCHAR(50) DEFAULT 'SUN' NOT NULL,
    public_holiday_bonus NUMERIC(5,2) DEFAULT 3.00 NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_kpi_policy_dept_pos UNIQUE (period_id, dept_code, position_name)
);

-- ------------------------------------------------------------------------------
-- 3. ตารางปฏิทินวันหยุดนักขัตฤกษ์ประจำปี (Public Holidays)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_public_holidays (
    holiday_id SERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    holiday_year INT DEFAULT 2026,
    holiday_date DATE NOT NULL,
    holiday_name VARCHAR(150) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_holiday_period_date UNIQUE (period_id, holiday_date)
);

-- ------------------------------------------------------------------------------
-- 4. ตารางขั้นบันไดนาทีที่สาย (Late Tiers)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_late_tiers (
    tier_id SERIAL PRIMARY KEY,
    policy_id INT NOT NULL REFERENCES kpi_scoring_policies(policy_id) ON DELETE CASCADE,
    min_minutes INT NOT NULL,
    max_minutes INT,
    deduct_points NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ------------------------------------------------------------------------------
-- 5. ตารางแต้มพิเศษตามตำแหน่งงาน (Position Points)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_position_points (
    position_point_id SERIAL PRIMARY KEY,
    position_code VARCHAR(50) NOT NULL,
    position_name VARCHAR(100),
    bonus_type VARCHAR(20) NOT NULL,
    bonus_points NUMERIC(5,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_kpi_position_bonus UNIQUE (position_code, bonus_type)
);

-- ------------------------------------------------------------------------------
-- 6. ตารางตัวเลือกเหตุผลมาตรฐาน (Manual Reason Presets)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_manual_reason_presets (
    reason_id SERIAL PRIMARY KEY,
    reason_code VARCHAR(50) UNIQUE NOT NULL,
    reason_name VARCHAR(255) NOT NULL,
    point_type VARCHAR(10) NOT NULL,
    default_points NUMERIC(5,2) NOT NULL,
    dept_scope VARCHAR(50) DEFAULT 'ALL' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ------------------------------------------------------------------------------
-- 7. ตารางประวัติการบันทึกคะแนน (Score Transactions Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_score_transactions (
    transaction_id BIGSERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    em_code VARCHAR(50) NOT NULL,
    transaction_date DATE NOT NULL,
    source_type VARCHAR(30) NOT NULL,
    reason_code VARCHAR(50),
    reason_description TEXT NOT NULL,
    points_change NUMERIC(5,2) NOT NULL,
    attachment_url TEXT,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    cloud_sync_id VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS idx_kpi_trans_emp_period ON kpi_score_transactions(em_code, period_id);
ALTER TABLE kpi_score_transactions DROP CONSTRAINT IF EXISTS uq_kpi_trans_period_sync;
ALTER TABLE kpi_score_transactions ADD CONSTRAINT uq_kpi_trans_period_sync UNIQUE (period_id, cloud_sync_id);

-- ------------------------------------------------------------------------------
-- 8. ตารางสรุปคะแนนและตัดเกรดรายบุคคล (Employee Score Summary & Grades)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_employee_summary (
    summary_id SERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    em_code VARCHAR(50) NOT NULL,
    dept_code VARCHAR(50),
    initial_score NUMERIC(5,2) DEFAULT 100.00 NOT NULL,
    total_deducted NUMERIC(5,2) DEFAULT 0.00 NOT NULL,
    total_added NUMERIC(5,2) DEFAULT 0.00 NOT NULL,
    net_score NUMERIC(5,2) DEFAULT 100.00 NOT NULL,
    current_grade VARCHAR(5) DEFAULT 'A' NOT NULL,
    last_recalculated TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT uq_kpi_emp_period UNIQUE (period_id, em_code)
);

-- ------------------------------------------------------------------------------
-- 9. ตารางการตั้งค่าระบบ (System Configuration)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_system_configs (
    config_id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    description VARCHAR(255),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ------------------------------------------------------------------------------
-- 10. ตารางเกณฑ์คะแนนจุดจ่ายงานยาก & สกิลพิเศษ (Difficult Station Configs)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_station_point_configs (
    station_code VARCHAR(50) PRIMARY KEY,
    station_name VARCHAR(150) NOT NULL,
    bonus_points NUMERIC(5,2) DEFAULT 5.00 NOT NULL,
    bonus_frequency VARCHAR(20) DEFAULT 'MONTHLY' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ------------------------------------------------------------------------------
-- 11. ตารางพนักงานที่ได้รับคะแนนประจำจุดงานยาก (Station Assignments)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_employee_station_assignments (
    assignment_id SERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    em_code VARCHAR(50) NOT NULL,
    station_code VARCHAR(50) NOT NULL REFERENCES kpi_station_point_configs(station_code) ON DELETE CASCADE,
    assigned_month VARCHAR(20) DEFAULT 'ALL' NOT NULL,
    assigned_by VARCHAR(50) DEFAULT 'ADMIN' NOT NULL,
    remark TEXT,
    assigned_date DATE DEFAULT CURRENT_DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT unique_period_emp_station_month UNIQUE (period_id, em_code, station_code, assigned_month)
);

-- ------------------------------------------------------------------------------
-- 12. ฟังก์ชัน RPC สำหรับเชื่อมต่อผ่าน SUPABASE_URL + SUPABASE_SECRET_KEY (HTTPS)
-- (อนุญาตเฉพาะ service_role / Secret Key เท่านั้น ปิดสิทธิ์ anon/public 100%)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kpi_exec_sql(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cleaned TEXT := REGEXP_REPLACE(query_text, '^\s+|;\s*$|\s+$', '', 'g');
  no_comments TEXT := REGEXP_REPLACE(cleaned, '^(\s|/\*.*?\*/|--[^\n]*\n)+', '', 'g');
  upper_q TEXT := UPPER(no_comments);
  result_rows JSONB := '[]'::jsonb;
  affected_count INT := 0;
BEGIN
  IF upper_q LIKE 'SELECT%' OR upper_q LIKE 'WITH%' THEN
    EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(_t)), ''[]''::jsonb) FROM (' || cleaned || E'\n) _t'
    INTO result_rows;
    affected_count := jsonb_array_length(result_rows);
  ELSIF upper_q ~ '\mRETURNING\M' THEN
    EXECUTE 'WITH _t AS (' || cleaned || E'\n) SELECT COALESCE(jsonb_agg(row_to_json(_t)), ''[]''::jsonb) FROM _t'
    INTO result_rows;
    affected_count := jsonb_array_length(result_rows);
  ELSE
    EXECUTE query_text;
    GET DIAGNOSTICS affected_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('rows', COALESCE(result_rows, '[]'::jsonb), 'rowCount', affected_count);
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_exec_sql(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kpi_exec_sql(TEXT) TO service_role, postgres;

NOTIFY pgrst, 'reload schema';

COMMIT;
