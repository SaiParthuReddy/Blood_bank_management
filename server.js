require('dotenv').config();
const express = require('express');
const path = require('path');
const { initDatabase, getPool, getDbState, VALID_BLOOD_GROUPS, VALID_REQUEST_STATUSES } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to ensure DB connection is ready
function checkDb(req, res, next) {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({
      success: false,
      error: 'Database connection is not initialized. Please verify MySQL configuration in .env.'
    });
  }
  next();
}

// ---------------------------------------------------------------------------
// 1. Health / Connection Status Route
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const state = getDbState();
  res.json({
    success: true,
    connected: state.connected,
    tablesVerified: state.tablesVerified,
    database: state.database,
    host: state.host,
    port: state.port,
    lastChecked: state.lastChecked,
    errorMessage: state.errorMessage || null,
    validBloodGroups: VALID_BLOOD_GROUPS,
    validStatuses: VALID_REQUEST_STATUSES
  });
});

// ---------------------------------------------------------------------------
// 2. Dashboard Analytics & Summary Statistics
// ---------------------------------------------------------------------------
app.get('/api/stats', checkDb, async (req, res) => {
  try {
    const pool = getPool();

    const [[donorCount]] = await pool.query('SELECT COUNT(*) as count FROM donors');
    const [[stockCount]] = await pool.query('SELECT COALESCE(SUM(units_available), 0) as totalUnits FROM blood_stock');
    const [[requestCount]] = await pool.query('SELECT COUNT(*) as total FROM blood_requests');
    const [[pendingCount]] = await pool.query("SELECT COUNT(*) as pending FROM blood_requests WHERE status = 'Pending'");
    const [[lowStockCount]] = await pool.query('SELECT COUNT(*) as lowCount FROM blood_stock WHERE units_available < 10');

    const [stockRows] = await pool.query('SELECT * FROM blood_stock ORDER BY blood_group ASC');
    const [recentDonors] = await pool.query('SELECT * FROM donors ORDER BY donor_id DESC LIMIT 5');
    const [recentRequests] = await pool.query('SELECT * FROM blood_requests ORDER BY request_id DESC LIMIT 5');

    res.json({
      success: true,
      stats: {
        totalDonors: donorCount.count,
        totalUnits: stockCount.totalUnits,
        totalRequests: requestCount.total,
        pendingRequests: pendingCount.pending,
        lowStockCount: lowStockCount.lowCount
      },
      stock: stockRows,
      recentDonors,
      recentRequests
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch dashboard statistics' });
  }
});

// ---------------------------------------------------------------------------
// 3. Donor Management Routes
// ---------------------------------------------------------------------------

// GET /api/donors - List donors with optional search query & blood group filter
app.get('/api/donors', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const { search, blood_group } = req.query;

    let query = 'SELECT * FROM donors WHERE 1=1';
    const params = [];

    if (search && search.trim() !== '') {
      query += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (blood_group && VALID_BLOOD_GROUPS.includes(blood_group)) {
      query += ' AND blood_group = ?';
      params.push(blood_group);
    }

    query += ' ORDER BY donor_id DESC';

    const [rows] = await pool.query(query, params);
    res.json({ success: true, count: rows.length, donors: rows });
  } catch (err) {
    console.error('Fetch donors error:', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching donors' });
  }
});

// GET /api/donors/:id - Get single donor
app.get('/api/donors/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM donors WHERE donor_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Donor not found' });
    }
    res.json({ success: true, donor: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Database error fetching donor' });
  }
});

