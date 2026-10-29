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
async function initDesktopUser() {
  const urlParams = new URLSearchParams(window.location.search);
  const ssoUser = urlParams.get('sso_user');
  const ssoTs = urlParams.get('ts');
  const ssoToken = urlParams.get('token');
  const hostname = window.location.hostname;
  const isLocalIntranet = (hostname === '10.5.3.242' || hostname === 'localhost' || hostname === '127.0.0.1');

  // 1) เฉพาะบนระบบภายใน (http://10.5.3.242:8882) หากคลิกมาจากแท็บเมนู Evaluation score (Main Menu จาก http://10.5.3.242:8888) ให้ดึง User ตาม Main Menu ทันที
  if (isLocalIntranet && ssoUser && ssoTs && ssoToken) {
    try {
      const res = await fetch('/api/auth/sso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sso_user: ssoUser, ts: ssoTs, token: ssoToken })
      });
      const json = await res.json();
      if (json.success && json.user) {
        if (json.is_supervisor) {
          desktopCurrentUser = json.user;
          localStorage.setItem('warelio_supervisor_user', JSON.stringify(desktopCurrentUser));
          renderDesktopUserHeader();
          closeLoginModal();
          loadAllDashboardData();
          updateModalSupervisorBar();
          onAdjustEmpSelected();
          return;
        } else {
          // หากเป็นพนักงานทั่วไป (Staff / User) ให้พาไปหน้าดูคะแนนของตัวเองพร้อมรหัสพนักงาน
          localStorage.setItem('warelio_emp_id', json.user.username);
          window.location.href = `/mobile.html?sso_user=${encodeURIComponent(ssoUser)}&ts=${encodeURIComponent(ssoTs)}&token=${encodeURIComponent(ssoToken)}`;
          return;
        }
      }
    } catch (err) {
      console.error('SSO auto-login error:', err);
    }
  }

  // 2) หากเปิด http://10.5.3.242:8882 และเคยซิงก์ User จาก Main Menu ไว้แล้ว ให้ใช้ User นั้นต่อได้โดยไม่ต้องล็อกอินซ้ำ
  if (isLocalIntranet) {
    const savedUser = localStorage.getItem('warelio_supervisor_user');
    if (savedUser) {
      try {
        desktopCurrentUser = JSON.parse(savedUser);
        if (desktopCurrentUser && desktopCurrentUser.username) {
          renderDesktopUserHeader();
          closeLoginModal();
          loadAllDashboardData();
          updateModalSupervisorBar();
          onAdjustEmpSelected();
          return;
        }
      } catch (e) {
        desktopCurrentUser = null;
      }
    }
  }

  // 3) ส่วน Web ภายนอก (Cloud / Render) หรือยังไม่มี User ในระบบ ต้อง Log in ทุกครั้ง
  desktopCurrentUser = null;
  localStorage.removeItem('warelio_supervisor_user');
  renderDesktopUserHeader();
  if (isLocalIntranet && ssoUser) {
    const userInp = document.getElementById('desktopLoginUsername');
    if (userInp) userInp.value = ssoUser;
  }
  openLoginModal();
}

