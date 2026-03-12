// server.js
const express = require('express');
const { Rcon } = require('rcon-client');
const cors = require('cors');

const app = express();
app.set('trust proxy', 1); // Trust Render's proxy – required for correct IP handling
app.use(cors());
app.use(express.json());

// In‑memory connection pool (optional, for performance)
const connections = new Map();

// Helper to get or create an RCON connection
async function getRcon(ip, port, password) {
    const id = `${ip}:${port}`;
    let rcon = connections.get(id);
    
    if (!rcon || !rcon.connected) {
        rcon = new Rcon({ host: ip, port: parseInt(port), password });
        await rcon.connect();
        connections.set(id, rcon);
        
        // Auto‑close after 5 minutes of inactivity
        setTimeout(() => {
            if (rcon.connected) {
                rcon.end();
                connections.delete(id);
            }
        }, 300000);
    }
    return rcon;
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', connections: connections.size });
});

// Execute a single command
app.post('/api/command', async (req, res) => {
    const { ip, port, password, command } = req.body;
    if (!ip || !port || !password || !command) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const rcon = await getRcon(ip, port, password);
        const result = await rcon.send(command);
        res.json({ success: true, result });
    } catch (err) {
        console.error('RCON error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get server status (quick test)
app.post('/api/status', async (req, res) => {
    const { ip, port, password } = req.body;
    try {
        const rcon = await getRcon(ip, port, password);
        const players = await rcon.send('status');
        const fps = await rcon.send('server.fps');
        res.json({ success: true, online: true, players, fps });
    } catch (err) {
        res.json({ success: false, online: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`RCON bridge running on port ${PORT}`);
});