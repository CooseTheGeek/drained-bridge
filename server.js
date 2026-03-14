// server.js – DRAINED TABLET BRIDGE v7.0.0 (with Discord user linking and server storage)

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

// ---------- WebRcon Connection Management (unchanged) ----------
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

// ========== DISCORD OAUTH ==========
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
        // For now, we'll use the Discord ID as username and create a dummy user if not exists
        const discordId = userData.id;
        const username = `discord_${discordId}`; // or use email if available
        const role = 'user';

        // Check if user exists
        const existing = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (existing.rows.length === 0) {
            // Create a new user (no password, since they authenticate via Discord)
            await pool.query(
                'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4)',
                [username, '', role, discordId]
            );
        } else {
            // Update existing user's discord_id if needed (already there)
        }

        console.log('✅ Discord user linked/stored:', userData.username, discordId);

        // Redirect back to dashboard with success flag
        res.redirect('https://the-drained-tablet.vercel.app/?discord=linked');
    } catch (err) {
        console.error('❌ Discord OAuth error:', err.message);
        console.error(err.stack);
        res.status(500).send('Discord authentication failed');
    }
});

// ========== USER SERVER MANAGEMENT ==========
// Middleware to identify user (using discord_id from query param for simplicity; in production use session)
// We'll assume the user passes their discord_id as a query param or header. For now, we'll use a simple header.
function getUserFromRequest(req) {
    // In a real app, you'd use a session token. For demo, we'll use a query param `discord_id`.
    // This is insecure; replace with proper auth later.
    const discordId = req.query.discord_id || req.headers['x-discord-id'];
    if (!discordId) return null;
    return discordId;
}

// Get user's servers
app.get('/api/user/servers', async (req, res) => {
    const discordId = getUserFromRequest(req);
    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        // Find user by discord_id
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
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
    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, ip, port, password, server_id, region } = req.body;
    if (!name || !ip || !port || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Find user by discord_id
        const user = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (user.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const username = user.rows[0].username;

        const result = await pool.query(
            'INSERT INTO user_servers (user_id, name, ip, port, password, server_id, region) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [username, name, ip, port, password, server_id || null, region || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Error adding server:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a server (optional)
app.delete('/api/user/servers/:id', async (req, res) => {
    const discordId = getUserFromRequest(req);
    if (!discordId) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const serverId = req.params.id;
    try {
        // Verify ownership
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

// ---------- Other endpoints (combat logs, claims, zones, etc.) remain unchanged ----------
// (Copy them from your existing server.js – they are the same as before)

// ... (include all your existing endpoints here) ...

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});