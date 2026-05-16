// server.js – DRAINED TABLET BRIDGE v7.0.0 (Full – all endpoints, no frontend code)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { default: RCEManager, LogLevel } = require('rce.js');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SALT_ROUNDS = 10;
const MASTER_CODE = '0827';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres.fvfptizasaahvcsdmxtz:Thatakspray%21@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    ssl: { rejectUnauthorized: false }
});

// ---------- Database initialization (full tables) ----------
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                discord_id TEXT UNIQUE,
                username TEXT UNIQUE,
                password_hash TEXT,
                platform TEXT,
                platform_id TEXT,
                avatar_url TEXT,
                role TEXT DEFAULT 'user',
                disabled BOOLEAN DEFAULT FALSE,
                session_token TEXT,
                permissions JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT NOW(),
                last_login TIMESTAMP
            )
        `);
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
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS claims (
                id SERIAL PRIMARY KEY,
                player_id TEXT NOT NULL,
                item_shortname TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                claimed_at TIMESTAMP DEFAULT NOW(),
                expires_at TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                username TEXT,
                action TEXT NOT NULL,
                ip TEXT,
                timestamp TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS zones (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                position JSONB NOT NULL,
                radius INTEGER,
                flags JSONB,
                enabled BOOLEAN DEFAULT true
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS drained_blueprints (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price INT NOT NULL,
                blocks JSONB NOT NULL,
                enabled BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS drained_purchases (
                id SERIAL PRIMARY KEY,
                player_id TEXT NOT NULL,
                blueprint_id INT NOT NULL REFERENCES drained_blueprints(id) ON DELETE CASCADE,
                purchased_at TIMESTAMP DEFAULT NOW(),
                deployed_at TIMESTAMP,
                UNIQUE(player_id, blueprint_id)
            )
        `);
        await pool.query(`
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
            )
        `);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token TEXT`);
        console.log('✅ Database ready');
    } catch (err) {
        console.error('DB init error:', err);
        throw err;
    }
}
initDB();

// ---------- GPortal API via rce.js ----------
let rce = null;
let serverIdentifier = 'main-server';
async function initGPortal() {
    const host = process.env.GPORTAL_HOST || '144.126.137.59';
    const port = parseInt(process.env.GPORTAL_RCON_PORT || '28916');
    const password = process.env.GPORTAL_RCON_PASSWORD || 'Myakspray1215!';
    const serverId = process.env.GPORTAL_SERVER_ID || '1879409';
    const region = process.env.GPORTAL_REGION || 'US';
    try {
        rce = new RCEManager({ logger: { level: LogLevel.Info } });
        await rce.addServer({
            identifier: serverIdentifier,
            serverId: serverId,
            region: region,
            rcon: { host, port, password },
            intents: ['ALL'],
            state: [],
            playerRefreshing: true
        });
        console.log('✅ rce.js ready');
    } catch (err) {
        console.error('❌ GPortal init failed:', err.message);
    }
}
initGPortal();

// ---------- Helper: Authenticate master ----------
function isMaster(req) {
    const auth = req.headers.authorization;
    return auth === `Bearer ${MASTER_CODE}`;
}

// ---------- Discord OAuth ----------
const DISCORD_CLIENT_ID = '1481899114986733630';
const DISCORD_CLIENT_SECRET = '9WuZs3eY1x38V7iF_SBkGJ8gc-5uUJIT';
const REDIRECT_URI = 'https://drained-bridge.onrender.com/api/discord/callback';

app.get('/api/discord/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/api/discord/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
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
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) throw new Error('No access token');
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const discordUser = await userRes.json();
        const discordId = discordUser.id;
        const avatar = discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png` : null;
        const existing = await pool.query('SELECT id FROM users WHERE discord_id = $1', [discordId]);
        if (existing.rows.length === 0) {
            await pool.query('INSERT INTO users (discord_id, avatar_url) VALUES ($1, $2) ON CONFLICT (discord_id) DO NOTHING', [discordId, avatar]);
        }
        const frontendUrl = `https://the-drained-tablet.vercel.app/?discord_id=${discordId}&avatar=${encodeURIComponent(avatar || '')}`;
        res.redirect(frontendUrl);
    } catch (err) {
        console.error(err);
        res.status(500).send('Discord auth failed');
    }
});