// POST /api/donors - Register new donor
app.post('/api/donors', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const { name, age, gender, blood_group, phone } = req.body;

    // Strict validation
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ success: false, error: 'Full name is required (2-100 characters).' });
    }

    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 18 || parsedAge > 65) {
      return res.status(400).json({ success: false, error: 'Eligible donor age must be between 18 and 65 years.' });
    }

    const cleanGender = (gender || '').trim();
    if (!['Male', 'Female', 'Other'].includes(cleanGender)) {
      return res.status(400).json({ success: false, error: 'Gender must be Male, Female, or Other.' });
    }

    if (!VALID_BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({
        success: false,
        error: `Invalid blood group. Allowed: ${VALID_BLOOD_GROUPS.join(', ')}`
      });
    }

    const cleanPhone = (phone || '').trim();
    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15 || !/^[0-9+\-\s()]+$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Valid phone number is required (10-15 digits).' });
    }

    const [result] = await pool.query(
      'INSERT INTO donors (name, age, gender, blood_group, phone) VALUES (?, ?, ?, ?, ?)',
      [name.trim(), parsedAge, cleanGender, blood_group, cleanPhone]
    );

    res.status(201).json({
      success: true,
      message: `Donor ${name.trim()} successfully registered!`,
      donor_id: result.insertId
    });
  } catch (err) {
    console.error('Add donor error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to register donor in database.' });
  }
});

// PUT /api/donors/:id - Update donor
app.put('/api/donors/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const donorId = parseInt(req.params.id, 10);
    const { name, age, gender, blood_group, phone } = req.body;

    if (!donorId || isNaN(donorId)) {
      return res.status(400).json({ success: false, error: 'Invalid donor ID.' });
    }

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ success: false, error: 'Full name is required (2-100 characters).' });
    }

    const parsedAge = parseInt(age, 10);
    if (isNaN(parsedAge) || parsedAge < 18 || parsedAge > 65) {
      return res.status(400).json({ success: false, error: 'Age must be between 18 and 65 years.' });
    }

    const cleanGender = (gender || '').trim();
    if (!['Male', 'Female', 'Other'].includes(cleanGender)) {
      return res.status(400).json({ success: false, error: 'Gender must be Male, Female, or Other.' });
    }

    if (!VALID_BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({
        success: false,
        error: `Invalid blood group. Allowed: ${VALID_BLOOD_GROUPS.join(', ')}`
      });
    }

    const cleanPhone = (phone || '').trim();
    if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 15 || !/^[0-9+\-\s()]+$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, error: 'Valid phone number is required (10-15 digits).' });
    }

    const [result] = await pool.query(
      'UPDATE donors SET name = ?, age = ?, gender = ?, blood_group = ?, phone = ? WHERE donor_id = ?',
      [name.trim(), parsedAge, cleanGender, blood_group, cleanPhone, donorId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Donor not found.' });
    }

    res.json({
      success: true,
      message: `Donor details for "${name.trim()}" updated successfully.`
    });
  } catch (err) {
    console.error('Update donor error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update donor record.' });
  }
});

// DELETE /api/donors/:id - Delete donor
app.delete('/api/donors/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const donorId = parseInt(req.params.id, 10);

    const [donorRows] = await pool.query('SELECT name FROM donors WHERE donor_id = ?', [donorId]);
    if (donorRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Donor not found.' });
    }

    const donorName = donorRows[0].name;
    await pool.query('DELETE FROM donors WHERE donor_id = ?', [donorId]);

    res.json({
      success: true,
      message: `Donor record for "${donorName}" has been successfully deleted.`
    });
  } catch (err) {
    console.error('Delete donor error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete donor record.' });
  }
});

// ---------------------------------------------------------------------------
// 4. Blood Stock Management Routes
// ---------------------------------------------------------------------------

// GET /api/stock - View all blood stock
app.get('/api/stock', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT 
        stock_id,
        blood_group,
        units_available,
        last_updated,
        CASE 
          WHEN units_available < 5 THEN 'Critical'
          WHEN units_available < 10 THEN 'Low'
          ELSE 'Optimal'
        END AS stock_status
      FROM blood_stock 
      ORDER BY blood_group ASC
    `);

    res.json({ success: true, count: rows.length, stock: rows });
  } catch (err) {
    console.error('Fetch stock error:', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching blood stock.' });
  }
});

// GET /api/stock/low - View only low blood stock (units < 10)
app.get('/api/stock/low', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT 
        stock_id,
        blood_group,
        units_available,
        last_updated,
        CASE 
          WHEN units_available < 5 THEN 'Critical'
          ELSE 'Low'
        END AS stock_status
      FROM blood_stock 
      WHERE units_available < 10 
      ORDER BY units_available ASC
    `);

    res.json({ success: true, count: rows.length, lowStock: rows });
  } catch (err) {
    console.error('Fetch low stock error:', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching low blood stock.' });
  }
});

