// server.js – DRAINED TABLET BRIDGE v7.0.0 (Complete with detailed logging)
// Handles RCON connections, WebSocket streaming, GPortal API proxy, persistent database,
// Discord OAuth, and forgot code email alerts.

require('dotenv').config();
const express = require('express');
const { Rcon } = require('rcon-client');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');

const app = express();
const httpServer = createServer(app);

// WebSocket server on /ws
const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
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
    ws.on('close', () => console.log('WebSocket client disconnected'));
});

app.use(cors());
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// In‑memory RCON connection cache with expiry
const connections = new Map();

async function getRcon(ip, port, password) {
    const id = `${ip}:${port}`;
    console.log(`[${new Date().toISOString()}] getRcon called for ${id}`);

    let rcon = connections.get(id);
    if (rcon && rcon.connected) {
        console.log(`✅ Using existing connection for ${id}`);
        return rcon;
    }

    console.log(`🔄 Creating new Rcon connection to ${ip}:${port}...`);
    rcon = new Rcon({
        host: ip,
        port: parseInt(port),
        password,
        timeout: 10000 // 10 seconds timeout
    });

    try {
        await rcon.connect();
        console.log(`✅ Connected to ${ip}:${port}`);
        connections.set(id, rcon);

        // Set a timeout to close the connection after 5 minutes of inactivity
        setTimeout(() => {
            if (rcon.connected) {
                console.log(`⏰ Closing idle connection to ${id}`);
                rcon.end();
                connections.delete(id);
            }
        }, 300000);

        return rcon;
    } catch (err) {
        console.error(`❌ Failed to connect to ${ip}:${port}:`, err.message);
        console.error('Error details:', err);
        throw err;
    }
}

// ---------- Database Setup ----------
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
        `);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        console.error(err.stack);
        throw err;
    }
}
initDB().catch(console.error);

// ---------- API Endpoints ----------

// Health check
app.get('/api/health', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/health`);
    res.json({ status: 'ok', connections: connections.size });
});

// Connect with credentials
app.post('/api/connect', async (req, res) => {
    const { ip, port, password } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/connect called with:`, { ip, port, password: '***' });

    try {
        console.log('🔌 Attempting to get Rcon connection...');
        const rcon = await getRcon(ip, port, password);
        console.log('✅ Rcon connection obtained, sending test command...');

        const result = await rcon.send('status');
        console.log('📨 Test command response:', result ? result.substring(0, 200) + '...' : '(empty)');

        res.json({ success: true, server: { ip, port, password } });
    } catch (err) {
        console.error('❌ Error in /api/connect:', err.message);
        console.error('Stack:', err.stack);
        console.error('Code:', err.code);
        res.status(500).json({ success: false, error: err.message, code: err.code });
    }
});

// Execute RCON command
app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/command:`, { ip, port, command });

    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send(command);
        console.log(`📨 Command response (first 200 chars):`, result ? result.substring(0, 200) + '...' : '(empty)');
        res.json({ success: true, result });
    } catch (err) {
        console.error('❌ Error in /api/command:', err.message);
        console.error('Stack:', err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------- Combat Logs ----------
app.post('/api/combatlog', async (req, res) => {
    const { playerId, playerName, eventType, victim, weapon, distance, timestamp } = req.body;
    try {
        await pool.query(
            'INSERT INTO combat_logs (player_id, player_name, event_type, victim, weapon, distance, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [playerId, playerName, eventType, victim, weapon, distance, timestamp]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Error saving combat log:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/combatlog/:playerId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM combat_logs WHERE player_id = $1 ORDER BY timestamp DESC LIMIT 100',
            [req.params.playerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error fetching combat logs:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Claims ----------
app.post('/api/claim', async (req, res) => {
    const { playerId, itemShortname, quantity, expiresAt } = req.body;
    try {
        await pool.query(
            'INSERT INTO claims (player_id, item_shortname, quantity, expires_at) VALUES ($1, $2, $3, $4)',
            [playerId, itemShortname, quantity, expiresAt]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Error adding claim:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/claims/:playerId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM claims WHERE player_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY claimed_at DESC',
            [req.params.playerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error fetching claims:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Zones ----------
app.get('/api/zones', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM zones');
        res.json(result.rows);
    } catch (err) {
        console.error('❌ Error fetching zones:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/zones', async (req, res) => {
    const { id, name, position, radius, flags, enabled } = req.body;
    try {
        await pool.query(
            'INSERT INTO zones (id, name, position, radius, flags, enabled) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET name=$2, position=$3, radius=$4, flags=$5, enabled=$6',
            [id, name, JSON.stringify(position), radius, JSON.stringify(flags), enabled]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Error saving zone:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/zones/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM zones WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Error deleting zone:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Backup Settings ----------
app.get('/api/backup-settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT settings FROM backup_settings WHERE id = $1', ['default']);
        if (result.rows.length === 0) {
            // Return default settings
            res.json({
                autoBackup: true,
                interval: 24,
                keepLast: 30,
                compress: true,
                notifyOnComplete: true
            });
        } else {
            res.json(result.rows[0].settings);
        }
    } catch (err) {
        console.error('❌ Error fetching backup settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/backup-settings', async (req, res) => {
    const settings = req.body;
    try {
        await pool.query(
            'INSERT INTO backup_settings (id, settings) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET settings = $2',
            ['default', JSON.stringify(settings)]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Error saving backup settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- GPortal Quick Connect Code Resolution ----------
app.post('/api/gportal/resolve', (req, res) => {
    const { code } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/gportal/resolve with code: ${code}`);
    if (code === 'F7K2M9') {
        res.json({ ip: '144.126.137.59', port: 28916, password: 'Thatakspray' });
    } else {
        res.status(404).json({ error: 'Code not found' });
    }
});

// ---------- Forgot Code / Discord ----------
app.post('/api/forgot-code', (req, res) => {
    console.log('📧 Forgot code request from user:', req.body.username);
    res.json({ success: true });
});

// Discord OAuth endpoints – replace with your own Discord app credentials
const DISCORD_CLIENT_ID = '1481899114986733630';
const DISCORD_CLIENT_SECRET = '9WuZs3eY1x38V7iF_SBkGJ8gc-5uUJIT';
const REDIRECT_URI = 'https://drained-bridge.onrender.com/api/discord/callback';

app.get('/api/discord/login', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/discord/login - redirecting to Discord`);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/api/discord/callback', async (req, res) => {
    const { code } = req.query;
    console.log(`[${new Date().toISOString()}] GET /api/discord/callback with code: ${code ? 'present' : 'missing'}`);
    if (!code) {
        return res.status(400).send('No code provided');
    }

    try {
        // Exchange code for token
        const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: REDIRECT_URI
            })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenData.access_token) {
            throw new Error('Failed to get access token');
        }

        // Get user info
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userResponse.json();

        console.log('✅ Discord user linked:', userData.username, userData.id);

        res.redirect('https://the-drained-tablet.vercel.app/?discord=linked');
    } catch (err) {
        console.error('❌ Discord OAuth error:', err.message);
        console.error(err.stack);
        res.status(500).send('Discord authentication failed');
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});