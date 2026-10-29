// Global state
let currentSummaryData = [];
let allEmployeesMaster = [];
let allPresets = [];
let currentPointType = 'ADD';
let desktopCurrentUser = null;

// Initialize: บังคับให้ล็อกอินใหม่ทุกครั้งที่เปิดเข้าหน้าเว็บหลัก (ยกเว้นหน้า mobile.html)
document.addEventListener('DOMContentLoaded', () => {
  initDesktopUser();
});

function loadAllDashboardData() {
  loadSummaryData();
  loadEmployees();
  loadPresets();
  loadPeriods();
  loadPolicies();
  loadPositions();
}

// --- Supervisor Authentication & Context (Desktop) ---
function initDesktopUser() {
  // ล้างสถานะเดิมเพื่อให้ทุกครั้งที่เข้าหน้าเว็บหลักต้องล็อกอินก่อนเสมอ
  desktopCurrentUser = null;
  localStorage.removeItem('warelio_supervisor_user');
  renderDesktopUserHeader();
  openLoginModal();
}

function renderDesktopUserHeader() {
  const container = document.getElementById('desktopUserHeader');
  if (!container) return;

  if (desktopCurrentUser) {
    const deptStr = desktopCurrentUser.dept || desktopCurrentUser.grp ? ` • แผนก ${desktopCurrentUser.dept || desktopCurrentUser.grp}` : '';
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; background: #EEF2FF; border: 1.5px solid #C7D2FE; padding: 5px 12px; border-radius: 20px; font-size: 13px;">
        <i class="fa-solid fa-circle-user" style="color: #4F46E5; font-size: 16px;"></i>
        <div>
          <strong style="color: #3730A3;">${desktopCurrentUser.fullname || desktopCurrentUser.username}</strong>
          <span style="font-size: 11px; color: #4338CA; margin-left: 4px;">(${desktopCurrentUser.role}${deptStr})</span>
        </div>
        <button onclick="handleDesktopLogout()" title="ออกจากระบบ" style="border: none; background: none; color: #EF4444; cursor: pointer; padding: 2px 4px; font-size: 13px; margin-left: 4px;">
          <i class="fa-solid fa-arrow-right-from-bracket"></i>
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn btn-outline" onclick="openLoginModal()" style="border: 1.5px solid #4F46E5; color: #4F46E5; background: #EEF2FF; font-weight: 600; padding: 6px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;">
        <i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบหัวหน้างาน
      </button>
    `;
  }
}

function openLoginModal() {
  const errBox = document.getElementById('desktopLoginError');
  if (errBox) errBox.style.display = 'none';
  const closeBtn = document.getElementById('btnCloseLoginModal');
  const cancelBtn = document.getElementById('btnCancelLoginModal');
  if (closeBtn) closeBtn.style.display = desktopCurrentUser ? 'block' : 'none';
  if (cancelBtn) cancelBtn.style.display = desktopCurrentUser ? 'inline-flex' : 'none';
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.add('active');
  setTimeout(() => {
    const userInp = document.getElementById('desktopLoginUsername');
    if (userInp) userInp.focus();
  }, 100);
}

function closeLoginModal() {
  // ห้ามปิดหน้าต่าง Login หากยังไม่ได้เข้าสู่ระบบ
  if (!desktopCurrentUser) return;
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.remove('active');
}

async function handleDesktopLogin(event) {
  event.preventDefault();
  const u = (document.getElementById('desktopLoginUsername').value || '').trim();
  const p = document.getElementById('desktopLoginPassword').value;
  const errBox = document.getElementById('desktopLoginError');
  const btn = document.getElementById('btnDesktopLoginSubmit');

  try {
    btn.disabled = true;
    btn.innerText = 'กำลังเข้าสู่ระบบ...';
    errBox.style.display = 'none';

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';

    if (!json.success) {
      errBox.innerText = json.message || 'เข้าสู่ระบบไม่สำเร็จ';
      errBox.style.display = 'block';
      return;
    }

    desktopCurrentUser = json.user;
    renderDesktopUserHeader();
    closeLoginModal();

    loadAllDashboardData();
    updateModalSupervisorBar();
    onAdjustEmpSelected();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> เข้าสู่ระบบ';
    errBox.innerText = 'เกิดข้อผิดพลาด: ' + err.message;
    errBox.style.display = 'block';
  }
}

function handleDesktopLogout() {
  if (confirm('คุณต้องการออกจากระบบใช่หรือไม่?')) {
    desktopCurrentUser = null;
    localStorage.removeItem('warelio_supervisor_user');
    const tbody = document.getElementById('leaderboardBody');
    if (tbody) tbody.innerHTML = '';
    const form = document.getElementById('desktopLoginForm');
    if (form) form.reset();
    renderDesktopUserHeader();
    updateModalSupervisorBar();
    openLoginModal();
  }
}

function updateModalSupervisorBar() {
  const nameEl = document.getElementById('modalSupervisorName');
  if (!nameEl) return;
  if (desktopCurrentUser) {
    const deptStr = desktopCurrentUser.dept || desktopCurrentUser.grp ? ` [แผนก ${desktopCurrentUser.dept || desktopCurrentUser.grp}]` : '';
    nameEl.innerText = `${desktopCurrentUser.fullname || desktopCurrentUser.username} (${desktopCurrentUser.role})${deptStr}`;
    nameEl.style.color = '#3730A3';
  } else {
    nameEl.innerHTML = `<span style="color: #DC2626;">ยังไม่ได้เข้าสู่ระบบ (คลิก "สลับบัญชี" เพื่อล็อกอิน)</span>`;
  }
}

// Switch Sidebar Tabs
function switchTab(tabName) {
  const views = ['viewDashboard', 'viewTransactions', 'viewPolicies', 'viewPeriods', 'viewPresets', 'viewHolidays', 'viewStations'];
  views.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = 'none';
  });

  const links = document.querySelectorAll('.nav-link');
  links.forEach(l => l.classList.remove('active'));

  const activeLink = document.querySelector(`a[onclick="switchTab('${tabName}')"]`);
  if (activeLink) activeLink.classList.add('active');

  if (tabName === 'dashboard') {
    document.getElementById('viewDashboard').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'แดชบอร์ดสรุปคะแนนพนักงาน & KPI';
    loadSummaryData();
  } else if (tabName === 'transactions') {
    document.getElementById('viewTransactions').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'ประวัติคะแนนและการหักคะแนนรายบุคคล (Transactions Ledger)';
    populateTxDropdown();
  } else if (tabName === 'policies') {
    document.getElementById('viewPolicies').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'ตั้งค่าเกณฑ์คะแนนตามแผนก (Department Overrides)';
    loadPolicies();
  } else if (tabName === 'periods') {
    document.getElementById('viewPeriods').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'จัดการรอบการประเมินคะแนน (Dynamic Periods)';
    loadPeriods();
  } else if (tabName === 'presets') {
    document.getElementById('viewPresets').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'ตารางตัวเลือกเหตุผลมาตรฐาน (Master Dropdowns)';
    loadPresets();
  } else if (tabName === 'holidays') {
    document.getElementById('viewHolidays').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'ปฏิทินวันหยุดนักขัตฤกษ์ประจำปี (Public Holidays)';
    loadHolidays();
  } else if (tabName === 'stations') {
    document.getElementById('viewStations').style.display = 'block';
    document.getElementById('pageTitle').innerText = 'คะแนนบวกอัตโนมัติ: ประจำจุดจ่ายงานยาก & สกิลพิเศษ';
    loadStationsData();
  }
}

// 1. Load Summary Data & Stats
async function loadSummaryData() {
  try {
    const dept = document.getElementById('deptSelect')?.value || 'ALL';
    const grade = document.getElementById('gradeSelect')?.value || 'ALL';
    const search = document.getElementById('searchInput')?.value || '';

    const url = `/api/kpi/summary?dept=${encodeURIComponent(dept)}&grade=${encodeURIComponent(grade)}&search=${encodeURIComponent(search)}`;
    const res = await fetch(url);
    const json = await res.json();

    if (!json.success) throw new Error(json.message);

    currentSummaryData = json.data;

    // Render Stats
    if (json.stats) {
      document.getElementById('statTotalEmp').innerText = json.stats.total_employees || 0;
      document.getElementById('statAvgScore').innerText = json.stats.avg_score || '0.0';
      document.getElementById('statGradeA').innerText = json.stats.grade_a_count || 0;
      document.getElementById('statGradeB').innerText = json.stats.grade_b_count || 0;
      document.getElementById('statGradeD').innerText = json.stats.grade_d_count || 0;
    }

    if (json.period) {
      document.getElementById('activePeriodBadge').innerText = json.period.period_name;
    }

    // Populate Departments dropdown if empty
    const deptSelect = document.getElementById('deptSelect');
    if (deptSelect && deptSelect.options.length <= 1 && json.departments) {
      json.departments.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.innerText = `แผนก/ทีม: ${d}`;
        deptSelect.appendChild(opt);
      });
    }

    renderLeaderboard(json.data);
  } catch (err) {
    console.error('Error loading summary data:', err);
  }
}

// 2. Render Leaderboard Table
function renderLeaderboard(data) {
  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 32px; color: #94A3B8;">ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  data.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 700; color: #64748B;">#${index + 1}</td>
      <td style="font-weight: 600; color: #4F46E5;">${row.em_code}</td>
      <td style="font-weight: 600;">${row.name_th || '-'}</td>
      <td><span class="badge" style="background: #F1F5F9; color: #475569;">${row.team || row.grp || '-'}</span></td>
      <td style="color: #64748B;">${row.position_name || '-'}</td>
      <td>${parseFloat(row.initial_score).toFixed(1)}</td>
      <td style="color: #EF4444; font-weight: 600;">-${parseFloat(row.total_deducted).toFixed(1)}</td>
      <td style="color: #10B981; font-weight: 600;">+${parseFloat(row.total_added).toFixed(1)}</td>
      <td style="font-size: 16px; font-weight: 700; color: #0F172A;">${parseFloat(row.net_score).toFixed(1)}</td>
      <td><span class="badge badge-grade-${row.current_grade}">เกรด ${row.current_grade}</span></td>
      <td style="white-space: nowrap;">
        <button class="btn btn-primary" style="padding: 5px 9px; font-size: 12px; margin-right: 4px;" onclick="viewEmpTransactions('${row.em_code}')" title="ดูประวัติการหัก/บวกคะแนน">
          <i class="fa-solid fa-clock-rotate-left"></i> ดูประวัติ
        </button>
        <button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px;" onclick="openAdjustForEmp('${row.em_code}', '${row.name_th}')" title="ปรับคะแนนพนักงาน">
          <i class="fa-solid fa-pen-to-square"></i> ปรับคะแนน
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Search debounce
let searchTimer = null;
function handleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadSummaryData();
  }, 300);
}

// 3. Manual Adjust Modal Logic & Employee Search
async function loadEmployees() {
  try {
    const res = await fetch('/api/kpi/employees');
    const json = await res.json();
    if (json.success) {
      allEmployeesMaster = json.employees || [];
      const badge = document.getElementById('empCountBadge');
      if (badge) badge.innerText = `(${allEmployeesMaster.length} คน)`;
      populateTxDropdown();
    }
  } catch (err) {
    console.error('Error loading employees:', err);
  }
}

function openAdjustModal() {
  if (!desktopCurrentUser) {
    openLoginModal();
    return;
  }

  updateModalSupervisorBar();

  if (allEmployeesMaster.length === 0) {
    loadEmployees().then(() => {
      populateEmpDropdown();
    });
  } else {
    populateEmpDropdown();
  }

  // Reset Search Box & Selected Badge
  const searchInput = document.getElementById('adjustEmpSearchInput');
  if (searchInput) searchInput.value = '';
  const btnClear = document.getElementById('btnClearEmpSearch');
  if (btnClear) btnClear.style.display = 'none';
  const badge = document.getElementById('selectedEmpBadge');
  if (badge) badge.style.display = 'none';

  updateReasonDropdown();
  document.getElementById('adjustModal').classList.add('active');
}

function closeAdjustModal() {
  document.getElementById('adjustModal').classList.remove('active');
}

function openAdjustForEmp(emCode, name) {
  openAdjustModal();
  setTimeout(() => {
    const select = document.getElementById('adjustEmpSelect');
    if (select) {
      select.value = emCode;
      onAdjustEmpSelected();
    }
  }, 120);
}

function populateEmpDropdown(filteredList = null, selectedEmCode = '') {
  const select = document.getElementById('adjustEmpSelect');
  if (!select) return;

  const list = filteredList !== null ? filteredList : allEmployeesMaster;
  select.innerHTML = '<option value="">-- เลือกรหัส / ชื่อพนักงาน --</option>';

  list.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.em_code;
    const deptInfo = e.dept || '-';
    const posInfo = e.position_name ? ` • ${e.position_name}` : '';
    opt.innerText = `${e.em_code} - ${e.name_th} (${deptInfo}${posInfo})`;
    select.appendChild(opt);
  });

  const countBadge = document.getElementById('empCountBadge');
  if (countBadge) {
    if (filteredList !== null) {
      countBadge.innerText = `(พบ ${list.length} คน)`;
      countBadge.style.color = list.length > 0 ? '#4F46E5' : '#EF4444';
    } else {
      countBadge.innerText = `(${allEmployeesMaster.length} คน)`;
      countBadge.style.color = '#64748B';
    }
  }

  if (selectedEmCode) {
    select.value = selectedEmCode;
    onAdjustEmpSelected();
  }
}

function filterAdjustEmployees() {
  const query = (document.getElementById('adjustEmpSearchInput').value || '').trim().toLowerCase();
  const btnClear = document.getElementById('btnClearEmpSearch');
  if (btnClear) btnClear.style.display = query ? 'block' : 'none';

  if (!query) {
    populateEmpDropdown(null);
    return;
  }

  const filtered = allEmployeesMaster.filter(e => {
    const code = (e.em_code || '').toLowerCase();
    const name = (e.name_th || '').toLowerCase();
    const dept = (e.dept || '').toLowerCase();
    const pos = (e.position_name || '').toLowerCase();
    return code.includes(query) || name.includes(query) || dept.includes(query) || pos.includes(query);
  });

  // If there's an exact code match or exactly 1 match, auto-select it
  const autoSelectCode = filtered.length === 1 ? filtered[0].em_code : '';
  populateEmpDropdown(filtered, autoSelectCode);
}

function clearEmpSearch() {
  const searchInput = document.getElementById('adjustEmpSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.focus();
  }
  const btnClear = document.getElementById('btnClearEmpSearch');
  if (btnClear) btnClear.style.display = 'none';
  populateEmpDropdown(null);
}

function onAdjustEmpSelected() {
  const select = document.getElementById('adjustEmpSelect');
  const badge = document.getElementById('selectedEmpBadge');
  const btnSubmit = document.getElementById('btnSubmitAdjust');

  const emCode = select ? select.value : '';
  if (!emCode) {
    if (badge) badge.style.display = 'none';
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.style.opacity = '1';
      btnSubmit.style.cursor = 'pointer';
      btnSubmit.title = '';
    }
    return;
  }

  const emp = allEmployeesMaster.find(e => e.em_code === emCode);
  if (!emp || !badge) return;

  if (!desktopCurrentUser) {
    badge.style.display = 'block';
    badge.style.background = '#FEF2F2';
    badge.style.borderColor = '#F87171';
    badge.style.color = '#991B1B';
    badge.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div><i class="fa-solid fa-lock" style="margin-right: 6px;"></i> กรุณาเข้าสู่ระบบหัวหน้างานก่อนดำเนินการ</div>
        <button type="button" onclick="openLoginModal()" class="btn btn-sm btn-primary" style="font-size: 11px; padding: 2px 8px;">เข้าสู่ระบบ</button>
      </div>
    `;
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.style.opacity = '0.5';
      btnSubmit.style.cursor = 'not-allowed';
    }
    return;
  }

  // Department matching rule:
  const isGlobalAdmin = ['Admin', 'Executive'].includes(desktopCurrentUser.role) || 
                        desktopCurrentUser.team === 'WH' || 
                        desktopCurrentUser.grp === 'WH';

  const isSameDept = isGlobalAdmin || (
    (desktopCurrentUser.grp && emp.grp && desktopCurrentUser.grp === emp.grp) ||
    (desktopCurrentUser.team && emp.team && desktopCurrentUser.team === emp.team) ||
    (desktopCurrentUser.dept && emp.dept && desktopCurrentUser.dept === emp.dept)
  );

  if (!isSameDept) {
    // Cross-department blocked!
    const supDeptLabel = desktopCurrentUser.dept || desktopCurrentUser.grp || 'ไม่ระบุ';
    const empDeptLabel = emp.dept || emp.grp || 'ไม่ระบุ';
    badge.style.display = 'block';
    badge.style.background = '#FEE2E2';
    badge.style.borderColor = '#FCA5A5';
    badge.style.color = '#B91C1C';
    badge.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 10px;">
        <i class="fa-solid fa-circle-xmark" style="font-size: 20px; color: #DC2626; margin-top: 2px;"></i>
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 2px;">⚠️ ไม่อนุญาตให้บวกลบคะแนนข้ามแผนก!</div>
          <div style="font-size: 13px; line-height: 1.4;">
            คุณ (${desktopCurrentUser.fullname || desktopCurrentUser.username}) สังกัดแผนก <b>"${supDeptLabel}"</b><br>
            แต่พนักงานเป้าหมาย (${emp.em_code} - ${emp.name_th}) สังกัดแผนก <b>"${empDeptLabel}"</b>
          </div>
          <div style="font-size: 12px; margin-top: 4px; color: #7F1D1D; font-weight: 600;">
            ระบบปิดการบันทึกคะแนน: หัวหน้างานสามารถปรับคะแนนได้เฉพาะพนักงานในสังกัดแผนกเดียวกันเท่านั้น
          </div>
        </div>
      </div>
    `;
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.style.opacity = '0.5';
      btnSubmit.style.cursor = 'not-allowed';
      btnSubmit.title = 'ไม่สามารถบันทึกได้เนื่องจากอยู่คนละแผนก';
    }
  } else {
    // Same department allowed!
    badge.style.display = 'block';
    badge.style.background = '#ECFDF5';
    badge.style.borderColor = '#A7F3D0';
    badge.style.color = '#065F46';
    badge.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <i class="fa-solid fa-circle-check" style="color: #10B981; margin-right: 6px; font-size: 16px;"></i>
          <strong>${emp.em_code} - ${emp.name_th}</strong>
          <span style="font-size: 12px; margin-left: 6px; color: #047857;">(สังกัดแผนกตรงกัน)</span>
        </div>
        <span class="badge" style="background: #D1FAE5; color: #065F46; font-weight: 600;">
          ${emp.dept || '-'} | ${emp.position_name || '-'}
        </span>
      </div>
    `;
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.style.opacity = '1';
      btnSubmit.style.cursor = 'pointer';
      btnSubmit.title = '';
    }
  }
}

