const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Initialize database
const db = new sqlite3.Database('vehicles.db', (err) => {
  if (err) console.error('Database opening error: ', err);
  initializeTables();
});

function initializeTables() {
  // Reservations table
  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_number TEXT NOT NULL,
    company TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    price_per_hour REAL DEFAULT 0
  )`);

  // Pending payments table
  db.run(`CREATE TABLE IF NOT EXISTS pending_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_number TEXT NOT NULL,
    company TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    price_per_hour REAL DEFAULT 0,
    total_hours INTEGER DEFAULT 0,
    total_price REAL DEFAULT 0,
    total_price_vat REAL DEFAULT 0,
    vehicle_expenses REAL DEFAULT 0,
    expected_payment_date TEXT NOT NULL
  )`);

  // Vehicle records table
  db.run(`CREATE TABLE IF NOT EXISTS vehicle_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_number TEXT NOT NULL,
    company TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    total_price REAL DEFAULT 0,
    total_price_vat REAL DEFAULT 0,
    vehicle_expenses REAL DEFAULT 0,
    payment_date TEXT NOT NULL
  )`);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for database operations
ipcMain.handle('add-reservation', async (event, data) => {
  return new Promise((resolve, reject) => {
    // Validate required fields
    if (!data.vehicleNumber || !data.company || !data.startDate || !data.endDate || !data.vehicleType) {
      reject(new Error('All fields are required'));
      return;
    }

    // Ensure price_per_hour is a valid number
    const pricePerHour = parseFloat(data.pricePerHour) || 0;

    const sql = `INSERT INTO reservations (vehicle_number, company, start_date, end_date, vehicle_type, price_per_hour) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(sql, [
      data.vehicleNumber.trim(),
      data.company.trim(),
      data.startDate,
      data.endDate,
      data.vehicleType,
      pricePerHour
    ], function(err) {
      if (err) {
        console.error('Database error:', err);
        reject(new Error('Failed to save reservation'));
        return;
      }
      resolve(this.lastID);
    });
  });
});

ipcMain.handle('get-reservations', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM reservations', [], (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
});

ipcMain.handle('move-to-pending', async (event, data) => {
  return new Promise((resolve, reject) => {
    // Validate required fields
    if (!data.vehicleNumber || !data.company || !data.startDate || !data.endDate || !data.expectedPaymentDate) {
      reject(new Error('Required fields are missing'));
      return;
    }

    // Ensure numeric fields are valid numbers
    const pricePerHour = parseFloat(data.pricePerHour) || 0;
    const totalHours = parseInt(data.totalHours) || 0;
    const vehicleExpenses = parseFloat(data.vehicleExpenses) || 0;
    const totalPrice = pricePerHour * totalHours;
    const totalPriceVat = totalPrice * 1.05; // 5% VAT

    db.serialize(() => {
      try {
        // Insert into pending_payments
        const insertSql = `INSERT INTO pending_payments 
          (vehicle_number, company, start_date, end_date, price_per_hour, total_hours, 
           total_price, total_price_vat, vehicle_expenses, expected_payment_date) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        
        db.run(insertSql, [
          data.vehicleNumber.trim(),
          data.company.trim(),
          data.startDate,
          data.endDate,
          pricePerHour,
          totalHours,
          totalPrice,
          totalPriceVat,
          vehicleExpenses,
          data.expectedPaymentDate
        ], function(err) {
          if (err) {
            throw err;
          }
        });

        // Delete from reservations
        db.run('DELETE FROM reservations WHERE id = ?', [data.reservationId], function(err) {
          if (err) {
            throw err;
          }
        });
        
        resolve(true);
      } catch (err) {
        console.error('Database error:', err);
        reject(new Error('Failed to process vehicle return'));
      }
    });
  });
});

ipcMain.handle('get-pending-payments', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM pending_payments', [], (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
});

ipcMain.handle('clear-payment', async (event, data) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      try {
        // Move to vehicle_records
        // First get the pending payment record
        db.get('SELECT * FROM pending_payments WHERE id = ?', [data.id], (err, payment) => {
          if (err) {
            console.error('Error fetching payment:', err);
            reject(new Error('Failed to fetch payment details'));
            return;
          }

          if (!payment) {
            reject(new Error('Payment record not found'));
            return;
          }

          const insertSql = `INSERT INTO vehicle_records 
            (vehicle_number, company, start_date, end_date, total_price, 
             total_price_vat, vehicle_expenses, payment_date) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
          
          const paymentDate = new Date().toISOString();

          // Use the data from the pending_payments record
          db.run(insertSql, [
            payment.vehicle_number,
            payment.company,
            payment.start_date,
            payment.end_date,
            payment.total_price || 0,
            payment.total_price_vat || 0,
            payment.vehicle_expenses || 0,
            paymentDate
          ], function(err) {
            if (err) {
              console.error('Error inserting record:', err);
              reject(new Error('Failed to save payment record'));
              return;
            }

            // Delete from pending_payments
            db.run('DELETE FROM pending_payments WHERE id = ?', [payment.id], function(err) {
              if (err) {
                console.error('Error deleting payment:', err);
                reject(new Error('Failed to remove pending payment'));
                return;
              }
              
              resolve(true);
            });
          });
        });
      } catch (err) {
        console.error('Database error:', err);
        reject(new Error('Failed to clear payment'));
      }
    });
  });
});

ipcMain.handle('get-vehicle-records', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM vehicle_records', [], (err, rows) => {
      if (err) reject(err);
      resolve(rows);
    });
  });
});

// Delete reservation handler
ipcMain.handle('delete-reservation', async (event, id) => {
  return new Promise((resolve, reject) => {
    if (!id) {
      reject(new Error('Reservation ID is required'));
      return;
    }

    db.run('DELETE FROM reservations WHERE id = ?', [id], function(err) {
      if (err) {
        console.error('Error deleting reservation:', err);
        reject(new Error('Failed to delete reservation'));
        return;
      }
      resolve(true);
    });
  });
});

// Delete pending payment handler
ipcMain.handle('delete-pending-payment', async (event, id) => {
  return new Promise((resolve, reject) => {
    if (!id) {
      reject(new Error('Payment ID is required'));
      return;
    }

    db.run('DELETE FROM pending_payments WHERE id = ?', [id], function(err) {
      if (err) {
        console.error('Error deleting pending payment:', err);
        reject(new Error('Failed to delete pending payment'));
        return;
      }
      resolve(true);
    });
  });
});
