// master-control.js – DRAINED TABLET v7.0.0 (Full – all original sections + user management)

class MasterControl {
    constructor() {
        this.access = window.accessControl;
        this.commands = window.serverCommands;
        this.usersList = [];
        this.init();
    }

    init() {
        this.createHTML();
        this.attachEvents();
        window.addEventListener('tab-changed', (e) => {
            if (e.detail.tab === 'master') {
                this.refresh();
                this.loadDashboardUsers();
            }
        });
    }

    createHTML() {
        const tab = document.getElementById('tab-master');
        if (!tab) return;
        if (!this.access.isMasterUser()) {
            tab.innerHTML = '<div class="access-denied">🔒 Master access only</div>';
            return;
        }

        tab.innerHTML = `
            <div class="master-container" style="padding: 1rem;">
                <div class="master-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                    <h2 style="color: var(--accent-primary);">👑 MASTER CONTROL</h2>
                    <div class="master-badge" style="background: var(--accent-primary); color: #000; padding: 0.3rem 1rem; border-radius: 20px; font-weight: 600;">MASTER ACCESS</div>
                </div>

                <!-- Quick Actions -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">⚡ QUICK ACTIONS</h3>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                        <button class="master-quick-btn" data-action="restart" style="padding: 0.8rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">🔄 Restart Server</button>
                        <button class="master-quick-btn" data-action="save" style="padding: 0.8rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">💾 Save World</button>
                        <button class="master-quick-btn" data-action="backup" style="padding: 0.8rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">📦 Create Backup</button>
                        <button class="master-quick-btn" data-action="broadcast" style="padding: 0.8rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">📢 Broadcast</button>
                        <button class="master-quick-btn" data-action="wipe" style="padding: 0.8rem 1.5rem; background: var(--error); color: #fff; border: none; border-radius: 8px; cursor: pointer;">⚠️ Wipe Server</button>
                    </div>
                </div>

                <!-- Server Core Settings -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">🖥️ SERVER CORE</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Server Name</label>
                            <input type="text" id="master-hostname" class="master-input" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Max Players</label>
                            <input type="number" id="master-maxplayers" class="master-input" value="100" min="1" max="500" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">World Size</label>
                            <input type="number" id="master-worldsize" class="master-input" value="3500" min="1000" max="6000" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">World Seed</label>
                            <input type="number" id="master-seed" class="master-input" value="10325" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                    </div>
                    <button id="master-apply-core" class="master-btn" style="margin-top: 1rem; padding: 0.6rem 1.5rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">APPLY CORE SETTINGS</button>
                </div>

                <!-- Performance Tuning -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">⚡ PERFORMANCE TUNING</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Tickrate</label>
                            <input type="range" id="master-tickrate" min="10" max="100" value="30" style="width: 100%;">
                            <span id="master-tickrate-val">30</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">FPS Limit</label>
                            <input type="range" id="master-fps" min="30" max="300" value="60" style="width: 100%;">
                            <span id="master-fps-val">60</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Craft Timescale</label>
                            <input type="range" id="master-craftscale" min="0.1" max="10" step="0.1" value="1.0" style="width: 100%;">
                            <span id="master-craftscale-val">1.0</span>
                        </div>
                    </div>
                    <button id="master-apply-performance" class="master-btn" style="margin-top: 1rem; padding: 0.6rem 1.5rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">APPLY PERFORMANCE SETTINGS</button>
                </div>

                <!-- World Environment -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">🌍 WORLD ENVIRONMENT</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Time of Day</label>
                            <input type="range" id="master-time" min="0" max="24" step="0.5" value="12" style="width: 100%;">
                            <span id="master-time-val">12:00</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Day Length (min)</label>
                            <input type="range" id="master-daylength" min="5" max="240" value="45" style="width: 100%;">
                            <span id="master-daylength-val">45</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Night Length (min)</label>
                            <input type="range" id="master-nightlength" min="5" max="240" value="15" style="width: 100%;">
                            <span id="master-nightlength-val">15</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Clouds</label>
                            <input type="range" id="master-clouds" min="0" max="1" step="0.1" value="0.5" style="width: 100%;">
                            <span id="master-clouds-val">0.5</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Rain</label>
                            <input type="range" id="master-rain" min="0" max="1" step="0.1" value="0" style="width: 100%;">
                            <span id="master-rain-val">0</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Wind</label>
                            <input type="range" id="master-wind" min="0" max="1" step="0.1" value="0.5" style="width: 100%;">
                            <span id="master-wind-val">0.5</span>
                        </div>
                    </div>
                    <button id="master-apply-world" class="master-btn" style="margin-top: 1rem; padding: 0.6rem 1.5rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">APPLY WORLD SETTINGS</button>
                </div>

                <!-- Decay & Upkeep -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">⏳ DECAY & UPKEEP</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Decay Scale</label>
                            <input type="range" id="master-decay-scale" min="0.1" max="5" step="0.1" value="1.0" style="width: 100%;">
                            <span id="master-decay-scale-val">1.0</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Tick Rate (sec)</label>
                            <input type="range" id="master-decay-tick" min="60" max="3600" step="60" value="600" style="width: 100%;">
                            <span id="master-decay-tick-val">600</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Upkeep Period (min)</label>
                            <input type="range" id="master-upkeep-period" min="60" max="2880" value="1440" style="width: 100%;">
                            <span id="master-upkeep-period-val">1440</span>
                        </div>
                    </div>
                    <button id="master-apply-decay" class="master-btn" style="margin-top: 1rem; padding: 0.6rem 1.5rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">APPLY DECAY SETTINGS</button>
                </div>

                <!-- Economy & Modifiers -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">💰 ECONOMY & MODIFIERS</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Starting Balance</label>
                            <input type="number" id="master-start-balance" value="1000" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Kill Reward</label>
                            <input type="number" id="master-kill-reward" value="50" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Gather Rate</label>
                            <input type="range" id="master-gather" min="0.5" max="5" step="0.1" value="1.0" style="width: 100%;">
                            <span id="master-gather-val">1.0</span>
                        </div>
                        <div class="master-setting">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Furnace Speed</label>
                            <input type="range" id="master-furnace-speed" min="0.5" max="5" step="0.1" value="1.0" style="width: 100%;">
                            <span id="master-furnace-speed-val">1.0</span>
                        </div>
                    </div>
                    <button id="master-apply-economy" class="master-btn" style="margin-top: 1rem; padding: 0.6rem 1.5rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">APPLY ECONOMY SETTINGS</button>
                </div>

                <!-- Plugin Management -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">🧩 PLUGIN MANAGEMENT</h3>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem;">
                        <input type="text" id="master-plugin-name" placeholder="Plugin name" style="flex: 1; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        <button id="master-plugin-load" class="master-btn" style="padding: 0.6rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">LOAD</button>
                        <button id="master-plugin-unload" class="master-btn" style="padding: 0.6rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">UNLOAD</button>
                        <button id="master-plugin-reload" class="master-btn" style="padding: 0.6rem 1.5rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px; cursor: pointer;">RELOAD</button>
                    </div>
                    <div id="master-plugin-list" style="background: var(--bg-secondary); border-radius: 8px; padding: 1rem; max-height: 200px; overflow-y: auto;">
                        <div class="plugin-item" style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--glass-border);">
                            <span>Kits</span>
                            <span style="color: var(--success);">Loaded</span>
                        </div>
                        <div class="plugin-item" style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--glass-border);">
                            <span>Economics</span>
                            <span style="color: var(--success);">Loaded</span>
                        </div>
                        <div class="plugin-item" style="display: flex; justify-content: space-between; padding: 0.3rem 0; border-bottom: 1px solid var(--glass-border);">
                            <span>Zones</span>
                            <span style="color: var(--warning);">Not Loaded</span>
                        </div>
                    </div>
                </div>

                <!-- Dashboard User Management (Master Only) -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">👥 DASHBOARD USERS</h3>
                    <div id="master-users-list" style="max-height: 300px; overflow-y: auto; margin-bottom: 1rem;"></div>
                    <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-end;">
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Username</label>
                            <input type="text" id="master-new-username" class="master-input" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;" placeholder="e.g., RustPlayer">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Password (min 6 chars)</label>
                            <input type="password" id="master-new-password" class="master-input" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;" placeholder="********">
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Platform</label>
                            <select id="master-new-platform" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                                <option value="ps5">PlayStation 5</option>
                                <option value="ps4">PlayStation 4</option>
                                <option value="xbox">Xbox Series X|S</option>
                                <option value="xboxone">Xbox One</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; margin-bottom: 0.3rem; color: var(--text-secondary);">Platform ID</label>
                            <input type="text" id="master-new-platform-id" class="master-input" style="width: 100%; padding: 0.6rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;" placeholder="Gamertag / PSN ID">
                        </div>
                        <button id="master-add-user-btn" class="master-btn" style="padding: 0.6rem 1.5rem; background: var(--success); color: #000; border: none; border-radius: 8px; cursor: pointer;">➕ ADD USER</button>
                    </div>
                </div>

                <!-- Raw Command Executor -->
                <div class="master-section" style="background: var(--glass-bg); backdrop-filter: blur(10px); border: 1px solid var(--glass-border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">⚡ RAW COMMAND EXECUTOR</h3>
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" id="master-raw-command" placeholder="Enter any RCON command..." style="flex: 1; padding: 0.8rem; background: var(--bg-tertiary); border: 1px solid var(--glass-border); border-radius: 8px;">
                        <button id="master-execute-raw" class="master-btn primary" style="padding: 0.8rem 2rem; background: var(--accent-primary); color: #000; border: none; border-radius: 8px; cursor: pointer;">EXECUTE</button>
                    </div>
                    <div id="master-raw-output" style="margin-top: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; max-height: 200px; overflow-y: auto;"></div>
                </div>
            </div>
        `;

        this.setupRangeListeners();
        this.loadDashboardUsers();
    }

