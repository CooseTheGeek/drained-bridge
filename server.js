// server.js – DRAINED TABLET BRIDGE v7.0.0 (using TCP RCON for Rust Console)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { Rcon } = require('rcon-client');

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
app.use(express.json({ limit: '50mb' }));

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
        
        await pool.query(`
            DO $$ 
            BEGIN 
                BEGIN
                    ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT;
                EXCEPTION
                    WHEN duplicate_column THEN 
                        NULL;
                END;
            END $$;
        `);
        
        // Ensure master user exists
        await pool.query(
            `INSERT INTO users (username, password_hash, role, discord_id)
             VALUES ('CooseTheGeek', '', 'master', NULL)
             ON CONFLICT (username) DO NOTHING`
        );
        
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('❌ Database initialization error:', err.message);
        console.error(err.stack);
        throw err;
    }
}
initDB().catch(console.error);

// ---------- RCON Connection Management (TCP) ----------
const connections = new Map();

async function getRcon(ip, port, password) {
    const key = `${ip}:${port}`;
    let entry = connections.get(key);
    if (entry && entry.client && entry.client.socket && !entry.client.socket.destroyed) {
        console.log(`✅ Reusing existing RCON connection for ${key}`);
        return entry;
    }

    if (entry) {
        try {
            entry.client.end();
        } catch (e) {}
        connections.delete(key);
    }

    console.log(`🔄 Creating new TCP RCON connection to ${ip}:${port}`);
    const client = await Rcon.connect({
        host: ip,
        port: port,
        password: password
    });
    console.log(`✅ TCP RCON connected to ${ip}:${port}`);
    const wrapper = {
        send: async (command) => {
            return await client.send(command);
        },
        close: () => client.end()
    };
    connections.set(key, wrapper);
    return wrapper;
}

// ---------- API Endpoints ----------

// Health check
app.get('/api/health', (req, res) => {
    console.log(`[${new Date().toISOString()}] GET /api/health`);
    res.json({ status: 'ok', connections: connections.size });
});

// Connect to server (TCP RCON)
app.post('/api/connect', async (req, res) => {
    const { ip, port, password } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/connect:`, { ip, port, password: '***' });

    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send('status');
        console.log('📨 Test command response (first 200 chars):', result?.substring(0, 200));
        res.json({ success: true, server: { ip, port, password } });
    } catch (err) {
        console.error('❌ RCON connection error:', err.message);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Execute RCON command (TCP)
app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    console.log(`[${new Date().toISOString()}] POST /api/command:`, { ip, port, command });

    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send(command);
        console.log('📨 Command response (first 200 chars):', result?.substring(0, 200));
        res.json({ success: true, result });
    } catch (err) {
        console.error('❌ RCON command error:', err.message);
        console.error(err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ---------- GPortal API via rce.js (disabled) ----------
// (commented out as before)

// ---------- Discord OAuth (with improved error logging) ----------
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

    const maxRetries = 3;
    let retryCount = 0;
    let retryDelay = 1000;

    while (retryCount < maxRetries) {
        try {
            const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'DrainedTabletBridge/7.0.0',
                    'Accept': 'application/json'
                },
                body: new URLSearchParams({
                    client_id: DISCORD_CLIENT_ID,
                    client_secret: DISCORD_CLIENT_SECRET,
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: REDIRECT_URI
                })
            });

            if (tokenResponse.status === 429) {
                const errorData = await tokenResponse.json();
                console.error('❌ Discord rate limit details:', errorData);
                const retryAfter = errorData.retry_after || 30;
                console.log(`⏳ Rate limited. Waiting ${retryAfter} seconds before retry ${retryCount + 1}/${maxRetries}`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                retryCount++;
                continue;
            }

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                console.error('❌ Discord token error response:', errorText);
                return res.redirect(`https://the-drained-tablet.vercel.app/?discord=error&details=${encodeURIComponent(errorText.substring(0, 200))}`);
            }

            const tokenData = await tokenResponse.json();
            if (!tokenData.access_token) {
                throw new Error('Failed to get access token');
            }

            const userResponse = await fetch('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${tokenData.access_token}`,
                    'User-Agent': 'DrainedTabletBridge/7.0.0'
                }
            });

            if (!userResponse.ok) {
                const errorText = await userResponse.text();
                console.error('❌ Discord user error response:', errorText);
                throw new Error('Failed to fetch user data');
            }

            const userData = await userResponse.json();

            const discordId = userData.id;
            const username = `discord_${discordId}`;
            const role = 'user';

            const existing = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
            if (existing.rows.length === 0) {
                await pool.query(
                    'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4)',
                    [username, '', role, discordId]
                );
            }

            console.log('✅ Discord user linked/stored:', userData.username, discordId);
            return res.redirect(`https://the-drained-tablet.vercel.app/?discord=linked&id=${discordId}`);

        } catch (err) {
            console.error('❌ Discord OAuth error:', err.message);
            console.error(err.stack);
            return res.redirect('https://the-drained-tablet.vercel.app/?discord=error&message=' + encodeURIComponent(err.message));
        }
    }

    // If we exhaust retries
    res.redirect('https://the-drained-tablet.vercel.app/?discord=error&message=Rate%20limited%20after%20multiple%20retries');
});

