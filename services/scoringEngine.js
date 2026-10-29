const pool = require('../db');

/**
 * Scoring Engine for Employee KPI & Performance Evaluation
 */
class ScoringEngine {
  /**
   * ดึงรอบการประเมินที่กำลัง Active อยู่
   */
  async getActivePeriod() {
    const res = await pool.query(`
      SELECT * FROM kpi_scoring_periods 
      WHERE is_active = TRUE 
      ORDER BY start_date DESC 
      LIMIT 1;
    `);
    if (res.rows.length === 0) {
      // ถ้ายังไม่มี ให้สร้างรอบปีปัจจุบัน 2026 อัตโนมัติ
      const insert = await pool.query(`
        INSERT INTO kpi_scoring_periods (period_name, start_date, end_date, initial_score, is_active)
        VALUES ('รอบประเมินประจำปี 2026', '2026-01-01', '2026-12-31', 100.00, TRUE)
        RETURNING *;
      `);
      return insert.rows[0];
    }
    return res.rows[0];
  }

  /**
   * ดึงนโยบายคะแนนทั้งหมดของรอบ (Global + Department Overrides + Late Tiers)
   */
  async getPolicies(periodId) {
    const policiesRes = await pool.query(`
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
      WHERE p.period_id = $1 AND p.is_enabled = TRUE
      GROUP BY p.policy_id;
    `, [periodId]);

    const policiesMap = {};
    for (const pol of policiesRes.rows) {
      const key = `${pol.dept_code}:::${pol.position_name || 'ALL'}`;
      policiesMap[key] = pol;
    }
    return policiesMap;
  }

  /**
   * หาเกณฑ์ของพนักงานแบบลำดับชั้น (Hierarchical Resolution):
   * 1. แผนก + ตำแหน่งเฉพาะ (Specific Dept + Specific Position)
   * 2. ตำแหน่งเฉพาะในเกณฑ์กลาง (GLOBAL + Specific Position)
   * 3. แผนกเฉพาะ (Specific Dept + ALL positions)
   * 4. เกณฑ์มาตรฐานกลาง (GLOBAL + ALL)
   */
  resolvePolicy(policiesMap, deptCode, positionName) {
    const cleanPos = (positionName || '').trim();
    if (deptCode && cleanPos && policiesMap[`${deptCode}:::${cleanPos}`]) {
      return policiesMap[`${deptCode}:::${cleanPos}`];
    }
    if (cleanPos && policiesMap[`GLOBAL:::${cleanPos}`]) {
      return policiesMap[`GLOBAL:::${cleanPos}`];
    }
    if (deptCode && policiesMap[`${deptCode}:::ALL`]) {
      return policiesMap[`${deptCode}:::ALL`];
    }
    return policiesMap['GLOBAL:::ALL'] || {
      late_penalty_type: 'TIER',
      late_fixed_points: 1.0,
      absent_penalty_points: 5.0,
      unannounced_leave_points: 3.0,
      sick_leave_points: 0.0,
      weekly_holiday_bonus: 2.0,
      weekly_off_days: 'SUN',
      public_holiday_bonus: 3.0,
      late_tiers: [
        { min_minutes: 1, max_minutes: 15, deduct_points: 1.0 },
        { min_minutes: 16, max_minutes: 30, deduct_points: 2.0 },
        { min_minutes: 31, max_minutes: null, deduct_points: 3.0 }
      ]
    };
  }

  /**
   * คำนวณตัดเกรดจากคะแนนสุทธิ
   */
  calculateGrade(netScore, configs = {}) {
    const aMin = parseFloat(configs.GRADE_A_MIN_SCORE || 90.0);
    const bMin = parseFloat(configs.GRADE_B_MIN_SCORE || 80.0);
    const cMin = parseFloat(configs.GRADE_C_MIN_SCORE || 70.0);

    if (netScore >= aMin) return 'A';
    if (netScore >= bMin) return 'B';
    if (netScore >= cMin) return 'C';
    return 'D';
  }

  /**
   * ดึง Configs ของระบบ
   */
  async getSystemConfigs() {
    const res = await pool.query('SELECT config_key, config_value FROM kpi_system_configs;');
    const configs = {};
    for (const row of res.rows) {
      configs[row.config_key] = row.config_value;
    }
    return configs;
  }