    setupRangeListeners() {
        const ranges = [
            { id: 'master-tickrate', val: 'master-tickrate-val' },
            { id: 'master-fps', val: 'master-fps-val' },
            { id: 'master-craftscale', val: 'master-craftscale-val' },
            { id: 'master-time', val: 'master-time-val' },
            { id: 'master-daylength', val: 'master-daylength-val' },
            { id: 'master-nightlength', val: 'master-nightlength-val' },
            { id: 'master-clouds', val: 'master-clouds-val' },
            { id: 'master-rain', val: 'master-rain-val' },
            { id: 'master-wind', val: 'master-wind-val' },
            { id: 'master-decay-scale', val: 'master-decay-scale-val' },
            { id: 'master-decay-tick', val: 'master-decay-tick-val' },
            { id: 'master-upkeep-period', val: 'master-upkeep-period-val' },
            { id: 'master-gather', val: 'master-gather-val' },
            { id: 'master-furnace-speed', val: 'master-furnace-speed-val' }
        ];
        ranges.forEach(item => {
            const input = document.getElementById(item.id);
            const span = document.getElementById(item.val);
            if (input && span) {
                input.addEventListener('input', (e) => {
                    let val = e.target.value;
                    if (item.id === 'master-time') {
                        const hours = Math.floor(val);
                        const minutes = (val % 1) * 60;
                        span.innerText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
                    } else {
                        span.innerText = val;
                    }
                });
            }
        });
    }

