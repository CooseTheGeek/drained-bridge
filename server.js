// server.js – DRAINED TABLET BRIDGE v7.0.0 (with rcon-client for TCP RCON)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { Rcon } = require('rcon-client');

const app = express();
const httpServer = createServer(app);

const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('📡 Dashboard WebSocket client connected');
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'subscribe') {
                ws.send(JSON.stringify({ type: 'subscribed', server: data.ip }));
            }
        } catch (e) {
            console.error('Invalid WebSocket message', e);
        }
    });
    ws.on('close', () => console.log('📡 Dashboard WebSocket client disconnected'));
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function initDB() {
    try {
        console.log('📦 Initializing database tables...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS combat_logs (
                id SERIAL PRIMARY KEY,
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                event_type TEXT NOT NULL,
                victim TEXT,
                weapon TEXT,
                distance INTEGER,
                timestamp BIGINT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                totp_secret TEXT,
                discord_id TEXT,
                trusted_devices TEXT[],
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS claims (
                id SERIAL PRIMARY KEY,
                player_id TEXT NOT NULL,
                item_shortname TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                claimed_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                username TEXT,
                action TEXT NOT NULL,
                ip TEXT,
                timestamp TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS zones (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                position JSONB NOT NULL,
                radius INTEGER,
                flags JSONB,
                enabled BOOLEAN DEFAULT true
            );
            CREATE TABLE IF NOT EXISTS backup_settings (
                id TEXT PRIMARY KEY DEFAULT 'default',
                settings JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS user_servers (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                name TEXT NOT NULL,
                ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                password TEXT NOT NULL,
                server_id TEXT,
                region TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS shop_items (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                shortname TEXT NOT NULL,
                price INTEGER NOT NULL,
                stock INTEGER NOT NULL DEFAULT -1,
                category TEXT,
                image TEXT,
                command TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT`);
        await pool.query(`INSERT INTO users (username, password_hash, role) VALUES ('CooseTheGeek', '', 'master') ON CONFLICT (username) DO NOTHING`);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        throw err;
    }
}
initDB().catch(console.error);

// WebRcon connection management (TCP)
const connections = new Map();

async function getRcon(ip, port, password) {
    const key = `${ip}:${port}`;
    let entry = connections.get(key);
    if (entry && entry.connected) return entry;
    if (entry) {
        try { entry.end(); } catch(e) {}
        connections.delete(key);
    }
    console.log(`🔄 Creating new Rcon connection to ${ip}:${port}`);
    const rcon = await Rcon.connect({ host: ip, port, password });
    connections.set(key, rcon);
    return rcon;
}

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', connections: connections.size });
});

app.post('/api/connect', async (req, res) => {
    const { ip, port, password } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/connect:`, { ip, port });
    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send('status');
        res.json({ success: true, server: { ip, port, password } });
    } catch (err) {
        console.error('❌ Rcon connection error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send(command);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========== User Server Management ==========
function getUserFromRequest(req) {
    const username = req.query.username || req.body.username;
    return username;
}

app.get('/api/user/servers', async (req, res) => {
    const username = getUserFromRequest(req);
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const result = await pool.query('SELECT id, name, ip, port, server_id, region, created_at FROM user_servers WHERE user_id = $1 ORDER BY created_at DESC', [username]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/servers', async (req, res) => {
    const username = getUserFromRequest(req);
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    const { name, ip, port, password, server_id, region } = req.body;
    if (!name || !ip || !port || !password) return res.status(400).json({ error: 'Missing fields' });
    try {
        const userCheck = await pool.query('SELECT username FROM users WHERE username = $1', [username]);
        if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const result = await pool.query(
            `INSERT INTO user_servers (user_id, name, ip, port, password, server_id, region)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [username, name, ip, port, password, server_id || null, region || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/user/servers/:id', async (req, res) => {
    const username = getUserFromRequest(req);
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    const id = req.params.id;
    try {
        await pool.query('DELETE FROM user_servers WHERE id = $1 AND user_id = $2', [id, username]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== Combat Logs ==========
app.post('/api/combatlog', async (req, res) => {
    const { playerId, playerName, eventType, victim, weapon, distance, timestamp } = req.body;
    try {
        await pool.query(
            `INSERT INTO combat_logs (player_id, player_name, event_type, victim, weapon, distance, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [playerId, playerName, eventType, victim, weapon, distance, timestamp]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/combatlog/:playerId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM combat_logs WHERE player_id = $1 ORDER BY timestamp DESC LIMIT 100`,
            [req.params.playerId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== Claims ==========
app.post('/api/claim', async (req, res) => {
    const { playerId, itemShortname, quantity, expiresAt } = req.body;
    try {
        await pool.query(
            `INSERT INTO claims (player_id, item_shortname, quantity, expires_at) VALUES ($1, $2, $3, $4)`,
            [playerId, itemShortname, quantity, expiresAt]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/claims/:playerId', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM claims WHERE player_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY claimed_at DESC`,
            [req.params.playerId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== Zones ==========
app.get('/api/zones', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM zones');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/zones', async (req, res) => {
    const { id, name, position, radius, flags, enabled } = req.body;
    try {
        await pool.query(
            `INSERT INTO zones (id, name, position, radius, flags, enabled)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO UPDATE SET name=$2, position=$3, radius=$4, flags=$5, enabled=$6`,
            [id, name, JSON.stringify(position), radius, JSON.stringify(flags), enabled]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/zones/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM zones WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== Backup Settings ==========
app.get('/api/backup-settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT settings FROM backup_settings WHERE id = $1', ['default']);
        if (result.rows.length === 0) {
            res.json({ autoBackup: true, interval: 24, keepLast: 30, compress: true, notifyOnComplete: true });
        } else {
            res.json(result.rows[0].settings);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/backup-settings', async (req, res) => {
    const settings = req.body;
    try {
        await pool.query(
            `INSERT INTO backup_settings (id, settings) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET settings = $2`,
            ['default', JSON.stringify(settings)]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== GPortal Quick Connect ==========
app.post('/api/gportal/resolve', (req, res) => {
    const { code } = req.body;
    if (code === 'F7K2M9') {
        res.json({ ip: '144.126.137.59', port: 28916, password: 'Myakspray1215' });
    } else {
        res.status(404).json({ error: 'Code not found' });
    }
});

// ========== Forgot Code ==========
app.post('/api/forgot-code', (req, res) => {
    console.log('📧 Forgot code request from user:', req.body.username);
    res.json({ success: true });
});

// ========== Shop API ==========
app.get('/api/shop/items', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM shop_items ORDER BY category, name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/shop/items', async (req, res) => {
    const { name, description, shortname, price, stock, category, image, command } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO shop_items (name, description, shortname, price, stock, category, image, command)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, description, shortname, price, stock, category, image, command]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/shop/items/:id', async (req, res) => {
    const { name, description, shortname, price, stock, category, image, command } = req.body;
    try {
        const result = await pool.query(
            `UPDATE shop_items SET name=$1, description=$2, shortname=$3, price=$4, stock=$5,
             category=$6, image=$7, command=$8, updated_at=NOW() WHERE id=$9 RETURNING *`,
            [name, description, shortname, price, stock, category, image, command, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/shop/items/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM shop_items WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/shop/purchase', async (req, res) => {
    const { playerId, itemShortname, quantity } = req.body;
    try {
        await pool.query(
            `INSERT INTO claims (player_id, item_shortname, quantity, expires_at) VALUES ($1, $2, $3, NULL)`,
            [playerId, itemShortname, quantity]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});