  /**
   * ซิงค์การหักคะแนนอัตโนมัติจากวันลาป่วย (Sick Leave Auto-Deductions) จาก tb_manpower_data
   */
  async syncSickLeaveDeductions(period, policiesMap, options = {}) {
    try {
      const periodId = period.period_id;
      let query = `
        SELECT 
          m.id_emp, 
          m.date_plan,
          TO_DATE(m.date_plan, 'DD/MM/YYYY') as trans_date,
          COALESCE(m.remark, '') as remark,
          e.team, e.grp, e.position_name
        FROM tb_manpower_data m
        JOIN employee_whc e ON m.id_emp = e.id_emp
        WHERE m.status = 'ป่วย'
          AND m.date_plan ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
          AND TO_DATE(m.date_plan, 'DD/MM/YYYY') BETWEEN $1 AND $2
      `;
      const params = [period.start_date, period.end_date];
      if (options.emCode) {
        params.push(options.emCode);
        query += ` AND m.id_emp = $${params.length}`;
      }
      query += ` ORDER BY trans_date ASC;`;

      // ตรวจสอบว่าตาราง tb_manpower_data มีข้อมูลอยู่หรือไม่ (ป้องกันกรณีรันบน Cloud ที่อาจยังไม่ได้ซิงค์ตารางดิบ)
      const mpCountRes = await pool.query(`SELECT COUNT(*)::int as cnt FROM tb_manpower_data WHERE status = 'ป่วย';`).catch(() => ({ rows: [{ cnt: 0 }] }));
      const hasManpowerTableData = (mpCountRes.rows[0]?.cnt || 0) > 0;
      if (!hasManpowerTableData && pool.isCloudInstance) {
        return;
      }

      const sickRows = await pool.query(query, params);

      // ตรวจสอบ Unique Constraint เพื่อป้องกัน duplicate
      await pool.query(`
        ALTER TABLE kpi_score_transactions 
        ADD CONSTRAINT uq_kpi_trans_period_sync UNIQUE (period_id, cloud_sync_id);
      `).catch(() => {});

      const activeSyncIds = [];
      const upsertRows = [];

      for (const row of sickRows.rows) {
        const emCode = row.id_emp;
        const deptCode = row.team || row.grp || 'GENERAL';
        const policy = this.resolvePolicy(policiesMap, deptCode, row.position_name);
        const sickRate = parseFloat(policy.sick_leave_points > 0 ? policy.sick_leave_points : (policy.unannounced_leave_points || 0));

        const datePlan = row.date_plan; // 'DD/MM/YYYY'
        const syncId = `AUTO_SICK_${emCode}_${datePlan.split('/').join('')}`;
        activeSyncIds.push(syncId);

        const deductPoints = -Math.abs(sickRate);
        const desc = `ลาป่วย (Auto Deduct: ${datePlan})${row.remark ? ' - ' + row.remark : ''}`;
        upsertRows.push({
          periodId,
          emCode,
          transDate: row.trans_date,
          desc,
          deductPoints,
          syncId
        });
      }

      const chunkSize = 80;
      for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const chunk = upsertRows.slice(i, i + chunkSize);
        const vals = [];
        const placeholders = chunk.map((item, idx) => {
          const base = idx * 6;
          vals.push(item.periodId, item.emCode, item.transDate, item.desc, item.deductPoints, item.syncId);
          return `($${base + 1}, $${base + 2}, $${base + 3}, 'AUTO', 'SICK_LEAVE', $${base + 4}, $${base + 5}, 'SYSTEM', CURRENT_TIMESTAMP, $${base + 6})`;
        }).join(', ');

        await pool.query(`
          INSERT INTO kpi_score_transactions (
            period_id, em_code, transaction_date, source_type,
            reason_code, reason_description, points_change,
            created_by, created_at, cloud_sync_id
          )
          VALUES ${placeholders}
          ON CONFLICT (period_id, cloud_sync_id) DO UPDATE SET
            points_change = EXCLUDED.points_change,
            reason_description = EXCLUDED.reason_description;
        `, vals);
      }

      // ลบรายการที่ถูกยกเลิกสถานะป่วยออกไป
      if (options.emCode) {
        if (activeSyncIds.length > 0) {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND em_code = $2 AND reason_code = 'SICK_LEAVE' AND source_type = 'AUTO'
              AND cloud_sync_id NOT IN (${activeSyncIds.map((_, i) => `$${i + 3}`).join(',')});
          `, [periodId, options.emCode, ...activeSyncIds]);
        } else {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND em_code = $2 AND reason_code = 'SICK_LEAVE' AND source_type = 'AUTO';
          `, [periodId, options.emCode]);
        }
      } else {
        if (activeSyncIds.length > 0) {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND reason_code = 'SICK_LEAVE' AND source_type = 'AUTO'
              AND cloud_sync_id NOT IN (${activeSyncIds.map((_, i) => `$${i + 2}`).join(',')});
          `, [periodId, ...activeSyncIds]);
        } else {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND reason_code = 'SICK_LEAVE' AND source_type = 'AUTO';
          `, [periodId]);
        }
      }
    } catch (err) {
      console.error('Error syncing sick leave deductions:', err);
    }
  }

  /**
   * ซิงค์การบวกคะแนนอัตโนมัติเมื่อมาทำงานในวันหยุดนักขัตฤกษ์ (Public Holiday Working Bonus)
   */
  async syncPublicHolidayBonuses(period, policiesMap, options = {}) {
    try {
      const periodId = period.period_id;
      let query = `
        SELECT DISTINCT ON (m.id_emp, m.date_plan)
          m.id_emp,
          m.date_plan,
          TO_DATE(m.date_plan, 'DD/MM/YYYY') as trans_date,
          h.holiday_name,
          e.team, e.grp, e.position_name
        FROM tb_manpower_data m
        JOIN employee_whc e ON m.id_emp = e.id_emp
        JOIN kpi_public_holidays h
          ON m.date_plan = TO_CHAR(h.holiday_date, 'DD/MM/YYYY')
          AND h.period_id = $1
        WHERE m.status IN ('ทำงาน', 'มาทำงาน', 'มาสาย', 'สาย', 'WFH', 'นอกสถานที่', 'ร่มเกล้า')
          AND m.date_plan ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
          AND h.holiday_date BETWEEN $2 AND $3
          AND h.holiday_date <= CURRENT_DATE
      `;
      const params = [periodId, period.start_date, period.end_date];
      if (options.emCode) {
        params.push(options.emCode);
        query += ` AND m.id_emp = $${params.length}`;
      }
      query += ` ORDER BY m.id_emp, m.date_plan, trans_date ASC;`;

      const mpWorkCountRes = await pool.query(`
        SELECT COUNT(*)::int as cnt FROM tb_manpower_data
        WHERE status IN ('ทำงาน', 'มาทำงาน', 'มาสาย', 'สาย', 'WFH', 'นอกสถานที่', 'ร่มเกล้า');
      `).catch(() => ({ rows: [{ cnt: 0 }] }));
      const hasManpowerWorkData = (mpWorkCountRes.rows[0]?.cnt || 0) > 0;
      if (!hasManpowerWorkData && pool.isCloudInstance) {
        const globalPol = this.resolvePolicy(policiesMap, 'GLOBAL', 'ALL');
        const globalBonus = Math.abs(parseFloat(globalPol.public_holiday_bonus !== undefined ? globalPol.public_holiday_bonus : 3.0));
        await pool.query(`
          UPDATE kpi_score_transactions
          SET points_change = $1
          WHERE period_id = $2 AND reason_code = 'PUBLIC_HOLIDAY_WORK' AND source_type = 'AUTO';
        `, [globalBonus, periodId]).catch(() => {});
        return;
      }

      const workRows = await pool.query(query, params);

      await pool.query(`
        ALTER TABLE kpi_score_transactions 
        ADD CONSTRAINT uq_kpi_trans_period_sync UNIQUE (period_id, cloud_sync_id);
      `).catch(() => {});

      const activeSyncIds = [];
      const upsertRows = [];

      for (const row of workRows.rows) {
        const emCode = row.id_emp;
        const deptCode = row.team || row.grp || 'GENERAL';
        const policy = this.resolvePolicy(policiesMap, deptCode, row.position_name);
        const bonusRate = parseFloat(
          policy.public_holiday_bonus !== undefined && policy.public_holiday_bonus !== null
            ? policy.public_holiday_bonus
            : 3.0
        );

        const datePlan = row.date_plan; // 'DD/MM/YYYY'
        const syncId = `AUTO_PUB_HOL_${emCode}_${datePlan.split('/').join('')}`;
        activeSyncIds.push(syncId);

        const bonusPoints = Math.abs(isNaN(bonusRate) ? 3.0 : bonusRate);
        const desc = `มาทำงานวันหยุดนักขัตฤกษ์ (Auto Bonus: ${datePlan} - ${row.holiday_name})`;
        upsertRows.push({
          periodId,
          emCode,
          transDate: row.trans_date,
          desc,
          bonusPoints,
          syncId
        });
      }

      const chunkSize = 80;
      for (let i = 0; i < upsertRows.length; i += chunkSize) {
        const chunk = upsertRows.slice(i, i + chunkSize);
        const vals = [];
        const placeholders = chunk.map((item, idx) => {
          const base = idx * 6;
          vals.push(item.periodId, item.emCode, item.transDate, item.desc, item.bonusPoints, item.syncId);
          return `($${base + 1}, $${base + 2}, $${base + 3}, 'AUTO', 'PUBLIC_HOLIDAY_WORK', $${base + 4}, $${base + 5}, 'SYSTEM', CURRENT_TIMESTAMP, $${base + 6})`;
        }).join(', ');

        await pool.query(`
          INSERT INTO kpi_score_transactions (
            period_id, em_code, transaction_date, source_type,
            reason_code, reason_description, points_change,
            created_by, created_at, cloud_sync_id
          )
          VALUES ${placeholders}
          ON CONFLICT (period_id, cloud_sync_id) DO UPDATE SET
            points_change = EXCLUDED.points_change,
            reason_description = EXCLUDED.reason_description;
        `, vals);
      }

      // ลบรายการวันหยุดนักขัตฤกษ์ที่ถูกลบหรือยกเลิกสถานะมาทำงานออกไป
      if (options.emCode) {
        if (activeSyncIds.length > 0) {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND em_code = $2 AND reason_code = 'PUBLIC_HOLIDAY_WORK' AND source_type = 'AUTO'
              AND cloud_sync_id NOT IN (${activeSyncIds.map((_, i) => `$${i + 3}`).join(',')});
          `, [periodId, options.emCode, ...activeSyncIds]);
        } else {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND em_code = $2 AND reason_code = 'PUBLIC_HOLIDAY_WORK' AND source_type = 'AUTO';
          `, [periodId, options.emCode]);
        }
      } else {
        if (activeSyncIds.length > 0) {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND reason_code = 'PUBLIC_HOLIDAY_WORK' AND source_type = 'AUTO'
              AND cloud_sync_id NOT IN (${activeSyncIds.map((_, i) => `$${i + 2}`).join(',')});
          `, [periodId, ...activeSyncIds]);
        } else {
          await pool.query(`
            DELETE FROM kpi_score_transactions
            WHERE period_id = $1 AND reason_code = 'PUBLIC_HOLIDAY_WORK' AND source_type = 'AUTO';
          `, [periodId]);
        }
      }
    } catch (err) {
      console.error('Error syncing public holiday bonuses:', err);
    }
  }

  /**
   * คำนวณคะแนนพนักงานทุกคน หรือเฉพาะเงื่อนไขที่ระบุ (Recalculate Engine)
   */
  async calculateScores(options = {}) {
    const period = options.period || await this.getActivePeriod();
    const periodId = period.period_id;
    const initialScore = parseFloat(period.initial_score || 100.0);
    const policiesMap = await this.getPolicies(periodId);
    const configs = await this.getSystemConfigs();

    // 0. ซิงค์การหักคะแนนอัตโนมัติจากวันลาป่วย (Sick Leave Auto-Deductions) และบวกคะแนนมาทำงานวันหยุดนักขัตฤกษ์ (Public Holiday Working Bonus)
    await this.syncSickLeaveDeductions(period, policiesMap, options);
    await this.syncPublicHolidayBonuses(period, policiesMap, options);

    // 1. ดึงรายชื่อพนักงานทั้งหมดจาก employee_whc
    let empQuery = `SELECT id_emp, name_th, position_name, team, grp FROM employee_whc WHERE id_emp IS NOT NULL`;
    const empParams = [];
    if (options.emCode) {
      empParams.push(options.emCode);
      empQuery += ` AND id_emp = $${empParams.length}`;
    }
    if (options.deptCode) {
      empParams.push(options.deptCode);
      empQuery += ` AND (team = $${empParams.length} OR grp = $${empParams.length})`;
    }
    empQuery += ` ORDER BY id_emp;`;
    const empRes = await pool.query(empQuery, empParams);

    // 2. ดึงแต้มพิเศษตามตำแหน่ง (Position Points)
    const posPointsRes = await pool.query(`SELECT * FROM kpi_position_points WHERE is_active = TRUE;`);
    const posPointsMap = {};
    for (const r of posPointsRes.rows) {
      posPointsMap[r.position_code] = r;
    }

    // 2.1 ดึงแต้มคะแนนคุณสมบัติพิเศษ ประจำจุดจ่ายงานยาก (Difficult Station Points & Assignments)
    const stationConfigsRes = await pool.query(`SELECT * FROM kpi_station_point_configs WHERE is_active = TRUE;`);
    const stationConfigsMap = {};
    for (const r of stationConfigsRes.rows) {
      stationConfigsMap[r.station_code] = r;
    }

    // คำนวณจำนวนเดือนที่ผ่านมาในรอบประเมินนี้ (Months Elapsed in Period)
    const startDate = new Date(period.start_date);
    const endDate = new Date(period.end_date);
    const currentDate = new Date();
    const effectiveDate = currentDate > endDate ? endDate : currentDate;
    let periodMonthsElapsed = (effectiveDate.getFullYear() - startDate.getFullYear()) * 12 + (effectiveDate.getMonth() - startDate.getMonth()) + 1;
    if (periodMonthsElapsed < 1) periodMonthsElapsed = 1;
    if (periodMonthsElapsed > 12) periodMonthsElapsed = 12;

    const stationAssignRes = await pool.query(`
      SELECT em_code, station_code, assigned_month, assigned_date 
      FROM kpi_employee_station_assignments 
      WHERE period_id = $1;
    `, [periodId]);
    const empStationMap = {};
    for (const r of stationAssignRes.rows) {
      if (!empStationMap[r.em_code]) empStationMap[r.em_code] = [];
      empStationMap[r.em_code].push(r);
    }

    // 3. ดึง Manual Transactions ทั้งหมดในรอบนี้
    const manualTransRes = await pool.query(`
      SELECT em_code, 
        SUM(CASE WHEN points_change > 0 THEN points_change ELSE 0 END) as manual_added,
        SUM(CASE WHEN points_change < 0 THEN ABS(points_change) ELSE 0 END) as manual_deducted
      FROM kpi_score_transactions
      WHERE period_id = $1
      GROUP BY em_code;
    `, [periodId]);
    const manualMap = {};
    for (const r of manualTransRes.rows) {
      manualMap[r.em_code] = {
        added: parseFloat(r.manual_added || 0),
        deducted: parseFloat(r.manual_deducted || 0)
      };
    }

    const results = [];

    // 4. วนลูปคำนวณคะแนนแต่ละคน
    for (const emp of empRes.rows) {
      const emCode = emp.id_emp;
      const deptCode = emp.team || emp.grp || 'GENERAL';
      const policy = this.resolvePolicy(policiesMap, deptCode, emp.position_name);

      let autoDeducted = 0;
      let autoAdded = 0;

      // แต้มพิเศษตามตำแหน่งงาน
      if (emp.position_name && posPointsMap[emp.position_name]) {
        const posBonus = posPointsMap[emp.position_name];
        if (posBonus.bonus_type === 'ANNUAL') {
          autoAdded += parseFloat(posBonus.bonus_points);
        } else if (posBonus.bonus_type === 'MONTHLY') {
          autoAdded += parseFloat(posBonus.bonus_points) * periodMonthsElapsed;
        }
      }

      // แต้มพิเศษคุณสมบัติพิเศษ ประจำจุดจ่ายงานยาก (E Picking, SR, Piece Picking) - บวกคะแนนเป็นรอบทุกเดือน
      if (empStationMap[emCode]) {
        for (const assign of empStationMap[emCode]) {
          const stConfig = stationConfigsMap[assign.station_code];
          if (stConfig) {
            const pts = parseFloat(stConfig.bonus_points || 0);
            if (stConfig.bonus_frequency === 'MONTHLY') {
              if (assign.assigned_month === 'ALL' || !assign.assigned_month) {
                // รอบประจำทุกเดือน: บวกคะแนนสะสมตามจำนวนเดือนที่ผ่านมาในรอบประเมิน
                autoAdded += pts * periodMonthsElapsed;
              } else {
                // เฉพาะเดือนที่ระบุ: บวกคะแนนประจำ 1 เดือนนั้น
                autoAdded += pts;
              }
            } else {
              // 'PERIOD' หรือค่าต่อรอบการประเมิน
              autoAdded += pts;
            }
          }
        }
      }

      // แต้ม Manual
      const manual = manualMap[emCode] || { added: 0, deducted: 0 };

      // ยอดรวม
      const totalDeducted = autoDeducted + manual.deducted;
      const totalAdded = autoAdded + manual.added;
      const netScore = Math.max(0, initialScore - totalDeducted + totalAdded);
      const grade = this.calculateGrade(netScore, configs);

      results.push({
        period_id: periodId,
        em_code: emCode,
        name_th: emp.name_th,
        position_name: emp.position_name,
        team: deptCode,
        initial_score: initialScore,
        total_deducted: totalDeducted,
        total_added: totalAdded,
        net_score: netScore,
        current_grade: grade
      });
    }

    // บันทึกลงตาราง kpi_employee_summary แบบ Batch Chunk
    const sumChunkSize = 80;
    for (let i = 0; i < results.length; i += sumChunkSize) {
      const chunk = results.slice(i, i + sumChunkSize);
      const vals = [];
      const placeholders = chunk.map((r, idx) => {
        const base = idx * 8;
        vals.push(r.period_id, r.em_code, r.team, r.initial_score, r.total_deducted, r.total_added, r.net_score, r.current_grade);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, CURRENT_TIMESTAMP)`;
      }).join(', ');

      await pool.query(`
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
          last_recalculated = CURRENT_TIMESTAMP;
      `, vals);
    }

    return {
      period: period.period_name,
      total_employees_processed: results.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * บันทึกรายการปรับคะแนน Manual
   */
  async recordManualAdjustment(data) {
    const { period_id, em_code, point_type, points, reason_code, reason_description, attachment_url, created_by } = data;
    
    // กำหนดเครื่องหมายคะแนน (+ หรือ -)
    const signedPoints = point_type === 'DEDUCT' ? -Math.abs(parseFloat(points)) : Math.abs(parseFloat(points));
    const originPrefix = pool.isCloudInstance ? 'CLOUD' : 'LOCAL';
    const syncId = data.cloud_sync_id || `${originPrefix}_MANUAL_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // ขยายคอลัมน์ attachment_url ให้เป็น TEXT เพื่อรองรับรูป Base64 ข้าม Cloud/Local
    await pool.query(`ALTER TABLE kpi_score_transactions ALTER COLUMN attachment_url TYPE TEXT;`).catch(() => {});

    const insertTrans = await pool.query(`
      INSERT INTO kpi_score_transactions (
        period_id, em_code, transaction_date, source_type,
        reason_code, reason_description, points_change,
        attachment_url, created_by, created_at, cloud_sync_id
      )
      VALUES ($1, $2, CURRENT_DATE, 'MANUAL', $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8)
      RETURNING *;
    `, [period_id, em_code, reason_code, reason_description, signedPoints, attachment_url, created_by || 'SUPERVISOR', syncId]);

    // คำนวณสรุปคะแนนของพนักงานคนนี้ใหม่ทันที
    await this.calculateScores({ emCode: em_code });

    return insertTrans.rows[0];
  }
}

module.exports = new ScoringEngine();