// POST /api/stock - Add or increment blood stock units
app.post('/api/stock', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const { blood_group, units_to_add } = req.body;

    if (!VALID_BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({
        success: false,
        error: `Invalid blood group. Allowed: ${VALID_BLOOD_GROUPS.join(', ')}`
      });
    }

    const units = parseInt(units_to_add, 10);
    if (isNaN(units) || units <= 0) {
      return res.status(400).json({ success: false, error: 'Units to add must be a positive integer.' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Check if group exists
    const [existing] = await pool.query('SELECT stock_id, units_available FROM blood_stock WHERE blood_group = ?', [blood_group]);
    if (existing.length > 0) {
      const newTotal = existing[0].units_available + units;
      await pool.query(
        'UPDATE blood_stock SET units_available = ?, last_updated = ? WHERE stock_id = ?',
        [newTotal, today, existing[0].stock_id]
      );
      return res.json({
        success: true,
        message: `Added ${units} unit(s) of ${blood_group}. New total: ${newTotal} units.`,
        newUnits: newTotal
      });
    } else {
      const [result] = await pool.query(
        'INSERT INTO blood_stock (blood_group, units_available, last_updated) VALUES (?, ?, ?)',
        [blood_group, units, today]
      );
      return res.status(201).json({
        success: true,
        message: `Registered ${units} unit(s) of ${blood_group}.`,
        stock_id: result.insertId
      });
    }
  } catch (err) {
    console.error('Add stock error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update blood stock.' });
  }
});

// PUT /api/stock/:id - Direct update of available blood units
app.put('/api/stock/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const stockId = parseInt(req.params.id, 10);
    const { units_available } = req.body;

    if (!stockId || isNaN(stockId)) {
      return res.status(400).json({ success: false, error: 'Invalid stock ID.' });
    }

    const units = parseInt(units_available, 10);
    if (isNaN(units) || units < 0) {
      return res.status(400).json({ success: false, error: 'Units available must be a non-negative number (0 or more).' });
    }

    const today = new Date().toISOString().split('T')[0];

    const [result] = await pool.query(
      'UPDATE blood_stock SET units_available = ?, last_updated = ? WHERE stock_id = ?',
      [units, today, stockId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Stock entry not found.' });
    }

    // Fetch updated row
    const [rows] = await pool.query('SELECT * FROM blood_stock WHERE stock_id = ?', [stockId]);
    res.json({
      success: true,
      message: `Stock for ${rows[0].blood_group} successfully updated to ${units} unit(s).`,
      stock: rows[0]
    });
  } catch (err) {
    console.error('Update stock error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update stock in database.' });
  }
});

// ---------------------------------------------------------------------------
// 5. Hospital Blood Requests Routes
// ---------------------------------------------------------------------------

// GET /api/requests - List requests with optional search, status, and blood group filters
app.get('/api/requests', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const { search, status, blood_group } = req.query;

    let query = 'SELECT * FROM blood_requests WHERE 1=1';
    const params = [];

    if (search && search.trim() !== '') {
      query += ' AND hospital_name LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    if (status && VALID_REQUEST_STATUSES.includes(status)) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (blood_group && VALID_BLOOD_GROUPS.includes(blood_group)) {
      query += ' AND blood_group = ?';
      params.push(blood_group);
    }

    query += ' ORDER BY request_id DESC';

    const [rows] = await pool.query(query, params);
    res.json({ success: true, count: rows.length, requests: rows });
  } catch (err) {
    console.error('Fetch requests error:', err.message);
    res.status(500).json({ success: false, error: 'Database error fetching blood requests.' });
  }
});

// GET /api/requests/:id - Get single request
app.get('/api/requests/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM blood_requests WHERE request_id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Request not found.' });
    }
    res.json({ success: true, request: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Database error fetching request.' });
  }
});

