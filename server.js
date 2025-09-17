const express = require('express');
const path = require('path');
const fs = require('fs');
const SimulationManager = require('./simulation/simulationManager');
const { countries } = require('./simulation/playerSimulation');

const { run, get, all } = require('./db/queries');
const { hashPassword, verifyPassword } = require('./auth/security');
const { issueToken, revokeToken, pruneExpiredTokens } = require('./auth/session');
const { authenticate, optionalAuth } = require('./auth/middleware');

const Module = require('./main.js');

const app = express();
const port = process.env.PORT || 4020;

app.use(express.json());
app.use(express.static('public'));

let runSimulation = null;
const simulationManager = new SimulationManager();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const DEFAULT_PLAYER_CONFIG = Object.freeze({
  malwareQuality: 0.5,
  attributes: {
    spread: 0.5,
    stealth: 0.5,
    resilience: 0.5
  },
  selectedBlueprint: null
});

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function parseNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeAttributes(attrs = {}) {
  return {
    spread: clamp(parseNumber(attrs.spread, DEFAULT_PLAYER_CONFIG.attributes.spread)),
    stealth: clamp(parseNumber(attrs.stealth, DEFAULT_PLAYER_CONFIG.attributes.stealth)),
    resilience: clamp(parseNumber(attrs.resilience, DEFAULT_PLAYER_CONFIG.attributes.resilience))
  };
}

function rowToConfig(row) {
  if (!row) {
    return { ...DEFAULT_PLAYER_CONFIG };
  }
  return {
    malwareQuality: clamp(
      parseNumber(row.malware_quality, DEFAULT_PLAYER_CONFIG.malwareQuality)
    ),
    attributes: {
      spread: clamp(parseNumber(row.spread, DEFAULT_PLAYER_CONFIG.attributes.spread)),
      stealth: clamp(parseNumber(row.stealth, DEFAULT_PLAYER_CONFIG.attributes.stealth)),
      resilience: clamp(
        parseNumber(row.resilience, DEFAULT_PLAYER_CONFIG.attributes.resilience)
      )
    },
    selectedBlueprint: row.selected_blueprint || null,
    updatedAt: row.updated_at || null
  };
}

async function loadOrCreateConfig(userId) {
  await run(
    `INSERT OR IGNORE INTO player_configs (
        user_id, malware_quality, spread, stealth, resilience, selected_blueprint
      ) VALUES (?, 0.5, 0.5, 0.5, 0.5, NULL)`,
    [userId]
  );
  const row = await get(
    `SELECT user_id, malware_quality, spread, stealth, resilience, selected_blueprint, updated_at
       FROM player_configs WHERE user_id = ?`,
    [userId]
  );
  return rowToConfig(row);
}

async function ensurePlayerSession(userId) {
  const config = await loadOrCreateConfig(userId);
  const session = simulationManager.upsertPlayer(userId, {
    malwareQuality: config.malwareQuality,
    attributes: { ...config.attributes }
  });
  return { session, config };
}

async function loadWasm() {
  const wasmModule = await Module();
  runSimulation = wasmModule.cwrap('runSimulation', 'string', ['string']);
  console.log('✅ WASM loaded and bound.');
}

function serializeCountries() {
  return Object.entries(countries).map(([name, data]) => ({
    name,
    code: data.code,
    region: data.region,
    neighbors: data.neighbors,
    security: data.security,
    connectivity: data.connectivity,
    population: data.population
  }));
}

pruneExpiredTokens().catch((err) => {
  console.error('⚠️ Failed to prune expired tokens:', err);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

app.get('/main', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

app.get('/blueprint', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'blueprint.html'));
});

app.get('/vm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sandbox/vm.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings/settings.html'));
});

app.get('/subscription', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shop.html'));
});

app.get('/production', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'production.html'));
});

app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

app.post('/simulate', (req, res) => {
  try {
    if (!runSimulation) {
      return res.status(500).json({ error: 'WASM function not loaded' });
    }
    const name = req.body.name || 'Unknown';
    const result = runSimulation(name);
    res.json({ result });
  } catch (err) {
    console.error('❌ Simulácia zlyhala:', err);
    res.status(500).json({ error: 'Simulation error: ' + err.message });
  }
});