// ---------- User Registration (role = 'user') ----------
app.post('/api/register', async (req, res) => {
    const { discordId, username, platform, platformId, password, avatarUrl } = req.body;
    if (!discordId || !username || !platform || !platformId || !password) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    try {
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Username already taken' });
        }
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const result = await pool.query(
            `UPDATE users 
             SET username = $1, password_hash = $2, platform = $3, platform_id = $4, 
                 avatar_url = COALESCE($5, avatar_url), role = 'user', disabled = FALSE, 
                 last_login = NOW(), permissions = '{}'
             WHERE discord_id = $6
             RETURNING id, username, role`,
            [username, hash, platform, platformId, avatarUrl, discordId]
        );
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        const user = result.rows[0];
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [sessionToken, user.id]);
        res.json({ success: true, username: user.username, role: user.role, sessionToken });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Login (master hardcoded, users via DB) ----------
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Missing credentials' });
    }
    // Hardcoded master login
    if (username === 'CooseTheGeek' && password === MASTER_CODE) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
            `INSERT INTO users (username, role, permissions) 
             VALUES ('CooseTheGeek', 'master', '{"*": true}') 
             ON CONFLICT (username) DO UPDATE SET role = 'master', permissions = '{"*": true}'`
        );
        await pool.query('UPDATE users SET session_token = $1 WHERE username = $2', [sessionToken, 'CooseTheGeek']);
        return res.json({ success: true, username: 'CooseTheGeek', role: 'master', sessionToken });
    }
    try {
        const result = await pool.query(
            'SELECT id, username, password_hash, role, disabled FROM users WHERE username = $1',
            [username]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        if (user.disabled) {
            return res.status(403).json({ error: 'Account disabled' });
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await pool.query('UPDATE users SET session_token = $1, last_login = NOW() WHERE id = $2', [sessionToken, user.id]);
        res.json({ success: true, username: user.username, role: user.role, sessionToken });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Get user profile ----------
app.get('/api/user/profile', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token' });
    }
    const token = auth.slice(7);
    try {
        const result = await pool.query(
            'SELECT username, platform, platform_id, avatar_url, role FROM users WHERE session_token = $1',
            [token]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid session' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Update avatar ----------
app.post('/api/user/avatar', async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token' });
    }
    const token = auth.slice(7);
    const { avatarUrl } = req.body;
    if (!avatarUrl) {
        return res.status(400).json({ error: 'Missing avatarUrl' });
    }
    try {
        await pool.query('UPDATE users SET avatar_url = $1 WHERE session_token = $2', [avatarUrl, token]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Verify session ----------
app.post('/api/verify', async (req, res) => {
    const { sessionToken } = req.body;
    if (!sessionToken) {
        return res.status(401).json({ error: 'No session' });
    }
    try {
        const result = await pool.query('SELECT username, role FROM users WHERE session_token = $1', [sessionToken]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid session' });
        }
        res.json({ valid: true, username: result.rows[0].username, role: result.rows[0].role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- Admin user management (master only) ----------
app.get('/api/admin/users', async (req, res) => {
    if (!isMaster(req)) {
        return res.status(403).json({ error: 'Master required' });
    }
    try {
        const result = await pool.query(
            'SELECT id, username, platform, platform_id, role, disabled, created_at, last_login FROM users ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users', async (req, res) => {
    if (!isMaster(req)) {
        return res.status(403).json({ error: 'Master required' });
    }
    const { username, password, platform, platformId } = req.body;
    if (!username || !password || !platform || !platformId) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: 'Password too short' });
    }
    try {
        const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists' });
        }
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await pool.query(
            'INSERT INTO users (username, password_hash, platform, platform_id, role) VALUES ($1, $2, $3, $4, $5)',
            [username, hash, platform, platformId, 'user']
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/disable', async (req, res) => {
    if (!isMaster(req)) {
        return res.status(403).json({ error: 'Master required' });
    }
    const { id } = req.params;
    try {
        await pool.query('UPDATE users SET disabled = NOT disabled WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/users/:id/password', async (req, res) => {
    if (!isMaster(req)) {
        return res.status(403).json({ error: 'Master required' });
    }
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password too short' });
    }
    try {
        const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', async (req, res) => {
    if (!isMaster(req)) {
        return res.status(403).json({ error: 'Master required' });
    }
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------- GPortal command endpoint ----------
app.post('/api/gportal/command', async (req, res) => {
    const { command } = req.body;
    if (!command) {
        return res.status(400).json({ error: 'Command required' });
    }
    if (!rce || !serverIdentifier) {
        return res.status(503).json({ error: 'GPortal not ready' });
    }
    try {
        const result = await rce.sendCommand(serverIdentifier, command);
        res.json({ success: true, result });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Health check ----------
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', rceReady: !!rce });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bridge running on port ${PORT}`));