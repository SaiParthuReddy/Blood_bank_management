require('dotenv').config();
const mysql = require('mysql2/promise');

const VALID_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const VALID_REQUEST_STATUSES = ['Pending', 'Approved', 'Fulfilled', 'Rejected'];

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'parthu_blood_bank',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
};

let pool = null;
let dbState = {
  connected: false,
  tablesVerified: false,
  database: dbConfig.database,
  host: dbConfig.host,
  port: dbConfig.port,
  lastChecked: null,
  errorMessage: null
};

async function initDatabase() {
  try {
    // First, verify host connection and ensure database exists
    const rootConn = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password
    });
    await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``);
    await rootConn.end();

    // Now initialize pool with the target database
    pool = mysql.createPool(dbConfig);
    const conn = await pool.getConnection();

    // Create donors table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS donors (
        donor_id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        age INT NOT NULL,
        gender VARCHAR(10) NOT NULL,
        blood_group VARCHAR(5) NOT NULL,
        phone VARCHAR(15) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Create blood_stock table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS blood_stock (
        stock_id INT PRIMARY KEY AUTO_INCREMENT,
        blood_group VARCHAR(5) NOT NULL,
        units_available INT NOT NULL DEFAULT 0,
        last_updated DATE NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Create blood_requests table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS blood_requests (
        request_id INT PRIMARY KEY AUTO_INCREMENT,
        hospital_name VARCHAR(150) NOT NULL,
        blood_group VARCHAR(5) NOT NULL,
        units_required INT NOT NULL,
        request_date DATE NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'Pending'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Seed blood_stock if empty or missing groups
    const [existingStock] = await conn.query('SELECT blood_group FROM blood_stock');
    const existingGroups = new Set(existingStock.map(r => r.blood_group));
    
    // Initial stock setup
    const initialStockAmounts = {
      'O+': 28,
      'A+': 22,
      'B+': 18,
      'AB+': 8,
      'O-': 4,   // low stock example
      'A-': 5,   // low stock example
      'B-': 6,   // low stock example
      'AB-': 3   // critical low stock example
    };

    const today = new Date().toISOString().split('T')[0];
    for (const bg of VALID_BLOOD_GROUPS) {
      if (!existingGroups.has(bg)) {
        await conn.query(
          'INSERT INTO blood_stock (blood_group, units_available, last_updated) VALUES (?, ?, ?)',
          [bg, initialStockAmounts[bg] || 10, today]
        );
      }
    }

    // Seed sample donors if table is empty
    const [donorCountRow] = await conn.query('SELECT COUNT(*) as cnt FROM donors');
    if (donorCountRow[0].cnt === 0) {
      const sampleDonors = [
        ['Rajesh Varma', 29, 'Male', 'O+', '9848022334'],
        ['Ananya Rao', 24, 'Female', 'A+', '9876543210'],
        ['Karthik Reddy', 34, 'Male', 'B+', '9123456789'],
        ['Deepika Sharma', 28, 'Female', 'O-', '9988776655'],
        ['Vikramaditya P', 41, 'Male', 'AB+', '9440112233'],
        ['Sneha Patil', 22, 'Female', 'A-', '9701234567'],
        ['Manoj Kumar', 31, 'Male', 'B-', '9550987654'],
        ['Pooja Hegde', 26, 'Female', 'AB-', '9849011224']
      ];
      for (const donor of sampleDonors) {
        await conn.query(
          'INSERT INTO donors (name, age, gender, blood_group, phone) VALUES (?, ?, ?, ?, ?)',
          donor
        );
      }
    }

    // Seed sample blood requests if table is empty
    const [requestCountRow] = await conn.query('SELECT COUNT(*) as cnt FROM blood_requests');
    if (requestCountRow[0].cnt === 0) {
      const sampleRequests = [
        ['Apollo Hospitals, Jubilee Hills', 'O-', 4, today, 'Pending'],
        ['Yashoda Super Speciality Hospital', 'A+', 6, today, 'Approved'],
        ['KIMS Hospitals, Secunderabad', 'AB-', 2, today, 'Pending'],
        ['Care Hospitals, Banjara Hills', 'B+', 5, today, 'Fulfilled'],
        ['Sunshine Hospitals', 'O+', 8, today, 'Approved']
      ];
      for (const req of sampleRequests) {
        await conn.query(
          'INSERT INTO blood_requests (hospital_name, blood_group, units_required, request_date, status) VALUES (?, ?, ?, ?, ?)',
          req
        );
      }
    }

    conn.release();

    dbState.connected = true;
    dbState.tablesVerified = true;
    dbState.lastChecked = new Date().toISOString();
    dbState.errorMessage = null;
    console.log('✅ MySQL Database and Tables successfully initialized & verified.');
  } catch (err) {
    dbState.connected = false;
    dbState.tablesVerified = false;
    dbState.lastChecked = new Date().toISOString();
    dbState.errorMessage = err.message;
    console.error('❌ MySQL Initialization Error:', err.message);
  }
}

function getPool() {
  return pool;
}

function getDbState() {
  return {
    ...dbState,
    validBloodGroups: VALID_BLOOD_GROUPS,
    validStatuses: VALID_REQUEST_STATUSES
  };
}

module.exports = {
  initDatabase,
  getPool,
  getDbState,
  VALID_BLOOD_GROUPS,
  VALID_REQUEST_STATUSES
};
