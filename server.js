const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const xlsx = require('xlsx');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const scoringEngine = require('./services/scoringEngine');
const cloudSyncService = require('./services/cloudSyncService');
const USERS_TABLE = pool.isCloudInstance ? 'kpi_users' : 'users';

const app = express();
const PORT = process.env.PORT || 8882;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload directory for evidence photos
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'evidence-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Serve static frontend files (Disable cache for HTML/JS so updates take effect immediately)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/uploads', express.static(uploadDir));

// ==============================================================================
// 0. API: Login สำหรับหัวหน้างาน / Admin
// ==============================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });
    }

    const userRes = await pool.query(`
      SELECT 
        u.*,
        e.team,
        e.grp,
        COALESCE(e.team, e.grp, '-') as dept,
        TRIM(REGEXP_REPLACE(e.position_name, '\\s+', ' ', 'g')) as position_name
      FROM ${USERS_TABLE} u
      LEFT JOIN employee_whc e ON u.username = e.id_emp
      WHERE u.username = $1;
    `, [username.trim()]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ' });
    }

    const user = userRes.rows[0];
    
    // ตรวจสอบรหัสผ่านด้วย bcrypt หรือ plain-text comparison
    let isMatch = false;
    if (user.password.startsWith('$2')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = (password === user.password);
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    // ตรวจสอบสิทธิ์ (เฉพาะ Admin, Supervisor, Manager, Leader, Executive)
    const allowedRoles = ['Admin', 'Supervisor', 'Manager', 'Leader', 'Executive'];
    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ success: false, message: 'บัญชีนี้ไม่มีสิทธิ์ระดับหัวหน้างานในการปรับคะแนน' });
    }

    res.json({
      success: true,
      message: 'เข้าสู่ระบบสำเร็จ',
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        role: user.role,
        team: user.team || null,
        grp: user.grp || null,
        dept: user.dept || null,
        position_name: user.position_name || null
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 0.1 API: SSO Login จากระบบหลัก Warelio (เฉพาะ Local Intranet 10.5.3.242:8882)
app.post('/api/auth/sso', async (req, res) => {
  try {
    if (pool.isCloudInstance) {
      return res.status(403).json({ success: false, message: 'หน้าเว็บภายนอก (Cloud) ต้องเข้าสู่ระบบด้วยรหัสผ่านทุกครั้ง' });
    }
    const { sso_user, ts, token } = req.body;
    if (!sso_user || !ts || !token) {
      return res.status(400).json({ success: false, message: 'ข้อมูล SSO ไม่ครบถ้วน' });
    }

    const ssoSecret = process.env.SSO_SECRET || 'warelio_kpi_portal_secret_2026';
    const expectedToken = crypto
      .createHmac('sha256', ssoSecret)
      .update(`${sso_user}:${ts}`)
      .digest('hex')
      .toLowerCase();

    if (token.toLowerCase() !== expectedToken) {
      return res.status(401).json({ success: false, message: 'SSO Token ไม่ถูกต้อง' });
    }

    const userRes = await pool.query(`
      SELECT 
        u.*,
        e.team,
        e.grp,
        COALESCE(e.team, e.grp, '-') as dept,
        TRIM(REGEXP_REPLACE(e.position_name, '\\s+', ' ', 'g')) as position_name
      FROM ${USERS_TABLE} u
      LEFT JOIN employee_whc e ON u.username = e.id_emp
      WHERE u.username = $1;
    `, [String(sso_user).trim()]);

    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานนี้ในระบบ' });
    }

    const user = userRes.rows[0];
    const allowedRoles = ['Admin', 'Supervisor', 'Manager', 'Leader', 'Executive'];
    const isSupervisor = allowedRoles.includes(user.role);

    res.json({
      success: true,
      is_supervisor: isSupervisor,
      message: isSupervisor ? 'เข้าสู่ระบบ SSO สำเร็จ' : 'บัญชีระดับพนักงาน',
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        role: user.role,
        team: user.team || null,
        grp: user.grp || null,
        dept: user.dept || null,
        position_name: user.position_name || null
      }
    });
  } catch (err) {
    console.error('SSO Login error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 1. API: ภาพรวม Dashboard & Leaderboard
// ==============================================================================
app.get('/api/kpi/summary', async (req, res) => {
  try {
    const { period_id, dept, search, grade, sort_by, order } = req.query;
    const activePeriod = period_id ? { period_id } : await scoringEngine.getActivePeriod();

    let query = `
      SELECT s.*, e.name_th, e.position_name, e.team, e.grp
      FROM kpi_employee_summary s
      JOIN employee_whc e ON s.em_code = e.id_emp
      WHERE s.period_id = $1
    `;
    const params = [activePeriod.period_id];

    if (dept && dept !== 'ALL') {
      params.push(dept);
      query += ` AND (e.team = $${params.length} OR e.grp = $${params.length})`;
    }

    if (grade && grade !== 'ALL') {
      params.push(grade);
      query += ` AND s.current_grade = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (s.em_code ILIKE $${params.length} OR e.name_th ILIKE $${params.length} OR e.position_name ILIKE $${params.length})`;
    }

    const sortCol = sort_by === 'em_code' ? 's.em_code' : (sort_by === 'name_th' ? 'e.name_th' : 's.net_score');
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${sortOrder};`;

    const result = await pool.query(query, params);

    // คำนวณสถิติสรุป (Stats)
    const statsQuery = `
      SELECT 
        COUNT(*) as total_employees,
        ROUND(AVG(net_score), 2) as avg_score,
        COUNT(CASE WHEN current_grade = 'A' THEN 1 END) as grade_a_count,
        COUNT(CASE WHEN current_grade = 'B' THEN 1 END) as grade_b_count,
        COUNT(CASE WHEN current_grade = 'C' THEN 1 END) as grade_c_count,
        COUNT(CASE WHEN current_grade = 'D' THEN 1 END) as grade_d_count
      FROM kpi_employee_summary
      WHERE period_id = $1;
    `;
    const statsResult = await pool.query(statsQuery, [activePeriod.period_id]);

    // รายชื่อแผนกที่ไม่ซ้ำกัน
    const deptsResult = await pool.query(`
      SELECT DISTINCT COALESCE(team, grp, 'OTHER') as dept_name 
      FROM employee_whc 
      WHERE team IS NOT NULL OR grp IS NOT NULL 
      ORDER BY dept_name;
    `);

    res.json({
      success: true,
      period: activePeriod,
      stats: statsResult.rows[0] || {},
      departments: deptsResult.rows.map(r => r.dept_name),
      data: result.rows
    });
  } catch (err) {
    console.error('Error fetching summary:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 1.1 API: ดึงรายชื่อพนักงานทั้งหมด (สำหรับค้นหาและเลือกปรับคะแนน)
// ==============================================================================
app.get('/api/kpi/employees', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id_emp as em_code,
        name_th,
        COALESCE(team, grp, '-') as dept,
        team,
        grp,
        TRIM(REGEXP_REPLACE(position_name, '\\s+', ' ', 'g')) as position_name
      FROM employee_whc
      ORDER BY id_emp ASC;
    `);
    res.json({ success: true, employees: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 2. API: หน้าดูคะแนนของพนักงาน (Employee PWA / No-Login View)
// ==============================================================================
app.get('/api/kpi/employee/:emCode', async (req, res) => {
  try {
    const { emCode } = req.params;
    const period = await scoringEngine.getActivePeriod();

    // ดึงข้อมูลพนักงานและคะแนนสรุป
    const summaryRes = await pool.query(`
      SELECT s.*, e.name_th, e.position_name, e.team, e.grp, p.period_name, p.start_date, p.end_date
      FROM kpi_employee_summary s
      JOIN employee_whc e ON s.em_code = e.id_emp
      JOIN kpi_scoring_periods p ON s.period_id = p.period_id
      WHERE s.em_code = $1 AND s.period_id = $2;
    `, [emCode, period.period_id]);

    if (summaryRes.rows.length === 0) {
      // ตรวจสอบว่ามีพนักงานรหัสนี้ในระบบหรือไม่
      const empCheck = await pool.query('SELECT * FROM employee_whc WHERE id_emp = $1;', [emCode]);
      if (empCheck.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'ไม่พบรหัสพนักงานนี้ในระบบ' });
      }
      // ถ้ามีพนักงานแต่ยังไม่เคยมีสรุปคะแนน ให้คำนวณทันที
      await scoringEngine.calculateScores({ emCode });
      const reSummary = await pool.query(`
        SELECT s.*, e.name_th, e.position_name, e.team, e.grp, p.period_name, p.start_date, p.end_date
        FROM kpi_employee_summary s
        JOIN employee_whc e ON s.em_code = e.id_emp
        JOIN kpi_scoring_periods p ON s.period_id = p.period_id
        WHERE s.em_code = $1 AND s.period_id = $2;
      `, [emCode, period.period_id]);
      summaryRes.rows = reSummary.rows;
    }

    // ดึงประวัติ Transaction Ledger ของพนักงานคนนี้
    const transRes = await pool.query(`
      SELECT transaction_id, transaction_date, source_type, reason_code, reason_description, points_change, attachment_url, created_by, created_at
      FROM kpi_score_transactions
      WHERE em_code = $1 AND period_id = $2
      ORDER BY transaction_date DESC, created_at DESC;
    `, [emCode, period.period_id]);

    // ดึงคุณสมบัติพิเศษ / ประจำจุดจ่ายงานยาก (E Picking, SR, Piece Picking)
    const stationRes = await pool.query(`
      SELECT a.assignment_id, a.station_code, a.assigned_month, c.station_name, c.bonus_points, c.bonus_frequency, a.assigned_date, a.remark
      FROM kpi_employee_station_assignments a
      JOIN kpi_station_point_configs c ON a.station_code = c.station_code
      WHERE a.em_code = $1 AND a.period_id = $2;
    `, [emCode, period.period_id]);

    res.json({
      success: true,
      employee: summaryRes.rows[0],
      special_stations: stationRes.rows,
      timeline: transRes.rows
    });
  } catch (err) {
    console.error('Error fetching employee scorecard:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 3. API: ตัวเลือกเหตุผล Master Dropdown (แยก Positive [+] กับ Negative [-])
// ==============================================================================
app.get('/api/kpi/presets', async (req, res) => {
  try {
    const { point_type, dept } = req.query;
    let query = `SELECT * FROM kpi_manual_reason_presets WHERE is_active = TRUE`;
    const params = [];

    if (point_type) {
      params.push(point_type); // 'ADD' หรือ 'DEDUCT'
      query += ` AND point_type = $${params.length}`;
    }

    if (dept && dept !== 'ALL') {
      params.push(dept);
      query += ` AND (dept_scope = 'ALL' OR dept_scope = $${params.length})`;
    }

    query += ` ORDER BY point_type DESC, reason_name ASC;`;
    const result = await pool.query(query, params);

    res.json({
      success: true,
      presets: result.rows
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ส่งออกตารางเหตุผลมาตรฐานเป็น Excel (.xlsx)
app.get('/api/kpi/presets/export', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        reason_code as "รหัสเหตุผล",
        reason_name as "ชื่อเหตุผล",
        point_type as "ประเภทคะแนน (ADD/DEDUCT)",
        default_points as "คะแนนมาตรฐาน",
        dept_scope as "แผนกที่ใช้ได้ (ALL หรือ รหัสแผนก)",
        is_active as "สถานะใช้งาน (TRUE/FALSE)"
      FROM kpi_manual_reason_presets
      ORDER BY point_type DESC, reason_code ASC;
    `);

    const ws = xlsx.utils.json_to_sheet(result.rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Preset Reasons');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="KPI_Preset_Reasons.xlsx"; filename*=UTF-8\'\'KPI_Preset_Reasons.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('Export presets error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// นำเข้าตารางเหตุผลมาตรฐานจาก Excel (.xlsx)
app.post('/api/kpi/presets/import', upload.single('excel_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'กรุณาเลือกไฟล์ Excel (.xlsx) ที่ต้องการนำเข้า' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'ไม่พบข้อมูลในไฟล์ Excel' });
    }

    let importedCount = 0;
    for (const r of rows) {
      const code = (r['รหัสเหตุผล'] || r['reason_code'] || '').toString().trim();
      const name = (r['ชื่อเหตุผล'] || r['reason_name'] || '').toString().trim();
      const type = (r['ประเภทคะแนน (ADD/DEDUCT)'] || r['point_type'] || 'ADD').toString().trim().toUpperCase();
      const points = parseFloat(r['คะแนนมาตรฐาน'] || r['default_points'] || 0);
      const dept = (r['แผนกที่ใช้ได้ (ALL หรือ รหัสแผนก)'] || r['dept_scope'] || 'ALL').toString().trim();
      const active = (r['สถานะใช้งาน (TRUE/FALSE)'] !== undefined) ? (r['สถานะใช้งาน (TRUE/FALSE)'].toString().toUpperCase() === 'TRUE') : true;

      if (!code || !name) continue;

      await pool.query(`
        INSERT INTO kpi_manual_reason_presets (reason_code, reason_name, point_type, default_points, dept_scope, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (reason_code) DO UPDATE SET
          reason_name = EXCLUDED.reason_name,
          point_type = EXCLUDED.point_type,
          default_points = EXCLUDED.default_points,
          dept_scope = EXCLUDED.dept_scope,
          is_active = EXCLUDED.is_active;
      `, [code, name, type === 'DEDUCT' ? 'DEDUCT' : 'ADD', points, dept, active]);

      importedCount++;
    }

    // ลบไฟล์ชั่วคราวหลังนำเข้าเสร็จ
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `นำเข้าข้อมูลเหตุผลมาตรฐานสำเร็จเรียบร้อย (${importedCount} รายการ)`,
      imported_count: importedCount
    });
  } catch (err) {
    console.error('Import presets error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/presets', async (req, res) => {
  try {
    const { reason_code, reason_name, point_type, default_points, dept_scope } = req.body;
    const result = await pool.query(`
      INSERT INTO kpi_manual_reason_presets (reason_code, reason_name, point_type, default_points, dept_scope)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (reason_code) DO UPDATE SET
        reason_name = EXCLUDED.reason_name,
        point_type = EXCLUDED.point_type,
        default_points = EXCLUDED.default_points,
        dept_scope = EXCLUDED.dept_scope,
        is_active = TRUE
      RETURNING *;
    `, [reason_code, reason_name, point_type, default_points, dept_scope || 'ALL']);

    res.json({ success: true, preset: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/kpi/presets/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (/^\d+$/.test(id)) {
      await pool.query(`DELETE FROM kpi_manual_reason_presets WHERE reason_id = $1;`, [parseInt(id, 10)]);
    } else {
      await pool.query(`DELETE FROM kpi_manual_reason_presets WHERE reason_code = $1;`, [id]);
    }
    res.json({ success: true, message: 'ลบตัวเลือกเหตุผลมาตรฐานสำเร็จเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 4. API: ปรับคะแนน Manual (พร้อมอัปโหลดรูปหลักฐาน)
// ==============================================================================
app.post('/api/kpi/adjust', upload.single('evidence_photo'), async (req, res) => {
  try {
    const { period_id, em_code, point_type, points, reason_code, reason_description, created_by, transaction_date } = req.body;
    let attachment_url = null;
    if (req.file) {
      try {
        const fileBuf = fs.readFileSync(req.file.path);
        const mime = req.file.mimetype || 'image/jpeg';
        attachment_url = `data:${mime};base64,${fileBuf.toString('base64')}`;
      } catch (readErr) {
        attachment_url = `/uploads/${req.file.filename}`;
      }
    }

    if (!em_code) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงานเป้าหมาย' });
    }

    // 1. ตรวจสอบข้อมูลพนักงานเป้าหมาย
    const empRes = await pool.query(`
      SELECT id_emp, name_th, team, grp, COALESCE(team, grp, '-') as dept, position_name
      FROM employee_whc
      WHERE id_emp = $1;
    `, [em_code.trim()]);

    if (empRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: `ไม่พบข้อมูลพนักงานรหัส ${em_code} ในระบบ` });
    }
    const targetEmp = empRes.rows[0];

    // 2. ตรวจสอบสิทธิ์ของหัวหน้างาน (ผู้บันทึก) และดักการบวกลบคะแนนข้ามแผนก
    if (!created_by) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุข้อมูลผู้บันทึก (หัวหน้างาน)' });
    }

    const supRes = await pool.query(`
      SELECT u.id, u.username, u.fullname, u.role, e.team, e.grp, COALESCE(e.team, e.grp, '-') as dept, e.position_name
      FROM ${USERS_TABLE} u
      LEFT JOIN employee_whc e ON u.username = e.id_emp
      WHERE u.username = $1;
    `, [created_by.trim()]);

    if (supRes.rows.length > 0) {
      const supervisor = supRes.rows[0];
      const isGlobalAdmin = ['Admin', 'Executive'].includes(supervisor.role) || 
                            supervisor.team === 'WH' || 
                            supervisor.grp === 'WH';

      if (!isGlobalAdmin) {
        // ตรวจสอบว่าอยู่แผนก/กลุ่มเดียวกันหรือไม่
        const isSameDept = (
          (supervisor.grp && targetEmp.grp && supervisor.grp === targetEmp.grp) ||
          (supervisor.team && targetEmp.team && supervisor.team === targetEmp.team) ||
          (supervisor.dept && targetEmp.dept && supervisor.dept === targetEmp.dept)
        );

        if (!isSameDept) {
          const supDeptLabel = supervisor.dept || supervisor.grp || 'ไม่ระบุ';
          const empDeptLabel = targetEmp.dept || targetEmp.grp || 'ไม่ระบุ';
          return res.status(403).json({
            success: false,
            message: `ไม่อนุญาตให้บวกลบคะแนนข้ามแผนก: คุณ (${supervisor.fullname}) สังกัดแผนก "${supDeptLabel}" แต่พนักงานเป้าหมาย (${targetEmp.name_th}) สังกัดแผนก "${empDeptLabel}"`
          });
        }
      }
    }

    const period = period_id ? { period_id } : await scoringEngine.getActivePeriod();

    const transaction = await scoringEngine.recordManualAdjustment({
      period_id: period.period_id,
      em_code,
      point_type,
      points: parseFloat(points),
      reason_code,
      reason_description,
      attachment_url,
      created_by,
      transaction_date
    });

    res.json({
      success: true,
      message: 'บันทึกการปรับคะแนนเรียบร้อยแล้ว',
      transaction
    });
  } catch (err) {
    console.error('Error adjusting score:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 5. API: คำนวณคะแนนใหม่ (Manual Recalculate Trigger)
// ==============================================================================
app.post('/api/kpi/recalculate', async (req, res) => {
  try {
    const { em_code, dept_code } = req.body;
    const result = await scoringEngine.calculateScores({
      emCode: em_code,
      deptCode: dept_code
    });
    res.json({
      success: true,
      message: 'ประมวลผลคำนวณคะแนนสำเร็จ',
      result
    });
  } catch (err) {
    console.error('Error recalculating:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 6. API: จัดการรอบการประเมิน (Scoring Periods)
// ==============================================================================
app.get('/api/kpi/periods', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        period_id, 
        period_name, 
        TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
        TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, 
        initial_score, 
        is_active, 
        created_at 
      FROM kpi_scoring_periods 
      ORDER BY start_date DESC;
    `);
    res.json({ success: true, periods: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/periods', async (req, res) => {
  try {
    const { period_name, start_date, end_date, initial_score, is_active } = req.body;
    if (is_active) {
      // ถ้ารอบนี้เป็น Active ให้ปลด Active ของรอบอื่นออก
      await pool.query(`UPDATE kpi_scoring_periods SET is_active = FALSE;`);
    }
    const result = await pool.query(`
      INSERT INTO kpi_scoring_periods (period_name, start_date, end_date, initial_score, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `, [period_name, start_date, end_date, initial_score || 100.0, is_active !== false]);

    // สร้างนโยบายกลางตั้งต้นให้รอบใหม่นี้
    await pool.query(`
      INSERT INTO kpi_scoring_policies (period_id, dept_code, position_name, late_penalty_type, late_fixed_points, absent_penalty_points, unannounced_leave_points, sick_leave_points, weekly_holiday_bonus, weekly_off_days, public_holiday_bonus)
      VALUES ($1, 'GLOBAL', 'ALL', 'TIER', 1.0, 5.0, 3.0, 0.0, 2.0, 'SUN', 3.0)
      ON CONFLICT DO NOTHING;
    `, [result.rows[0].period_id]);

    res.json({ success: true, period: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.put('/api/kpi/periods/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { period_name, start_date, end_date, initial_score, is_active } = req.body;

    const check = await pool.query(`SELECT * FROM kpi_scoring_periods WHERE period_id = $1;`, [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรอบการประเมินนี้' });
    }

    if (is_active) {
      await pool.query(`UPDATE kpi_scoring_periods SET is_active = FALSE WHERE period_id != $1;`, [id]);
    }

    const result = await pool.query(`
      UPDATE kpi_scoring_periods
      SET 
        period_name = COALESCE($1, period_name),
        start_date = COALESCE($2, start_date),
        end_date = COALESCE($3, end_date),
        initial_score = COALESCE($4, initial_score),
        is_active = COALESCE($5, is_active)
      WHERE period_id = $6
      RETURNING 
        period_id, 
        period_name, 
        TO_CHAR(start_date, 'YYYY-MM-DD') as start_date, 
        TO_CHAR(end_date, 'YYYY-MM-DD') as end_date, 
        initial_score, 
        is_active, 
        created_at;
    `, [
      period_name || null, 
      start_date || null, 
      end_date || null, 
      initial_score !== undefined ? parseFloat(initial_score) : null, 
      is_active !== undefined ? is_active : null, 
      id
    ]);

    if (result.rows[0].is_active) {
      await scoringEngine.calculateScores();
    }

    res.json({ success: true, message: 'แก้ไขข้อมูลรอบการประเมินเรียบร้อย', period: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/kpi/periods/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const check = await client.query(`SELECT is_active, period_name FROM kpi_scoring_periods WHERE period_id = $1;`, [id]);
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรอบการประเมินนี้' });
    }
    const totalPeriods = await client.query(`SELECT COUNT(*) FROM kpi_scoring_periods;`);
    if (check.rows[0].is_active && parseInt(totalPeriods.rows[0].count, 10) > 1) {
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบรอบที่กำลังเปิดใช้งานอยู่ได้ กรุณาเปิดใช้งานรอบอื่นก่อนทำการลบ' });
    }

    await client.query('BEGIN');
    // ลบข้อมูลที่ผูกกับรอบนี้ทั้งหมดเพื่อความปลอดภัยสูงสุด
    await client.query(`DELETE FROM kpi_score_transactions WHERE period_id = $1;`, [id]);
    await client.query(`DELETE FROM kpi_employee_summary WHERE period_id = $1;`, [id]);
    await client.query(`DELETE FROM kpi_public_holidays WHERE period_id = $1;`, [id]);
    await client.query(`
      DELETE FROM kpi_late_tiers 
      WHERE policy_id IN (SELECT policy_id FROM kpi_scoring_policies WHERE period_id = $1);
    `, [id]);
    await client.query(`DELETE FROM kpi_scoring_policies WHERE period_id = $1;`, [id]);
    await client.query(`DELETE FROM kpi_scoring_periods WHERE period_id = $1;`, [id]);
    await client.query('COMMIT');

    res.json({ success: true, message: `ลบรอบการประเมิน "${check.rows[0].period_name}" และข้อมูลที่เกี่ยวข้องเรียบร้อยแล้ว` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

app.put('/api/kpi/periods/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`UPDATE kpi_scoring_periods SET is_active = FALSE;`);
    const r = await pool.query(`
      UPDATE kpi_scoring_periods 
      SET is_active = TRUE 
      WHERE period_id = $1 
      RETURNING *;
    `, [id]);
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรอบการประเมินนี้' });
    }
    res.json({ success: true, message: `เปิดใช้งานรอบ "${r.rows[0].period_name}" เรียบร้อยแล้ว`, period: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 7. API: จัดการเกณฑ์คะแนนตามแผนกและตำแหน่งงาน (Scoring Policies & Positions)
// ==============================================================================
app.get('/api/kpi/positions', async (req, res) => {
  try {
    const { dept } = req.query;
    let query = `
      SELECT DISTINCT 
        COALESCE(team, grp, 'OTHER') as dept,
        TRIM(REGEXP_REPLACE(position_name, '\\s+', ' ', 'g')) as position_name 
      FROM employee_whc 
      WHERE position_name IS NOT NULL AND TRIM(position_name) != ''
    `;
    const params = [];
    if (dept && dept !== 'GLOBAL' && dept !== 'ALL') {
      params.push(dept);
      query += ` AND COALESCE(team, grp, 'OTHER') = $1`;
    }
    query += ` ORDER BY dept ASC, position_name ASC;`;

    const r = await pool.query(query, params);
    res.json({ success: true, positions: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/kpi/policies', async (req, res) => {
  try {
    const period = await scoringEngine.getActivePeriod();
    const policies = await pool.query(`
      SELECT p.*,
        COALESCE(
          json_agg(
            json_build_object(
              'tier_id', t.tier_id,
              'min_minutes', t.min_minutes,
              'max_minutes', t.max_minutes,
              'deduct_points', t.deduct_points
            ) ORDER BY t.min_minutes
          ) FILTER (WHERE t.tier_id IS NOT NULL), '[]'
        ) as late_tiers
      FROM kpi_scoring_policies p
      LEFT JOIN kpi_late_tiers t ON p.policy_id = t.policy_id
      WHERE p.period_id = $1
      GROUP BY p.policy_id
      ORDER BY CASE WHEN p.dept_code = 'GLOBAL' THEN 0 ELSE 1 END, p.dept_code ASC, p.position_name ASC;
    `, [period.period_id]);

    res.json({ success: true, policies: policies.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/policies', async (req, res) => {
  try {
    const {
      period_id, dept_code, position_name, late_penalty_type, late_fixed_points,
      absent_penalty_points, unannounced_leave_points, sick_leave_points,
      weekly_holiday_bonus, weekly_off_days, public_holiday_bonus, late_tiers
    } = req.body;

    const period = period_id ? { period_id } : await scoringEngine.getActivePeriod();

    const policyRes = await pool.query(`
      INSERT INTO kpi_scoring_policies (
        period_id, dept_code, position_name, late_penalty_type, late_fixed_points,
        absent_penalty_points, unannounced_leave_points, sick_leave_points,
        weekly_holiday_bonus, weekly_off_days, public_holiday_bonus, is_enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
      ON CONFLICT (period_id, dept_code, position_name) DO UPDATE SET
        late_penalty_type = EXCLUDED.late_penalty_type,
        late_fixed_points = EXCLUDED.late_fixed_points,
        absent_penalty_points = EXCLUDED.absent_penalty_points,
        unannounced_leave_points = EXCLUDED.unannounced_leave_points,
        sick_leave_points = EXCLUDED.sick_leave_points,
        weekly_holiday_bonus = EXCLUDED.weekly_holiday_bonus,
        weekly_off_days = EXCLUDED.weekly_off_days,
        public_holiday_bonus = EXCLUDED.public_holiday_bonus
      RETURNING *;
    `, [
      period.period_id, dept_code, position_name || 'ALL', late_penalty_type || 'TIER', late_fixed_points || 1.0,
      absent_penalty_points || 5.0, unannounced_leave_points || 3.0, sick_leave_points || 0.0,
      weekly_holiday_bonus || 2.0, weekly_off_days || 'SUN', public_holiday_bonus || 3.0
    ]);

    const policyId = policyRes.rows[0].policy_id;

    // ถ้ามีการส่ง late_tiers มา ให้บันทึกทับ
    if (Array.isArray(late_tiers) && late_tiers.length > 0) {
      await pool.query(`DELETE FROM kpi_late_tiers WHERE policy_id = $1;`, [policyId]);
      for (const tier of late_tiers) {
        await pool.query(`
          INSERT INTO kpi_late_tiers (policy_id, min_minutes, max_minutes, deduct_points)
          VALUES ($1, $2, $3, $4);
        `, [policyId, tier.min_minutes, tier.max_minutes || null, tier.deduct_points]);
      }
    }

    // คำนวณคะแนนและซิงค์การหักแต้มใหม่ตามเกณฑ์ที่อัปเดตทันที
    await scoringEngine.calculateScores();

    res.json({ success: true, policy: policyRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/kpi/policies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query(`SELECT dept_code FROM kpi_scoring_policies WHERE policy_id = $1;`, [id]);
    if (check.rows.length > 0 && check.rows[0].dept_code === 'GLOBAL') {
      return res.status(400).json({ success: false, message: 'ไม่สามารถลบเกณฑ์มาตรฐานกลาง (Global) ได้' });
    }
    await pool.query(`DELETE FROM kpi_scoring_policies WHERE policy_id = $1;`, [id]);
    await scoringEngine.calculateScores();
    res.json({ success: true, message: 'ลบเกณฑ์สำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 7.2 API: จัดการเกณฑ์คะแนนตัดเกรด A, B, C, D (Grade Criteria Configuration)
// ==============================================================================
app.get('/api/kpi/grades', async (req, res) => {
  try {
    const configs = await scoringEngine.getSystemConfigs();
    res.json({
      success: true,
      grades: {
        grade_a_min: parseFloat(configs.GRADE_A_MIN_SCORE || 90.0),
        grade_b_min: parseFloat(configs.GRADE_B_MIN_SCORE || 80.0),
        grade_c_min: parseFloat(configs.GRADE_C_MIN_SCORE || 70.0),
        grade_d_max: parseFloat(configs.GRADE_D_MAX_SCORE || 69.9)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/grades', async (req, res) => {
  try {
    const { grade_a_min, grade_b_min, grade_c_min } = req.body;
    const a = parseFloat(grade_a_min);
    const b = parseFloat(grade_b_min);
    const c = parseFloat(grade_c_min);

    if (isNaN(a) || isNaN(b) || isNaN(c) || !(a > b && b > c)) {
      return res.status(400).json({ 
        success: false, 
        message: 'กรุณากรอกคะแนนเกรดให้ถูกต้อง โดย เกรด A ต้องมากกว่า เกรด B และ เกรด B ต้องมากกว่า เกรด C' 
      });
    }

    const dMax = (c - 0.1).toFixed(1);

    await pool.query(`
      INSERT INTO kpi_system_configs (config_key, config_value, description, updated_at)
      VALUES 
        ('GRADE_A_MIN_SCORE', $1, 'คะแนนขั้นต่ำสำหรับเกรด A (ดีเยี่ยม)', CURRENT_TIMESTAMP),
        ('GRADE_B_MIN_SCORE', $2, 'คะแนนขั้นต่ำสำหรับเกรด B (ดี)', CURRENT_TIMESTAMP),
        ('GRADE_C_MIN_SCORE', $3, 'คะแนนขั้นต่ำสำหรับเกรด C (ปานกลาง)', CURRENT_TIMESTAMP),
        ('GRADE_D_MAX_SCORE', $4, 'คะแนนต่ำกว่านี้เป็นเกรด D (ต้องปรับปรุง)', CURRENT_TIMESTAMP)
      ON CONFLICT (config_key) DO UPDATE SET
        config_value = EXCLUDED.config_value,
        updated_at = CURRENT_TIMESTAMP;
    `, [a.toString(), b.toString(), c.toString(), dMax.toString()]);

    // Recalculate summary scores and grades for all employees
    await scoringEngine.calculateScores();

    res.json({
      success: true,
      message: 'บันทึกเกณฑ์คะแนนตัดเกรดเรียบร้อย และคำนวณเกรดพนักงานทุกคนใหม่แล้ว',
      grades: {
        grade_a_min: a,
        grade_b_min: b,
        grade_c_min: c,
        grade_d_max: parseFloat(dMax)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 7.1 API: จัดการปฏิทินวันหยุดนักขัตฤกษ์ประจำปี (Public Holidays)
// ==============================================================================
app.get('/api/kpi/holidays', async (req, res) => {
  try {
    const period = await scoringEngine.getActivePeriod();
    const reqYear = req.query.year;
    
    let query = `
      SELECT holiday_id, period_id, holiday_year, TO_CHAR(holiday_date, 'YYYY-MM-DD') as holiday_date, holiday_name, description
      FROM kpi_public_holidays
      WHERE 1=1
    `;
    const params = [];
    if (reqYear && reqYear !== 'ALL') {
      params.push(parseInt(reqYear, 10));
      query += ` AND holiday_year = $${params.length}`;
    } else {
      params.push(period.period_id);
      query += ` AND period_id = $${params.length}`;
    }
    query += ` ORDER BY holiday_date ASC;`;

    const holidays = await pool.query(query, params);
    const policiesMap = await scoringEngine.getPolicies(period.period_id);
    const globalPolicy = scoringEngine.resolvePolicy(policiesMap, 'GLOBAL', 'ALL');
    const rawGlobalBonus = globalPolicy && globalPolicy.public_holiday_bonus !== undefined && globalPolicy.public_holiday_bonus !== null
      ? parseFloat(globalPolicy.public_holiday_bonus)
      : 3.0;
    const publicHolidayBonus = isNaN(rawGlobalBonus) ? 3.0 : rawGlobalBonus;
    const hasCustomDeptBonus = Object.values(policiesMap || {}).some(
      p => p.dept_code !== 'GLOBAL' && parseFloat(p.public_holiday_bonus) !== publicHolidayBonus
    );

    res.json({
      success: true,
      holidays: holidays.rows,
      public_holiday_bonus: publicHolidayBonus,
      has_custom_dept_bonus: hasCustomDeptBonus
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/holidays', async (req, res) => {
  try {
    const { holiday_date, holiday_name, holiday_year, description } = req.body;
    const period = await scoringEngine.getActivePeriod();
    if (!holiday_date || !holiday_name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุวันที่และชื่อวันหยุด' });
    }
    const computedYear = holiday_year ? parseInt(holiday_year, 10) : new Date(holiday_date).getFullYear();

    const result = await pool.query(`
      INSERT INTO kpi_public_holidays (period_id, holiday_date, holiday_year, holiday_name, description)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (period_id, holiday_date) DO UPDATE SET
        holiday_name = EXCLUDED.holiday_name,
        holiday_year = EXCLUDED.holiday_year,
        description = EXCLUDED.description
      RETURNING holiday_id, period_id, holiday_year, TO_CHAR(holiday_date, 'YYYY-MM-DD') as holiday_date, holiday_name, description;
    `, [period.period_id, holiday_date, computedYear, holiday_name, description || null]);

    await scoringEngine.calculateScores();
    res.json({ success: true, holiday: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/kpi/holidays/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM kpi_public_holidays WHERE holiday_id = $1;`, [id]);
    await scoringEngine.calculateScores();
    res.json({ success: true, message: 'ลบวันหยุดเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 8. API: ส่งออกรายงาน Excel (.xlsx)
// ==============================================================================
app.get('/api/kpi/export/excel', async (req, res) => {
  try {
    const { type } = req.query; // 'summary' หรือ 'transactions'
    const period = await scoringEngine.getActivePeriod();

    if (type === 'transactions') {
      // รายงาน Transaction Ledger แบบละเอียด
      const trans = await pool.query(`
        SELECT 
          t.transaction_id as "รหัสรายการ",
          t.em_code as "รหัสพนักงาน",
          e.name_th as "ชื่อ-นามสกุล",
          COALESCE(e.team, e.grp) as "แผนก/ทีม",
          e.position_name as "ตำแหน่ง",
          TO_CHAR(t.transaction_date, 'DD/MM/YYYY') as "วันที่เกิดเหตุ",
          t.source_type as "ที่มา",
          t.reason_description as "เหตุผล",
          t.points_change as "คะแนน (+/-)",
          t.created_by as "ผู้บันทึก",
          TO_CHAR(t.created_at, 'DD/MM/YYYY HH24:MI') as "วันเวลาที่บันทึก"
        FROM kpi_score_transactions t
        LEFT JOIN employee_whc e ON t.em_code = e.id_emp
        WHERE t.period_id = $1
        ORDER BY t.transaction_date DESC, t.created_at DESC;
      `, [period.period_id]);

      const ws = xlsx.utils.json_to_sheet(trans.rows);
      const wb = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(wb, ws, 'Transaction Log');
      const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const safeFilename = encodeURIComponent(`KPI_Transactions_${period.period_name}.xlsx`);
      res.setHeader('Content-Disposition', `attachment; filename="KPI_Transactions.xlsx"; filename*=UTF-8''${safeFilename}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    // รายงานสรุปรายคน (Default Summary)
    const summary = await pool.query(`
      SELECT 
        s.em_code as "รหัสพนักงาน",
        e.name_th as "ชื่อ-นามสกุล",
        COALESCE(e.team, e.grp, '-') as "แผนก/ทีม",
        e.position_name as "ตำแหน่ง",
        s.initial_score as "คะแนนตั้งต้น",
        s.total_deducted as "คะแนนหักรวม",
        s.total_added as "คะแนนบวกรวม",
        s.net_score as "คะแนนสุทธิ",
        s.current_grade as "เกรดผลงาน",
        TO_CHAR(s.last_recalculated, 'DD/MM/YYYY HH24:MI') as "คำนวณล่าสุด"
      FROM kpi_employee_summary s
      JOIN employee_whc e ON s.em_code = e.id_emp
      WHERE s.period_id = $1
      ORDER BY s.net_score DESC, s.em_code ASC;
    `, [period.period_id]);

    const ws = xlsx.utils.json_to_sheet(summary.rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'KPI Summary');
    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const safeFilename2 = encodeURIComponent(`KPI_Summary_${period.period_name}.xlsx`);
    res.setHeader('Content-Disposition', `attachment; filename="KPI_Summary.xlsx"; filename*=UTF-8''${safeFilename2}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// 9. API: ซิงค์ข้อมูล 2 ทางระหว่าง On-Premise (10.5.3.242) กับ Cloud (Supabase)
// ==============================================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', is_cloud: Boolean(pool.isCloudInstance), timestamp: new Date().toISOString() });
});

app.get('/api/kpi/sync/config', async (req, res) => {
  try {
    const config = await cloudSyncService.getSyncConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/sync/config', async (req, res) => {
  try {
    const config = await cloudSyncService.saveSyncConfig(req.body || {});
    res.json({
      success: true,
      message: 'บันทึกการตั้งค่า Cloud Sync (Supabase + Render) เรียบร้อยแล้ว',
      config
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/kpi/sync/test', async (req, res) => {
  try {
    const result = await cloudSyncService.testConnection(req.body?.supabase_db_url);
    res.json({
      success: true,
      message: `เชื่อมต่อ Supabase PostgreSQL สำเร็จ! (DB: ${result.database}, User: ${result.user})`,
      result
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'เชื่อมต่อไม่สำเร็จ: ' + err.message });
  }
});

app.post('/api/kpi/sync/now', async (req, res) => {
  try {
    const syncResult = await cloudSyncService.syncNow();
    res.json({
      success: true,
      ...syncResult
    });
  } catch (err) {
    console.error('Sync Now error:', err);
    res.status(500).json({ success: false, message: 'ซิงค์ข้อมูลไม่สำเร็จ: ' + err.message });
  }
});

// ==============================================================================
// 10. API: จัดการคุณสมบัติพิเศษ & ประจำจุดจ่ายงานยาก (Difficult Station Points)
// ==============================================================================

// 10.1 ดึงการตั้งค่าจุดจ่ายงานยากทั้งหมด
app.get('/api/kpi/stations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.*,
        (SELECT COUNT(*) FROM kpi_employee_station_assignments a WHERE a.station_code = s.station_code) as assigned_count
      FROM kpi_station_point_configs s
      ORDER BY s.station_id ASC;
    `);
    res.json({ success: true, stations: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10.2 บันทึก/แก้ไขการตั้งค่าจุดจ่ายงานยาก
app.post('/api/kpi/stations', async (req, res) => {
  try {
    const { station_code, station_name, bonus_points, bonus_frequency, is_active } = req.body;
    if (!station_code || !station_name) {
      return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสและชื่อจุดงานยาก' });
    }

    const code = station_code.trim().toUpperCase().replace(/\s+/g, '_');
    const points = parseFloat(bonus_points) || 10.0;
    const freq = bonus_frequency || 'PERIOD';
    const active = is_active !== false;

    await pool.query(`
      INSERT INTO kpi_station_point_configs (station_code, station_name, bonus_points, bonus_frequency, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (station_code) DO UPDATE SET
        station_name = EXCLUDED.station_name,
        bonus_points = EXCLUDED.bonus_points,
        bonus_frequency = EXCLUDED.bonus_frequency,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP;
    `, [code, station_name.trim(), points, freq, active]);

    // คำนวณคะแนนใหม่
    await scoringEngine.calculateScores();

    res.json({ success: true, message: 'บันทึกการตั้งค่าจุดจ่ายงานยากสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10.3 ลบการตั้งค่าจุดจ่ายงานยาก
app.delete('/api/kpi/stations/:stationCode', async (req, res) => {
  try {
    const { stationCode } = req.params;
    await pool.query(`DELETE FROM kpi_station_point_configs WHERE station_code = $1;`, [stationCode]);
    await scoringEngine.calculateScores();
    res.json({ success: true, message: 'ลบจุดจ่ายงานยากสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10.4 ดึงรายชื่อพนักงานที่ประจำจุดจ่ายงานยาก
app.get('/api/kpi/station-assignments', async (req, res) => {
  try {
    const { period_id } = req.query;
    const period = period_id ? { period_id: parseInt(period_id, 10) } : await scoringEngine.getActivePeriod();

    const startDate = new Date(period.start_date);
    const endDate = new Date(period.end_date);
    const currentDate = new Date();
    const effectiveDate = currentDate > endDate ? endDate : currentDate;
    let periodMonthsElapsed = (effectiveDate.getFullYear() - startDate.getFullYear()) * 12 + (effectiveDate.getMonth() - startDate.getMonth()) + 1;
    if (periodMonthsElapsed < 1) periodMonthsElapsed = 1;
    if (periodMonthsElapsed > 12) periodMonthsElapsed = 12;

    const result = await pool.query(`
      SELECT 
        a.assignment_id,
        a.period_id,
        a.em_code,
        e.name_th,
        COALESCE(e.team, e.grp, '-') as dept,
        e.team,
        e.grp,
        e.position_name,
        a.station_code,
        a.assigned_month,
        c.station_name,
        c.bonus_points,
        c.bonus_frequency,
        a.assigned_by,
        u.fullname as assigner_name,
        a.remark,
        TO_CHAR(a.assigned_date, 'YYYY-MM-DD') as assigned_date,
        a.created_at
      FROM kpi_employee_station_assignments a
      JOIN employee_whc e ON a.em_code = e.id_emp
      JOIN kpi_station_point_configs c ON a.station_code = c.station_code
      LEFT JOIN ${USERS_TABLE} u ON a.assigned_by = u.username
      WHERE a.period_id = $1
      ORDER BY a.created_at DESC;
    `, [period.period_id]);

    res.json({
      success: true,
      assignments: result.rows,
      period_id: period.period_id,
      period_months_elapsed: periodMonthsElapsed
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10.5 กำหนดพนักงานประจำจุดจ่ายงานยาก (พร้อมดักห้ามข้ามแผนก)
app.post('/api/kpi/station-assignments', async (req, res) => {
  try {
    const { period_id, em_code, station_code, assigned_month, assigned_by, remark } = req.body;
    if (!em_code || !station_code) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสพนักงานและจุดงานยาก' });
    }

    const period = period_id ? { period_id: parseInt(period_id, 10) } : await scoringEngine.getActivePeriod();

    // ตรวจสอบพนักงานเป้าหมาย
    const empRes = await pool.query(`
      SELECT id_emp, name_th, team, grp, COALESCE(team, grp, '-') as dept
      FROM employee_whc WHERE id_emp = $1;
    `, [em_code.trim()]);
    if (empRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรหัสพนักงานในระบบ' });
    }
    const emp = empRes.rows[0];

    // ตรวจสอบสิทธิ์ผู้กำหนดว่าข้ามแผนกหรือไม่
    if (assigned_by) {
      const supRes = await pool.query(`
        SELECT u.username, u.fullname, u.role, e.team, e.grp, COALESCE(e.team, e.grp, '-') as dept
        FROM ${USERS_TABLE} u
        LEFT JOIN employee_whc e ON u.username = e.id_emp
        WHERE u.username = $1;
      `, [assigned_by.trim()]);

      if (supRes.rows.length > 0) {
        const supervisor = supRes.rows[0];
        const isGlobalAdmin = ['Admin', 'Executive'].includes(supervisor.role) || 
                              supervisor.team === 'WH' || 
                              supervisor.grp === 'WH';

        if (!isGlobalAdmin) {
          const isSameDept = (
            (supervisor.grp && emp.grp && supervisor.grp === emp.grp) ||
            (supervisor.team && emp.team && supervisor.team === emp.team) ||
            (supervisor.dept && emp.dept && supervisor.dept === emp.dept)
          );
          if (!isSameDept) {
            return res.status(403).json({
              success: false,
              message: `ไม่อนุญาตให้กำหนดจุดงานยากข้ามแผนก: คุณ (${supervisor.fullname}) สังกัด "${supervisor.dept || supervisor.grp}" ไม่สามารถจัดการพนักงานสังกัด "${emp.dept || emp.grp}" ได้`
            });
          }
        }
      }
    }

    const month = assigned_month || 'ALL';

    await pool.query(`
      INSERT INTO kpi_employee_station_assignments (period_id, em_code, station_code, assigned_month, assigned_by, remark)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (period_id, em_code, station_code, assigned_month) DO UPDATE SET
        assigned_by = EXCLUDED.assigned_by,
        remark = EXCLUDED.remark,
        created_at = CURRENT_TIMESTAMP;
    `, [period.period_id, em_code.trim(), station_code.trim(), month, assigned_by || 'ADMIN', remark || null]);

    // คำนวณคะแนนใหม่ทันทีเพื่อให้คะแนนบวกอัตโนมัติแสดงผลทันที!
    await scoringEngine.calculateScores({ emCode: em_code.trim() });

    res.json({
      success: true,
      message: `บันทึกกำหนดพนักงาน (${emp.name_th}) ประจำจุดงานยากเรียบร้อยแล้ว (+คะแนนบวกอัตโนมัติรอบทุกเดือนแล้ว)`
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10.6 ยกเลิกพนักงานประจำจุดจ่ายงานยาก
app.delete('/api/kpi/station-assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const findRes = await pool.query(`SELECT em_code FROM kpi_employee_station_assignments WHERE assignment_id = $1;`, [id]);
    if (findRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'ไม่พบรายการที่ต้องการลบ' });
    }
    const emCode = findRes.rows[0].em_code;

    await pool.query(`DELETE FROM kpi_employee_station_assignments WHERE assignment_id = $1;`, [id]);
    await scoringEngine.calculateScores({ emCode });

    res.json({ success: true, message: 'ยกเลิกการประจำจุดจ่ายงานยากสำเร็จ (คำนวณคะแนนปรับปรุงใหม่แล้ว)' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==============================================================================
// Start Server
// ==============================================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Warelio KPI Portal is running on http://0.0.0.0:${PORT}`);
  console.log(`🌐 Mode: ${pool.isCloudInstance ? 'CLOUD (Render + Supabase)' : 'ON-PREMISE (Hybrid 2-DB Sync)'}`);
  console.log(`💻 Desktop Admin Portal: http://localhost:${PORT}`);
  console.log(`📱 Mobile PWA Portal:   http://localhost:${PORT}/mobile.html`);
  console.log(`====================================================`);
  cloudSyncService.restartBackgroundTimers();
});