function renderDesktopUserHeader() {
  const container = document.getElementById('desktopUserHeader');
  if (!container) return;

  if (desktopCurrentUser) {
    const deptStr = desktopCurrentUser.dept || desktopCurrentUser.grp ? ` • ${desktopCurrentUser.dept || desktopCurrentUser.grp}` : '';
    container.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; background: #F8FAFC; border: 1px solid #CBD5E1; padding: 5px 10px; border-radius: 6px; font-size: 12.5px;">
        <i class="fa-solid fa-user-check" style="color: #2563EB; font-size: 13px;"></i>
        <div>
          <strong style="color: #0F172A;">${desktopCurrentUser.fullname || desktopCurrentUser.username}</strong>
          <span style="font-size: 11.5px; color: #64748B; margin-left: 4px;">(${desktopCurrentUser.role}${deptStr})</span>
        </div>
        <button onclick="handleDesktopLogout()" title="ออกจากระบบ" style="border: none; background: none; color: #64748B; cursor: pointer; padding: 2px 4px; font-size: 12.5px; margin-left: 2px;" onmouseover="this.style.color='#DC2626'" onmouseout="this.style.color='#64748B'">
          <i class="fa-solid fa-right-from-bracket"></i>
        </button>
      </div>
    `;
  } else {
    container.innerHTML = `
      <button class="btn btn-secondary" onclick="openLoginModal()">
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
    const hostname = window.location.hostname;
    if (hostname === '10.5.3.242' || hostname === 'localhost' || hostname === '127.0.0.1') {
      localStorage.setItem('warelio_supervisor_user', JSON.stringify(desktopCurrentUser));
    }
    renderDesktopUserHeader();
    closeLoginModal();

    loadAllDashboardData();
    updateModalSupervisorBar();
    populateEmpDropdown();
    onAdjustEmpSelected();
    if (document.getElementById('viewStations')?.style.display !== 'none') {
      loadStationsData();
    }
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
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 36px; color: #64748B;">ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา</td></tr>`;
    return;
  }

  data.forEach((row, index) => {
    const rankNum = index + 1;
    const rankClass = rankNum <= 3 ? `rank-cell rank-${rankNum}` : 'rank-cell';
    const deductVal = parseFloat(row.total_deducted || 0);
    const addedVal = parseFloat(row.total_added || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="text-center"><span class="${rankClass}">${rankNum}</span></td>
      <td class="font-mono" style="font-weight: 600; color: #1E293B;">${row.em_code}</td>
      <td style="font-weight: 600; color: #0F172A;">${row.name_th || '-'}</td>
      <td><span class="badge badge-neutral">${row.team || row.grp || '-'}</span></td>
      <td style="color: #475569;">${row.position_name || '-'}</td>
      <td class="text-right" style="color: #475569;">${parseFloat(row.initial_score).toFixed(1)}</td>
      <td class="text-right" style="color: ${deductVal > 0 ? '#DC2626' : '#94A3B8'}; font-weight: ${deductVal > 0 ? '600' : '400'};">${deductVal > 0 ? '-' : ''}${deductVal.toFixed(1)}</td>
      <td class="text-right" style="color: ${addedVal > 0 ? '#059669' : '#94A3B8'}; font-weight: ${addedVal > 0 ? '600' : '400'};">${addedVal > 0 ? '+' : ''}${addedVal.toFixed(1)}</td>
      <td class="text-right" style="font-size: 14px; font-weight: 700; color: #0F172A;">${parseFloat(row.net_score).toFixed(1)}</td>
      <td class="text-center"><span class="badge badge-grade-${row.current_grade}">เกรด ${row.current_grade}</span></td>
      <td class="text-right" style="white-space: nowrap;">
        <button class="btn btn-sm btn-secondary" style="margin-right: 4px;" onclick="viewEmpTransactions('${row.em_code}')" title="ดูประวัติการหัก/บวกคะแนน">
          <i class="fa-solid fa-file-lines" style="color: #2563EB;"></i> ดูประวัติ
        </button>
        <button class="btn btn-sm btn-secondary" onclick="openAdjustForEmp('${row.em_code}', '${row.name_th}')" title="ปรับคะแนนพนักงาน">
          <i class="fa-solid fa-pen-to-square" style="color: #475569;"></i> ปรับคะแนน
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
function isAdminRole(user) {
  if (!user) return false;
  return String(user.role || '').trim().toLowerCase() === 'admin';
}

function isSameDeptForAdjust(emp, user) {
  if (!user || !emp) return false;
  if (isAdminRole(user)) return true;

  const userDept = String(user.dept || user.team || user.grp || '').trim();
  const empDept = String(emp.dept || emp.team || emp.grp || '').trim();
  if (!userDept || userDept === '-') return false;
  return empDept === userDept;
}

function getScopedEmployeesForAdjust() {
  if (!desktopCurrentUser) return [];
  if (isAdminRole(desktopCurrentUser)) {
    return allEmployeesMaster;
  }
  return allEmployeesMaster.filter(e => isSameDeptForAdjust(e, desktopCurrentUser));
}

async function loadEmployees() {
  try {
    const res = await fetch('/api/kpi/employees');
    const json = await res.json();
    if (json.success) {
      allEmployeesMaster = json.employees || [];
      populateEmpDropdown();
      populateTxDropdown();
    }
  } catch (err) {
    console.error('Error loading employees:', err);
  }
}

function getTodayLocalISO() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

  // Default transaction date = today
  const dateInput = document.getElementById('adjustDate');
  if (dateInput) {
    dateInput.value = getTodayLocalISO();
  }

  updateReasonDropdown();
  document.getElementById('adjustModal').classList.add('active');
}

function closeAdjustModal() {
  document.getElementById('adjustModal').classList.remove('active');
}

function openAdjustForEmp(emCode, name) {
  if (!desktopCurrentUser) {
    openLoginModal();
    return;
  }

  const targetEmp = allEmployeesMaster.find(e => e.em_code === emCode);
  if (targetEmp && !isSameDeptForAdjust(targetEmp, desktopCurrentUser)) {
    const supDept = desktopCurrentUser.dept || desktopCurrentUser.team || desktopCurrentUser.grp || '-';
    const empDept = targetEmp.dept || targetEmp.team || targetEmp.grp || '-';
    alert(`ไม่อนุญาตให้ปรับคะแนนข้ามแผนก\nบัญชีของคุณ (${desktopCurrentUser.role}) สังกัดแผนก "${supDept}" สามารถเลือกปรับคะแนนได้เฉพาะพนักงานในแผนก "${supDept}" เท่านั้น (พนักงาน ${name || emCode} สังกัดแผนก "${empDept}")`);
    return;
  }

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

  const baseList = getScopedEmployeesForAdjust();
  const list = filteredList !== null ? filteredList : baseList;
  const userDept = desktopCurrentUser ? (desktopCurrentUser.dept || desktopCurrentUser.team || desktopCurrentUser.grp || '-') : '-';
  const isAdmin = isAdminRole(desktopCurrentUser);

  const defaultLabel = isAdmin
    ? '-- เลือกรหัส / ชื่อพนักงาน (ทุกแผนก) --'
    : `-- เลือกรหัส / ชื่อพนักงาน (เฉพาะแผนก ${userDept}) --`;
  select.innerHTML = `<option value="">${defaultLabel}</option>`;

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
      countBadge.innerText = `(พบ ${list.length} คน${!isAdmin ? ` ในแผนก ${userDept}` : ''})`;
      countBadge.style.color = list.length > 0 ? '#2563EB' : '#DC2626';
    } else {
      countBadge.innerText = isAdmin
        ? `(ทุกแผนก ${baseList.length} คน)`
        : `(เฉพาะแผนก ${userDept}: ${baseList.length} คน)`;
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

  const baseList = getScopedEmployeesForAdjust();
  const filtered = baseList.filter(e => {
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
  const isSameDept = isSameDeptForAdjust(emp, desktopCurrentUser);

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
  const transactionDate = document.getElementById('adjustDate')?.value || getTodayLocalISO();
  const points = document.getElementById('adjustPoints').value;
  const description = document.getElementById('adjustDescription').value;
  const photoInput = document.getElementById('adjustPhoto');

  if (!emCode || !reasonCode || !points || !transactionDate) {
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
    const isSameDept = isSameDeptForAdjust(emp, desktopCurrentUser);

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
  formData.append('transaction_date', transactionDate);
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
    selectPointType(currentPointType);

    if (!json.success) throw new Error(json.message);

    alert('บันทึกการปรับคะแนนเรียบร้อยแล้ว!');
    closeAdjustModal();
    document.getElementById('adjustForm').reset();
    const dateInput = document.getElementById('adjustDate');
    if (dateInput) dateInput.value = getTodayLocalISO();
    loadSummaryData();
    if (selectedTxEmp && selectedTxEmp.em_code === emCode) {
      loadEmployeeTransactions(emCode);
    }
  } catch (err) {
    const btn = document.getElementById('btnSubmitAdjust');
    if (btn) btn.disabled = false;
    selectPointType(currentPointType);
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
    ? 'ทุกตำแหน่ง (All Positions - ค่าเริ่มต้นกลาง)' 
    : `ทุกตำแหน่งในแผนก ${selectedDept} (All Positions)`;
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
    opt.innerText = `ตำแหน่ง: ${pos}`;
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
        <td style="font-weight: 600;">
          ${isGlobal ? '<span class="badge badge-grade-B">เกณฑ์มาตรฐานกลาง (Global)</span>' : `<span style="color:#0F172A;">${p.dept_code}</span>`}
        </td>
        <td>
          ${hasSpecificPos 
            ? `<span class="badge badge-neutral">${p.position_name}</span>` 
            : '<span style="color:#64748B; font-size:12.5px;">ทุกตำแหน่งในแผนก</span>'}
        </td>
        <td>${p.late_penalty_type === 'TIER' ? 'ขั้นบันไดตามนาที' : `คงที่ (-${p.late_fixed_points} แต้ม)`}</td>
        <td class="text-right" style="color:#DC2626; font-weight:600;">-${p.absent_penalty_points} แต้ม</td>
        <td class="text-right" style="color:#DC2626;">-${p.sick_leave_points !== undefined && p.sick_leave_points !== null && Number(p.sick_leave_points) > 0 ? p.sick_leave_points : p.unannounced_leave_points} แต้ม</td>
        <td>
          <div style="color:#059669; font-weight:600;">+${p.weekly_holiday_bonus} แต้ม/วัน</div>
          <div style="font-size:11px; color:#475569; background:#F1F5F9; padding:1px 6px; border-radius:4px; display:inline-block; margin-top:2px;">
            วันหยุด: ${formatDayOffNames(p.weekly_off_days)}
          </div>
        </td>
        <td class="text-right" style="color:#059669; font-weight:600;">+${p.public_holiday_bonus} แต้ม/วัน</td>
        <td>
          <span style="font-size:12px; color:#64748B;">
            ${(p.late_tiers || []).map(t => `${t.min_minutes}-${t.max_minutes || '∞'}m: -${t.deduct_points}`).join(', ') || '-'}
          </span>
        </td>
        <td class="text-right">
          <div style="display: inline-flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="openPolicyModal('${p.dept_code}', '${(p.position_name || 'ALL').replace(/'/g, "\\'")}')">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            ${!isGlobal ? `
              <button class="btn btn-sm btn-secondary" style="color:#DC2626;" onclick="deletePolicy(${p.policy_id}, '${p.dept_code} - ${p.position_name}')" title="ลบเกณฑ์เฉพาะนี้">
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
  deptSelect.innerHTML = '<option value="GLOBAL">เกณฑ์มาตรฐานกลาง (Global Default - ใช้กับทุกแผนก)</option>';

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
    o.innerText = `แผนก / ทีม: ${d}`;
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
    await loadPolicies();
    loadHolidays();
    loadSummaryData();
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
    await loadPolicies();
    loadHolidays();
    loadSummaryData();
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
        <td class="font-mono" style="font-weight: 600; color: #64748B;">#${p.period_id}</td>
        <td style="font-weight: 600; color: #0F172A;">${p.period_name}</td>
        <td>${startTh}</td>
        <td>${endTh}</td>
        <td class="text-right" style="font-weight: 600;">${p.initial_score} คะแนน</td>
        <td class="text-center">
          ${p.is_active 
            ? '<span class="badge badge-grade-A"><i class="fa-solid fa-circle-check"></i> รอบปัจจุบัน (Active)</span>' 
            : '<span class="badge badge-neutral">ปิดรอบแล้ว</span>'}
        </td>
        <td class="text-right">
          <div style="display: inline-flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="openEditPeriodModal(${p.period_id})" title="แก้ไขรอบนี้">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            ${!p.is_active ? `
              <button class="btn btn-sm btn-secondary" style="color: #059669;" onclick="activatePeriod(${p.period_id}, '${p.period_name.replace(/'/g, "\\'")}')" title="เปิดใช้งานรอบนี้เป็นรอบปัจจุบัน">
                <i class="fa-solid fa-play"></i> เปิดใช้
              </button>
            ` : ''}
            <button class="btn btn-sm btn-secondary" style="color: #DC2626;" onclick="deletePeriod(${p.period_id}, '${p.period_name.replace(/'/g, "\\'")}', ${p.is_active})" title="ลบรอบนี้">
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
      <td class="font-mono" style="font-weight: 600;">${p.reason_code}</td>
      <td style="font-weight: 600;">${p.reason_name}</td>
      <td class="text-right" style="font-weight: 700; color: ${isAdd ? '#059669' : '#DC2626'};">
        ${isAdd ? '+' : ''}${parseFloat(p.default_points).toFixed(1)} แต้ม
      </td>
      <td><span class="badge badge-neutral">${p.dept_scope}</span></td>
      <td class="text-center"><span class="badge badge-grade-A">เปิดใช้งาน</span></td>
      <td class="text-right">
        <button class="btn btn-sm btn-secondary" style="color: #DC2626;" onclick="deletePreset(${p.reason_id}, '${(p.reason_name || '').replace(/'/g, "\\'")}', '${p.reason_code}')" title="ลบตัวเลือกเหตุผลนี้">
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

    const globalPolicy = (loadedPolicies || []).find(p => p.dept_code === 'GLOBAL' && (p.position_name || 'ALL') === 'ALL')
      || (loadedPolicies || []).find(p => p.dept_code === 'GLOBAL');
    const rawBonus = (json.public_holiday_bonus !== undefined && json.public_holiday_bonus !== null)
      ? json.public_holiday_bonus
      : (globalPolicy && globalPolicy.public_holiday_bonus !== undefined ? globalPolicy.public_holiday_bonus : 3.0);
    const bonusNum = parseFloat(rawBonus);
    const bonusFormatted = `+${(isNaN(bonusNum) ? 3.0 : bonusNum).toFixed(2)} แต้ม/วัน`;
    const scopeLabel = json.has_custom_dept_bonus ? '(เกณฑ์กลาง / มีแยกตามแผนก)' : '(เท่ากันทั้งบริษัท)';

    const subtitleRateEl = document.getElementById('holidayBonusSubtitleRate');
    if (subtitleRateEl) {
      subtitleRateEl.innerText = bonusFormatted;
    }

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
        <td>
          <span class="badge badge-neutral">${yearDisplay}</span>
        </td>
        <td style="font-weight: 600; color: #0F172A;">
          <i class="fa-regular fa-calendar-days" style="margin-right: 6px; color: #64748B;"></i> ${dateTh}
        </td>
        <td style="font-weight: 600;">${h.holiday_name}</td>
        <td style="color: #059669; font-weight: 600;">${bonusFormatted} ${scopeLabel}</td>
        <td style="color: #64748B; font-size: 12.5px;">${h.description || '-'}</td>
        <td class="text-right">
          <button class="btn btn-sm btn-secondary" style="color: #DC2626;" onclick="deleteHoliday(${h.holiday_id}, '${h.holiday_name.replace(/'/g, "\\'")}')">
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
    loadSummaryData();
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
    loadSummaryData();
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
// 8. จุดจ่ายงานยาก & ตารางกำหนดจุดจ่ายงานพนักงานประจำเดือน (Team Station Roster & History)
// ==============================================================================
let allStationConfigs = [];
let allStationAssignments = [];
let currentPeriodMonthsElapsed = 1;
let stationRosterList = [];
let stationRosterDirtyMap = {};
let stationAllDepartments = [];
let currentHistoryModalEmCode = null;

function getDefaultStationMonthStr() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function formatThaiMonthYearLabel(ym) {
  if (!ym || ym === 'ALL') return 'รอบประจำทุกเดือน';
  const parts = String(ym).split('-');
  if (parts.length !== 2) return ym;
  const thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  const mIdx = parseInt(parts[1], 10) - 1;
  const mName = thaiMonths[mIdx] || parts[1];
  return `${mName} ${parts[0]} (${ym})`;
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function matchStationConfigClient(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
  const normInput = norm(text);
  if (!normInput) return '';

  const activeConfigs = (allStationConfigs || []).filter(c => c && c.is_active !== false);

  // 1. Exact normalized match
  for (const c of activeConfigs) {
    const normCode = norm(c.station_code);
    const normName = norm(c.station_name);
    const baseName = String(c.station_name || '').split('(')[0].trim();
    const normBase = norm(baseName);
    const parenMatch = String(c.station_name || '').match(/\(([^)]+)\)/);
    const normParen = parenMatch ? norm(parenMatch[1]) : '';

    if (
      normInput === normCode ||
      normInput === normName ||
      (normBase && normInput === normBase) ||
      (normParen && normInput === normParen)
    ) {
      return c.station_code;
    }
  }

  // 2. Partial / token match
  for (const c of activeConfigs) {
    const codeRaw = String(c.station_code || '').trim();
    const baseName = String(c.station_name || '').split('(')[0].trim();
    const normCode = norm(codeRaw);
    const normBase = norm(baseName);

    if (normBase && normBase.length >= 4 && normInput.includes(normBase)) {
      return c.station_code;
    }
    if (normCode && normCode.length >= 4 && normInput.includes(normCode)) {
      return c.station_code;
    }
    if (codeRaw && codeRaw.length >= 2) {
      const escaped = codeRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`(^|[^a-zA-Z0-9])${escaped}($|[^a-zA-Z0-9])`, 'i');
      if (wordRegex.test(text)) {
        return c.station_code;
      }
    }
  }

  return '';
}

async function loadStationsData() {
  const monthInput = document.getElementById('stationRosterMonth');
  if (monthInput && !monthInput.value) {
    monthInput.value = getDefaultStationMonthStr();
  }
  await loadStationRoster();
}

async function loadStationConfigs() {
  try {
    const monthVal = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
    const res = await fetch(`/api/kpi/stations?month=${encodeURIComponent(monthVal)}`);
    const json = await res.json();
    if (!json.success) return;
    allStationConfigs = json.stations || [];
    renderStationCards();
    populateStationDropdowns();
  } catch (err) {
    console.error('Error loading stations:', err);
  }
}

async function loadStationRoster() {
  try {
    const monthInput = document.getElementById('stationRosterMonth');
    if (monthInput && !monthInput.value) {
      monthInput.value = getDefaultStationMonthStr();
    }
    const selectedMonth = monthInput ? monthInput.value : getDefaultStationMonthStr();
    const deptSelect = document.getElementById('stationDeptFilterSelect');
    let selectedDept = deptSelect ? deptSelect.value : 'ALL';

    if (desktopCurrentUser && !isAdminRole(desktopCurrentUser)) {
      const userDept = String(desktopCurrentUser.dept || desktopCurrentUser.team || desktopCurrentUser.grp || '').trim();
      selectedDept = (userDept && userDept !== '-') ? userDept : '__NONE__';
    }

    const username = desktopCurrentUser ? (desktopCurrentUser.username || '') : '';
    const url = `/api/kpi/station-roster?month=${encodeURIComponent(selectedMonth)}&dept=${encodeURIComponent(selectedDept)}&username=${encodeURIComponent(username)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    allStationConfigs = json.stations || [];
    stationRosterList = json.roster || [];
    stationAllDepartments = json.departments || [];
    stationRosterDirtyMap = {};
    updateStationDirtyBadge();

    // Update Month Badge
    const monthBadge = document.getElementById('stationRosterMonthBadge');
    if (monthBadge) {
      monthBadge.innerText = `ประจำเดือน ${formatThaiMonthYearLabel(selectedMonth)}`;
    }

    // Update Department Dropdown based on Role
    if (deptSelect) {
      if (desktopCurrentUser && !isAdminRole(desktopCurrentUser)) {
        const userDept = String(desktopCurrentUser.dept || desktopCurrentUser.team || desktopCurrentUser.grp || '-').trim();
        deptSelect.innerHTML = `<option value="${escapeHtmlAttr(userDept)}">แผนกของคุณ: ${userDept}</option>`;
        deptSelect.value = userDept;
        deptSelect.disabled = true;
      } else {
        deptSelect.disabled = false;
        const prevVal = json.effective_dept || selectedDept || 'ALL';
        deptSelect.innerHTML = '<option value="ALL">ทุกแผนก (ทั้งหมด)</option>';
        stationAllDepartments.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d;
          opt.innerText = `แผนก: ${d}`;
          deptSelect.appendChild(opt);
        });
        if ([...deptSelect.options].some(o => o.value === prevVal)) {
          deptSelect.value = prevVal;
        }
      }
    }

    // Update Datalist Suggestions for Free-Text Station Input
    const datalist = document.getElementById('stationSuggestionsDatalist');
    if (datalist) {
      const suggestions = json.station_suggestions || [];
      datalist.innerHTML = suggestions.map(s => `<option value="${escapeHtmlAttr(s)}"></option>`).join('');
    }

    renderStationCards();
    populateStationDropdowns();
    updateStationRosterCounters();
    filterStationRosterTable();
  } catch (err) {
    console.error('Error loading station roster:', err);
  }
}

function updateStationRosterCounters() {
  let total = stationRosterList.length;
  let assigned = 0;
  let bonus = 0;

  stationRosterList.forEach(r => {
    const dirty = stationRosterDirtyMap[r.em_code];
    const stText = dirty !== undefined ? dirty.station_name_text : (r.station_name_text || '');
    const stCode = dirty !== undefined ? dirty.station_code : (r.station_code || '');
    const cfg = stCode ? allStationConfigs.find(c => c.station_code === stCode && c.is_active !== false) : null;
    const pts = cfg ? parseFloat(cfg.bonus_points || 0) : 0;

    if ((stText && stText.trim()) || stCode) {
      assigned++;
      if (pts > 0) bonus++;
    }
  });

  const unassigned = Math.max(0, total - assigned);
  const elTotal = document.getElementById('stCountTotal');
  const elAssigned = document.getElementById('stCountAssigned');
  const elBonus = document.getElementById('stCountBonus');
  const elUnassigned = document.getElementById('stCountUnassigned');

  if (elTotal) elTotal.innerText = total;
  if (elAssigned) elAssigned.innerText = assigned;
  if (elBonus) elBonus.innerText = bonus;
  if (elUnassigned) elUnassigned.innerText = unassigned;
}

function updateStationDirtyBadge() {
  const dirtyCount = Object.keys(stationRosterDirtyMap).length;
  const badge = document.getElementById('stationDirtyCountBadge');
  if (badge) badge.innerText = dirtyCount;
}

function renderStationCards() {
  const container = document.getElementById('stationCardsContainer');
  if (!container) return;

  if (allStationConfigs.length === 0) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94A3B8; padding: 20px;">ยังไม่มีการตั้งค่าเกณฑ์จุดงานยาก</div>`;
    return;
  }

  container.innerHTML = allStationConfigs.map(s => {
    const pts = parseFloat(s.bonus_points).toFixed(1);
    const isMonthly = s.bonus_frequency === 'MONTHLY';
    const freqLabel = isMonthly ? 'รอบทุกเดือน (Monthly)' : 'ต่อรอบประเมิน (Per Period)';
    const ptsText = isMonthly ? `+${pts} แต้ม / เดือน` : `+${pts} แต้ม / รอบ`;
    const statusBadge = s.is_active 
      ? '<span class="badge badge-grade-A">เปิดใช้งาน</span>'
      : '<span class="badge badge-grade-D">ปิดใช้งาน</span>';

    return `
      <div class="card" style="padding: 14px 16px; border-left: 3px solid #2563EB; display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <span class="font-mono" style="font-size: 11px; font-weight: 600; color: #64748B; text-transform: uppercase;">${s.station_code}</span>
              <h4 style="font-size: 14px; font-weight: 700; color: #0F172A; margin: 2px 0 0 0;">${s.station_name}</h4>
            </div>
            ${statusBadge}
          </div>
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 7px 10px; margin: 8px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
              <span style="font-size: 12px; color: #64748B;">แต้มบวกอัตโนมัติ:</span>
              <strong style="font-size: 13.5px; color: #059669;">${ptsText}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: #64748B;">
              <span>ความถี่:</span>
              <span style="font-weight: 600; color: #334155;">${freqLabel}</span>
            </div>
          </div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 8px; border-top: 1px solid #F1F5F9;">
          <span style="font-size: 12px; color: #64748B;">
            พนักงานในเดือนนี้: <strong style="color: #0F172A;">${s.assigned_count || 0}</strong> คน
          </span>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="openEditStationModal('${s.station_code}')" title="แก้ไขการตั้งค่า">
              <i class="fa-solid fa-pen-to-square"></i> แก้ไข
            </button>
            <button class="btn btn-sm btn-secondary" style="color: #DC2626;" onclick="deleteStationConfig('${s.station_code}')" title="ลบจุดนี้">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function populateStationDropdowns() {
  const histSelect = document.getElementById('histQuickStationCode');
  if (histSelect) {
    const curVal = histSelect.value;
    histSelect.innerHTML = '<option value="">จุดจ่ายทั่วไป (0 แต้ม)</option>';
    allStationConfigs.filter(s => s.is_active !== false).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.station_code;
      opt.innerText = `${s.station_name} (+${parseFloat(s.bonus_points).toFixed(1)} แต้ม)`;
      histSelect.appendChild(opt);
    });
    if (curVal) histSelect.value = curVal;
  }
}

function filterStationRosterTable() {
  const query = (document.getElementById('stationAssignSearchInput')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('stationStatusFilterSelect')?.value || 'ALL';

  const filtered = stationRosterList.filter(r => {
    const dirty = stationRosterDirtyMap[r.em_code];
    const stText = dirty !== undefined ? dirty.station_name_text : (r.station_name_text || '');
    const stCode = dirty !== undefined ? dirty.station_code : (r.station_code || '');
    const remark = dirty !== undefined ? dirty.remark : (r.remark || '');
    const cfg = stCode ? allStationConfigs.find(c => c.station_code === stCode && c.is_active !== false) : null;
    const pts = cfg ? parseFloat(cfg.bonus_points || 0) : 0;
    const hasStation = Boolean((stText && stText.trim()) || stCode);

    if (statusFilter === 'BONUS' && !(hasStation && pts > 0)) return false;
    if (statusFilter === 'NORMAL' && !(hasStation && pts === 0)) return false;
    if (statusFilter === 'ASSIGNED' && !hasStation) return false;
    if (statusFilter === 'UNASSIGNED' && hasStation) return false;

    if (query) {
      const matchQuery =
        (r.em_code || '').toLowerCase().includes(query) ||
        (r.name_th || '').toLowerCase().includes(query) ||
        (r.dept || '').toLowerCase().includes(query) ||
        (r.position_name || '').toLowerCase().includes(query) ||
        stText.toLowerCase().includes(query) ||
        stCode.toLowerCase().includes(query) ||
        remark.toLowerCase().includes(query);
      if (!matchQuery) return false;
    }

    return true;
  });

  renderStationRosterTable(filtered);
}

function renderStationRosterTable(list) {
  const tbody = document.getElementById('stationAssignmentsTableBody');
  if (!tbody) return;

  if (!list || list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: #94A3B8; padding: 32px;">ไม่พบรายชื่อพนักงานตามเงื่อนไขที่เลือก</td></tr>`;
    return;
  }

  const activeConfigs = allStationConfigs.filter(s => s.is_active !== false);

  tbody.innerHTML = list.map(r => {
    const dirty = stationRosterDirtyMap[r.em_code];
    const isDirty = dirty !== undefined;
    const stText = isDirty ? dirty.station_name_text : (r.station_name_text || '');
    const stCode = isDirty ? dirty.station_code : (r.station_code || '');
    const remark = isDirty ? dirty.remark : (r.remark || '');

    const cfg = stCode ? activeConfigs.find(c => c.station_code === stCode) : null;
    const pts = cfg ? parseFloat(cfg.bonus_points || 0) : 0;

    const optionsHtml = [
      `<option value="" ${!stCode ? 'selected' : ''}>-- จุดจ่ายทั่วไป (0 แต้ม) --</option>`,
      ...activeConfigs.map(c => {
        const sel = c.station_code === stCode ? 'selected' : '';
        return `<option value="${escapeHtmlAttr(c.station_code)}" ${sel}>${escapeHtmlAttr(c.station_name)} (+${parseFloat(c.bonus_points).toFixed(1)})</option>`;
      })
    ].join('');

    const ptsBadgeHtml = pts > 0
      ? `<span class="badge badge-grade-A" id="stRowPts_${r.em_code}" style="font-size: 12.5px; font-weight: 700;">+${pts.toFixed(1)} แต้ม</span>`
      : (stText.trim()
          ? `<span class="badge badge-neutral" id="stRowPts_${r.em_code}" style="font-size: 12px;">0.0 แต้ม</span>`
          : `<span class="badge" id="stRowPts_${r.em_code}" style="background: #F1F5F9; color: #94A3B8; font-size: 11.5px;">ยังไม่ระบุ</span>`);

    const histMonths = r.history_months_count || 0;
    const histBonus = parseFloat(r.history_total_bonus || 0);
    const recentHint = (r.recent_stations && r.recent_stations.length > 0)
      ? r.recent_stations.map(x => `${x.assigned_month}: ${x.station_name_text}`).join(' | ')
      : 'ยังไม่มีประวัติจุดจ่ายงาน';

    const rowBg = isDirty ? 'background: #FFFBEB;' : (pts > 0 ? 'background: #F0FDF4;' : '');

    return `
      <tr id="stRow_${r.em_code}" style="${rowBg}">
        <td class="font-mono" style="font-weight: 600; color: #1E293B;">${r.em_code}</td>
        <td>
          <div style="font-weight: 600; color: #0F172A;">${r.name_th || '-'}</div>
          ${r.assigner_name ? `<div style="font-size: 11px; color: #64748B;">ผู้บันทึกล่าสุด: ${r.assigner_name}</div>` : ''}
        </td>
        <td>
          <span class="badge badge-neutral">${r.dept || '-'}</span>
          <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${r.position_name || '-'}</div>
        </td>
        <td>
          <input type="text" class="form-control" id="stInputText_${r.em_code}"
            list="stationSuggestionsDatalist"
            value="${escapeHtmlAttr(stText)}"
            placeholder="พิมพ์จุดจ่าย เช่น E Picking, SR, Receiving..."
            style="font-size: 12.5px; font-weight: 600; padding: 6px 10px;"
            oninput="onRosterStationTextInput('${r.em_code}')">
        </td>
        <td>
          <select class="form-control" id="stSelectCode_${r.em_code}"
            style="font-size: 12.5px; font-weight: 600; padding: 6px 8px; ${stCode ? 'border-color: #10B981; color: #065F46; background: #ECFDF5;' : ''}"
            onchange="onRosterStationCodeSelect('${r.em_code}')">
            ${optionsHtml}
          </select>
        </td>
        <td class="text-right">
          ${ptsBadgeHtml}
        </td>
        <td>
          <input type="text" class="form-control" id="stInputRemark_${r.em_code}"
            value="${escapeHtmlAttr(remark)}"
            placeholder="หมายเหตุ (ถ้ามี)"
            style="font-size: 12px; padding: 6px 8px;"
            oninput="onRosterRemarkInput('${r.em_code}')">
        </td>
        <td class="text-right" style="white-space: nowrap;">
          <button type="button" class="btn btn-sm ${isDirty ? 'btn-primary' : 'btn-secondary'}"
            id="stBtnSave_${r.em_code}"
            onclick="saveSingleStationRosterRow('${r.em_code}')"
            title="บันทึกจุดจ่ายของพนักงานคนนี้ทันที"
            style="margin-right: 4px; padding: 5px 9px; font-size: 12px;">
            <i class="fa-solid fa-check"></i> บันทึก
          </button>
          <button type="button" class="btn btn-sm btn-secondary"
            onclick="openEmpStationHistoryModal('${r.em_code}')"
            title="${escapeHtmlAttr(recentHint)}"
            style="padding: 5px 9px; font-size: 12px;">
            <i class="fa-solid fa-clock-rotate-left" style="color: #2563EB;"></i>
            ประวัติ (${histMonths} ด.${histBonus > 0 ? ` / +${histBonus.toFixed(0)}` : ''})
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function onRosterStationTextInput(emCode) {
  const textEl = document.getElementById(`stInputText_${emCode}`);
  const selectEl = document.getElementById(`stSelectCode_${emCode}`);
  const remarkEl = document.getElementById(`stInputRemark_${emCode}`);
  if (!textEl || !selectEl) return;

  const rawText = textEl.value;
  // Auto-match against difficult station configs as the user types
  const matchedCode = matchStationConfigClient(rawText);
  selectEl.value = matchedCode || '';

  syncRosterRowVisualsAndDirtyState(emCode, rawText, selectEl.value, remarkEl ? remarkEl.value : '');
}

function onRosterStationCodeSelect(emCode) {
  const textEl = document.getElementById(`stInputText_${emCode}`);
  const selectEl = document.getElementById(`stSelectCode_${emCode}`);
  const remarkEl = document.getElementById(`stInputRemark_${emCode}`);
  if (!textEl || !selectEl) return;

  const chosenCode = selectEl.value;
  if (chosenCode && !textEl.value.trim()) {
    const cfg = allStationConfigs.find(c => c.station_code === chosenCode);
    if (cfg) {
      textEl.value = cfg.station_name.split('(')[0].trim() || cfg.station_name;
    }
  }

  syncRosterRowVisualsAndDirtyState(emCode, textEl.value, chosenCode, remarkEl ? remarkEl.value : '');
}

function onRosterRemarkInput(emCode) {
  const textEl = document.getElementById(`stInputText_${emCode}`);
  const selectEl = document.getElementById(`stSelectCode_${emCode}`);
  const remarkEl = document.getElementById(`stInputRemark_${emCode}`);
  if (!textEl || !selectEl) return;

  syncRosterRowVisualsAndDirtyState(emCode, textEl.value, selectEl.value, remarkEl ? remarkEl.value : '');
}

function syncRosterRowVisualsAndDirtyState(emCode, stText, stCode, remark) {
  const orig = stationRosterList.find(r => r.em_code === emCode);
  const cleanText = String(stText || '').trim();
  const cleanCode = String(stCode || '').trim();
  const cleanRemark = String(remark || '').trim();

  const isSameAsOrig = orig &&
    String(orig.station_name_text || '').trim() === cleanText &&
    String(orig.station_code || '').trim() === cleanCode &&
    String(orig.remark || '').trim() === cleanRemark;

  if (isSameAsOrig) {
    delete stationRosterDirtyMap[emCode];
  } else {
    stationRosterDirtyMap[emCode] = {
      em_code: emCode,
      station_name_text: cleanText,
      station_code: cleanCode,
      remark: cleanRemark
    };
  }

  const selectEl = document.getElementById(`stSelectCode_${emCode}`);
  if (selectEl) {
    if (cleanCode) {
      selectEl.style.borderColor = '#10B981';
      selectEl.style.color = '#065F46';
      selectEl.style.background = '#ECFDF5';
    } else {
      selectEl.style.borderColor = '';
      selectEl.style.color = '';
      selectEl.style.background = '';
    }
  }

  const cfg = cleanCode ? allStationConfigs.find(c => c.station_code === cleanCode && c.is_active !== false) : null;
  const pts = cfg ? parseFloat(cfg.bonus_points || 0) : 0;

  const ptsEl = document.getElementById(`stRowPts_${emCode}`);
  if (ptsEl) {
    if (pts > 0) {
      ptsEl.className = 'badge badge-grade-A';
      ptsEl.style.cssText = 'font-size: 12.5px; font-weight: 700;';
      ptsEl.innerText = `+${pts.toFixed(1)} แต้ม`;
    } else if (cleanText) {
      ptsEl.className = 'badge badge-neutral';
      ptsEl.style.cssText = 'font-size: 12px;';
      ptsEl.innerText = '0.0 แต้ม';
    } else {
      ptsEl.className = 'badge';
      ptsEl.style.cssText = 'background: #F1F5F9; color: #94A3B8; font-size: 11.5px;';
      ptsEl.innerText = 'ยังไม่ระบุ';
    }
  }

  const rowEl = document.getElementById(`stRow_${emCode}`);
  if (rowEl) {
    rowEl.style.background = !isSameAsOrig ? '#FFFBEB' : (pts > 0 ? '#F0FDF4' : '');
  }

  const saveBtn = document.getElementById(`stBtnSave_${emCode}`);
  if (saveBtn) {
    saveBtn.className = `btn btn-sm ${!isSameAsOrig ? 'btn-primary' : 'btn-secondary'}`;
  }

  updateStationDirtyBadge();
  updateStationRosterCounters();
}

async function saveSingleStationRosterRow(emCode) {
  const textEl = document.getElementById(`stInputText_${emCode}`);
  const selectEl = document.getElementById(`stSelectCode_${emCode}`);
  const remarkEl = document.getElementById(`stInputRemark_${emCode}`);
  const btn = document.getElementById(`stBtnSave_${emCode}`);

  const stationNameText = textEl ? textEl.value.trim() : '';
  const stationCode = selectEl ? selectEl.value.trim() : '';
  const remark = remarkEl ? remarkEl.value.trim() : '';
  const selectedMonth = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerText = '...';
    }

    const res = await fetch('/api/kpi/station-roster/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_month: selectedMonth,
        assigned_by: assignedBy,
        items: [{
          em_code: emCode,
          station_name_text: stationNameText,
          station_code: stationCode,
          remark
        }]
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึก';
    }
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function saveAllStationRosterChanges() {
  const selectedMonth = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  let itemsToSave = Object.values(stationRosterDirtyMap);
  if (itemsToSave.length === 0) {
    // หากไม่ได้แก้ไขแถวใหม่แต่กดบันทึกทั้งหมด ให้บันทึกแถวที่มีข้อมูลจุดจ่ายอยู่แล้วทั้งหมดในหน้าจอ
    itemsToSave = stationRosterList
      .filter(r => (r.station_name_text && r.station_name_text.trim()) || r.station_code)
      .map(r => ({
        em_code: r.em_code,
        station_name_text: r.station_name_text,
        station_code: r.station_code,
        remark: r.remark
      }));
  }

  if (itemsToSave.length === 0) {
    alert('กรุณาพิมพ์ชื่อจุดจ่ายงานของพนักงานอย่างน้อย 1 คนก่อนกดบันทึก');
    return;
  }

  const btn1 = document.getElementById('btnSaveAllStationRoster');
  const btn2 = document.getElementById('btnSaveAllStationRosterTop');

  try {
    if (btn1) { btn1.disabled = true; btn1.innerText = 'กำลังบันทึก...'; }
    if (btn2) { btn2.disabled = true; btn2.innerText = 'กำลังบันทึก...'; }

    const res = await fetch('/api/kpi/station-roster/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_month: selectedMonth,
        assigned_by: assignedBy,
        items: itemsToSave
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  } finally {
    if (btn1) {
      btn1.disabled = false;
      btn1.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> บันทึกทั้งหมด (<span id="stationDirtyCountBadge">${Object.keys(stationRosterDirtyMap).length}</span>)`;
    }
    if (btn2) {
      btn2.disabled = false;
      btn2.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> บันทึกข้อมูลจุดจ่ายทั้งหมด`;
    }
  }
}

async function copyPreviousMonthRoster() {
  const targetMonth = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  const parts = targetMonth.split('-');
  if (parts.length !== 2) return;
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  const defaultPrevMonth = `${y}-${String(m).padStart(2, '0')}`;
  const sourceMonth = prompt(`ระบุเดือนต้นทางที่ต้องการคัดลอกข้อมูลจุดจ่ายงานมายังเดือน ${targetMonth} (รูปแบบ YYYY-MM):`, defaultPrevMonth);
  if (!sourceMonth || !sourceMonth.trim()) return;

  const dept = document.getElementById('stationDeptFilterSelect')?.value || 'ALL';
  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  try {
    const res = await fetch('/api/kpi/station-roster/copy-month', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_month: sourceMonth.trim(),
        target_month: targetMonth,
        dept,
        assigned_by: assignedBy
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function exportStationRosterExcel() {
  const month = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  const dept = document.getElementById('stationDeptFilterSelect')?.value || 'ALL';
  const username = desktopCurrentUser ? (desktopCurrentUser.username || '') : '';
  window.open(`/api/kpi/station-roster/export?month=${encodeURIComponent(month)}&dept=${encodeURIComponent(dept)}&username=${encodeURIComponent(username)}`, '_blank');
}

function triggerImportStationRoster() {
  const input = document.getElementById('stationRosterFileInput');
  if (input) input.click();
}

async function handleStationRosterFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const selectedMonth = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  const formData = new FormData();
  formData.append('excel_file', file);
  formData.append('assigned_month', selectedMonth);
  formData.append('assigned_by', assignedBy);

  try {
    const res = await fetch('/api/kpi/station-roster/import', {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการนำเข้าไฟล์ Excel: ' + err.message);
  } finally {
    event.target.value = '';
  }
}

// --- Modal: Individual Employee Station History across Months ---
async function openEmpStationHistoryModal(emCode) {
  if (!emCode) return;
  currentHistoryModalEmCode = emCode;

  const modal = document.getElementById('empStationHistoryModal');
  if (modal) modal.classList.add('active');

  const quickMonth = document.getElementById('histQuickMonth');
  if (quickMonth) {
    quickMonth.value = document.getElementById('stationRosterMonth')?.value || getDefaultStationMonthStr();
  }
  const quickText = document.getElementById('histQuickStationText');
  if (quickText) quickText.value = '';
  populateStationDropdowns();
  const quickCode = document.getElementById('histQuickStationCode');
  if (quickCode) quickCode.value = '';

  await refreshEmpStationHistoryModal();
}

function closeEmpStationHistoryModal() {
  const modal = document.getElementById('empStationHistoryModal');
  if (modal) modal.classList.remove('active');
  currentHistoryModalEmCode = null;
}

function onHistQuickStationTextChanged() {
  const textEl = document.getElementById('histQuickStationText');
  const codeEl = document.getElementById('histQuickStationCode');
  if (!textEl || !codeEl) return;
  const matched = matchStationConfigClient(textEl.value);
  codeEl.value = matched || '';
}

function onHistQuickStationCodeChanged() {
  const textEl = document.getElementById('histQuickStationText');
  const codeEl = document.getElementById('histQuickStationCode');
  if (!textEl || !codeEl) return;
  if (codeEl.value && !textEl.value.trim()) {
    const cfg = allStationConfigs.find(c => c.station_code === codeEl.value);
    if (cfg) {
      textEl.value = cfg.station_name.split('(')[0].trim() || cfg.station_name;
    }
  }
}

async function saveHistQuickStation() {
  if (!currentHistoryModalEmCode) return;
  const monthVal = document.getElementById('histQuickMonth')?.value || getDefaultStationMonthStr();
  const stationText = (document.getElementById('histQuickStationText')?.value || '').trim();
  const stationCode = (document.getElementById('histQuickStationCode')?.value || '').trim();

  if (!stationText && !stationCode) {
    alert('กรุณาระบุชื่อจุดจ่ายงานที่ประจำ');
    return;
  }

  const assignedBy = desktopCurrentUser ? desktopCurrentUser.username : 'ADMIN';

  try {
    const res = await fetch('/api/kpi/station-roster/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_month: monthVal,
        assigned_by: assignedBy,
        items: [{
          em_code: currentHistoryModalEmCode,
          station_name_text: stationText,
          station_code: stationCode,
          remark: ''
        }]
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    document.getElementById('histQuickStationText').value = '';
    document.getElementById('histQuickStationCode').value = '';
    await refreshEmpStationHistoryModal();
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

function prefillHistQuickStation(monthVal, stationText, stationCode) {
  const mEl = document.getElementById('histQuickMonth');
  const tEl = document.getElementById('histQuickStationText');
  const cEl = document.getElementById('histQuickStationCode');
  if (mEl && monthVal && monthVal !== 'ALL') mEl.value = monthVal;
  if (tEl) tEl.value = stationText || '';
  if (cEl) cEl.value = stationCode || '';
  if (tEl) tEl.focus();
}

async function refreshEmpStationHistoryModal() {
  if (!currentHistoryModalEmCode) return;
  const tbody = document.getElementById('empStationHistoryTableBody');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #64748B;">กำลังโหลดประวัติ...</td></tr>`;
  }

  try {
    const res = await fetch(`/api/kpi/station-history/${encodeURIComponent(currentHistoryModalEmCode)}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    const emp = json.employee || {};
    const history = json.history || [];

    const titleEl = document.getElementById('empStationHistoryModalTitle');
    const subEl = document.getElementById('empStationHistoryModalSubtitle');
    if (titleEl) {
      titleEl.innerText = `ประวัติจุดจ่ายงานย้อนหลัง: ${emp.em_code || ''} - ${emp.name_th || ''}`;
    }
    if (subEl) {
      const totalBonus = history.reduce((sum, h) => sum + parseFloat(h.bonus_points || 0), 0);
      subEl.innerText = `แผนก: ${emp.dept || '-'} | ตำแหน่ง: ${emp.position_name || '-'} | บันทึกสะสมรวม ${history.length} เดือน (คะแนนจุดงานยากสะสม +${totalBonus.toFixed(1)} แต้ม)`;
    }

    if (!tbody) return;
    if (history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 28px; color: #94A3B8;">ยังไม่มีประวัติการบันทึกจุดจ่ายงานของพนักงานคนนี้</td></tr>`;
      return;
    }

    tbody.innerHTML = history.map(h => {
      const pts = parseFloat(h.bonus_points || 0);
      const stText = h.station_name_text || h.station_config_name || h.station_code || '-';
      const diffBadge = h.station_code && pts > 0
        ? `<span class="badge badge-grade-B">${h.station_config_name || h.station_code}</span>`
        : `<span class="badge badge-neutral">จุดจ่ายทั่วไป</span>`;
      const ptsHtml = pts > 0
        ? `<strong style="color: #059669;">+${pts.toFixed(1)} แต้ม</strong>`
        : `<span style="color: #64748B;">0.0 แต้ม</span>`;
      const assigner = h.assigner_name || h.assigned_by || '-';

      return `
        <tr>
          <td style="font-weight: 600; color: #0F172A;">
            ${formatThaiMonthYearLabel(h.assigned_month)}
          </td>
          <td>
            <strong style="color: #1E293B;">${stText}</strong>
            ${h.remark ? `<div style="font-size: 11px; color: #64748B;">หมายเหตุ: ${h.remark}</div>` : ''}
          </td>
          <td>${diffBadge}</td>
          <td class="text-right">${ptsHtml}</td>
          <td style="font-size: 11.5px; color: #64748B;">
            <div>${assigner}</div>
            <div>${h.assigned_date || '-'}</div>
          </td>
          <td class="text-right" style="white-space: nowrap;">
            <button type="button" class="btn btn-sm btn-secondary"
              onclick="prefillHistQuickStation('${escapeHtmlAttr(h.assigned_month)}', '${escapeHtmlAttr(stText)}', '${escapeHtmlAttr(h.station_code || '')}')"
              style="padding: 4px 8px; font-size: 11.5px; margin-right: 4px;">
              <i class="fa-solid fa-pen"></i> แก้ไข
            </button>
            <button type="button" class="btn btn-sm btn-secondary" style="color: #DC2626; padding: 4px 8px; font-size: 11.5px;"
              onclick="deleteStationAssignmentFromHistory(${h.assignment_id}, '${escapeHtmlAttr(stText)}', '${escapeHtmlAttr(h.assigned_month)}')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: #DC2626;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
    }
  }
}

async function deleteStationAssignmentFromHistory(assignmentId, stationName, monthLabel) {
  if (!confirm(`ยืนยันการลบประวัติประจำจุด "${stationName}" ของเดือน ${monthLabel} ใช่หรือไม่?`)) return;
  try {
    const res = await fetch(`/api/kpi/station-assignments/${assignmentId}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    await refreshEmpStationHistoryModal();
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

async function deleteStationConfig(stationCode) {
  if (!confirm(`ยืนยันการลบเกณฑ์จุดงานยาก "${stationCode}" ใช่หรือไม่?\n(ประวัติชื่อจุดจ่ายของพนักงานจะยังคงถูกเก็บไว้ แต่จะไม่คำนวณคะแนนพิเศษของจุดนี้)`)) {
    return;
  }
  try {
    const res = await fetch(`/api/kpi/stations/${encodeURIComponent(stationCode)}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert(json.message);
    await loadStationRoster();
    loadSummaryData();
  } catch (err) {
    alert('เกิดข้อผิดพลาด: ' + err.message);
  }
}

// Modal Station Config
function openAddStationModal() {
  document.getElementById('stationConfigModalTitle').innerHTML = 'เพิ่มเกณฑ์จุดจ่ายงานยากใหม่';
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

  document.getElementById('stationConfigModalTitle').innerHTML = 'แก้ไขเกณฑ์จุดจ่ายงานยาก';
  document.getElementById('stationConfigIsEdit').value = '1';
  const codeInput = document.getElementById('cfgStationCode');
  codeInput.value = station.station_code;
  codeInput.disabled = true; // Key cannot be edited
  document.getElementById('cfgStationName').value = station.station_name;
  document.getElementById('cfgBonusPoints').value = station.bonus_points;
  document.getElementById('cfgBonusFrequency').value = station.bonus_frequency || 'MONTHLY';
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
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกการตั้งค่า';

    if (!json.success) throw new Error(json.message);

    alert(json.message);
    closeStationConfigModal();
    await loadStationRoster();
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
      btn.style.color = '#0F172A';
      btn.style.fontWeight = '600';
      btn.style.boxShadow = '0 1px 2px rgba(15,23,42,0.06)';
    } else {
      btn.style.background = 'transparent';
      btn.style.color = '#64748B';
      btn.style.fontWeight = '500';
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
        <td colspan="8" style="text-align: center; padding: 36px; color: #64748B;">
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
      ? `<span class="badge badge-grade-B">ระบบอัตโนมัติ</span>`
      : `<span class="badge badge-grade-C">หัวหน้างานบันทึก</span>`;

    // Points style
    const pointsHtml = isNegative
      ? `<span style="color: #DC2626; font-weight: 700; font-size: 13.5px;">${pts.toFixed(2)} แต้ม</span>`
      : `<span style="color: #059669; font-weight: 700; font-size: 13.5px;">+${pts.toFixed(2)} แต้ม</span>`;

    // Reason highlight
    let reasonHtml = t.reason_description || '-';
    if (reasonHtml.includes('ลาป่วย')) {
      reasonHtml = `<span style="color: #DC2626; font-weight: 500;">${reasonHtml}</span>`;
    } else if (reasonHtml.includes('ขาดงาน') || reasonHtml.includes('ขาด')) {
      reasonHtml = `<span style="color: #991B1B; font-weight: 600;">${reasonHtml}</span>`;
    } else if (reasonHtml.includes('สาย')) {
      reasonHtml = `<span style="color: #B45309; font-weight: 500;">${reasonHtml}</span>`;
    }

    // Attachment
    let attachHtml = '<span style="color: #CBD5E1;">-</span>';
    if (t.attachment_url) {
      attachHtml = `
        <button type="button" class="btn btn-sm btn-secondary" onclick="openTxPhotoModal('${t.attachment_url}')" title="คลิกดูรูปหลักฐาน">
          <i class="fa-regular fa-image" style="color: #2563EB;"></i> ดูรูป
        </button>
      `;
    }

    tr.innerHTML = `
      <td class="text-center font-mono" style="color: #64748B;">${i + 1}</td>
      <td style="font-weight: 600; color: #0F172A; white-space: nowrap;">${dateStr}</td>
      <td>${typeBadge}</td>
      <td>${reasonHtml}</td>
      <td class="text-right" style="white-space: nowrap;">${pointsHtml}</td>
      <td><span class="badge badge-neutral">${t.created_by || 'SYSTEM'}</span></td>
      <td class="text-center">${attachHtml}</td>
      <td style="font-size: 12px; color: #64748B; white-space: nowrap;">${createdTimeStr}</td>
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