app.post('/save-blueprint', (req, res) => {
  try {
    const { name, blueprint } = req.body;
    if (!name || !blueprint) {
      return res.status(400).json({ error: 'Missing name or blueprint' });
    }
    const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(__dirname, 'creator', `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ name, blueprint }, null, 2));
    res.json({ success: true, file: `/creator/${safeName}.json` });
  } catch (err) {
    console.error('❌ Saving blueprint failed:', err);
    res.status(500).json({ error: 'Failed to save blueprint: ' + err.message });
  }
});

app.get('/allCreatorFiles', (req, res) => {
  try {
    const dirPath = path.join(__dirname, 'creator');
    if (!fs.existsSync(dirPath)) {
      return res.status(404).json({ error: 'Creator directory not found' });
    }
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({ name: file.replace('.json', '') }));
    res.json(files);
  } catch (err) {
    console.error('❌ Fetching creator files failed:', err);
    res.status(500).json({ error: 'Failed to fetch creator files: ' + err.message });
  }
});

app.get('/creator/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'creator', `${filename}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error('❌ Reading file failed:', err);
    res.status(500).json({ error: 'Failed to read file: ' + err.message });
  }
});

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const trimmed = typeof username === 'string' ? username.trim() : '';
    if (trimmed.length < 3 || trimmed.length > 32) {
      return res.status(400).json({ error: 'Username must be between 3 and 32 characters.' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
      const passwordHash = hashPassword(password);
      const result = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [
        trimmed,
        passwordHash
      ]);
      const userId = result.lastID;
      const config = await loadOrCreateConfig(userId);
      const token = await issueToken(userId);
      simulationManager.upsertPlayer(userId, {
        malwareQuality: config.malwareQuality,
        attributes: { ...config.attributes }
      });
      res.json({
        token,
        user: { id: userId, username: trimmed },
        config
      });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'Username is already taken.' });
      }
      throw err;
    }
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const trimmed = typeof username === 'string' ? username.trim() : '';
    if (!trimmed || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = await get('SELECT id, username, password_hash FROM users WHERE username = ?', [
      trimmed
    ]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const config = await loadOrCreateConfig(user.id);
    const token = await issueToken(user.id);
    simulationManager.upsertPlayer(user.id, {
      malwareQuality: config.malwareQuality,
      attributes: { ...config.attributes }
    });

    res.json({
      token,
      user: { id: user.id, username: user.username },
      config
    });
  })
);

app.post(
  '/api/auth/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await revokeToken(req.authToken);
    res.json({ success: true });
  })
);

app.get(
  '/api/auth/session',
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.json({ authenticated: false });
    }
    const config = await loadOrCreateConfig(req.user.id);
    res.json({ authenticated: true, user: req.user, config });
  })
);

app.get(
  '/api/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const config = await loadOrCreateConfig(req.user.id);
    res.json({ user: req.user, config });
  })
);

app.put(
  '/api/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const payload = req.body || {};
    const attributes = normalizeAttributes(payload.attributes || {});
    const selectedBlueprint = payload.selectedBlueprint
      ? String(payload.selectedBlueprint).trim() || null
      : null;
    const malwareQuality = clamp(
      parseNumber(payload.malwareQuality, DEFAULT_PLAYER_CONFIG.malwareQuality)
    );

    await run(
      `UPDATE player_configs
          SET malware_quality = ?,
              spread = ?,
              stealth = ?,
              resilience = ?,
              selected_blueprint = ?,
              updated_at = datetime('now')
        WHERE user_id = ?`,
      [
        malwareQuality,
        attributes.spread,
        attributes.stealth,
        attributes.resilience,
        selectedBlueprint,
        req.user.id
      ]
    );

    const session = simulationManager.upsertPlayer(req.user.id, {
      malwareQuality,
      attributes
    });
    session.tick(Date.now());
    const config = await loadOrCreateConfig(req.user.id);
    res.json({ success: true, config });
  })
);

app.get(
  '/api/world/state',
  authenticate,
  asyncHandler(async (req, res) => {
    const { session, config } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());
    res.json({ config, snapshot: session.getSnapshot() });
  })
);

