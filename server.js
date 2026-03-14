// server.js – DRAINED TABLET BRIDGE v7.0.0 (with enhanced logging)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');

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
            -- Add discord_id to users if not exists
            ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT;
            -- Create user_servers table
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
        `);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        console.error(err.stack);
        throw err;
    }
}
initDB().catch(console.error);

// ---------- WebRcon Connection Management ----------
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
                reject(new Error('Authentication timeout: server did not respond to auth request'));
            }
        }, 5000);

        ws.on('open', () => {
            console.log('✅ WebSocket opened, sending authentication message...');
            ws.send(JSON.stringify({
                Identifier: -1,
                Message: password,
                Name: "WebRcon"
            }));
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                console.log('📩 WebRcon message:', response);

                if (response.Identifier === -1) {
                    clearTimeout(authTimeout);
                    if (response.Message === "Success") {
                        authenticated = true;
                        console.log('✅ WebRcon authenticated');
                        resolve({
                            send: (command) => sendCommand(ws, command, pendingCommands),
                            close: () => ws.close()
                        });
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
                console.error('❌ Failed to parse WebRcon message:', e);
            }
        });

        ws.on('error', (err) => {
            console.error('❌ WebSocket error:', err.message);
            clearTimeout(authTimeout);
            reject(err);
        });

        ws.on('close', () => {
            console.log('🔌 WebRcon connection closed');
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

        ws.send(JSON.stringify({
            Identifier: id,
            Message: command,
            Name: "WebRcon"
        }));
    });
}

async function getWebRcon(ip, port, password) {
    const key = `${ip}:${port}`;
    let entry = connections.get(key);
    if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
        console.log(`✅ Reusing existing WebRcon connection for ${key}`);
        return entry;
    }

    if (entry) {
        entry.close();
        connections.delete(key);
    }

    console.log(`🔄 Creating new WebRcon connection for ${key}`);
    try {
        const connection = await createWebRconConnection(ip, port, password);
        connections.set(key, connection);
        return connection;
    } catch (err) {
        connections.delete(key);
        throw err;
    }
}

// ---------- API Endpoints ----------

// Health check
app.get('/api/health', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/health`);
    res.json({ status: 'ok', connections: connections.size });
});

// Connect to server (WebRcon)
app.post('/api/connect', async (req, res) => {
    const { ip, port, password } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/connect:`, { ip, port, password: '***' });

    try {
        const rcon = await getWebRcon(ip, port, password);
        const result = await rcon.send('status');
        console.log('📨 Test command response (first 200 chars):', result?.substring(0, 200));
        res.json({ success: true, server: { ip, port, password } });
    } catch (err) {
        console.error('❌ WebRcon connection error:', err.message);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Execute RCON command
app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/command:`, { ip, port, command });

    try {
        const rcon = await getWebRcon(ip, port, password);
        const result = await rcon.send(command);
        console.log('📨 Command response (first 200 chars):', result?.substring(0, 200));
        res.json({ success: true, result });
    } catch (err) {
        console.error('❌ WebRcon command error:', err.message);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------- Discord OAuth ----------
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

        // Store or update user in database
        const discordId = userData.id;
        const username = `discord_${discordId}`;
        const role = 'user';

        console.log(`🔍 Discord callback: received discord_id ${discordId}, username ${userData.username}`);

        // Check if user exists
        const existing = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        console.log('Existing user query result:', existing.rows);

        if (existing.rows.length === 0) {
            // Insert new user
            const insertResult = await pool.query(
                'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4) RETURNING username',
                [username, '', role, discordId]
            );
            console.log('✅ New user inserted:', insertResult.rows[0]);
        } else {
            console.log('✅ User already exists:', existing.rows[0].username);
        }

        console.log('✅ Discord user linked/stored:', userData.username, discordId);

        // Redirect back to dashboard with Discord ID in query
        res.redirect(`https://the-drained-tablet.vercel.app/?discord=linked&id=${discordId}`);
    } catch (err) {
        console.error('❌ Discord OAuth error:', err.message);
        console.error(err.stack);
        res.status(500).send('Discord authentication failed');
    }
});

// ---------- User Server Management ----------
// Helper to get user by Discord ID from query param (simplified; in production use proper auth)
function getUserFromRequest(req) {
    const discordId = req.query.discord_id;
    return discordId;
}

// Get user's servers
app.get('/api/user/servers', async (req, res) => {
    const discordId = getUserFromRequest(req);
    console.log(`[${new Date().toISOString()}] GET /api/user/servers?discord_id=${discordId}`);

    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        console.log('User lookup result:', user.rows);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const username = user.rows[0].username;

        const result = await pool.query(
            'SELECT id, name, ip, port, server_id, region, created_at FROM user_servers WHERE user_id = $1 ORDER BY created_at DESC',
            [username]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching user servers:', err);
        res.status(500).json({ error: err.message });
    }
});

// Add a server for the user
app.post('/api/user/servers', async (req, res) => {
    const discordId = getUserFromRequest(req);
    console.log(`[${new Date().toISOString()}] POST /api/user/servers?discord_id=${discordId}`, req.body);

    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, ip, port, password, server_id, region } = req.body;
    if (!name || !ip || !port || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        console.log('User lookup for add server:', user.rows);
        if (user.rows.length === 0) {
            // Optionally create user on the fly if they don't exist (should not happen if OAuth succeeded)
            console.log('⚠️ User not found, attempting to create on the fly...');
            const username = `discord_${discordId}`;
            await pool.query(
                'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4)',
                [username, '', 'user', discordId]
            );
            console.log('✅ User created on the fly');
            // Re-fetch user
            const newUser = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
            if (newUser.rows.length === 0) {
                return res.status(500).json({ error: 'Failed to create user' });
            }
            user.rows = newUser.rows;
        }
        const username = user.rows[0].username;

        const result = await pool.query(
            'INSERT INTO user_servers (user_id, name, ip, port, password, server_id, region) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [username, name, ip, port, password, server_id || null, region || null]
        );
        console.log('✅ Server added with id:', result.rows[0].id);
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Error adding server:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a server
app.delete('/api/user/servers/:id', async (req, res) => {
    const discordId = getUserFromRequest(req);
    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const serverId = req.params.id;
    try {
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const username = user.rows[0].username;

        await pool.query('DELETE FROM user_servers WHERE id = $1 AND user_id = $2', [serverId, username]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting server:', err);
        res.status(500).json({ error: err.message });
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

// ---------- GPortal Quick Connect Code Resolution (optional) ----------
app.post('/api/gportal/resolve', (req, res) => {
    const { code } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/gportal/resolve with code: ${code}`);
    if (code === 'F7K2M9') {
        res.json({ ip: '144.126.137.59', port: 28916, password: 'Thatakspray' });
    } else {
        res.status(404).json({ error: 'Code not found' });
    }
});

// ---------- Forgot Code ----------
app.post('/api/forgot-code', (req, res) => {
    console.log('📧 Forgot code request from user:', req.body.username);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});