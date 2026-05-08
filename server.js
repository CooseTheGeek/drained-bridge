// server.js – DRAINED TABLET BRIDGE v7.0.0 (Full rce.js integration, all API endpoints)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { default: RCEManager, LogLevel } = require('rce.js');

const app = express();
const httpServer = createServer(app);

// WebSocket server for dashboard real‑time features
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
app.use(express.json());

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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
            CREATE TABLE IF NOT EXISTS drained_blueprints (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price INT NOT NULL,
                blocks JSONB NOT NULL,
                enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS drained_purchases (
                id SERIAL PRIMARY KEY,
                player_id TEXT NOT NULL,
                blueprint_id INT NOT NULL REFERENCES drained_blueprints(id) ON DELETE CASCADE,
                purchased_at TIMESTAMP DEFAULT NOW(),
                deployed_at TIMESTAMP,
                UNIQUE(player_id, blueprint_id)
            );
        `);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        throw err;
    }
}
initDB().catch(console.error);

// ---------- WebRcon Connection Management (fallback) ----------
const connections = new Map();

async function createWebRconConnection(ip, port, password) {
    const url = `ws://${ip}:${port}/${password}`;
    console.log(`🔄 Creating WebRcon connection to ${url}`);

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, {
            handshakeTimeout: 10000,
            rejectUnauthorized: false
        });

        let authenticated = false;
        const pendingCommands = new Map();
        let authTimeout = setTimeout(() => {
            if (!authenticated) {
                ws.close();
                reject(new Error('Authentication timeout'));
            }
        }, 5000);

        ws.on('open', () => {
            ws.send(JSON.stringify({ Identifier: -1, Message: password, Name: "WebRcon" }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.Identifier === -1) {
                    clearTimeout(authTimeout);
                    if (response.Message === "Success") {
                        authenticated = true;
                        resolve({ send: (cmd) => sendCommand(ws, cmd, pendingCommands), close: () => ws.close() });
                    } else {
                        reject(new Error('Authentication failed: ' + response.Message));
                    }
                    return;
                }
                const pending = pendingCommands.get(response.Identifier);
                if (pending) {
                    clearTimeout(pending.timeout);
                    pending.resolve(response.Message);
                    pendingCommands.delete(response.Identifier);
                }
            } catch (e) {
                console.error('Failed to parse WebRcon message:', e);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(authTimeout);
            reject(err);
        });

        ws.on('close', () => {
            clearTimeout(authTimeout);
            for (const [id, pending] of pendingCommands) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Connection closed'));
            }
            pendingCommands.clear();
        });
    });
}

function sendCommand(ws, command, pendingMap) {
    return new Promise((resolve, reject) => {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        const timeout = setTimeout(() => {
            pendingMap.delete(id);
            reject(new Error('Command timeout'));
        }, 10000);
        pendingMap.set(id, { resolve, reject, timeout });
        ws.send(JSON.stringify({ Identifier: id, Message: command, Name: "WebRcon" }));
    });
}

async function getWebRcon(ip, port, password) {
    const key = `${ip}:${port}`;
    let entry = connections.get(key);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) return entry;
    if (entry) { entry.close(); connections.delete(key); }
    const connection = await createWebRconConnection(ip, port, password);
    connections.set(key, connection);
    return connection;
}

// ---------- GPortal API via rce.js ----------
let rce = null;
let serverIdentifier = null;

async function initGPortal() {
    const host = '144.126.137.59';
    const port = 28916;
    const password = 'Myakspray1215';
    try {
        rce = new RCEManager({ logger: { level: LogLevel.Info } });
        await rce.addServer({
            identifier: 'main-server',
            rcon: { host, port, password },
            state: [],
            intents: ['ALL']
        });
        serverIdentifier = 'main-server';
        console.log('✅ rce.js ready');
    } catch (err) {
        console.error('❌ Failed to initialize rce.js:', err.message);
    }
}
initGPortal();

// ---------- API Endpoints ----------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', connections: connections.size });
});

