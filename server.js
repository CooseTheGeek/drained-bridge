// server.js – DRAINED TABLET BRIDGE v7.0.0 (GPortal API via rce.js)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { default: RCEManager, LogLevel } = require('rce.js');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection pool (your credentials are baked in)
const pool = new Pool({
    connectionString: 'postgresql://postgres.fvfptizasaahvcsdmxtz:Thatakspray%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

// ---------- Database initialization ----------
async function initDB() {
    try {
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
            CREATE TABLE IF NOT EXISTS shop_items (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                shortname TEXT NOT NULL,
                price INT NOT NULL,
                stock INT DEFAULT -1,
                category TEXT,
                image TEXT,
                command TEXT,
                enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ Database tables ready');
    } catch (err) {
        console.error('Database init error:', err.message);
    }
}
initDB();

// ---------- GPortal API via rce.js (the fix) ----------
let rce = null;
let serverIdentifier = 'main-server';

async function initGPortal() {
    // Your credentials are baked in
    const host = '144.126.137.59';
    const port = 28916;
    const password = 'Myakspray1215!';
    const serverId = '1879409';   // your GPortal server ID
    const region = 'US';           // your region

    try {
        console.log(`🔐 Initializing rce.js with Server ID: ${serverId}, Region: ${region}`);
        rce = new RCEManager({
            logger: { level: LogLevel.Info }
        });

        await rce.addServer({
            identifier: serverIdentifier,
            serverId: serverId,
            region: region,
            rcon: { host, port, password },
            intents: ['ALL'],
            state: [],
            playerRefreshing: true
        });

        console.log('✅ rce.js ready – server added');
    } catch (err) {
        console.error('❌ Failed to initialize rce.js:', err.message);
        console.error(err.stack);
    }
}

initGPortal();

// ---------- API endpoints ----------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', rceReady: !!rce });
});

// GPortal command endpoint (used by frontend)
app.post('/api/gportal/command', async (req, res) => {
    const { command } = req.body;
    if (!command) {
        return res.status(400).json({ error: 'Command is required' });
    }
    if (!rce || !serverIdentifier) {
        return res.status(503).json({ error: 'GPortal API not initialized' });
    }
    try {
        const result = await rce.sendCommand(serverIdentifier, command);
        res.json({ success: true, result });
    } catch (err) {
        console.error('GPortal command error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Legacy RCON command endpoint (kept for fallback)
app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    if (!ip || !port || !password || !command) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    try {
        if (rce && serverIdentifier) {
            const result = await rce.sendCommand(serverIdentifier, command);
            return res.json({ success: true, result });
        }
        throw new Error('No active RCON connection');
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Discord OAuth (with headers and retry)
const DISCORD_CLIENT_ID = '1481899114986733630';
const DISCORD_CLIENT_SECRET = '9WuZs3eY1x38V7iF_SBkGJ8gc-5uUJIT';
const REDIRECT_URI = 'https://drained-bridge.onrender.com/api/discord/callback';

app.get('/api/discord/login', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/api/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'DrainedTabletBridge/1.0',
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
        if (tokenRes.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return fetch(`${REDIRECT_URI}?code=${code}`);
        }
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No access token');
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userData = await userRes.json();
        const discordId = userData.id;
        const existing = await pool.query('SELECT username FROM users WHERE discord_id = $1', [discordId]);
        if (existing.rows.length === 0) {
            await pool.query(
                'INSERT INTO users (username, password_hash, role, discord_id) VALUES ($1, $2, $3, $4)',
                [`discord_${discordId}`, '', 'user', discordId]
            );
        }
        res.redirect(`https://the-drained-tablet.vercel.app/?discord=linked&id=${discordId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Discord auth failed');
    }
});

// Keep all other endpoints (user servers, combat logs, claims, zones, etc.)
// ... (insert your existing remaining endpoints here) ...
// For brevity, I assume you already have them. If not, they are unchanged.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bridge running on port ${PORT}`);
});