// ---------- User Server Management ----------
function getUserFromRequest(req) {
    // First try the old discord_id, then username from query or body
    const discordId = req.query.discord_id;
    if (discordId) return discordId;
    const username = req.query.username || req.body.username;
    return username;
}

app.get('/api/user/servers', async (req, res) => {
    const identifier = getUserFromRequest(req);
    if (!identifier) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        let user;
        if (identifier.startsWith('discord_')) {
            const userRes = await pool.query('SELECT username FROM users WHERE discord_id = $1', [identifier]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            user = userRes.rows[0].username;
        } else {
            user = identifier;
            // Verify user exists
            const userRes = await pool.query('SELECT username FROM users WHERE username = $1', [user]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
        }

        const result = await pool.query(
            'SELECT id, name, ip, port, server_id, region, created_at FROM user_servers WHERE user_id = $1 ORDER BY created_at DESC',
            [user]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching user servers:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/user/servers', async (req, res) => {
    const identifier = getUserFromRequest(req);
    if (!identifier) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const { name, ip, port, password, server_id, region, username } = req.body;
    if (!name || !ip || !port || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        let user;
        if (identifier.startsWith('discord_')) {
            const userRes = await pool.query('SELECT username FROM users WHERE discord_id = $1', [identifier]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            user = userRes.rows[0].username;
        } else {
            user = identifier;
            const userRes = await pool.query('SELECT username FROM users WHERE username = $1', [user]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
        }

        const result = await pool.query(
            'INSERT INTO user_servers (user_id, name, ip, port, password, server_id, region) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [user, name, ip, port, password, server_id || null, region || null]
        );
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Error adding server:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/user/servers/:id', async (req, res) => {
    const identifier = getUserFromRequest(req);
    if (!identifier) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const serverId = req.params.id;
    try {
        let user;
        if (identifier.startsWith('discord_')) {
            const userRes = await pool.query('SELECT username FROM users WHERE discord_id = $1', [identifier]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            user = userRes.rows[0].username;
        } else {
            user = identifier;
            const userRes = await pool.query('SELECT username FROM users WHERE username = $1', [user]);
            if (userRes.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
        }

        await pool.query('DELETE FROM user_servers WHERE id = $1 AND user_id = $2', [serverId, user]);
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

// ---------- Forgot Code ----------
app.post('/api/forgot-code', (req, res) => {
    console.log('📧 Forgot code request from user:', req.body.username);
    res.json({ success: true });
});

// ==================== SHOP API ====================
app.get('/api/shop/items', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM shop_items ORDER BY category, name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching shop items:', err);
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
        console.error('Error creating shop item:', err);
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
        console.error('Error updating shop item:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/shop/items/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM shop_items WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting shop item:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/shop/purchase', async (req, res) => {
    const { playerId, itemShortname, quantity } = req.body;
    try {
        await pool.query(
            'INSERT INTO claims (player_id, item_shortname, quantity, expires_at) VALUES ($1, $2, $3, NULL)',
            [playerId, itemShortname, quantity]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error creating claim:', err);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});