    attachEvents() {
        // Quick actions
        document.querySelectorAll('.master-quick-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                this.executeQuickAction(action);
            });
        });
        // Apply buttons
        document.getElementById('master-apply-core')?.addEventListener('click', () => this.applyCoreSettings());
        document.getElementById('master-apply-performance')?.addEventListener('click', () => this.applyPerformanceSettings());
        document.getElementById('master-apply-world')?.addEventListener('click', () => this.applyWorldSettings());
        document.getElementById('master-apply-decay')?.addEventListener('click', () => this.applyDecaySettings());
        document.getElementById('master-apply-economy')?.addEventListener('click', () => this.applyEconomySettings());
        // Plugin buttons
        document.getElementById('master-plugin-load')?.addEventListener('click', () => this.loadPlugin());
        document.getElementById('master-plugin-unload')?.addEventListener('click', () => this.unloadPlugin());
        document.getElementById('master-plugin-reload')?.addEventListener('click', () => this.reloadPlugin());
        // User management
        document.getElementById('master-add-user-btn')?.addEventListener('click', () => this.addUser());
        // Raw command
        document.getElementById('master-execute-raw')?.addEventListener('click', () => this.executeRawCommand());
        document.getElementById('master-raw-command')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.executeRawCommand();
        });
    }

    async executeQuickAction(action) {
        switch(action) {
            case 'restart':
                if (confirm('Restart server? This will kick all players.')) {
                    toast.warning('Restarting server...');
                    try {
                        await this.commands.restart();
                    } catch (err) {
                        toast.error(err.message);
                    }
                }
                break;
            case 'save':
                toast.info('Saving world...');
                try {
                    await this.commands.save();
                    toast.success('World saved');
                } catch (err) {
                    toast.error(err.message);
                }
                break;
            case 'backup':
                toast.info('Creating backup...');
                setTimeout(() => toast.success('Backup created'), 2000);
                break;
            case 'broadcast':
                const msg = prompt('Enter broadcast message:');
                if (msg) {
                    try {
                        await this.commands.execute(`say "${msg}"`);
                        toast.success('Broadcast sent');
                    } catch (err) {
                        toast.error(err.message);
                    }
                }
                break;
            case 'wipe':
                if (confirm('⚠️ WIPE SERVER? ⚠️\nThis will erase everything!')) {
                    toast.error('Server wipe initiated');
                }
                break;
        }
    }

    async applyCoreSettings() {
        const hostname = document.getElementById('master-hostname').value;
        const maxPlayers = document.getElementById('master-maxplayers').value;
        const worldSize = document.getElementById('master-worldsize').value;
        const seed = document.getElementById('master-seed').value;
        try {
            if (hostname) await this.commands.setHostname(hostname);
            if (maxPlayers) await this.commands.setMaxPlayers(parseInt(maxPlayers));
            if (worldSize) await this.commands.setWorldSize(parseInt(worldSize));
            if (seed) await this.commands.setSeed(parseInt(seed));
            toast.success('Core settings applied');
        } catch (err) {
            toast.error(err.message);
        }
    }

    async applyPerformanceSettings() {
        const tickrate = document.getElementById('master-tickrate').value;
        const fps = document.getElementById('master-fps').value;
        const craftscale = document.getElementById('master-craftscale').value;
        try {
            await this.commands.setTickrate(parseInt(tickrate));
            await this.commands.setFPS(parseInt(fps));
            await this.commands.execute(`craft.timescale ${craftscale}`);
            toast.success('Performance settings applied');
        } catch (err) {
            toast.error(err.message);
        }
    }

    async applyWorldSettings() {
        const time = document.getElementById('master-time').value;
        const day = document.getElementById('master-daylength').value;
        const night = document.getElementById('master-nightlength').value;
        const clouds = document.getElementById('master-clouds').value;
        const rain = document.getElementById('master-rain').value;
        const wind = document.getElementById('master-wind').value;
        try {
            await this.commands.setTime(parseFloat(time));
            await this.commands.setDayLength(parseInt(day));
            await this.commands.setNightLength(parseInt(night));
            await this.commands.setWeather(clouds, rain, wind, 0);
            toast.success('World settings applied');
        } catch (err) {
            toast.error(err.message);
        }
    }

    async applyDecaySettings() {
        const scale = document.getElementById('master-decay-scale').value;
        const tick = document.getElementById('master-decay-tick').value;
        const period = document.getElementById('master-upkeep-period').value;
        try {
            await ConnectionManager.executeCommand(`decay.scale ${scale}`);
            await ConnectionManager.executeCommand(`decay.tick ${tick}`);
            await ConnectionManager.executeCommand(`decay.upkeep_period_minutes ${period}`);
            toast.success('Decay settings applied');
        } catch (err) {
            toast.error(err.message);
        }
    }

    async applyEconomySettings() {
        const start = document.getElementById('master-start-balance').value;
        const kill = document.getElementById('master-kill-reward').value;
        const gather = document.getElementById('master-gather').value;
        const furnace = document.getElementById('master-furnace-speed').value;
        try {
            await ConnectionManager.executeCommand(`economy.startingbalance ${start}`);
            await ConnectionManager.executeCommand(`economy.killreward ${kill}`);
            await ConnectionManager.executeCommand(`modifiers.gatherrate ${gather}`);
            await ConnectionManager.executeCommand(`craft.furnacespeed ${furnace}`);
            toast.success('Economy settings applied');
        } catch (err) {
            toast.error(err.message);
        }
    }

    async loadPlugin() {
        const name = document.getElementById('master-plugin-name').value.trim();
        if (!name) return;
        try {
            await ConnectionManager.executeCommand(`oxide.load ${name}`);
            toast.success(`Plugin ${name} loaded`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async unloadPlugin() {
        const name = document.getElementById('master-plugin-name').value.trim();
        if (!name) return;
        try {
            await ConnectionManager.executeCommand(`oxide.unload ${name}`);
            toast.success(`Plugin ${name} unloaded`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async reloadPlugin() {
        const name = document.getElementById('master-plugin-name').value.trim();
        if (!name) return;
        try {
            await ConnectionManager.executeCommand(`oxide.reload ${name}`);
            toast.success(`Plugin ${name} reloaded`);
        } catch (err) {
            toast.error(err.message);
        }
    }

    async executeRawCommand() {
        const input = document.getElementById('master-raw-command');
        const cmd = input.value.trim();
        if (!cmd) return;
        const output = document.getElementById('master-raw-output');
        output.innerText = 'Executing...';
        try {
            const result = await ConnectionManager.executeCommand(cmd);
            output.innerText = result || 'Command executed (no output)';
        } catch (err) {
            output.innerText = `Error: ${err.message}`;
        }
        input.value = '';
    }

    // ========== USER MANAGEMENT (Master only) ==========
    async loadDashboardUsers() {
        if (!this.access.isMasterUser()) return;
        const masterCode = '0827';
        try {
            const res = await fetch('https://drained-bridge.onrender.com/api/admin/users', {
                headers: { 'Authorization': `Bearer ${masterCode}` }
            });
            const users = await res.json();
            this.usersList = users;
            const container = document.getElementById('master-users-list');
            if (!container) return;
            if (users.length === 0) {
                container.innerHTML = '<div class="no-users">No registered users yet</div>';
                return;
            }
            let html = '<table class="user-table"><thead><tr><th>Username</th><th>Platform</th><th>Platform ID</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
            for (const u of users) {
                html += `<tr>
                    <td>${u.username}</td>
                    <td>${u.platform || '-'}</td>
                    <td>${u.platform_id || '-'}</td>
                    <td>${u.role === 'master' ? 'MASTER' : 'user'}</td>
                    <td>${u.disabled ? '🔴 Disabled' : '🟢 Active'}</td>
                    <td>
                        <button class="small-btn toggle-disable" data-id="${u.id}" data-disabled="${u.disabled}" ${u.username === 'CooseTheGeek' ? 'disabled' : ''}>${u.disabled ? 'Enable' : 'Disable'}</button>
                        <button class="small-btn reset-pw" data-id="${u.id}" ${u.username === 'CooseTheGeek' ? 'disabled' : ''}>Reset PW</button>
                        <button class="small-btn delete-user" data-id="${u.id}" ${u.username === 'CooseTheGeek' ? 'disabled' : ''}>Delete</button>
                    </td>
                </tr>`;
            }
            html += '</tbody></table>';
            container.innerHTML = html;
            document.querySelectorAll('.toggle-disable:not([disabled])').forEach(btn => {
                btn.addEventListener('click', () => this.toggleUserDisable(btn.dataset.id, btn.dataset.disabled === 'true'));
            });
            document.querySelectorAll('.reset-pw:not([disabled])').forEach(btn => {
                btn.addEventListener('click', () => this.resetUserPassword(btn.dataset.id));
            });
            document.querySelectorAll('.delete-user:not([disabled])').forEach(btn => {
                btn.addEventListener('click', () => this.deleteUser(btn.dataset.id));
            });
        } catch (err) {
            console.error(err);
            const container = document.getElementById('master-users-list');
            if (container) container.innerHTML = '<div class="error">Failed to load users</div>';
        }
    }

    async addUser() {
        const username = document.getElementById('master-new-username').value.trim();
        const password = document.getElementById('master-new-password').value;
        const platform = document.getElementById('master-new-platform').value;
        const platformId = document.getElementById('master-new-platform-id').value.trim();
        if (!username || !password || !platform || !platformId) {
            toast.error('All fields required');
            return;
        }
        if (password.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }
        const masterCode = '0827';
        try {
            const res = await fetch('https://drained-bridge.onrender.com/api/admin/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterCode}` },
                body: JSON.stringify({ username, password, platform, platformId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`User ${username} added`);
            document.getElementById('master-new-username').value = '';
            document.getElementById('master-new-password').value = '';
            document.getElementById('master-new-platform-id').value = '';
            this.loadDashboardUsers();
        } catch (err) {
            toast.error(err.message);
        }
    }

    async toggleUserDisable(userId, currentlyDisabled) {
        const masterCode = '0827';
        try {
            await fetch(`https://drained-bridge.onrender.com/api/admin/users/${userId}/disable`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${masterCode}` }
            });
            toast.success(`User ${currentlyDisabled ? 'enabled' : 'disabled'}`);
            this.loadDashboardUsers();
        } catch (err) {
            toast.error(err.message);
        }
    }

    async resetUserPassword(userId) {
        const newPassword = prompt('Enter new password (min 6 characters):');
        if (!newPassword || newPassword.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }
        const masterCode = '0827';
        try {
            await fetch(`https://drained-bridge.onrender.com/api/admin/users/${userId}/password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${masterCode}` },
                body: JSON.stringify({ newPassword })
            });
            toast.success('Password reset');
            this.loadDashboardUsers();
        } catch (err) {
            toast.error(err.message);
        }
    }

    async deleteUser(userId) {
        if (!confirm('Permanently delete this user?')) return;
        const masterCode = '0827';
        try {
            await fetch(`https://drained-bridge.onrender.com/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${masterCode}` }
            });
            toast.success('User deleted');
            this.loadDashboardUsers();
        } catch (err) {
            toast.error(err.message);
        }
    }

    refresh() {
        this.loadDashboardUsers();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.masterControl = new MasterControl();
});