function selectPointType(type) {
  currentPointType = type;
  document.getElementById('adjustPointType').value = type;

  const btnAdd = document.getElementById('tabAdd');
  const btnDeduct = document.getElementById('tabDeduct');
  const btnSubmit = document.getElementById('btnSubmitAdjust');

  if (type === 'ADD') {
    btnAdd.className = 'type-btn active add';
    btnDeduct.className = 'type-btn deduct';
    btnSubmit.className = 'btn btn-success';
    btnSubmit.innerHTML = '<i class="fa-solid fa-plus-circle"></i> บันทึกให้คะแนนบวก';
  } else {
    btnAdd.className = 'type-btn add';
    btnDeduct.className = 'type-btn active deduct';
    btnSubmit.className = 'btn btn-danger';
    btnSubmit.innerHTML = '<i class="fa-solid fa-minus-circle"></i> บันทึกตัดคะแนน';
  }

  updateReasonDropdown();
}

async function loadPresets() {
  try {
    const res = await fetch('/api/kpi/presets');
    const json = await res.json();
    if (json.success) {
      allPresets = json.presets;
      renderPresetsTable(allPresets);
      updateReasonDropdown();
    }
  } catch (err) {
    console.error('Error loading presets:', err);
  }
}

function updateReasonDropdown() {
  const select = document.getElementById('adjustReasonSelect');
  if (!select) return;
  select.innerHTML = `<option value="">-- เลือกเหตุผล (${currentPointType === 'ADD' ? 'บวก' : 'ลบ'}) --</option>`;

  const filtered = allPresets.filter(p => p.point_type === currentPointType);
  filtered.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.reason_code;
    opt.dataset.points = Math.abs(parseFloat(p.default_points));
    opt.dataset.name = p.reason_name;
    const sign = currentPointType === 'ADD' ? '+' : '-';
    opt.innerText = `${p.reason_name} (${sign}${Math.abs(parseFloat(p.default_points))} คะแนน)`;
    select.appendChild(opt);
  });
}

function onReasonSelected() {
  const select = document.getElementById('adjustReasonSelect');
  const opt = select.options[select.selectedIndex];
  if (opt && opt.dataset.points) {
    document.getElementById('adjustPoints').value = opt.dataset.points;
    if (!document.getElementById('adjustDescription').value) {
      document.getElementById('adjustDescription').value = opt.dataset.name;
    }
  }
}