// POST /api/requests - Create blood request
app.post('/api/requests', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const { hospital_name, blood_group, units_required, request_date, status } = req.body;

    if (!hospital_name || typeof hospital_name !== 'string' || hospital_name.trim().length < 2 || hospital_name.trim().length > 150) {
      return res.status(400).json({ success: false, error: 'Hospital name is required (2-150 characters).' });
    }

    if (!VALID_BLOOD_GROUPS.includes(blood_group)) {
      return res.status(400).json({
        success: false,
        error: `Invalid blood group. Allowed: ${VALID_BLOOD_GROUPS.join(', ')}`
      });
    }

    const units = parseInt(units_required, 10);
    if (isNaN(units) || units <= 0) {
      return res.status(400).json({ success: false, error: 'Units required must be at least 1 unit.' });
    }

    let dateVal = request_date;
    if (!dateVal || isNaN(Date.parse(dateVal))) {
      dateVal = new Date().toISOString().split('T')[0];
    } else {
      dateVal = new Date(dateVal).toISOString().split('T')[0];
    }

    const finalStatus = VALID_REQUEST_STATUSES.includes(status) ? status : 'Pending';

    const [result] = await pool.query(
      'INSERT INTO blood_requests (hospital_name, blood_group, units_required, request_date, status) VALUES (?, ?, ?, ?, ?)',
      [hospital_name.trim(), blood_group, units, dateVal, finalStatus]
    );

    res.status(201).json({
      success: true,
      message: `Blood request for ${units} unit(s) of ${blood_group} by "${hospital_name.trim()}" created successfully.`,
      request_id: result.insertId
    });
  } catch (err) {
    console.error('Create request error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create blood request in database.' });
  }
});

// PUT /api/requests/:id/status - Update Blood Request Status
app.put('/api/requests/:id/status', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const requestId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!requestId || isNaN(requestId)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    }

    if (!VALID_REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid status. Allowed: ${VALID_REQUEST_STATUSES.join(', ')}`
      });
    }

    // Check request
    const [existing] = await pool.query('SELECT * FROM blood_requests WHERE request_id = ?', [requestId]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Blood request not found.' });
    }

    const currentRequest = existing[0];

    // If status is transitioning to Fulfilled, optionally deduct from stock if sufficient
    if (status === 'Fulfilled' && currentRequest.status !== 'Fulfilled') {
      const [stockRows] = await pool.query(
        'SELECT stock_id, units_available FROM blood_stock WHERE blood_group = ?',
        [currentRequest.blood_group]
      );
      if (stockRows.length > 0 && stockRows[0].units_available >= currentRequest.units_required) {
        const newStock = stockRows[0].units_available - currentRequest.units_required;
        const today = new Date().toISOString().split('T')[0];
        await pool.query(
          'UPDATE blood_stock SET units_available = ?, last_updated = ? WHERE stock_id = ?',
          [newStock, today, stockRows[0].stock_id]
        );
      }
    }

    await pool.query('UPDATE blood_requests SET status = ? WHERE request_id = ?', [status, requestId]);

    res.json({
      success: true,
      message: `Request #${requestId} status updated to "${status}".`
    });
  } catch (err) {
    console.error('Update request status error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update request status.' });
  }
});

// DELETE /api/requests/:id - Delete blood request
app.delete('/api/requests/:id', checkDb, async (req, res) => {
  try {
    const pool = getPool();
    const requestId = parseInt(req.params.id, 10);

    const [rows] = await pool.query('SELECT hospital_name, blood_group FROM blood_requests WHERE request_id = ?', [requestId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Blood request not found.' });
    }

    await pool.query('DELETE FROM blood_requests WHERE request_id = ?', [requestId]);

    res.json({
      success: true,
      message: `Blood request #${requestId} for ${rows[0].hospital_name} (${rows[0].blood_group}) deleted successfully.`
    });
  } catch (err) {
    console.error('Delete request error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete blood request.' });
  }
});

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB and start server
async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`🚀 Parthu Reddy's Blood Bank server running at http://localhost:${PORT}`);
  });
}

startServer();