app.post('/api/connect', async (req, res) => {
    const { ip, port, password } = req.body;
    try {
        const rcon = await getWebRcon(ip, port, password);
        await rcon.send('status');
        res.json({ success: true, server: { ip, port, password } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    try {
        const rcon = await getWebRcon(ip, port, password);
        const result = await rcon.send(command);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/gportal/command', async (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });
    if (!rce || !serverIdentifier) return res.status(503).json({ error: 'GPortal API not initialized' });
    try {
        const result = await rce.sendCommand(serverIdentifier, command);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/gportal/status', async (req, res) => {
    if (!rce || !serverIdentifier) return res.status(503).json({ error: 'GPortal API not initialized' });
    try {
        const info = await rce.fetchInfo(serverIdentifier);
        res.json(info);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Discord OAuth ----------
const DISCORD_CLIENT_ID = '1481899114986733630';
const DISCORD_CLIENT_SECRET = '9WuZs3eY1x38V7iF_SBkGJ8gc-5uUJIT';
const REDIRECT_URI = 'https://drained-bridge.onrender.com/api/discord/callback';

app.get('/api/discord/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.post('/api/discord/callback', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'No code provided' });
    try {
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
        if (!tokenData.access_token) throw new Error('Failed to get access token');
        const userResponse = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userResponse.json();
        const discordId = userData.id;
        const existing = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (existing.rows.length === 0) {
            await pool.query(
                'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4)',
                [`discord_${discordId}`, '', 'user', discordId]
            );
        }
        res.json({ success: true, user: { id: discordId, username: userData.username, avatar: userData.avatar } });
    } catch (err) {
        console.error('Discord OAuth error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- User Server Management ----------
app.get('/api/user/servers', async (req, res) => {
    const discordId = req.query.discord_id;
    if (!discordId) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const result = await pool.query('SELECT id, name, ip, port, server_id, region, created_at FROM user_servers WHERE user_id = $1 ORDER BY created_at DESC', [user.rows[0].username]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/servers', async (req, res) => {
    const discordId = req.query.discord_id;
    if (!discordId) return res.status(401).json({ error: 'Not authenticated' });
    const { name, ip, port, password, server_id, region } = req.body;
    if (!name || !ip || !port || !password) return res.status(400).json({ error: 'Missing required fields' });
    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const result = await pool.query(
            'INSERT INTO user_servers (user_id, name, ip, port, password, server_id, region) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [user.rows[0].username, name, ip, port, password, server_id || null, region || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/user/servers/:id', async (req, res) => {
    const discordId = req.query.discord_id;
    if (!discordId) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        await pool.query('DELETE FROM user_servers WHERE id = $1 AND user_id = $2', [req.params.id, user.rows[0].username]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Combat Logs ----------
app.post('/api/combatlog', async (req, res) => {
    const { playerId, playerName, eventType, victim, weapon, distance, timestamp } = req.body;
    try {
        await pool.query('INSERT INTO combat_logs (player_id, player_name, event_type, victim, weapon, distance, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)', [playerId, playerName, eventType, victim, weapon, distance, timestamp]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/combatlog/:playerId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM combat_logs WHERE player_id = $1 ORDER BY timestamp DESC LIMIT 100', [req.params.playerId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Claims ----------
app.post('/api/claim', async (req, res) => {
    const { playerId, itemShortname, quantity, expiresAt } = req.body;
    try {
        await pool.query('INSERT INTO claims (player_id, item_shortname, quantity, expires_at) VALUES ($1, $2, $3, $4)', [playerId, itemShortname, quantity, expiresAt]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/claims/:playerId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM claims WHERE player_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY claimed_at DESC', [req.params.playerId]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Zones ----------
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
        await pool.query('INSERT INTO zones (id, name, position, radius, flags, enabled) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET name=$2, position=$3, radius=$4, flags=$5, enabled=$6', [id, name, JSON.stringify(position), radius, JSON.stringify(flags), enabled]);
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

// ---------- Backup Settings ----------
app.get('/api/backup-settings', async (req, res) => {
    try {
        const result = await pool.query('SELECT settings FROM backup_settings WHERE id = $1', ['default']);
        if (result.rows.length === 0) res.json({ autoBackup: true, interval: 24, keepLast: 30, compress: true, notifyOnComplete: true });
        else res.json(result.rows[0].settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/backup-settings', async (req, res) => {
    try {
        await pool.query('INSERT INTO backup_settings (id, settings) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET settings = $2', ['default', JSON.stringify(req.body)]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GPortal Quick Connect ----------
app.post('/api/gportal/resolve', (req, res) => {
    const { code } = req.body;
    if (code === 'F7K2M9') res.json({ ip: '144.126.137.59', port: 28916, password: 'Myakspray1215' });
    else res.status(404).json({ error: 'Code not found' });
});

// ---------- Forgot Code ----------
app.post('/api/forgot-code', (req, res) => {
    res.json({ success: true });
});

// ========== DRAINED BASES BLUEPRINTS ==========
app.get('/api/drained/blueprints', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM drained_blueprints WHERE enabled = true ORDER BY price ASC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/drained/purchases/:playerId', async (req, res) => {
    const { playerId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM drained_purchases WHERE player_id = $1 ORDER BY purchased_at DESC', [playerId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/drained/purchase', async (req, res) => {
    const { playerId, blueprintId, price } = req.body;
    if (!playerId || !blueprintId) return res.status(400).json({ error: 'Missing playerId or blueprintId' });
    try {
        await pool.query('INSERT INTO drained_purchases (player_id, blueprint_id) VALUES ($1, $2)', [playerId, blueprintId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Purchase error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/drained/deploy', async (req, res) => {
    const { playerId, blueprintId } = req.body;
    if (!playerId || !blueprintId) return res.status(400).json({ error: 'Missing playerId or blueprintId' });
    try {
        await pool.query('UPDATE drained_purchases SET deployed_at = NOW() WHERE player_id = $1 AND blueprint_id = $2 AND deployed_at IS NULL', [playerId, blueprintId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Audit Log ----------
app.post('/api/audit', async (req, res) => {
    const { username, action, ip } = req.body;
    try {
        await pool.query('INSERT INTO audit_log (username, action, ip) VALUES ($1, $2, $3)', [username, action, ip]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/audit', async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    try {
        const result = await pool.query('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT $1', [limit]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Shop ----------
app.get('/api/shop/items', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM shop_items WHERE enabled = true ORDER BY price ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/shop/purchase', async (req, res) => {
    const { playerId, itemShortname, quantity } = req.body;
    if (!playerId || !itemShortname) return res.status(400).json({ error: 'Missing fields' });
    try {
        await pool.query('INSERT INTO claims (player_id, item_shortname, quantity) VALUES ($1, $2, $3)', [playerId, itemShortname, quantity]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});