app.post(
  '/api/world/infect',
  authenticate,
  asyncHandler(async (req, res) => {
    const { country, reapply } = req.body || {};
    if (!country) {
      return res.status(400).json({ error: 'Country is required.' });
    }
    const { session, config } = await ensurePlayerSession(req.user.id);
    const source = config.selectedBlueprint || 'player';
    const result = session.startInfection(country, { reapply, source });
    session.tick(Date.now());
    await run(
      `INSERT INTO deployments (user_id, country, blueprint, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      [req.user.id, result.country, config.selectedBlueprint || null]
    );
    res.json({ config, infection: result, snapshot: session.getSnapshot() });
  })
);

app.get(
  '/api/world/deployments',
  authenticate,
  asyncHandler(async (req, res) => {
    const deployments = await all(
      `SELECT id, country, blueprint, created_at
         FROM deployments
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT 25`,
      [req.user.id]
    );
    res.json({ deployments });
  })
);

app.get('/api/countries', (req, res) => {
  res.json(serializeCountries());
});

app.get('/api/players', (req, res) => {
  const summaries = simulationManager.getPlayerSummaries();
  res.json(summaries);
});

app.post('/api/players/:playerId', (req, res) => {
  const { playerId } = req.params;
  try {
    const session = simulationManager.upsertPlayer(playerId, req.body || {});
    session.tick(Date.now());
    res.json(session.getSnapshot());
  } catch (err) {
    console.error('❌ Failed to create or update player:', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/players/:playerId', (req, res) => {
  const { playerId } = req.params;
  const session = simulationManager.getPlayer(playerId);
  if (!session) {
    return res.status(404).json({ error: 'Player not found' });
  }
  session.tick(Date.now());
  res.json(session.getSnapshot());
});

app.post('/api/players/:playerId/infections', (req, res) => {
  const { playerId } = req.params;
  const { country, reapply } = req.body || {};

  if (!country) {
    return res.status(400).json({ error: 'Country is required' });
  }

  const session = simulationManager.getPlayer(playerId);
  if (!session) {
    return res.status(404).json({ error: 'Player not found' });
  }

  try {
    const result = session.startInfection(country, { reapply, source: 'player' });
    session.tick(Date.now());
    res.json({ infection: result, state: session.getSnapshot() });
  } catch (err) {
    console.error('❌ Failed to start infection:', err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/players/:playerId', (req, res) => {
  const { playerId } = req.params;
  const removed = simulationManager.removePlayer(playerId);
  res.json({ removed });
});



app.use(express.static('public'));

let wasmModule = null;
const Module = require('./main.js');
let runSimulation = null;
const simulationManager = new SimulationManager();

async function loadWasm() {
    const wasmModule = await Module(); // zavoláš funkciu, nedávaj len require()

    runSimulation = wasmModule.cwrap('runSimulation', 'string', ['string']);
    console.log("✅ WASM loaded and bound.");
}

function serializeCountries() {
    return Object.entries(countries).map(([name, data]) => ({
        name,
        code: data.code,
        region: data.region,
        neighbors: data.neighbors,
        security: data.security,
        connectivity: data.connectivity,
        population: data.population
    }));
}
app.post('/simulate', (req, res) => {
    try {
        if (!runSimulation) {
            return res.status(500).json({ error: "WASM function not loaded" });
        }

        const name = req.body.name || 'Unknown';
        const result = runSimulation(name);
        res.json({ result });
    } catch (err) {
        console.error("❌ Simulácia zlyhala:", err);
        res.status(500).json({ error: "Simulation error: " + err.message });
    }
});

app.post('/save-blueprint', (req, res) => {
    try {
        const { name, blueprint } = req.body;
        if (!name || !blueprint) {
            return res.status(400).json({ error: "Missing name or blueprint" });
        }
        // Odstráň nebezpečné znaky z názvu (kvôli FS bezpečnosti)
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const filePath = path.join(__dirname, 'creator', `${safeName}.json`);
        fs.writeFileSync(filePath, JSON.stringify({ name, blueprint }, null, 2));
        res.json({ success: true, file: `/creator/${safeName}.json` });
    } catch (err) {
        console.error("❌ Saving blueprint failed:", err);
        res.status(500).json({ error: "Failed to save blueprint: " + err.message });
    }
});

app.get('/allCreatorFiles', (req, res) => {
    try {
        const dirPath = path.join(__dirname, 'creator');
        if (!fs.existsSync(dirPath)) {
            return res.status(404).json({ error: "Creator directory not found" });
        }
        const files = fs.readdirSync(dirPath)
            .filter(file => file.endsWith('.json'))
            .map(file => ({
                name: file.replace('.json', ''),
            }));
        res.json(files);
    } catch (err) {
        console.error("❌ Fetching creator files failed:", err);
        res.status(500).json({ error: "Failed to fetch creator files: " + err.message });
    }
});

app.get('/creator/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'creator', `${filename}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
    }
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } catch (err) {
        console.error("❌ Reading file failed:", err);
        res.status(500).json({ error: "Failed to read file: " + err.message });
    }
});

app.get('/api/countries', (req, res) => {
    res.json(serializeCountries());
});

app.get('/api/players', (req, res) => {
    const summaries = simulationManager.getPlayerSummaries();
    res.json(summaries);
});

app.post('/api/players/:playerId', (req, res) => {
    const { playerId } = req.params;
    try {
        const session = simulationManager.upsertPlayer(playerId, req.body || {});
        session.tick(Date.now());
        res.json(session.getSnapshot());
    } catch (err) {
        console.error("❌ Failed to create or update player:", err);
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/players/:playerId', (req, res) => {
    const { playerId } = req.params;
    const session = simulationManager.getPlayer(playerId);
    if (!session) {
        return res.status(404).json({ error: "Player not found" });
    }
    session.tick(Date.now());
    res.json(session.getSnapshot());
});

app.post('/api/players/:playerId/infections', (req, res) => {
    const { playerId } = req.params;
    const { country, reapply } = req.body || {};

    if (!country) {
        return res.status(400).json({ error: "Country is required" });
    }

    const session = simulationManager.getPlayer(playerId);
    if (!session) {
        return res.status(404).json({ error: "Player not found" });
    }

    try {
        const result = session.startInfection(country, { reapply, source: 'player' });
        session.tick(Date.now());
        res.json({ infection: result, state: session.getSnapshot() });
    } catch (err) {
        console.error("❌ Failed to start infection:", err);
        res.status(400).json({ error: err.message });
    }
});

app.delete('/api/players/:playerId', (req, res) => {
    const { playerId } = req.params;
    const removed = simulationManager.removePlayer(playerId);
    res.json({ removed });
});

app.listen(port, async () => {
    await loadWasm();
    simulationManager.start();
    console.log(`🚀 Server running on http://localhost:${port}`);
});