async function submitAdjustment(event) {
  event.preventDefault();
  const emCode = document.getElementById('adjustEmpSelect').value;
  const reasonCode = document.getElementById('adjustReasonSelect').value;
  const points = document.getElementById('adjustPoints').value;
  const description = document.getElementById('adjustDescription').value;
  const photoInput = document.getElementById('adjustPhoto');

  if (!emCode || !reasonCode || !points) {
    alert('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน');
    return;
  }

  if (!desktopCurrentUser) {
    alert('กรุณาเข้าสู่ระบบหัวหน้างานก่อนทำการปรับคะแนน');
    openLoginModal();
    return;
  }

  const emp = allEmployeesMaster.find(e => e.em_code === emCode);
  if (emp) {
    const isGlobalAdmin = ['Admin', 'Executive'].includes(desktopCurrentUser.role) || 
                          desktopCurrentUser.team === 'WH' || 
                          desktopCurrentUser.grp === 'WH';

    const isSameDept = isGlobalAdmin || (
      (desktopCurrentUser.grp && emp.grp && desktopCurrentUser.grp === emp.grp) ||
      (desktopCurrentUser.team && emp.team && desktopCurrentUser.team === emp.team) ||
      (desktopCurrentUser.dept && emp.dept && desktopCurrentUser.dept === emp.dept)
    );

    if (!isSameDept) {
      alert(`ไม่อนุญาตให้บวกลบคะแนนข้ามแผนก!\nคุณสังกัดแผนก "${desktopCurrentUser.dept || desktopCurrentUser.grp}" แต่พนักงานเป้าหมาย (${emp.name_th}) สังกัดแผนก "${emp.dept || emp.grp}"`);
      return;
    }
  }

  const formData = new FormData();
  formData.append('em_code', emCode);
  formData.append('point_type', currentPointType);
  formData.append('points', points);
  formData.append('reason_code', reasonCode);
  formData.append('reason_description', description);
  formData.append('created_by', desktopCurrentUser.username);

  if (photoInput.files.length > 0) {
    formData.append('evidence_photo', photoInput.files[0]);
  }

  try {
    const btn = document.getElementById('btnSubmitAdjust');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    const res = await fetch('/api/kpi/adjust', {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    btn.disabled = false;

    if (!json.success) throw new Error(json.message);

    alert('บันทึกการปรับคะแนนเรียบร้อยแล้ว!');
    closeAdjustModal();
    document.getElementById('adjustForm').reset();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// 4. Policies Table & Modal Handlers
let loadedPolicies = [];

const DAY_NAMES_TH = {
  'MON': 'จันทร์',
  'TUE': 'อังคาร',
  'WED': 'พุธ',
  'THU': 'พฤหัสฯ',
  'FRI': 'ศุกร์',
  'SAT': 'เสาร์',
  'SUN': 'อาทิตย์'
};

function formatDayOffNames(dayString) {
  if (!dayString) return 'อาทิตย์';
  const days = dayString.split(',').map(d => d.trim()).filter(Boolean);
  if (days.length === 0) return 'ไม่มี';
  return days.map(d => DAY_NAMES_TH[d] || d).join(', ');
}

function updateDayChipActive(cb) {
  const chip = cb.closest('.day-chip');
  if (!chip) return;
  if (cb.checked) {
    chip.classList.add('active');
  } else {
    chip.classList.remove('active');
  }
}

function setWeeklyOffDaysUI(dayString) {
  const days = (dayString || 'SUN').split(',').map(d => d.trim());
  const checkboxes = document.querySelectorAll('input[name="weeklyOffDay"]');
  checkboxes.forEach(cb => {
    cb.checked = days.includes(cb.value);
    updateDayChipActive(cb);
  });
}

function getWeeklyOffDaysFromUI() {
  const checkboxes = document.querySelectorAll('input[name="weeklyOffDay"]:checked');
  const selected = Array.from(checkboxes).map(cb => cb.value);
  return selected.length > 0 ? selected.join(',') : 'SUN';
}

let loadedPositions = [];

async function loadPositions() {
  try {
    const res = await fetch('/api/kpi/positions');
    const json = await res.json();
    if (!json.success) return;
    loadedPositions = json.positions || [];
    populatePolicyPosDropdown();
  } catch (err) {
    console.error('Error loading positions:', err);
  }
}

function populatePolicyPosDropdown(selectedDept = 'GLOBAL', targetPos = 'ALL') {
  const posSelect = document.getElementById('policyPosSelect');
  if (!posSelect) return;

  posSelect.innerHTML = '';

  // 1. Default Option: All Positions in this department
  const allOpt = document.createElement('option');
  allOpt.value = 'ALL';
  allOpt.innerText = (selectedDept === 'GLOBAL') 
    ? '👥 ทุกตำแหน่ง (All Positions - ค่าเริ่มต้นกลาง)' 
    : `👥 ทุกตำแหน่งในแผนก ${selectedDept} (All Positions)`;
  posSelect.appendChild(allOpt);

  // 2. Filter positions for selected department
  let positionsToShow = [];
  if (selectedDept === 'GLOBAL') {
    // Show all distinct position names across company
    positionsToShow = Array.from(new Set(loadedPositions.map(p => (p.position_name || '').trim()).filter(Boolean))).sort();
  } else {
    // Show only positions belonging to this specific department
    const deptItems = loadedPositions.filter(p => p.dept === selectedDept);
    positionsToShow = Array.from(new Set(deptItems.map(p => (p.position_name || '').trim()).filter(Boolean))).sort();
  }

  positionsToShow.forEach(pos => {
    const opt = document.createElement('option');
    opt.value = pos;
    opt.innerText = `👔 ตำแหน่ง: ${pos}`;
    posSelect.appendChild(opt);
  });

  const exists = Array.from(posSelect.options).some(o => o.value === targetPos);
  posSelect.value = exists ? targetPos : 'ALL';
}

async function loadPolicies() {
  try {
    const res = await fetch('/api/kpi/policies');
    const json = await res.json();
    if (!json.success) return;

    loadedPolicies = json.policies || [];
    const tbody = document.getElementById('policiesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    json.policies.forEach(p => {
      const isGlobal = p.dept_code === 'GLOBAL';
      const hasSpecificPos = p.position_name && p.position_name !== 'ALL';
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td style="font-weight: 700;">
          ${isGlobal ? '<span class="badge" style="background:#EEF2FF; color:#4F46E5;">เกณฑ์มาตรฐานกลาง (Global)</span>' : p.dept_code}
        </td>
        <td>
          ${hasSpecificPos 
            ? `<span class="badge" style="background:#E0F2FE; color:#0369A1; font-weight:600;"><i class="fa-solid fa-id-badge"></i> ${p.position_name}</span>` 
            : '<span style="color:#64748B; font-size:12px;">👥 ทุกตำแหน่งในแผนก</span>'}
        </td>
        <td>${p.late_penalty_type === 'TIER' ? 'ขั้นบันไดตามนาที' : `คงที่ (-${p.late_fixed_points} แต้ม)`}</td>
        <td style="color:#EF4444; font-weight:600;">-${p.absent_penalty_points} แต้ม</td>
        <td style="color:#EF4444;">-${p.sick_leave_points !== undefined && p.sick_leave_points !== null && Number(p.sick_leave_points) > 0 ? p.sick_leave_points : p.unannounced_leave_points} แต้ม</td>
        <td>
          <div style="color:#10B981; font-weight:700;">+${p.weekly_holiday_bonus} แต้ม/วัน</div>
          <div style="font-size:11px; color:#4F46E5; background:#EEF2FF; padding:2px 6px; border-radius:4px; display:inline-block; margin-top:2px;">
            <i class="fa-solid fa-calendar-day"></i> หยุด: ${formatDayOffNames(p.weekly_off_days)}
          </div>
        </td>
        <td style="color:#10B981; font-weight:600;">+${p.public_holiday_bonus} แต้ม/วัน</td>
        <td>
          <span style="font-size:12px; color:#64748B;">
            ${(p.late_tiers || []).map(t => `${t.min_minutes}-${t.max_minutes || '∞'}m: -${t.deduct_points}`).join(', ') || '-'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px;" onclick="openPolicyModal('${p.dept_code}', '${(p.position_name || 'ALL').replace(/'/g, "\\'")}')">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            ${!isGlobal ? `
              <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 12px; color:#EF4444;" onclick="deletePolicy(${p.policy_id}, '${p.dept_code} - ${p.position_name}')" title="ลบเกณฑ์เฉพาะนี้">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            ` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading policies:', err);
  }
}

function openPolicyModal(deptCode = 'GLOBAL', positionName = 'ALL') {
  populatePolicyDeptDropdown(deptCode);
  populatePolicyPosDropdown(deptCode, positionName);

  const deptSelect = document.getElementById('policyDeptSelect');
  if (deptSelect) deptSelect.value = deptCode;

  const posSelect = document.getElementById('policyPosSelect');
  if (posSelect) posSelect.value = positionName;

  fillPolicyForm(deptCode, positionName);
  document.getElementById('policyModal').classList.add('active');
}

function populatePolicyDeptDropdown(selectedDept = 'GLOBAL') {
  const deptSelect = document.getElementById('policyDeptSelect');
  if (!deptSelect) return;

  const currentVal = selectedDept || deptSelect.value || 'GLOBAL';
  deptSelect.innerHTML = '<option value="GLOBAL">🌐 เกณฑ์มาตรฐานกลาง (Global Default - ใช้กับทุกแผนก)</option>';

  const deptSet = new Set();
  loadedPositions.forEach(p => {
    if (p.dept && p.dept !== 'OTHER' && p.dept !== 'ALL' && p.dept !== 'GLOBAL') {
      deptSet.add(p.dept);
    }
  });

  const mainDeptSelect = document.getElementById('deptSelect');
  if (mainDeptSelect) {
    Array.from(mainDeptSelect.options).forEach(opt => {
      if (opt.value && opt.value !== 'ALL' && opt.value !== 'GLOBAL') {
        deptSet.add(opt.value);
      }
    });
  }

  Array.from(deptSet).sort().forEach(d => {
    const o = document.createElement('option');
    o.value = d;
    o.innerText = `🏢 แผนก / ทีม: ${d}`;
    deptSelect.appendChild(o);
  });

  deptSelect.value = currentVal;
}

function onPolicyDeptChanged() {
  const deptSelect = document.getElementById('policyDeptSelect');
  const selectedDept = deptSelect ? deptSelect.value : 'GLOBAL';
  // เมื่อเปลี่ยนแผนก ให้โหลดรายการตำแหน่งงานที่สังกัดแผนกนั้นทันที
  populatePolicyPosDropdown(selectedDept, 'ALL');
  fillPolicyForm(selectedDept, 'ALL');
}

function onPolicyPosChanged() {
  const deptSelect = document.getElementById('policyDeptSelect');
  const posSelect = document.getElementById('policyPosSelect');
  const selectedDept = deptSelect ? deptSelect.value : 'GLOBAL';
  const selectedPos = posSelect ? posSelect.value : 'ALL';
  fillPolicyForm(selectedDept, selectedPos);
}

function onPolicyFilterChanged() {
  onPolicyPosChanged();
}

function fillPolicyForm(deptCode, positionName) {
  const pos = positionName || 'ALL';
  // 1. หาตรงเป๊ะ deptCode + pos
  let policy = loadedPolicies.find(p => p.dept_code === deptCode && (p.position_name || 'ALL') === pos);

  // 2. ถ้ายังไม่พบ หา deptCode + ALL
  if (!policy && pos !== 'ALL') {
    policy = loadedPolicies.find(p => p.dept_code === deptCode && (p.position_name || 'ALL') === 'ALL');
  }

  // 3. ถ้ายังไม่พบ หา GLOBAL + ALL
  if (!policy) {
    const globalPolicy = loadedPolicies.find(p => p.dept_code === 'GLOBAL' && (p.position_name || 'ALL') === 'ALL') || loadedPolicies.find(p => p.dept_code === 'GLOBAL');
    policy = {
      dept_code: deptCode,
      position_name: pos,
      absent_penalty_points: globalPolicy ? globalPolicy.absent_penalty_points : 5.0,
      unannounced_leave_points: globalPolicy ? globalPolicy.unannounced_leave_points : 3.0,
      weekly_holiday_bonus: globalPolicy ? globalPolicy.weekly_holiday_bonus : 2.0,
      weekly_off_days: globalPolicy ? globalPolicy.weekly_off_days : 'SUN',
      public_holiday_bonus: globalPolicy ? globalPolicy.public_holiday_bonus : 3.0,
      late_penalty_type: globalPolicy ? globalPolicy.late_penalty_type : 'TIER',
      late_fixed_points: globalPolicy ? globalPolicy.late_fixed_points : 1.0,
      late_tiers: globalPolicy ? globalPolicy.late_tiers : [
        { min_minutes: 1, max_minutes: 15, deduct_points: 1.0 },
        { min_minutes: 16, max_minutes: 30, deduct_points: 2.0 },
        { min_minutes: 31, max_minutes: null, deduct_points: 3.0 }
      ]
    };
  }

  document.getElementById('polAbsentPoints').value = policy.absent_penalty_points;
  document.getElementById('polUnannouncedPoints').value = (policy.sick_leave_points !== undefined && policy.sick_leave_points !== null && Number(policy.sick_leave_points) > 0)
    ? policy.sick_leave_points
    : (policy.unannounced_leave_points !== undefined ? policy.unannounced_leave_points : 3.0);
  document.getElementById('polWeeklyBonus').value = policy.weekly_holiday_bonus;
  document.getElementById('polPublicBonus').value = policy.public_holiday_bonus;
  document.getElementById('polLateType').value = policy.late_penalty_type || 'TIER';
  document.getElementById('polFixedLatePoints').value = policy.late_fixed_points || 1.0;

  // Set Weekly Off Days Checkboxes
  setWeeklyOffDaysUI(policy.weekly_off_days || 'SUN');

  // Tiers
  const tiers = policy.late_tiers || [];
  document.getElementById('tier1Points').value = tiers[0] ? tiers[0].deduct_points : 1.0;
  document.getElementById('tier2Points').value = tiers[1] ? tiers[1].deduct_points : 2.0;
  document.getElementById('tier3Points').value = tiers[2] ? tiers[2].deduct_points : 3.0;

  toggleLateTypeUI();
}

function closePolicyModal() {
  document.getElementById('policyModal').classList.remove('active');
}

function toggleLateTypeUI() {
  const type = document.getElementById('polLateType').value;
  if (type === 'FIXED') {
    document.getElementById('fixedLateUI').style.display = 'block';
    document.getElementById('tieredLateUI').style.display = 'none';
  } else {
    document.getElementById('fixedLateUI').style.display = 'none';
    document.getElementById('tieredLateUI').style.display = 'block';
  }
}

async function savePolicySettings(event) {
  event.preventDefault();
  const deptCode = document.getElementById('policyDeptSelect').value;
  const positionName = document.getElementById('policyPosSelect').value;
  const absentPoints = parseFloat(document.getElementById('polAbsentPoints').value);
  const unannouncedPoints = parseFloat(document.getElementById('polUnannouncedPoints').value);
  const weeklyBonus = parseFloat(document.getElementById('polWeeklyBonus').value);
  const weeklyOffDays = getWeeklyOffDaysFromUI();
  const publicBonus = parseFloat(document.getElementById('polPublicBonus').value);
  const lateType = document.getElementById('polLateType').value;
  const fixedLatePoints = parseFloat(document.getElementById('polFixedLatePoints').value || 1.0);

  const lateTiers = [
    { min_minutes: 1, max_minutes: 15, deduct_points: parseFloat(document.getElementById('tier1Points').value || 1.0) },
    { min_minutes: 16, max_minutes: 30, deduct_points: parseFloat(document.getElementById('tier2Points').value || 2.0) },
    { min_minutes: 31, max_minutes: null, deduct_points: parseFloat(document.getElementById('tier3Points').value || 3.0) }
  ];

  try {
    const btn = document.getElementById('btnSavePolicy');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    const res = await fetch('/api/kpi/policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dept_code: deptCode,
        position_name: positionName,
        late_penalty_type: lateType,
        late_fixed_points: fixedLatePoints,
        absent_penalty_points: absentPoints,
        unannounced_leave_points: unannouncedPoints,
        sick_leave_points: unannouncedPoints,
        weekly_holiday_bonus: weeklyBonus,
        weekly_off_days: weeklyOffDays,
        public_holiday_bonus: publicBonus,
        late_tiers: lateTiers
      })
    });

    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกเกณฑ์คะแนน Auto';

    if (!json.success) throw new Error(json.message);

    const targetLabel = `${deptCode === 'GLOBAL' ? 'เกณฑ์มาตรฐานกลาง' : 'แผนก ' + deptCode} (${positionName === 'ALL' ? 'ทุกตำแหน่ง' : 'ตำแหน่ง ' + positionName})`;
    alert(`บันทึกเกณฑ์คะแนนสำหรับ [${targetLabel}] เรียบร้อย!\n(วันหยุดสัปดาห์: ${formatDayOffNames(weeklyOffDays)})`);
    closePolicyModal();
    loadPolicies();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deletePolicy(policyId, label) {
  if (!confirm(`ยืนยันการลบเกณฑ์เฉพาะของ [${label}] หรือไม่? (ระบบจะกลับไปใช้เกณฑ์ระดับแผนกหรือเกณฑ์กลางแทน)`)) return;

  try {
    const res = await fetch(`/api/kpi/policies/${policyId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    alert('ลบเกณฑ์เฉพาะเรียบร้อย!');
    loadPolicies();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

let loadedPeriodsList = [];

async function loadPeriods() {
  try {
    const res = await fetch('/api/kpi/periods');
    const json = await res.json();
    if (!json.success) return;

    loadedPeriodsList = json.periods || [];
    const tbody = document.getElementById('periodsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    json.periods.forEach(p => {
      const tr = document.createElement('tr');
      const startTh = new Date(p.start_date).toLocaleDateString('th-TH');
      const endTh = new Date(p.end_date).toLocaleDateString('th-TH');

      tr.innerHTML = `
        <td style="font-weight: 700; color: #64748B;">#${p.period_id}</td>
        <td style="font-weight: 700; font-size: 14px; color: #1E293B;">${p.period_name}</td>
        <td>${startTh}</td>
        <td>${endTh}</td>
        <td style="font-weight: 600;">${p.initial_score} คะแนน</td>
        <td>
          ${p.is_active 
            ? '<span class="badge badge-grade-A" style="font-size: 12px;"><i class="fa-solid fa-circle-check"></i> รอบปัจจุบัน (Active)</span>' 
            : '<span class="badge badge-grade-D" style="font-size: 12px;">ปิดรอบแล้ว</span>'}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; color: #4F46E5;" onclick="openEditPeriodModal(${p.period_id})" title="แก้ไขรอบนี้">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            ${!p.is_active ? `
              <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; color: #059669;" onclick="activatePeriod(${p.period_id}, '${p.period_name.replace(/'/g, "\\'")}')" title="เปิดใช้งานรอบนี้เป็นรอบปัจจุบัน">
                <i class="fa-solid fa-play"></i> เปิดใช้
              </button>
            ` : ''}
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; color: #EF4444;" onclick="deletePeriod(${p.period_id}, '${p.period_name.replace(/'/g, "\\'")}', ${p.is_active})" title="ลบรอบนี้">
              <i class="fa-solid fa-trash-can"></i> ลบ
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      if (p.is_active) {
        const badge = document.getElementById('activePeriodBadge');
        if (badge) badge.innerText = p.period_name;
      }
    });
  } catch (err) {
    console.error('Error loading periods:', err);
  }
}

function openPeriodModal() {
  document.getElementById('periodForm').reset();
  document.getElementById('editPeriodId').value = '';
  document.getElementById('periodModalTitle').innerText = 'สร้างรอบการประเมินคะแนนใหม่';
  document.getElementById('btnSavePeriodText').innerText = 'สร้างรอบประเมิน';

  const today = new Date();
  const nextYear = today.getFullYear() + 1;
  document.getElementById('perName').value = `รอบประเมินประจำปี ${nextYear}`;
  document.getElementById('perStartDate').value = `${nextYear}-01-01`;
  document.getElementById('perEndDate').value = `${nextYear}-12-31`;
  document.getElementById('perInitialScore').value = "100.0";
  document.getElementById('perIsActive').checked = true;
  document.getElementById('periodModal').classList.add('active');
}

function openEditPeriodModal(periodId) {
  const period = loadedPeriodsList.find(p => p.period_id === periodId);
  if (!period) return;

  document.getElementById('editPeriodId').value = period.period_id;
  document.getElementById('periodModalTitle').innerText = `แก้ไขรอบการประเมิน (${period.period_name})`;
  document.getElementById('btnSavePeriodText').innerText = 'บันทึกการแก้ไข';

  document.getElementById('perName').value = period.period_name;
  
  const sDate = (period.start_date || '').substring(0, 10);
  const eDate = (period.end_date || '').substring(0, 10);
  document.getElementById('perStartDate').value = sDate;
  document.getElementById('perEndDate').value = eDate;
  document.getElementById('perInitialScore').value = period.initial_score;
  document.getElementById('perIsActive').checked = period.is_active;

  document.getElementById('periodModal').classList.add('active');
}

function closePeriodModal() {
  document.getElementById('periodModal').classList.remove('active');
}

async function savePeriod(event) {
  event.preventDefault();
  const editId = document.getElementById('editPeriodId').value;
  const isEdit = Boolean(editId);

  const name = document.getElementById('perName').value;
  const startDate = document.getElementById('perStartDate').value;
  const endDate = document.getElementById('perEndDate').value;
  const initialScore = parseFloat(document.getElementById('perInitialScore').value || 100);
  const isActive = document.getElementById('perIsActive').checked;

  try {
    const btn = document.getElementById('btnSavePeriod');
    btn.disabled = true;
    btn.innerText = isEdit ? 'กำลังบันทึก...' : 'กำลังสร้าง...';

    const url = isEdit ? `/api/kpi/periods/${editId}` : '/api/kpi/periods';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_name: name,
        start_date: startDate,
        end_date: endDate,
        initial_score: initialScore,
        is_active: isActive
      })
    });

    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = `<i class="fa-solid fa-check"></i> <span id="btnSavePeriodText">${isEdit ? 'บันทึกการแก้ไข' : 'สร้างรอบประเมิน'}</span>`;

    if (!json.success) throw new Error(json.message);

    alert(isEdit ? `บันทึกการแก้ไขรอบ "${name}" เรียบร้อย!` : `สร้างรอบประเมิน "${name}" สำเร็จเรียบร้อย!`);
    closePeriodModal();
    loadPeriods();
    if (isActive) {
      loadSummaryData();
      loadPolicies();
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deletePeriod(periodId, periodName, isActive) {
  if (isActive) {
    alert(`ไม่สามารถลบรอบ "${periodName}" ได้ เนื่องจากเป็นรอบที่กำลังเปิดใช้งานอยู่ (Active)\nกรุณากด "เปิดใช้" รอบอื่นให้เป็น Active ก่อนทำการลบรอบนี้`);
    return;
  }

  if (!confirm(`ยืนยันการลบรอบประเมิน "${periodName}" หรือไม่?\n⚠️ คำเตือน: ข้อมูลการตัดแต้ม เกณฑ์คะแนน และประวัติทั้งหมดในรอบนี้จะถูกลบถาวร`)) return;

  try {
    const res = await fetch(`/api/kpi/periods/${periodId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert('ลบรอบการประเมินเรียบร้อย!');
    loadPeriods();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function activatePeriod(periodId, periodName) {
  if (!confirm(`ต้องการเปลี่ยนไปใช้รอบประเมิน "${periodName}" เป็นรอบปัจจุบันหรือไม่?`)) return;

  try {
    const res = await fetch(`/api/kpi/periods/${periodId}/activate`, { method: 'PUT' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(`เปิดใช้งานรอบ "${periodName}" เรียบร้อย!`);
    loadPeriods();
    loadSummaryData();
    loadPolicies();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// 6. Presets Table
function renderPresetsTable(presets) {
  const tbody = document.getElementById('presetsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!presets || presets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color:#64748B;">ไม่พบรายการตัวเลือกเหตุผลมาตรฐาน</td></tr>`;
    return;
  }

  presets.forEach(p => {
    const isAdd = p.point_type === 'ADD';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <span class="badge ${isAdd ? 'badge-grade-A' : 'badge-grade-D'}">
          ${isAdd ? '+ คะแนนบวก' : '- คะแนนลบ'}
        </span>
      </td>
      <td style="font-family: monospace; font-weight: 600;">${p.reason_code}</td>
      <td style="font-weight: 600;">${p.reason_name}</td>
      <td style="font-weight: 700; color: ${isAdd ? '#10B981' : '#EF4444'};">
        ${isAdd ? '+' : ''}${parseFloat(p.default_points).toFixed(1)} แต้ม
      </td>
      <td><span class="badge" style="background:#F1F5F9; color:#475569;">${p.dept_scope}</span></td>
      <td><span class="badge badge-grade-A">เปิดใช้งาน</span></td>
      <td>
        <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; color: #EF4444;" onclick="deletePreset(${p.reason_id}, '${(p.reason_name || '').replace(/'/g, "\\'")}', '${p.reason_code}')" title="ลบตัวเลือกเหตุผลนี้">
          <i class="fa-solid fa-trash-can"></i> ลบ
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function deletePreset(reasonId, reasonName, reasonCode) {
  if (!confirm(`ยืนยันการลบตัวเลือกเหตุผล "${reasonName}" (รหัส: ${reasonCode}) หรือไม่?`)) return;

  try {
    const res = await fetch(`/api/kpi/presets/${reasonId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(`ลบตัวเลือกเหตุผล "${reasonName}" สำเร็จเรียบร้อยแล้ว`);
    loadPresets();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการลบ: ' + err.message);
  }
}

// 7. Actions: Recalculate & Sync Now & Exports
async function triggerRecalculate() {
  const btn = document.getElementById('btnRecalc');
  if (!confirm('ต้องการเริ่มประมวลผลคำนวณคะแนนใหม่ทั้งหมดใช่หรือไม่?')) return;
  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังคำนวณ...';
    const res = await fetch('/api/kpi/recalculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> คำนวณคะแนนใหม่';
    alert(json.message);
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function triggerSyncNow() {
  const btn = document.getElementById('btnSync');
  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลัง Sync...';
    const res = await fetch('/api/kpi/sync/now', { method: 'POST' });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sync ตอนนี้';
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    loadSummaryData();

    if (json.configured === false) {
      openCloudSyncModal();
    }
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Sync ตอนนี้';
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// --- Cloud Sync Settings Modal (Supabase + Render 4G/5G) ---
async function openCloudSyncModal() {
  const modal = document.getElementById('cloudSyncModal');
  if (!modal) return;
  modal.classList.add('active');

  try {
    const res = await fetch('/api/kpi/sync/config');
    const json = await res.json();
    if (json.success && json.config) {
      const cfg = json.config;
      document.getElementById('cfgSupabaseDbUrl').value = cfg.supabase_db_url || '';
      document.getElementById('cfgRenderAppUrl').value = cfg.render_app_url || '';
      document.getElementById('cfgAutoSyncEnabled').checked = cfg.auto_sync_enabled !== false;
      document.getElementById('cfgSyncIntervalMins').value = cfg.sync_interval_minutes || 5;
      updateMobile4gLinkPreview();

      const lastBox = document.getElementById('cloudLastSyncBox');
      if (lastBox) {
        if (cfg.last_sync_at) {
          const dt = new Date(cfg.last_sync_at).toLocaleString('th-TH');
          lastBox.style.display = 'block';
          lastBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <b>ซิงค์กับ Supabase ล่าสุด:</b> ${dt}<br><span style="font-size: 11.5px;">${cfg.last_sync_summary || ''}</span>`;
        } else {
          lastBox.style.display = 'none';
        }
      }
    }
  } catch (e) {
    console.error('Error loading cloud sync config:', e);
  }
}

function closeCloudSyncModal() {
  const modal = document.getElementById('cloudSyncModal');
  if (modal) modal.classList.remove('active');
}

function toggleSupabaseUrlVisibility() {
  const input = document.getElementById('cfgSupabaseDbUrl');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function updateMobile4gLinkPreview() {
  const val = (document.getElementById('cfgRenderAppUrl')?.value || '').trim().replace(/\/+$/, '');
  const box = document.getElementById('mobile4gLinkPreview');
  if (!box) return;
  if (!val) {
    box.style.display = 'none';
    return;
  }
  const mobileUrl = `${val}/mobile.html`;
  box.style.display = 'block';
  box.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
      <div>
        <span style="color: #475569; font-weight: 600;">📱 ลิงก์มือถือ 4G/5G (สำหรับหัวหน้างาน/พนักงาน):</span><br>
        <a href="${mobileUrl}" target="_blank" style="color: #4F46E5; font-weight: 700; word-break: break-all;">${mobileUrl}</a>
      </div>
      <button type="button" class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('${mobileUrl}'); alert('คัดลอกลิงก์ 4G/5G เรียบร้อยแล้ว!');" style="white-space: nowrap; padding: 4px 10px; font-size: 11.5px;">
        <i class="fa-regular fa-copy"></i> คัดลอกลิงก์
      </button>
    </div>
  `;
}

async function testSupabaseConnection() {
  const url = (document.getElementById('cfgSupabaseDbUrl')?.value || '').trim();
  const btn = document.getElementById('btnTestSupabase');
  if (!url) {
    alert('กรุณาวาง Supabase Connection URI (postgresql://...) ก่อนทดสอบ');
    return;
  }
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังทดสอบ...';
    }
    const res = await fetch('/api/kpi/sync/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_db_url: url })
    });
    const json = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-plug-circle-check"></i> ทดสอบเชื่อมต่อ';
    }
    alert(json.message);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-plug-circle-check"></i> ทดสอบเชื่อมต่อ';
    }
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function saveCloudSyncSettings(event) {
  if (event) event.preventDefault();
  const supabase_db_url = (document.getElementById('cfgSupabaseDbUrl')?.value || '').trim();
  const render_app_url = (document.getElementById('cfgRenderAppUrl')?.value || '').trim();
  const auto_sync_enabled = Boolean(document.getElementById('cfgAutoSyncEnabled')?.checked);
  const sync_interval_minutes = parseInt(document.getElementById('cfgSyncIntervalMins')?.value || '5', 10) || 5;

  const btn = document.getElementById('btnSaveCloudSync');
  try {
    if (btn) {
      btn.disabled = true;
      btn.innerText = 'กำลังบันทึก...';
    }
    const res = await fetch('/api/kpi/sync/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supabase_db_url, render_app_url, auto_sync_enabled, sync_interval_minutes })
    });
    const json = await res.json();
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกตั้งค่า Cloud';
    }
    if (!json.success) throw new Error(json.message);
    if (event) alert(json.message);
    return true;
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกตั้งค่า Cloud';
    }
    alert('เกิดข้อผิดพลาด: ' + err.message);
    return false;
  }
}

async function saveAndTriggerSyncNow() {
  const ok = await saveCloudSyncSettings(null);
  if (!ok) return;
  closeCloudSyncModal();
  await triggerSyncNow();
}

function exportExcel() {
  window.open('/api/kpi/export/excel', '_blank');
}

function exportTransactionsExcel() {
  window.open('/api/kpi/export/excel?type=transactions', '_blank');
}

// 8. Preset Dropdown Table Export & Import
function exportPresetsExcel() {
  window.open('/api/kpi/presets/export', '_blank');
}

function triggerImportPresets() {
  const input = document.getElementById('presetFileInput');
  if (input) input.click();
}

async function handlePresetFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('excel_file', file);

  try {
    const res = await fetch('/api/kpi/presets/import', {
      method: 'POST',
      body: formData
    });
    const json = await res.json();

    if (!json.success) throw new Error(json.message);

    alert(json.message);
    loadPresets();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการนำเข้าไฟล์: ' + err.message);
  } finally {
    event.target.value = '';
  }
}

// 9. Public Holidays Management
async function loadHolidays() {
  try {
    const yearSelect = document.getElementById('holidayYearSelect');
    const selectedYear = yearSelect ? yearSelect.value : '2026';
    const res = await fetch(`/api/kpi/holidays?year=${encodeURIComponent(selectedYear)}`);
    const json = await res.json();
    if (!json.success) return;

    const tbody = document.getElementById('holidaysTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!json.holidays || json.holidays.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color:#64748B;">ไม่พบรายการวันหยุดสำหรับปี ${selectedYear}</td></tr>`;
      return;
    }

    json.holidays.forEach(h => {
      const tr = document.createElement('tr');
      const d = new Date(h.holiday_date);
      const dateTh = d.toLocaleDateString('th-TH', { month: 'long', day: 'numeric', weekday: 'short' });
      const yearDisplay = h.holiday_year || d.getFullYear();

      tr.innerHTML = `
        <td style="font-weight: 700; color: #475569;">
          <span class="badge" style="background:#F1F5F9; color:#334155;">${yearDisplay}</span>
        </td>
        <td style="font-weight: 700; color: #4F46E5;">
          <i class="fa-regular fa-calendar-days" style="margin-right: 6px;"></i> ${dateTh}
        </td>
        <td style="font-weight: 600; font-size: 14px;">${h.holiday_name}</td>
        <td style="color: #10B981; font-weight: 700;">+3.00 แต้ม/วัน (เท่ากันทั้งบริษัท)</td>
        <td style="color: #64748B; font-size: 13px;">${h.description || '-'}</td>
        <td>
          <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 12px; color: #EF4444;" onclick="deleteHoliday(${h.holiday_id}, '${h.holiday_name.replace(/'/g, "\\'")}')">
            <i class="fa-solid fa-trash-can"></i> ลบ
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading holidays:', err);
  }
}

function openAddHolidayModal() {
  document.getElementById('holidayForm').reset();
  const yearSelect = document.getElementById('holidayYearSelect');
  const y = yearSelect && yearSelect.value !== 'ALL' ? yearSelect.value : new Date().getFullYear();
  document.getElementById('holYear').value = y;
  document.getElementById('holidayModal').classList.add('active');
}

function onHolidayDateChanged() {
  const d = document.getElementById('holDate').value;
  if (d) {
    const parts = d.split('-');
    if (parts.length >= 1 && parts[0] && parts[0].length === 4) {
      const year = parseInt(parts[0], 10);
      if (!isNaN(year)) {
        document.getElementById('holYear').value = year;
      }
    }
  }
}

function onHolidayYearChanged() {
  const y = document.getElementById('holYear').value;
  const d = document.getElementById('holDate').value;
  if (y && y.length === 4 && d) {
    const parts = d.split('-');
    if (parts.length === 3) {
      document.getElementById('holDate').value = `${y}-${parts[1]}-${parts[2]}`;
    }
  }
}

function closeHolidayModal() {
  document.getElementById('holidayModal').classList.remove('active');
}

async function saveHoliday(event) {
  event.preventDefault();
  const date = document.getElementById('holDate').value;
  if (!date) {
    alert('กรุณาระบุวันที่วันหยุด');
    return;
  }

  // ซิงค์ปีให้ตรงกับวันที่โดยตรง (100% Guaranteed Link)
  const parts = date.split('-');
  const computedYear = parts.length >= 1 ? parseInt(parts[0], 10) : parseInt(document.getElementById('holYear').value, 10);
  const year = !isNaN(computedYear) ? computedYear : 2026;
  document.getElementById('holYear').value = year;

  const name = document.getElementById('holName').value;
  const desc = document.getElementById('holDesc').value;

  try {
    const btn = document.getElementById('btnSaveHoliday');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    const res = await fetch('/api/kpi/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holiday_date: date,
        holiday_year: year,
        holiday_name: name,
        description: desc
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกวันหยุด';

    if (!json.success) throw new Error(json.message);

    alert(`บันทึกวันหยุด "${name}" ประจำปี ${year} เรียบร้อยแล้ว!`);
    closeHolidayModal();
    
    // ตั้งค่า dropdown ปี ให้ตรงกับปีที่เพิ่งเพิ่ม
    const yearSelect = document.getElementById('holidayYearSelect');
    if (yearSelect) yearSelect.value = year.toString();
    loadHolidays();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deleteHoliday(holidayId, holidayName) {
  if (!confirm(`ยืนยันการลบวันหยุด "${holidayName}" หรือไม่?`)) return;

  try {
    const res = await fetch(`/api/kpi/holidays/${holidayId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert('ลบวันหยุดเรียบร้อย!');
    loadHolidays();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==============================================================================
// 10. Grade Configuration Functions
// ==============================================================================
async function openGradeModal() {
  try {
    const res = await fetch('/api/kpi/grades');
    const json = await res.json();
    if (json.success && json.grades) {
      document.getElementById('cfgGradeA').value = json.grades.grade_a_min;
      document.getElementById('cfgGradeB').value = json.grades.grade_b_min;
      document.getElementById('cfgGradeC').value = json.grades.grade_c_min;
      updateGradeDHelper();
    }
  } catch (err) {
    console.error('Error fetching grades:', err);
  }
  document.getElementById('gradeModal').classList.add('active');
}

function closeGradeModal() {
  document.getElementById('gradeModal').classList.remove('active');
}

function updateGradeDHelper() {
  const cVal = parseFloat(document.getElementById('cfgGradeC').value);
  const label = document.getElementById('cfgGradeDLabel');
  if (label) {
    if (!isNaN(cVal)) {
      label.innerText = `คะแนนต่ำกว่าเกรด C (< ${cVal.toFixed(1)})`;
    } else {
      label.innerText = 'คะแนนต่ำกว่าเกรด C (< 70.0)';
    }
  }
}

async function saveGradeSettings(event) {
  event.preventDefault();
  const a = parseFloat(document.getElementById('cfgGradeA').value);
  const b = parseFloat(document.getElementById('cfgGradeB').value);
  const c = parseFloat(document.getElementById('cfgGradeC').value);

  if (isNaN(a) || isNaN(b) || isNaN(c)) {
    alert('กรุณากรอกคะแนนตัวเลขให้ครบถ้วน');
    return;
  }
  if (!(a > b && b > c)) {
    alert('เงื่อนไขคะแนนไม่ถูกต้อง:\n- เกรด A ต้องมากกว่า เกรด B\n- เกรด B ต้องมากกว่า เกรด C');
    return;
  }

  try {
    const btn = document.getElementById('btnSaveGrade');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึกและคำนวณใหม่...';

    const res = await fetch('/api/kpi/grades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade_a_min: a,
        grade_b_min: b,
        grade_c_min: c
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกเกณฑ์ตัดเกรด';

    if (!json.success) throw new Error(json.message);

    alert('บันทึกเกณฑ์คะแนนตัดเกรดเรียบร้อยแล้ว! ระบบได้คำนวณเกรดพนักงานทุกคนใหม่เรียบร้อยแล้ว');
    closeGradeModal();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==============================================================================
// 8. จุดจ่ายงานยาก & สกิลพิเศษ (Difficult Station Bonus)
// ==============================================================================
let allStationConfigs = [];
let allStationAssignments = [];
let currentPeriodMonthsElapsed = 1;

async function loadStationsData() {
  await Promise.all([loadStationConfigs(), loadStationAssignments()]);
}

async function loadStationConfigs() {
  try {
    const res = await fetch('/api/kpi/stations');
    const json = await res.json();
    if (!json.success) return;
    allStationConfigs = json.stations || [];
    renderStationCards();
    populateStationDropdowns();
  } catch (err) {
    console.error('Error loading stations:', err);
  }
}

function renderStationCards() {
  const container = document.getElementById('stationCardsContainer');
  if (!container) return;

  if (allStationConfigs.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94A3B8; padding: 20px;">ยังไม่มีการตั้งค่าจุดงานยาก</div>`;
    return;
  }

  container.innerHTML = allStationConfigs.map(s => {
    const pts = parseFloat(s.bonus_points).toFixed(1);
    const isMonthly = s.bonus_frequency === 'MONTHLY';
    const freqLabel = isMonthly ? 'รอบทุกเดือน (Monthly Cycle)' : 'ต่อรอบประเมิน (Per Period)';
    const ptsText = isMonthly ? `+${pts} แต้ม / เดือน` : `+${pts} แต้ม / รอบ`;
    const statusBadge = s.is_active 
      ? '<span class="badge" style="background: #D1FAE5; color: #065F46;"><i class="fa-solid fa-circle-check"></i> เปิดใช้งาน</span>'
      : '<span class="badge" style="background: #FEE2E2; color: #991B1B;"><i class="fa-solid fa-circle-xmark"></i> ปิดใช้งาน</span>';

    return `
      <div class="card" style="margin-bottom: 0; padding: 18px 20px; border-left: 5px solid #4F46E5; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
            <div>
              <span style="font-size: 11px; font-weight: 700; color: #6366F1; text-transform: uppercase;">${s.station_code}</span>
              <h4 style="font-size: 16px; font-weight: 700; color: #1E293B; margin: 4px 0 0 0;">${s.station_name}</h4>
            </div>
            ${statusBadge}
          </div>
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px; margin: 12px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 12.5px; color: #64748B;">แต้มบวกอัตโนมัติ:</span>
              <strong style="font-size: 16px; color: #059669;">${ptsText}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #64748B;">
              <span>ความถี่:</span>
              <span style="font-weight: 600; color: #4338CA;">${freqLabel}</span>
            </div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 10px; border-top: 1px dashed #E2E8F0;">
          <span style="font-size: 12px; color: #64748B;">
            <i class="fa-solid fa-users" style="color: #4F46E5;"></i> ประจำอยู่: <b>${s.assigned_count || 0}</b> คน
          </span>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="openEditStationModal('${s.station_code}')" title="แก้ไขการตั้งค่า" style="padding: 4px 10px; font-size: 12px;">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            <button class="btn btn-sm btn-danger" onclick="deleteStationConfig('${s.station_code}')" title="ลบจุดนี้" style="padding: 4px 8px; font-size: 12px;">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function populateStationDropdowns() {
  const filterSelect = document.getElementById('stationFilterSelect');
  const assignSelect = document.getElementById('assignStationCodeSelect');

  if (filterSelect) {
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = '<option value="ALL">ทุกจุดงานยาก</option>';
    allStationConfigs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.station_code;
      opt.innerText = `${s.station_name} (+${s.bonus_points} แต้ม/เดือน)`;
      filterSelect.appendChild(opt);
    });
    if (currentVal) filterSelect.value = currentVal;
  }

  if (assignSelect) {
    assignSelect.innerHTML = '<option value="">-- กรุณาเลือกจุดจ่ายงานยาก --</option>';
    allStationConfigs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.station_code;
      opt.dataset.points = s.bonus_points;
      opt.dataset.frequency = s.bonus_frequency;
      opt.innerText = `${s.station_name} (+${s.bonus_points} แต้ม/เดือน)`;
      assignSelect.appendChild(opt);
    });
  }
}

async function loadStationAssignments() {
  try {
    const res = await fetch('/api/kpi/station-assignments');
    const json = await res.json();
    if (!json.success) return;
    allStationAssignments = json.assignments || [];
    currentPeriodMonthsElapsed = json.period_months_elapsed || 1;
    renderStationAssignmentsTable(allStationAssignments);
  } catch (err) {
    console.error('Error loading station assignments:', err);
  }
}

function renderStationAssignmentsTable(list) {
  const tbody = document.getElementById('stationAssignmentsTableBody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #94A3B8; padding: 30px;">ยังไม่มีรายชื่อพนักงานประจำจุดจ่ายงานยากในรอบนี้</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(a => {
    const pts = parseFloat(a.bonus_points).toFixed(1);
    const isAllMonths = (!a.assigned_month || a.assigned_month === 'ALL');
    const cycleBadge = isAllMonths 
      ? `<span class="badge" style="background: #ECFDF5; color: #065F46; font-weight: 600;"><i class="fa-solid fa-arrows-rotate"></i> ทุกเดือน (${currentPeriodMonthsElapsed} เดือน)</span>`
      : `<span class="badge" style="background: #EFF6FF; color: #1D4ED8; font-weight: 600;"><i class="fa-solid fa-calendar-day"></i> เดือน ${a.assigned_month}</span>`;
    
    const totalPts = isAllMonths 
      ? (parseFloat(a.bonus_points) * currentPeriodMonthsElapsed) 
      : parseFloat(a.bonus_points);

    const assigner = a.assigner_name || a.assigned_by || '-';
    const remark = a.remark || '-';

    return `
      <tr>
        <td style="font-weight: 700; color: #1E293B;">${a.em_code}</td>
        <td style="font-weight: 600;">${a.name_th}</td>
        <td>
          <span class="badge" style="background: #F1F5F9; color: #334155; font-size: 12px;">${a.dept || '-'}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${a.position_name || '-'}</div>
        </td>
        <td>
          <span class="badge" style="background: #EEF2FF; color: #3730A3; font-weight: 700; font-size: 12.5px;">
            <i class="fa-solid fa-award" style="color: #6366F1;"></i> ${a.station_name}
          </span>
        </td>
        <td>${cycleBadge}</td>
        <td style="color: #059669; font-weight: 700; font-size: 13.5px;">+${pts} แต้ม/ด.</td>
        <td>
          <strong style="color: #047857; font-size: 14px; background: #D1FAE5; padding: 4px 10px; border-radius: 6px; display: inline-block;">
            +${totalPts.toFixed(1)} แต้ม
          </strong>
        </td>
        <td style="font-size: 12px; color: #64748B;">${assigner}</td>
        <td style="font-size: 12px; color: #64748B; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${remark}">${remark}</td>
        <td style="text-align: center;">
          <button class="btn btn-sm btn-danger" onclick="deleteStationAssignment(${a.assignment_id}, '${a.name_th}', '${a.station_name}')" title="ยกเลิกการประจำจุดนี้" style="padding: 4px 10px; font-size: 12px;">
            <i class="fa-solid fa-user-minus"></i> ยกเลิก
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filterStationAssignments() {
  const query = (document.getElementById('stationAssignSearchInput')?.value || '').trim().toLowerCase();
  const stationFilter = document.getElementById('stationFilterSelect')?.value || 'ALL';

  const filtered = allStationAssignments.filter(a => {
    const matchStation = (stationFilter === 'ALL' || a.station_code === stationFilter);
    const matchQuery = !query || 
      (a.em_code || '').toLowerCase().includes(query) ||
      (a.name_th || '').toLowerCase().includes(query) ||
      (a.dept || '').toLowerCase().includes(query) ||
      (a.station_name || '').toLowerCase().includes(query) ||
      (a.assigned_month || '').toLowerCase().includes(query);
    return matchStation && matchQuery;
  });

  renderStationAssignmentsTable(filtered);
}

// Modal Assign Station
function openAssignStationModal() {
  if (allEmployeesMaster.length === 0) {
    loadEmployees().then(() => populateAssignStationEmpDropdown());
  } else {
    populateAssignStationEmpDropdown();
  }

  const searchInput = document.getElementById('assignEmpSearchInput');
  if (searchInput) searchInput.value = '';
  const badge = document.getElementById('assignEmpDeptBadge');
  if (badge) badge.style.display = 'none';
  const remarkInput = document.getElementById('assignStationRemark');
  if (remarkInput) remarkInput.value = '';

  // Setup monthly cycle options
  const monthSelect = document.getElementById('assignStationMonthSelect');
  if (monthSelect) {
    monthSelect.innerHTML = '<option value="ALL">🔄 รอบประจำทุกเดือน (สะสมทุกเดือนในรอบประเมิน)</option>';
    const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const curYear = new Date().getFullYear();
    for (let m = 1; m <= 12; m++) {
      const mStr = m < 10 ? `0${m}` : `${m}`;
      const val = `${curYear}-${mStr}`;
      const opt = document.createElement('option');
      opt.value = val;
      opt.innerText = `📅 เฉพาะเดือน ${thaiMonths[m - 1]} ${curYear} (${val})`;
      monthSelect.appendChild(opt);
    }
    monthSelect.value = 'ALL';
  }

  populateStationDropdowns();
  onAssignStationCodeChanged();

  document.getElementById('assignStationModal').classList.add('active');
}

function closeAssignStationModal() {
  document.getElementById('assignStationModal').classList.remove('active');
}

function populateAssignStationEmpDropdown(filteredList = null) {
  const select = document.getElementById('assignStationEmpSelect');
  if (!select) return;
  const list = filteredList !== null ? filteredList : allEmployeesMaster;

  select.innerHTML = '<option value="">-- เลือกรหัส / ชื่อพนักงาน --</option>';
  list.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.em_code;
    const deptInfo = e.dept || '-';
    const posInfo = e.position_name ? ` • ${e.position_name}` : '';
    opt.innerText = `${e.em_code} - ${e.name_th} (${deptInfo}${posInfo})`;
    select.appendChild(opt);
  });
}

function filterAssignStationEmployees() {
  const query = (document.getElementById('assignEmpSearchInput')?.value || '').trim().toLowerCase();
  if (!query) {
    populateAssignStationEmpDropdown(null);
    return;
  }
  const filtered = allEmployeesMaster.filter(e => {
    return (e.em_code || '').toLowerCase().includes(query) ||
           (e.name_th || '').toLowerCase().includes(query) ||
           (e.dept || '').toLowerCase().includes(query);
  });
  populateAssignStationEmpDropdown(filtered);
}

function onAssignStationEmpSelected() {
  const select = document.getElementById('assignStationEmpSelect');
  const badge = document.getElementById('assignEmpDeptBadge');
  const btnSubmit = document.getElementById('btnSubmitAssignStation');

  const emCode = select ? select.value : '';
  if (!emCode) {
    if (badge) badge.style.display = 'none';
    if (btnSubmit) btnSubmit.disabled = false;
    return;
  }

  const emp = allEmployeesMaster.find(e => e.em_code === emCode);
  if (!emp || !badge) return;

  if (desktopCurrentUser) {
    const isGlobalAdmin = ['Admin', 'Executive'].includes(desktopCurrentUser.role) || 
                          desktopCurrentUser.team === 'WH' || 
                          desktopCurrentUser.grp === 'WH';

    const isSameDept = isGlobalAdmin || (
      (desktopCurrentUser.grp && emp.grp && desktopCurrentUser.grp === emp.grp) ||
      (desktopCurrentUser.team && emp.team && desktopCurrentUser.team === emp.team) ||
      (desktopCurrentUser.dept && emp.dept && desktopCurrentUser.dept === emp.dept)
    );

    if (!isSameDept) {
      badge.style.display = 'block';
      badge.style.background = '#FEE2E2';
      badge.style.border = '1.5px solid #FCA5A5';
      badge.style.color = '#B91C1C';
      badge.innerHTML = `
        <div style="font-weight: 700;">⚠️ ไม่อนุญาตให้กำหนดจุดงานยากข้ามแผนก!</div>
        <div style="font-size: 12px; margin-top: 2px;">
          คุณ (${desktopCurrentUser.fullname}) สังกัด "${desktopCurrentUser.dept || desktopCurrentUser.grp}"<br>
          แต่พนักงาน (${emp.name_th}) สังกัด "${emp.dept || emp.grp}"
        </div>
      `;
      if (btnSubmit) btnSubmit.disabled = true;
      return;
    }
  }

  badge.style.display = 'block';
  badge.style.background = '#ECFDF5';
  badge.style.border = '1px solid #A7F3D0';
  badge.style.color = '#065F46';
  badge.innerHTML = `
    <div><i class="fa-solid fa-circle-check"></i> <strong>${emp.em_code} - ${emp.name_th}</strong> (แผนก: ${emp.dept || '-'})</div>
  `;
  if (btnSubmit) btnSubmit.disabled = false;
}

function onAssignStationCodeChanged() {
  const select = document.getElementById('assignStationCodeSelect');
  const monthSelect = document.getElementById('assignStationMonthSelect');
  const preview = document.getElementById('assignStationPreviewPoints');
  const monthDesc = document.getElementById('assignMonthDesc');
  if (!select || !preview) return;

  const opt = select.options[select.selectedIndex];
  const selMonth = monthSelect ? monthSelect.value : 'ALL';

  if (opt && opt.dataset.points) {
    const pts = parseFloat(opt.dataset.points);
    if (selMonth === 'ALL') {
      const totalPts = pts * currentPeriodMonthsElapsed;
      preview.innerHTML = `💡 <strong>คิดคะแนนรอบทุกเดือน:</strong> +${pts.toFixed(1)} แต้ม/เดือน &nbsp;|&nbsp; สะสมปัจจุบัน (${currentPeriodMonthsElapsed} เดือน) = <strong style="color: #047857; text-decoration: underline;">+${totalPts.toFixed(1)} แต้ม</strong>`;
      if (monthDesc) monthDesc.innerText = `ระบบจะคำนวณบวกคะแนนสะสมต่อเนื่องทุกเดือนในรอบประเมิน (ปัจจุบันสะสมแล้ว ${currentPeriodMonthsElapsed} เดือน)`;
    } else {
      preview.innerHTML = `💡 <strong>คิดคะแนนเฉพาะเดือน ${selMonth}:</strong> ได้รับ <strong style="color: #047857;">+${pts.toFixed(1)} แต้ม</strong> ในเดือนดังกล่าว`;
      if (monthDesc) monthDesc.innerText = `ระบบจะบวกคะแนนเฉพาะรอบของเดือน ${selMonth}`;
    }
  } else {
    preview.innerText = '';
  }
}

async function submitAssignStation(event) {
  event.preventDefault();
  const emCode = document.getElementById('assignStationEmpSelect').value;
  const stationCode = document.getElementById('assignStationCodeSelect').value;
  const assignedMonth = document.getElementById('assignStationMonthSelect')?.value || 'ALL';
  const remark = document.getElementById('assignStationRemark').value;

  if (!emCode || !stationCode) {
    alert('กรุณาเลือกพนักงานและจุดงานยาก');
    return;
  }

  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  try {
    const btn = document.getElementById('btnSubmitAssignStation');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    const res = await fetch('/api/kpi/station-assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        em_code: emCode,
        station_code: stationCode,
        assigned_month: assignedMonth,
        assigned_by: assignedBy,
        remark: remark
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกและคำนวณคะแนนทันที';

    if (!json.success) throw new Error(json.message);

    alert(json.message);
    closeAssignStationModal();
    loadStationsData();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deleteStationAssignment(id, empName, stationName) {
  if (!confirm(`คุณต้องการยกเลิกการประจำจุด "${stationName}" ของคุณ ${empName} ใช่หรือไม่?\n(ระบบจะคำนวณหักคะแนนบวกอัตโนมัตินี้ออกทันที)`)) {
    return;
  }

  try {
    const res = await fetch(`/api/kpi/station-assignments/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    loadStationsData();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// Modal Station Config
function openAddStationModal() {
  document.getElementById('stationConfigModalTitle').innerHTML = '<i class="fa-solid fa-plus-circle" style="color: #4F46E5;"></i> เพิ่มจุดจ่ายงานยากใหม่';
  document.getElementById('stationConfigIsEdit').value = '0';
  const codeInput = document.getElementById('cfgStationCode');
  codeInput.value = '';
  codeInput.disabled = false;
  document.getElementById('cfgStationName').value = '';
  document.getElementById('cfgBonusPoints').value = '10.0';
  document.getElementById('cfgBonusFrequency').value = 'MONTHLY';
  document.getElementById('cfgStationIsActive').checked = true;

  document.getElementById('stationConfigModal').classList.add('active');
}

function openEditStationModal(code) {
  const station = allStationConfigs.find(s => s.station_code === code);
  if (!station) return;

  document.getElementById('stationConfigModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square" style="color: #4F46E5;"></i> แก้ไขเกณฑ์จุดจ่ายงานยาก';
  document.getElementById('stationConfigIsEdit').value = '1';
  const codeInput = document.getElementById('cfgStationCode');
  codeInput.value = station.station_code;
  codeInput.disabled = true; // Key cannot be edited
  document.getElementById('cfgStationName').value = station.station_name;
  document.getElementById('cfgBonusPoints').value = station.bonus_points;
  document.getElementById('cfgBonusFrequency').value = station.bonus_frequency || 'PERIOD';
  document.getElementById('cfgStationIsActive').checked = (station.is_active !== false);

  document.getElementById('stationConfigModal').classList.add('active');
}

function closeStationConfigModal() {
  document.getElementById('stationConfigModal').classList.remove('active');
}

async function submitStationConfig(event) {
  event.preventDefault();
  const code = document.getElementById('cfgStationCode').value.trim();
  const name = document.getElementById('cfgStationName').value.trim();
  const points = parseFloat(document.getElementById('cfgBonusPoints').value);
  const freq = document.getElementById('cfgBonusFrequency').value;
  const active = document.getElementById('cfgStationIsActive').checked;

  if (!code || !name || isNaN(points)) {
    alert('กรุณากรอกข้อมูลให้ครบถ้วน');
    return;
  }

  try {
    const btn = document.getElementById('btnSubmitStationConfig');
    btn.disabled = true;
    btn.innerText = 'กำลังบันทึก...';

    const res = await fetch('/api/kpi/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station_code: code,
        station_name: name,
        bonus_points: points,
        bonus_frequency: freq,
        is_active: active
      })
    });
    const json = await res.json();
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-save"></i> บันทึกการตั้งค่า';

    if (!json.success) throw new Error(json.message);

    alert(json.message);
    closeStationConfigModal();
    loadStationsData();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// ==============================================================================
// 11. Individual Employee Transactions & Scorecard Ledger
// ==============================================================================
let currentEmpTransactions = [];
let currentTxFilter = 'ALL';
let selectedTxEmp = null;

function populateTxDropdown(selectedCode = '') {
  const select = document.getElementById('txEmpDropdownSelect');
  if (!select) return;

  const currentVal = selectedCode || select.value;
  select.innerHTML = '<option value="">-- กรุณาเลือกพนักงาน --</option>';

  const sorted = [...allEmployeesMaster].sort((a, b) => (a.em_code || '').localeCompare(b.em_code || ''));
  sorted.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp.em_code;
    const dept = emp.dept || emp.grp || '-';
    const pos = emp.position_name ? ` (${emp.position_name})` : '';
    opt.textContent = `${emp.em_code} - ${emp.name_th} [${dept}]${pos}`;
    select.appendChild(opt);
  });

  if (currentVal) {
    select.value = currentVal;
  }
}

function onTxDropdownSelect(emCode) {
  if (!emCode) {
    document.getElementById('txDetailContainer').style.display = 'none';
    document.getElementById('txEmptyState').style.display = 'block';
    selectedTxEmp = null;
    return;
  }
  const searchInput = document.getElementById('txEmpSearchInput');
  if (searchInput) searchInput.value = emCode;
  loadEmployeeTransactions(emCode);
}

function searchTxEmployee() {
  const rawQuery = (document.getElementById('txEmpSearchInput').value || '').trim().toLowerCase();
  if (!rawQuery) {
    alert('กรุณากรอกรหัสพนักงาน หรือชื่อที่ต้องการค้นหา');
    return;
  }

  // 1. Direct exact match by em_code
  let matched = allEmployeesMaster.find(e => (e.em_code || '').toLowerCase() === rawQuery);

  // 2. Partial match
  if (!matched) {
    matched = allEmployeesMaster.find(e => 
      (e.em_code || '').toLowerCase().includes(rawQuery) || 
      (e.name_th || '').toLowerCase().includes(rawQuery)
    );
  }

  if (!matched) {
    alert(`ไม่พบข้อมูลพนักงานที่ตรงกับ "${rawQuery}"`);
    return;
  }

  const dropdown = document.getElementById('txEmpDropdownSelect');
  if (dropdown) dropdown.value = matched.em_code;
  loadEmployeeTransactions(matched.em_code);
}

function viewEmpTransactions(emCode) {
  if (!emCode) return;
  switchTab('transactions');
  const searchInput = document.getElementById('txEmpSearchInput');
  if (searchInput) searchInput.value = emCode;
  const dropdown = document.getElementById('txEmpDropdownSelect');
  if (dropdown) dropdown.value = emCode;
  loadEmployeeTransactions(emCode);
}

async function loadEmployeeTransactions(emCode) {
  try {
    const res = await fetch(`/api/kpi/employee/${encodeURIComponent(emCode)}`);
    const json = await res.json();

    if (!json.success || !json.employee) {
      alert('ไม่พบข้อมูลคะแนนของพนักงานรหัส: ' + emCode);
      return;
    }

    selectedTxEmp = json.employee;
    currentEmpTransactions = json.timeline || [];

    // Render Employee Profile Card
    document.getElementById('txEmpName').innerText = selectedTxEmp.name_th || 'ไม่ระบุชื่อ';
    document.getElementById('txEmpCodeBadge').innerText = selectedTxEmp.em_code;
    document.getElementById('txEmpDept').innerText = selectedTxEmp.team || selectedTxEmp.grp || '-';
    document.getElementById('txEmpPos').innerText = selectedTxEmp.position_name || '-';
    document.getElementById('txPeriodName').innerText = selectedTxEmp.period_name || 'รอบปัจจุบัน';

    const initScore = parseFloat(selectedTxEmp.initial_score || 100);
    const totalDeduct = parseFloat(selectedTxEmp.total_deducted || 0);
    const totalAdded = parseFloat(selectedTxEmp.total_added || 0);
    const netScore = parseFloat(selectedTxEmp.net_score || 0);
    const grade = selectedTxEmp.current_grade || 'A';

    document.getElementById('txInitScore').innerText = initScore.toFixed(1);
    document.getElementById('txTotalDeduct').innerText = `-${totalDeduct.toFixed(1)}`;
    document.getElementById('txTotalAdded').innerText = `+${totalAdded.toFixed(1)}`;
    document.getElementById('txNetScore').innerText = netScore.toFixed(1);

    const gradeBadge = document.getElementById('txGradeBadge');
    if (gradeBadge) {
      gradeBadge.className = `badge badge-grade-${grade}`;
      gradeBadge.innerText = `เกรด ${grade}`;
    }

    // Toggle container display
    document.getElementById('txEmptyState').style.display = 'none';
    document.getElementById('txDetailContainer').style.display = 'block';

    // Reset Filter and Render Table
    currentTxFilter = 'ALL';
    updateTxFilterButtons();
    renderTransactionsTable(currentEmpTransactions);

  } catch (err) {
    alert('เกิดข้อผิดพลาดในการโหลดประวัติ: ' + err.message);
  }
}

function filterTransactions(type) {
  currentTxFilter = type;
  updateTxFilterButtons();

  let filtered = [...currentEmpTransactions];
  if (type === 'DEDUCT') {
    filtered = filtered.filter(t => parseFloat(t.points_change) < 0);
  } else if (type === 'BONUS') {
    filtered = filtered.filter(t => parseFloat(t.points_change) > 0);
  } else if (type === 'AUTO') {
    filtered = filtered.filter(t => (t.source_type || '').toUpperCase() === 'AUTO');
  } else if (type === 'MANUAL') {
    filtered = filtered.filter(t => (t.source_type || '').toUpperCase() === 'MANUAL');
  }

  renderTransactionsTable(filtered);
}

function updateTxFilterButtons() {
  const map = {
    'ALL': 'btnFilterTxAll',
    'DEDUCT': 'btnFilterTxDeduct',
    'BONUS': 'btnFilterTxBonus',
    'AUTO': 'btnFilterTxAuto',
    'MANUAL': 'btnFilterTxManual'
  };

  Object.keys(map).forEach(k => {
    const btn = document.getElementById(map[k]);
    if (!btn) return;
    if (k === currentTxFilter) {
      btn.style.background = '#FFFFFF';
      btn.style.color = '#4F46E5';
      btn.style.fontWeight = '700';
      btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#64748B';
      btn.style.fontWeight = '600';
      btn.style.boxShadow = 'none';
    }
  });
}

function renderTransactionsTable(list) {
  const tbody = document.getElementById('txTableBody');
  const countBadge = document.getElementById('txCountBadge');
  if (countBadge) countBadge.innerText = list.length;
  if (!tbody) return;

  tbody.innerHTML = '';

  if (!list || list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: #94A3B8;">
          <i class="fa-solid fa-folder-open" style="font-size: 28px; margin-bottom: 8px; display: block; color: #CBD5E1;"></i>
          ไม่พบรายการประวัติคะแนนตามเงื่อนไขที่เลือก
        </td>
      </tr>
    `;
    return;
  }

  list.forEach((t, i) => {
    const tr = document.createElement('tr');
    const pts = parseFloat(t.points_change || 0);
    const isNegative = pts < 0;
    const isAuto = (t.source_type || '').toUpperCase() === 'AUTO';

    // Format transaction date (Thai)
    let dateStr = '-';
    if (t.transaction_date) {
      const d = new Date(t.transaction_date);
      dateStr = d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Format created timestamp
    let createdTimeStr = '-';
    if (t.created_at) {
      const cd = new Date(t.created_at);
      createdTimeStr = cd.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    // Type Badge
    const typeBadge = isAuto
      ? `<span class="badge" style="background: #EEF2FF; color: #4F46E5; font-weight: 700; border: 1px solid #C7D2FE;"><i class="fa-solid fa-robot"></i> Auto ระบบ</span>`
      : `<span class="badge" style="background: #FEF3C7; color: #B45309; font-weight: 700; border: 1px solid #FDE68A;"><i class="fa-solid fa-user-check"></i> Manual หัวหน้า</span>`;

    // Points style
    const pointsHtml = isNegative
      ? `<span style="color: #EF4444; font-weight: 800; font-size: 15px;">${pts.toFixed(2)} แต้ม</span>`
      : `<span style="color: #10B981; font-weight: 800; font-size: 15px;">+${pts.toFixed(2)} แต้ม</span>`;

    // Reason highlight: If reason starts with "ลาป่วย", "ขาด", etc.
    let reasonHtml = t.reason_description || '-';
    if (reasonHtml.includes('ลาป่วย')) {
      reasonHtml = `<span style="color: #DC2626; font-weight: 600;"><i class="fa-solid fa-head-side-cough"></i> ${reasonHtml}</span>`;
    } else if (reasonHtml.includes('ขาดงาน') || reasonHtml.includes('ขาด')) {
      reasonHtml = `<span style="color: #991B1B; font-weight: 600;"><i class="fa-solid fa-user-xmark"></i> ${reasonHtml}</span>`;
    } else if (reasonHtml.includes('สาย')) {
      reasonHtml = `<span style="color: #D97706; font-weight: 600;"><i class="fa-solid fa-business-time"></i> ${reasonHtml}</span>`;
    }

    // Attachment
    let attachHtml = '<span style="color: #CBD5E1;">-</span>';
    if (t.attachment_url) {
      attachHtml = `
        <button type="button" class="btn btn-sm btn-secondary" onclick="openTxPhotoModal('${t.attachment_url}')" style="padding: 2px 8px; font-size: 11px;" title="คลิกดูรูปหลักฐาน">
          <i class="fa-solid fa-image" style="color: #4F46E5;"></i> รูป
        </button>
      `;
    }

    tr.innerHTML = `
      <td style="color: #94A3B8; font-weight: 600;">#${i + 1}</td>
      <td style="font-weight: 700; color: #1E293B; white-space: nowrap;">
        <i class="fa-regular fa-calendar" style="color: #64748B; margin-right: 4px;"></i> ${dateStr}
      </td>
      <td>${typeBadge}</td>
      <td style="font-size: 14px;">${reasonHtml}</td>
      <td style="text-align: right; white-space: nowrap;">${pointsHtml}</td>
      <td style="font-size: 12px; color: #64748B;">
        <span class="badge" style="background: #F8FAFC; color: #475569; border: 1px solid #E2E8F0;">
          ${t.created_by || 'SYSTEM'}
        </span>
      </td>
      <td style="text-align: center;">${attachHtml}</td>
      <td style="font-size: 12px; color: #94A3B8; white-space: nowrap;">${createdTimeStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

function openAdjustForEmpFromTx() {
  if (!selectedTxEmp) return;
  openAdjustForEmp(selectedTxEmp.em_code, selectedTxEmp.name_th);
}

function openTxPhotoModal(url) {
  const modal = document.getElementById('txPhotoModal');
  const img = document.getElementById('txPhotoModalImg');
  if (modal && img) {
    img.src = url;
    modal.classList.add('active');
  }
}

function closeTxPhotoModal() {
  const modal = document.getElementById('txPhotoModal');
  if (modal) modal.classList.remove('active');
}


async function deleteStationConfig(code) {
  if (!confirm(`คุณต้องการลบจุดจ่ายงานยาก "${code}" ใช่หรือไม่?\nพนักงานที่ผูกไว้กับจุดนี้จะถูกยกเลิกด้วย`)) {
    return;
  }

  try {
    const res = await fetch(`/api/kpi/stations/${code}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    loadStationsData();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

