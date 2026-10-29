-- ==============================================================================
-- WARELIO KPI PORTAL: COMPLETE & SAFE PRODUCTION DATABASE SETUP
-- Database: LogiTrackDB (PostgreSQL)
-- สคริปต์นี้ปลอดภัย 100%: ใช้คำสั่ง IF NOT EXISTS 
-- สามารถรันได้ทั้งบน Database ใหม่ หรือ Database เดิมที่มีข้อมูลอยู่แล้ว
-- ==============================================================================

BEGIN;

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
    attachment_url VARCHAR(500),
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
    bonus_frequency VARCHAR(20) DEFAULT 'MONTHLY' NOT NULL, -- 'MONTHLY' หรือ 'PERIOD'
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ปรับให้ bonus_frequency เป็น MONTHLY แน่นอน
ALTER TABLE kpi_station_point_configs 
  ALTER COLUMN bonus_frequency SET DEFAULT 'MONTHLY';

-- เพิ่มจุดงานยากมาตรฐาน (E Picking, SR, Piece Picking)
INSERT INTO kpi_station_point_configs (station_code, station_name, bonus_points, bonus_frequency, is_active)
VALUES
    ('E_PICKING', 'E Picking (จ่ายงานยาก)', 5.00, 'MONTHLY', TRUE),
    ('SR', 'Selective Rack', 5.00, 'MONTHLY', TRUE),
    ('PIECE_PICKING', 'Piece Picking (หยิบสินค้ารายชิ้นชิ้นย่อย)', 5.00, 'MONTHLY', TRUE)
ON CONFLICT (station_code) DO UPDATE SET
    bonus_frequency = 'MONTHLY',
    updated_at = CURRENT_TIMESTAMP;

-- ------------------------------------------------------------------------------
-- 11. ตารางพนักงานที่ได้รับคะแนนประจำจุดงานยาก (Station Assignments)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_employee_station_assignments (
    assignment_id SERIAL PRIMARY KEY,
    period_id INT NOT NULL REFERENCES kpi_scoring_periods(period_id) ON DELETE CASCADE,
    em_code VARCHAR(50) NOT NULL,
    station_code VARCHAR(50) NOT NULL REFERENCES kpi_station_point_configs(station_code) ON DELETE CASCADE,
    assigned_month VARCHAR(20) DEFAULT 'ALL' NOT NULL, -- 'ALL' (ทุกเดือน) หรือ 'YYYY-MM'
    assigned_by VARCHAR(50) DEFAULT 'ADMIN' NOT NULL,
    remark TEXT,
    assigned_date DATE DEFAULT CURRENT_DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- เพิ่มคอลัมน์ assigned_month หากตารางเดิมยังไม่มี
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kpi_employee_station_assignments' 
      AND column_name = 'assigned_month'
  ) THEN
    ALTER TABLE kpi_employee_station_assignments 
    ADD COLUMN assigned_month VARCHAR(20) DEFAULT 'ALL';
  END IF;
END $$;

UPDATE kpi_employee_station_assignments 
SET assigned_month = 'ALL' 
WHERE assigned_month IS NULL;

-- ปรับ Unique Constraint เพื่อรองรับการมอบหมายรายเดือน
ALTER TABLE kpi_employee_station_assignments 
  DROP CONSTRAINT IF EXISTS unique_period_emp_station;

ALTER TABLE kpi_employee_station_assignments 
  DROP CONSTRAINT IF EXISTS unique_period_emp_station_month;

ALTER TABLE kpi_employee_station_assignments 
  ADD CONSTRAINT unique_period_emp_station_month 
  UNIQUE (period_id, em_code, station_code, assigned_month);

-- ------------------------------------------------------------------------------
-- 12. ข้อมูลตั้งต้นสำหรับระบบ (Seed Data)
-- ------------------------------------------------------------------------------

-- รอบการประเมินตั้งต้น
INSERT INTO kpi_scoring_periods (period_name, start_date, end_date, initial_score, is_active)
SELECT 'รอบประเมินประจำปี 2026', '2026-01-01', '2026-12-31', 100.00, TRUE
WHERE NOT EXISTS (SELECT 1 FROM kpi_scoring_periods WHERE is_active = TRUE);

-- นโยบายกลาง (Global Default Policy)
INSERT INTO kpi_scoring_policies (period_id, dept_code, late_penalty_type, late_fixed_points, absent_penalty_points, unannounced_leave_points, sick_leave_points, weekly_holiday_bonus, public_holiday_bonus, is_enabled)
SELECT p.period_id, 'GLOBAL', 'TIER', 1.00, 5.00, 3.00, 0.00, 2.00, 3.00, TRUE
FROM kpi_scoring_periods p
WHERE p.is_active = TRUE
  AND NOT EXISTS (SELECT 1 FROM kpi_scoring_policies WHERE dept_code = 'GLOBAL' AND period_id = p.period_id);

-- ค่าตั้งค่าระบบ (เวลารอบรัน และเกณฑ์ตัดเกรด A/B/C/D)
INSERT INTO kpi_system_configs (config_key, config_value, description)
VALUES 
    ('GRADE_A_MIN_SCORE', '90.0', 'คะแนนขั้นต่ำสำหรับเกรด A (ดีเยี่ยม)'),
    ('GRADE_B_MIN_SCORE', '80.0', 'คะแนนขั้นต่ำสำหรับเกรด B (ดี)'),
    ('GRADE_C_MIN_SCORE', '70.0', 'คะแนนขั้นต่ำสำหรับเกรด C (ปานกลาง)'),
    ('GRADE_D_MAX_SCORE', '69.9', 'คะแนนต่ำกว่านี้เป็นเกรด D (ต้องปรับปรุง)')
ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

COMMIT;

-- ------------------------------------------------------------------------------
-- 13. ตรวจสอบความถูกต้องหลังรัน (Verification Output)
-- ------------------------------------------------------------------------------
SELECT '1. Station Configs' as check_item, station_code, bonus_points, bonus_frequency, is_active 
FROM kpi_station_point_configs;

SELECT '2. Total KPI Tables' as check_item, COUNT(*)::text as table_count 
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'kpi_%';
