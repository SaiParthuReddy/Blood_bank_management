/**
 * Parthu Reddy’s Blood Bank - Frontend Application Controller
 * Handles REST API communication, live UI updates, validation, and modals.
 */

// State
let currentTab = 'dashboard';
let donorsList = [];
let stockList = [];
let requestsList = [];
let dbConnectionState = {
  connected: false,
  tablesVerified: false,
  database: 'Unknown',
  host: 'Unknown',
  port: 3306,
  errorMessage: null
};

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupMobileToggle();
  setupModals();
  setDefaultDates();

  // Initial Data Fetch
  checkHealth().then(() => {
    loadAllData();
  });

  // Handle URL hash changes
  window.addEventListener('hashchange', handleHashRouting);
  handleHashRouting();

  // Periodically refresh health & stats every 30 seconds
  setInterval(checkHealth, 30000);
});

function setDefaultDates() {
  const reqDate = document.getElementById('reqDate');
  if (reqDate) {
    reqDate.value = new Date().toISOString().split('T')[0];
  }
}

// ---------------------------------------------------------------------------
// 2. Routing & Navigation
// ---------------------------------------------------------------------------
function setupNavigation() {
  const navLinks = document.querySelectorAll('.nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.getAttribute('data-tab');
      navigate(tab);
    });
  });
}

function handleHashRouting() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  const validTabs = ['dashboard', 'donors', 'stock', 'low-stock', 'requests'];
  if (validTabs.includes(hash)) {
    navigate(hash, false);
  }
}

function navigate(tabName, updateHash = true) {
  currentTab = tabName;
  if (updateHash) {
    window.location.hash = tabName;
  }

  // Update nav link active state
  document.querySelectorAll('.nav-link').forEach(link => {
    if (link.getAttribute('data-tab') === tabName) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Switch view sections
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  const targetView = document.getElementById(`view-${tabName}`);
  if (targetView) {
    targetView.classList.add('active');
  }

  // Scroll to top of main area
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Close mobile nav if open
  const navLinksList = document.getElementById('navLinks');
  if (navLinksList) navLinksList.classList.remove('mobile-open');

  // If specific view needs fresh data
  if (tabName === 'donors') loadDonors();
  if (tabName === 'stock') loadStock();
  if (tabName === 'low-stock') loadLowStock();
  if (tabName === 'requests') loadRequests();
  if (tabName === 'dashboard') loadStats();
}

function setupMobileToggle() {
  const toggleBtn = document.getElementById('mobileToggleBtn');
  const navLinks = document.getElementById('navLinks');
  if (toggleBtn && navLinks) {
    toggleBtn.addEventListener('click', () => {
      navLinks.classList.toggle('mobile-open');
    });
  }
}

// ---------------------------------------------------------------------------
// 3. MySQL Database Health & Status Indicator
// ---------------------------------------------------------------------------
async function checkHealth() {
  const dbDot = document.getElementById('dbDot');
  const dbText = document.getElementById('dbText');
  const footerDb = document.getElementById('footerDbName');

  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    dbConnectionState = data;

    if (data.connected && data.tablesVerified) {
      dbDot.className = 'db-indicator-dot connected';
      dbText.textContent = `MySQL: ${data.database}`;
      if (footerDb) footerDb.textContent = data.database;
    } else {
      dbDot.className = 'db-indicator-dot error';
      dbText.textContent = 'MySQL Disconnected';
      if (footerDb) footerDb.textContent = 'Disconnected';
      showToast('MySQL Database not connected. Please verify .env settings.', 'error');
    }
  } catch (err) {
    dbDot.className = 'db-indicator-dot error';
    dbText.textContent = 'Backend Offline';
    if (footerDb) footerDb.textContent = 'Offline';
  }
}

function openDbModal() {
  const body = document.getElementById('dbModalBody');
  const isOk = dbConnectionState.connected && dbConnectionState.tablesVerified;

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:18px;">
      <div class="db-indicator-dot ${isOk ? 'connected' : 'error'}" style="width:14px; height:14px;"></div>
      <div>
        <h4 style="font-size:16px; color:var(--navy-900); font-weight:700;">
          ${isOk ? 'Database Connected & Schema Verified' : 'Database Connection Issue'}
        </h4>
        <span style="font-size:12px; color:var(--text-muted);">
          Status verified: ${dbConnectionState.lastChecked ? new Date(dbConnectionState.lastChecked).toLocaleTimeString() : 'Just now'}
        </span>
      </div>
    </div>

    <div style="background:#f8fafc; border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; font-size:13px; line-height:1.7;">
      <div><strong>Host:</strong> ${escapeHtml(dbConnectionState.host || 'localhost')}</div>
      <div><strong>Port:</strong> ${escapeHtml(String(dbConnectionState.port || 3306))}</div>
      <div><strong>Database:</strong> ${escapeHtml(dbConnectionState.database || 'parthu_blood_bank')}</div>
      <div><strong>Verified Tables:</strong> <code>donors</code>, <code>blood_stock</code>, <code>blood_requests</code></div>
      <div><strong>Standard Blood Groups:</strong> 8 (${(dbConnectionState.validBloodGroups || []).join(', ')})</div>
      ${dbConnectionState.errorMessage ? `<div style="color:var(--crimson-600); margin-top:8px;"><strong>Error Diagnostic:</strong> ${escapeHtml(dbConnectionState.errorMessage)}</div>` : ''}
    </div>
  `;
  openModal('modalDbInfo');
}

// ---------------------------------------------------------------------------
// 4. Data Loading & Dashboard Stats
// ---------------------------------------------------------------------------
async function loadAllData() {
  await Promise.all([
    loadStats(),
    loadDonors(),
    loadStock(),
    loadRequests()
  ]);
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats;
    document.getElementById('statDonors').textContent = stats.totalDonors;
    document.getElementById('statUnits').textContent = stats.totalUnits;
    document.getElementById('statRequests').textContent = stats.totalRequests;
    document.getElementById('statPendingReqs').textContent = stats.pendingRequests;
    document.getElementById('statLowStock').textContent = stats.lowStockCount;

    // Highlight low stock card if any
    const lowStockCard = document.getElementById('metricLowStockCard');
    const urgentAlert = document.getElementById('urgentAlertBox');
    const urgentText = document.getElementById('urgentAlertText');
    const lowBadge = document.getElementById('lowStockBadge');

    if (stats.lowStockCount > 0) {
      lowStockCard.classList.add('warning');
      urgentAlert.style.display = 'flex';
      urgentText.textContent = `${stats.lowStockCount} blood group(s) are below the safe reserve threshold (<10 units). Immediate donor recruitment or stock replenishment recommended.`;
      lowBadge.style.display = 'inline-flex';
      lowBadge.textContent = stats.lowStockCount;
    } else {
      lowStockCard.classList.remove('warning');
      urgentAlert.style.display = 'none';
      lowBadge.style.display = 'none';
    }

    renderDashboardStock(data.stock || []);
    renderDashboardRecent(data.recentDonors || [], data.recentRequests || []);
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

function renderDashboardStock(stock) {
  const container = document.getElementById('dashboardStockGrid');
  if (!container) return;
  container.innerHTML = '';

  stock.forEach(item => {
    const card = createStockCardElement(item);
    container.appendChild(card);
  });
}

function renderDashboardRecent(recentDonors, recentRequests) {
  // Recent Donors table
  const donorsTbody = document.getElementById('dashboardRecentDonors');
  if (donorsTbody) {
    if (recentDonors.length === 0) {
      donorsTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No donors registered yet.</td></tr>`;
    } else {
      donorsTbody.innerHTML = recentDonors.map(d => `
        <tr>
          <td><strong>${escapeHtml(d.name)}</strong></td>
          <td><span class="blood-badge blood-badge-crimson">${escapeHtml(d.blood_group)}</span></td>
          <td>${escapeHtml(d.phone)}</td>
          <td>${escapeHtml(String(d.age))} yrs</td>
        </tr>
      `).join('');
    }
  }

  // Recent Requests table
  const reqsTbody = document.getElementById('dashboardRecentRequests');
  if (reqsTbody) {
    if (recentRequests.length === 0) {
      reqsTbody.innerHTML = `<tr><td colspan="4" class="empty-state">No blood requests filed yet.</td></tr>`;
    } else {
      reqsTbody.innerHTML = recentRequests.map(r => `
        <tr>
          <td><strong>${escapeHtml(r.hospital_name)}</strong></td>
          <td><span class="blood-badge blood-badge-crimson">${escapeHtml(r.blood_group)}</span></td>
          <td>${escapeHtml(String(r.units_required))} units</td>
          <td><span class="status-badge ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        </tr>
      `).join('');
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Blood Stock Logic & Views
// ---------------------------------------------------------------------------
async function loadStock() {
  try {
    const res = await fetch('/api/stock');
    const data = await res.json();
    if (!data.success) return;
    stockList = data.stock;

    // Render stock grid cards
    const grid = document.getElementById('allStockGrid');
    if (grid) {
      grid.innerHTML = '';
      stockList.forEach(item => {
        grid.appendChild(createStockCardElement(item));
      });
    }

    // Render stock table
    const tbody = document.getElementById('stockTableBody');
    if (tbody) {
      tbody.innerHTML = stockList.map(s => {
        let badgeClass = 'stock-badge-optimal';
        if (s.units_available < 5) badgeClass = 'stock-badge-critical';
        else if (s.units_available < 10) badgeClass = 'stock-badge-low';

        return `
          <tr>
            <td>#${s.stock_id}</td>
            <td>
              <span class="blood-badge blood-badge-crimson">${escapeHtml(s.blood_group)}</span>
            </td>
            <td>
              <strong style="font-size:16px;">${s.units_available}</strong> Units
            </td>
            <td>
              <span class="status-badge ${badgeClass}">${s.stock_status || (s.units_available < 10 ? 'Low' : 'Optimal')}</span>
            </td>
            <td>${escapeHtml(s.last_updated || 'Today')}</td>
            <td style="text-align: right;">
              <button class="btn btn-sm btn-light" onclick="openUpdateUnitsModal(${s.stock_id}, '${escapeHtml(s.blood_group)}', ${s.units_available})">
                <i class="fa-solid fa-pen-to-square"></i> Update Units
              </button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load stock:', err);
  }
}

function createStockCardElement(item) {
  const card = document.createElement('div');
  const units = parseInt(item.units_available, 10);
  let statusClass = 'optimal';
  let cardStatusClass = '';

  if (units < 5) {
    statusClass = 'critical';
    cardStatusClass = 'critical';
  } else if (units < 10) {
    statusClass = 'low';
    cardStatusClass = 'low';
  }

  card.className = `stock-card ${cardStatusClass}`;

  // Gauge percent (capped at 100% for 30 units)
  const percent = Math.min(100, Math.round((units / 30) * 100));

  card.innerHTML = `
    <div class="stock-card-top">
      <div class="blood-badge blood-badge-lg">${escapeHtml(item.blood_group)}</div>
      <div style="text-align: right;">
        <div class="stock-units-number">${units}</div>
        <div class="stock-units-label">Units Available</div>
      </div>
    </div>

    <div class="stock-card-progress">
      <div class="stock-progress-fill ${statusClass}" style="width: ${percent}%;"></div>
    </div>

    <div class="stock-card-footer">
      <span class="stock-date-text">
        <i class="fa-regular fa-clock"></i> ${escapeHtml(item.last_updated || 'Updated')}
      </span>
      <button class="btn btn-sm btn-light" onclick="openUpdateUnitsModal(${item.stock_id}, '${escapeHtml(item.blood_group)}', ${units})">
        <i class="fa-solid fa-pen-to-square"></i> Set Units
      </button>
    </div>
  `;
  return card;
}

async function loadLowStock() {
  try {
    const res = await fetch('/api/stock/low');
    const data = await res.json();
    if (!data.success) return;

    const container = document.getElementById('lowStockAlertContainer');
    if (!container) return;

    if (data.lowStock.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="background:#f0fdf4; border:1px dashed #86efac; border-radius:var(--radius-md);">
          <div class="empty-state-icon" style="color:#16a34a;"><i class="fa-solid fa-circle-check"></i></div>
          <h4 style="color:#15803d;">All Reserves Are Stable!</h4>
          <p>Every blood group currently has 10 or more available units in stock.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:20px; font-size:14px; color:var(--crimson-700); background:var(--crimson-50); padding:12px 16px; border-radius:8px; border:1px solid var(--crimson-100);">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>
        Found <strong>${data.lowStock.length}</strong> blood group(s) requiring immediate stock replenishment.
      </div>
      <div class="blood-stock-grid">
        ${data.lowStock.map(item => `
          <div class="stock-card ${item.units_available < 5 ? 'critical' : 'low'}">
            <div class="stock-card-top">
              <div class="blood-badge blood-badge-lg">${escapeHtml(item.blood_group)}</div>
              <div style="text-align: right;">
                <div class="stock-units-number" style="color:var(--crimson-600);">${item.units_available}</div>
                <div class="stock-units-label">${item.stock_status} Level</div>
              </div>
            </div>
            <p style="font-size:13px; color:var(--text-muted); margin: 8px 0 14px;">
              ${item.units_available < 5 ? 'CRITICAL: Severe shortage! Call registered donors immediately.' : 'WARNING: Below safety minimum of 10 units.'}
            </p>
            <div class="stock-card-footer">
              <button class="btn btn-sm btn-primary" onclick="openAddStockModal('${escapeHtml(item.blood_group)}')">
                <i class="fa-solid fa-plus"></i> Replenish
              </button>
              <button class="btn btn-sm btn-light" onclick="openUpdateUnitsModal(${item.stock_id}, '${escapeHtml(item.blood_group)}', ${item.units_available})">
                Adjust Units
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Failed to load low stock:', err);
  }
}

function openAddStockModal(presetGroup = '') {
  if (presetGroup) {
    const sel = document.getElementById('addStockGroup');
    if (sel) sel.value = presetGroup;
  }
  openModal('modalAddStock');
}

async function submitAddStock(e) {
  e.preventDefault();
  const blood_group = document.getElementById('addStockGroup').value;
  const units_to_add = parseInt(document.getElementById('addStockUnits').value, 10);

  if (isNaN(units_to_add) || units_to_add <= 0) {
    showToast('Units to add must be greater than 0', 'error');
    return;
  }

  try {
    const res = await fetch('/api/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blood_group, units_to_add })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update stock');
    }
    showToast(data.message, 'success');
    closeModal('modalAddStock');
    loadStock();
    loadStats();
    if (currentTab === 'low-stock') loadLowStock();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openUpdateUnitsModal(stockId, bloodGroup, currentUnits) {
  document.getElementById('updateStockId').value = stockId;
  document.getElementById('updateStockGroupText').textContent = bloodGroup;
  document.getElementById('updateStockUnitsInput').value = currentUnits;
  openModal('modalUpdateUnits');
}

async function submitUpdateUnits(e) {
  e.preventDefault();
  const stockId = document.getElementById('updateStockId').value;
  const units_available = parseInt(document.getElementById('updateStockUnitsInput').value, 10);

  if (isNaN(units_available) || units_available < 0) {
    showToast('Available units cannot be negative', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/stock/${stockId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units_available })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update units');
    }
    showToast(data.message, 'success');
    closeModal('modalUpdateUnits');
    loadStock();
    loadStats();
    if (currentTab === 'low-stock') loadLowStock();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// 6. Donors Hub (List, Search, Add, Edit, Delete)
// ---------------------------------------------------------------------------
let donorSearchDebounce = null;
function onDonorSearch() {
  clearTimeout(donorSearchDebounce);
  donorSearchDebounce = setTimeout(() => {
    loadDonors();
  }, 250);
}

function resetDonorFilters() {
  document.getElementById('donorSearchInput').value = '';
  document.getElementById('donorGroupFilter').value = '';
  loadDonors();
}

async function loadDonors() {
  const search = document.getElementById('donorSearchInput')?.value || '';
  const bloodGroup = document.getElementById('donorGroupFilter')?.value || '';

  const params = new URLSearchParams();
  if (search.trim()) params.append('search', search.trim());
  if (bloodGroup) params.append('blood_group', bloodGroup);

  try {
    const res = await fetch(`/api/donors?${params.toString()}`);
    const data = await res.json();
    if (!data.success) return;
    donorsList = data.donors;

    const tbody = document.getElementById('donorsTableBody');
    if (!tbody) return;

    if (donorsList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-user-slash"></i></div>
              <h4>No Donors Found</h4>
              <p>No donor records match your filter criteria.</p>
              <button class="btn btn-sm btn-primary" onclick="openAddDonorModal()" style="margin-top:10px;">
                <i class="fa-solid fa-plus"></i> Add New Donor
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = donorsList.map(d => `
      <tr>
        <td>#${d.donor_id}</td>
        <td>
          <div style="font-weight:700; color:var(--navy-900);">${escapeHtml(d.name)}</div>
        </td>
        <td>${escapeHtml(String(d.age))} yrs</td>
        <td>${escapeHtml(d.gender)}</td>
        <td>
          <span class="blood-badge blood-badge-crimson">${escapeHtml(d.blood_group)}</span>
        </td>
        <td>
          <i class="fa-solid fa-phone" style="font-size:11px; color:var(--text-light); margin-right:4px;"></i>
          ${escapeHtml(d.phone)}
        </td>
        <td style="text-align: right;">
          <div class="table-actions" style="justify-content: flex-end;">
            <button class="btn btn-sm btn-light btn-icon" title="Edit Donor" onclick="openEditDonorModal(${d.donor_id})">
              <i class="fa-solid fa-user-pen" style="color:var(--navy-700);"></i>
            </button>
            <button class="btn btn-sm btn-danger-outline btn-icon" title="Delete Donor" onclick="confirmDeleteDonor(${d.donor_id}, '${escapeHtml(d.name)}')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load donors:', err);
  }
}

function openAddDonorModal() {
  document.getElementById('formAddDonor').reset();
  openModal('modalAddDonor');
}

async function submitAddDonor(e) {
  e.preventDefault();
  const name = document.getElementById('addDonorName').value.trim();
  const age = parseInt(document.getElementById('addDonorAge').value, 10);
  const gender = document.getElementById('addDonorGender').value;
  const bloodGroupRadio = document.querySelector('input[name="addDonorBlood"]:checked');
  const blood_group = bloodGroupRadio ? bloodGroupRadio.value : '';
  const phone = document.getElementById('addDonorPhone').value.trim();

  // Validate
  if (!name || name.length < 2) {
    showToast('Please enter a valid donor name.', 'error');
    return;
  }
  if (isNaN(age) || age < 18 || age > 65) {
    showToast('Eligible donor age must be between 18 and 65.', 'error');
    return;
  }
  if (!gender) {
    showToast('Please select a gender.', 'error');
    return;
  }
  if (!phone || phone.length < 10) {
    showToast('Please enter a valid 10-15 digit phone number.', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitAddDonor');
  btn.disabled = true;

  try {
    const res = await fetch('/api/donors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, age, gender, blood_group, phone })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to register donor');
    }
    showToast(data.message, 'success');
    closeModal('modalAddDonor');
    loadDonors();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function openEditDonorModal(donorId) {
  try {
    const res = await fetch(`/api/donors/${donorId}`);
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || 'Donor not found', 'error');
      return;
    }

    const d = data.donor;
    document.getElementById('editDonorId').value = d.donor_id;
    document.getElementById('editDonorName').value = d.name;
    document.getElementById('editDonorAge').value = d.age;
    document.getElementById('editDonorGender').value = d.gender;
    document.getElementById('editDonorBlood').value = d.blood_group;
    document.getElementById('editDonorPhone').value = d.phone;

    openModal('modalEditDonor');
  } catch (err) {
    showToast('Error loading donor details', 'error');
  }
}

async function submitEditDonor(e) {
  e.preventDefault();
  const donorId = document.getElementById('editDonorId').value;
  const name = document.getElementById('editDonorName').value.trim();
  const age = parseInt(document.getElementById('editDonorAge').value, 10);
  const gender = document.getElementById('editDonorGender').value;
  const blood_group = document.getElementById('editDonorBlood').value;
  const phone = document.getElementById('editDonorPhone').value.trim();

  try {
    const res = await fetch(`/api/donors/${donorId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, age, gender, blood_group, phone })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update donor');
    }
    showToast(data.message, 'success');
    closeModal('modalEditDonor');
    loadDonors();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteDonor(donorId, donorName) {
  document.getElementById('confirmModalText').innerHTML = `
    Are you sure you want to permanently delete donor <strong>"${escapeHtml(donorName)}"</strong> (ID: #${donorId})?
  `;
  const confirmBtn = document.getElementById('btnConfirmAction');
  confirmBtn.onclick = async () => {
    try {
      const res = await fetch(`/api/donors/${donorId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete donor');
      }
      showToast(data.message, 'success');
      closeModal('modalConfirm');
      loadDonors();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  openModal('modalConfirm');
}

// ---------------------------------------------------------------------------
// 7. Hospital Blood Requests (List, Filter, Create, Status, Delete)
// ---------------------------------------------------------------------------
let requestSearchDebounce = null;
function onRequestSearch() {
  clearTimeout(requestSearchDebounce);
  requestSearchDebounce = setTimeout(() => {
    loadRequests();
  }, 250);
}

function resetRequestFilters() {
  document.getElementById('requestSearchInput').value = '';
  document.getElementById('requestStatusFilter').value = '';
  document.getElementById('requestGroupFilter').value = '';
  loadRequests();
}

async function loadRequests() {
  const search = document.getElementById('requestSearchInput')?.value || '';
  const status = document.getElementById('requestStatusFilter')?.value || '';
  const bloodGroup = document.getElementById('requestGroupFilter')?.value || '';

  const params = new URLSearchParams();
  if (search.trim()) params.append('search', search.trim());
  if (status) params.append('status', status);
  if (bloodGroup) params.append('blood_group', bloodGroup);

  try {
    const res = await fetch(`/api/requests?${params.toString()}`);
    const data = await res.json();
    if (!data.success) return;
    requestsList = data.requests;

    const tbody = document.getElementById('requestsTableBody');
    if (!tbody) return;

    if (requestsList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="empty-state">
              <div class="empty-state-icon"><i class="fa-solid fa-folder-open"></i></div>
              <h4>No Blood Requests Found</h4>
              <p>No hospital request records match your criteria.</p>
              <button class="btn btn-sm btn-primary" onclick="openCreateRequestModal()" style="margin-top:10px;">
                <i class="fa-solid fa-plus"></i> Create Blood Request
              </button>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = requestsList.map(r => `
      <tr>
        <td>#${r.request_id}</td>
        <td>
          <div style="font-weight:700; color:var(--navy-900);">${escapeHtml(r.hospital_name)}</div>
        </td>
        <td>
          <span class="blood-badge blood-badge-crimson">${escapeHtml(r.blood_group)}</span>
        </td>
        <td>
          <strong>${r.units_required}</strong> Unit(s)
        </td>
        <td>${escapeHtml(r.request_date || 'N/A')}</td>
        <td>
          <span class="status-badge ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span>
        </td>
        <td style="text-align: right;">
          <div class="table-actions" style="justify-content: flex-end;">
            <button class="btn btn-sm btn-light" title="Update Status" onclick="openUpdateRequestStatusModal(${r.request_id}, '${escapeHtml(r.hospital_name)}', '${escapeHtml(r.blood_group)}', ${r.units_required}, '${escapeHtml(r.status)}')">
              <i class="fa-solid fa-arrows-rotate"></i> Status
            </button>
            <button class="btn btn-sm btn-danger-outline btn-icon" title="Delete Request" onclick="confirmDeleteRequest(${r.request_id}, '${escapeHtml(r.hospital_name)}')">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load requests:', err);
  }
}

function openCreateRequestModal() {
  document.getElementById('formCreateRequest').reset();
  setDefaultDates();
  openModal('modalCreateRequest');
}

async function submitCreateRequest(e) {
  e.preventDefault();
  const hospital_name = document.getElementById('reqHospitalName').value.trim();
  const blood_group = document.getElementById('reqBloodGroup').value;
  const units_required = parseInt(document.getElementById('reqUnits').value, 10);
  const request_date = document.getElementById('reqDate').value;
  const status = document.getElementById('reqStatus').value;

  if (!hospital_name || hospital_name.length < 2) {
    showToast('Hospital name is required', 'error');
    return;
  }
  if (isNaN(units_required) || units_required <= 0) {
    showToast('Units required must be at least 1 unit', 'error');
    return;
  }

  try {
    const res = await fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hospital_name, blood_group, units_required, request_date, status })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to create request');
    }
    showToast(data.message, 'success');
    closeModal('modalCreateRequest');
    loadRequests();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openUpdateRequestStatusModal(requestId, hospitalName, bloodGroup, unitsRequired, currentStatus) {
  document.getElementById('statusRequestId').value = requestId;
  document.getElementById('statusReqIdText').textContent = `#${requestId}`;
  document.getElementById('statusHospitalText').textContent = hospitalName;
  document.getElementById('statusReqGroupText').textContent = bloodGroup;
  document.getElementById('statusReqUnitsText').textContent = unitsRequired;
  document.getElementById('statusSelectInput').value = currentStatus;
  openModal('modalRequestStatus');
}

async function submitUpdateRequestStatus(e) {
  e.preventDefault();
  const requestId = document.getElementById('statusRequestId').value;
  const status = document.getElementById('statusSelectInput').value;

  try {
    const res = await fetch(`/api/requests/${requestId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to update request status');
    }
    showToast(data.message, 'success');
    closeModal('modalRequestStatus');
    loadRequests();
    loadStock();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function confirmDeleteRequest(requestId, hospitalName) {
  document.getElementById('confirmModalText').innerHTML = `
    Are you sure you want to delete blood request <strong>#${requestId}</strong> from <strong>"${escapeHtml(hospitalName)}"</strong>?
  `;
  const confirmBtn = document.getElementById('btnConfirmAction');
  confirmBtn.onclick = async () => {
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to delete request');
      }
      showToast(data.message, 'success');
      closeModal('modalConfirm');
      loadRequests();
      loadStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  openModal('modalConfirm');
}

// ---------------------------------------------------------------------------
// 8. Modal & Toast Utilities
// ---------------------------------------------------------------------------
function setupModals() {
  // Close modals on clicking overlay background
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // Close modals on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    }
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let icon = '<i class="fa-solid fa-circle-info"></i>';
  if (type === 'success') icon = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i>';
  if (type === 'error') icon = '<i class="fa-solid fa-circle-exclamation" style="color:#ef4444;"></i>';

  toast.innerHTML = `
    ${icon}
    <div style="flex:1;">${escapeHtml(message)}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
