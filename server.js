const express = require('express');
const path = require('path');
const fs = require('fs');

const SimulationManager = require('./simulation/simulationManager');
const { countries } = require('./simulation/playerSimulation');
const { SKILL_TREE, COMPANY_CATALOG } = require('./simulation/progressionData');

const { run, get, all } = require('./db/queries');
const { hashPassword, verifyPassword } = require('./auth/security');
const { issueToken, revokeToken, pruneExpiredTokens } = require('./auth/session');
const { authenticate, optionalAuth } = require('./auth/middleware');

const ModuleFactory = require('./main.js');

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

const DEFAULT_PROGRESSION_STATE = Object.freeze({
  level: 1,
  xp: 0,
  skillPoints: 0,
  capital: 0,
  unlockedBlueprints: [],
  skillsUnlocked: [],
  flags: [],
  companies: [],
  employees: [],
  avBypasses: {},
  lastRandomXpAt: null
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

function safeParseJson(payload, fallback) {
  try {
    if (payload === null || payload === undefined) {
      return fallback;
    }
    return JSON.parse(payload);
  } catch (err) {
    return fallback;
  }
}

function rowToConfig(row) {
  if (!row) {
    return { ...DEFAULT_PLAYER_CONFIG };
  }
  return {
    malwareQuality: clamp(parseNumber(row.malware_quality, DEFAULT_PLAYER_CONFIG.malwareQuality)),
    attributes: {
      spread: clamp(parseNumber(row.spread, DEFAULT_PLAYER_CONFIG.attributes.spread)),
      stealth: clamp(parseNumber(row.stealth, DEFAULT_PLAYER_CONFIG.attributes.stealth)),
      resilience: clamp(parseNumber(row.resilience, DEFAULT_PLAYER_CONFIG.attributes.resilience))
    },
    selectedBlueprint: row.selected_blueprint || null,
    updatedAt: row.updated_at || null
  };
}

function rowToProgression(row) {
  if (!row) {
    return { ...DEFAULT_PROGRESSION_STATE };
  }

  return {
    level: parseInt(row.level, 10) || 1,
    xp: parseInt(row.xp, 10) || 0,
    skillPoints: parseInt(row.skill_points, 10) || 0,
    capital: parseInt(row.capital, 10) || 0,
    unlockedBlueprints: safeParseJson(row.unlocked_blueprints, []),
    skillsUnlocked: safeParseJson(row.skills_unlocked, []),
    flags: safeParseJson(row.flags, []),
    companies: safeParseJson(row.companies, []),
    employees: safeParseJson(row.employees, []),
    avBypasses: safeParseJson(row.av_bypasses, {}),
    lastRandomXpAt: row.last_random_xp_at || null,
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

async function loadOrCreateProgression(userId) {
  await run(
    `INSERT OR IGNORE INTO player_progression (
        user_id, level, xp, skill_points, capital,
        unlocked_blueprints, skills_unlocked, flags,
        companies, employees, av_bypasses, last_random_xp_at
      ) VALUES (?, 1, 0, 0, 0, '[]', '[]', '[]', '[]', '[]', '{}', datetime('now'))`,
    [userId]
  );

  const row = await get(
    `SELECT user_id, level, xp, skill_points, capital,
            unlocked_blueprints, skills_unlocked, flags,
            companies, employees, av_bypasses, last_random_xp_at, updated_at
       FROM player_progression WHERE user_id = ?`,
    [userId]
  );

  return rowToProgression(row);
}

async function ensurePlayerSession(userId) {
  const config = await loadOrCreateConfig(userId);
  const progression = await loadOrCreateProgression(userId);

  const session = simulationManager.upsertPlayer(userId, {
    malwareQuality: config.malwareQuality,
    attributes: { ...config.attributes },
    progression
  });

  return { session, config, progression };
}

async function saveProgression(userId, session) {
  const state = session.getPersistableProgression();

  await run(
    `INSERT OR IGNORE INTO player_progression (
        user_id, level, xp, skill_points, capital,
        unlocked_blueprints, skills_unlocked, flags,
        companies, employees, av_bypasses, last_random_xp_at
      ) VALUES (?, 1, 0, 0, 0, '[]', '[]', '[]', '[]', '[]', '{}', datetime('now'))`,
    [userId]
  );

  await run(
    `UPDATE player_progression
        SET level = ?,
            xp = ?,
            skill_points = ?,
            capital = ?,
            unlocked_blueprints = ?,
            skills_unlocked = ?,
            flags = ?,
            companies = ?,
            employees = ?,
            av_bypasses = ?,
            last_random_xp_at = ?,
            updated_at = datetime('now')
      WHERE user_id = ?`,
    [
      state.level,
      state.xp,
      state.skillPoints,
      state.capital,
      JSON.stringify(state.unlockedBlueprints || []),
      JSON.stringify(state.skillsUnlocked || []),
      JSON.stringify(state.flags || []),
      JSON.stringify(state.companies || []),
      JSON.stringify(state.employees || []),
      JSON.stringify(state.avBypasses || {}),
      state.lastRandomXpAt || null,
      userId
    ]
  );

  session.markProgressionSaved();
  return state;
}

async function persistProgressionIfNeeded(userId, session) {
  if (!session.isProgressionDirty()) {
    return null;
  }
  return saveProgression(userId, session);
}

async function loadWasm() {
  const wasmModule = await ModuleFactory();
  runSimulation = wasmModule.cwrap('runSimulation', 'string', ['string']);
  console.log('>> WASM module loaded.');
}

function serializeCountries() {
  return Object.entries(countries).map(([name, data]) => ({
    name,
    code: data.code,
    region: data.region,
    neighbors: data.neighbors,
    security: data.security,
    connectivity: data.connectivity,
    population: data.population,
    antivirus: data.antivirus || null
  }));
}

pruneExpiredTokens().catch((err) => {
  console.error('Failed to prune expired tokens:', err);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/menu', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});


// --- Auth endpoints -------------------------------------------------------

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Username and password (6+ chars) are required.' });
    }

    const trimmed = String(username).trim();
    const passwordHash = hashPassword(password);

    try {
      const result = await run(
        `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
        [trimmed, passwordHash]
      );

      const userId = result.lastID;
      const config = await loadOrCreateConfig(userId);
      const progression = await loadOrCreateProgression(userId);
      const token = await issueToken(userId);

      simulationManager.upsertPlayer(userId, {
        malwareQuality: config.malwareQuality,
        attributes: { ...config.attributes },
        progression
      });

      res.status(201).json({
        token,
        user: { id: userId, username: trimmed },
        config,
        progression
      });
    } catch (err) {
      if (err && err.code === 'SQLITE_CONSTRAINT') {
        return res.status(409).json({ error: 'Username already taken.' });
      }
      throw err;
    }
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required.' });
    }

    const trimmed = String(username).trim();
    const user = await get(`SELECT id, username, password_hash FROM users WHERE username = ?`, [trimmed]);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const config = await loadOrCreateConfig(user.id);
    const progression = await loadOrCreateProgression(user.id);
    const token = await issueToken(user.id);

    simulationManager.upsertPlayer(user.id, {
      malwareQuality: config.malwareQuality,
      attributes: { ...config.attributes },
      progression
    });

    res.json({
      token,
      user: { id: user.id, username: user.username },
      config,
      progression
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
    const progression = await loadOrCreateProgression(req.user.id);
    res.json({ authenticated: true, user: req.user, config, progression });
  })
);

// --- Profile --------------------------------------------------------------

app.get(
  '/api/profile',
  authenticate,
  asyncHandler(async (req, res) => {
    const config = await loadOrCreateConfig(req.user.id);
    const progression = await loadOrCreateProgression(req.user.id);
    res.json({ user: req.user, config, progression });
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
    const malwareQuality = clamp(parseNumber(payload.malwareQuality, DEFAULT_PLAYER_CONFIG.malwareQuality));

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

    const { session, config, progression } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());
    await persistProgressionIfNeeded(req.user.id, session);

    res.json({ success: true, config, progression, snapshot: session.getSnapshot() });
  })
);

// --- Progression ---------------------------------------------------------

app.get(
  '/api/progression',
  authenticate,
  asyncHandler(async (req, res) => {
    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());
    await persistProgressionIfNeeded(req.user.id, session);

    res.json({
      progression: session.getSnapshot().progression,
      skillTree: SKILL_TREE,
      companies: COMPANY_CATALOG
    });
  })
);

app.post(
  '/api/progression/skills',
  authenticate,
  asyncHandler(async (req, res) => {
    const { skillId } = req.body || {};
    if (!skillId) {
      return res.status(400).json({ error: 'skillId is required.' });
    }

    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());

    try {
      session.unlockSkill(String(skillId));
      await persistProgressionIfNeeded(req.user.id, session);
      res.json({ progression: session.getSnapshot().progression });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

app.post(
  '/api/progression/companies',
  authenticate,
  asyncHandler(async (req, res) => {
    const { companyId } = req.body || {};
    if (!companyId) {
      return res.status(400).json({ error: 'companyId is required.' });
    }

    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());

    try {
      session.purchaseCompany(String(companyId));
      await persistProgressionIfNeeded(req.user.id, session);
      res.json({ progression: session.getSnapshot().progression });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

app.post(
  '/api/progression/employees',
  authenticate,
  asyncHandler(async (req, res) => {
    const { companyId, employeeId } = req.body || {};
    if (!companyId || !employeeId) {
      return res.status(400).json({ error: 'companyId and employeeId are required.' });
    }

    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());

    try {
      session.hireEmployee(String(companyId), String(employeeId));
      await persistProgressionIfNeeded(req.user.id, session);
      res.json({ progression: session.getSnapshot().progression });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

app.post(
  '/api/progression/blueprint-build',
  authenticate,
  asyncHandler(async (req, res) => {
    const { blueprintType, complexity } = req.body || {};
    if (!blueprintType) {
      return res.status(400).json({ error: 'blueprintType is required.' });
    }

    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());

    const baseXp = 60;
    const complexityBonus = Math.max(0, Math.min(40, Number(complexity) || 0));
    const xpAward = baseXp + complexityBonus;
    session.grantXp(xpAward, 'BLUEPRINT_BUILD', { blueprintType });

    await persistProgressionIfNeeded(req.user.id, session);
    res.json({
      xpAward,
      progression: session.getSnapshot().progression
    });
  })
);

// --- World simulation ----------------------------------------------------

app.get(
  '/api/world/state',
  authenticate,
  asyncHandler(async (req, res) => {
    const { session, config } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());
    await persistProgressionIfNeeded(req.user.id, session);
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
    const result = session.startInfection(country, { reapply, source: config.selectedBlueprint || 'player' });
    session.tick(Date.now());

    if (result && result.blocked) {
      await persistProgressionIfNeeded(req.user.id, session);
      return res.json({
        blocked: true,
        challenge: result.challenge,
        snapshot: session.getSnapshot()
      });
    }

    await run(
      `INSERT INTO deployments (user_id, country, blueprint, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      [req.user.id, result.country, config.selectedBlueprint || null]
    );

    await persistProgressionIfNeeded(req.user.id, session);
    res.json({ config, infection: result, snapshot: session.getSnapshot() });
  })
);

app.post(
  '/api/world/av-bypass',
  authenticate,
  asyncHandler(async (req, res) => {
    const { challengeId, answer } = req.body || {};
    if (!challengeId || !answer) {
      return res.status(400).json({ error: 'challengeId and answer are required.' });
    }

    const { session } = await ensurePlayerSession(req.user.id);
    session.tick(Date.now());

    try {
      const result = session.attemptAvBypass(String(challengeId), String(answer));
      await persistProgressionIfNeeded(req.user.id, session);
      res.json({ result, snapshot: session.getSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err.message, snapshot: session.getSnapshot() });
    }
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

// --- Blueprint creator + WASM --------------------------------------------

app.post('/simulate', (req, res) => {
  try {
    if (!runSimulation) {
      return res.status(500).json({ error: 'WASM function not loaded' });
    }
    const name = req.body?.name || 'Unknown';
    const result = runSimulation(name);
    res.json({ result });
  } catch (err) {
    console.error('Simulation failure:', err);
    res.status(500).json({ error: `Simulation error: ${err.message}` });
  }
});

app.post('/save-blueprint', (req, res) => {
  try {
    const { name, blueprint } = req.body || {};
    if (!name || !blueprint) {
      return res.status(400).json({ error: 'Missing name or blueprint' });
    }
    const safeName = String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(__dirname, 'creator', `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ name, blueprint }, null, 2));
    res.json({ success: true, file: `/creator/${safeName}.json` });
  } catch (err) {
    console.error('Saving blueprint failed:', err);
    res.status(500).json({ error: `Failed to save blueprint: ${err.message}` });
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
    console.error('Fetching creator files failed:', err);
    res.status(500).json({ error: `Failed to fetch creator files: ${err.message}` });
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
    console.error('Reading creator file failed:', err);
    res.status(500).json({ error: `Failed to read file: ${err.message}` });
  }
});

// --- Diagnostics ---------------------------------------------------------

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
    console.error('Failed to create or update player:', err);
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
    console.error('Failed to start infection:', err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/players/:playerId', (req, res) => {
  const { playerId } = req.params;
  const removed = simulationManager.removePlayer(playerId);
  res.json({ removed });
});


const sim = new SimulationManager({ tickMs: 2000 });
sim.start();

app.get('/api/world/state', (req, res) => {
  const player = sim.upsertPlayer(req.session.userId, req.session.config || {});
  res.json({
    snapshot: player.getSnapshot(),
    config: player.getConfig()
  });
});

app.post('/api/world/infect', (req, res) => {
  const player = sim.upsertPlayer(req.session.userId, req.session.config || {});
  const { country, reapply } = req.body;
  const result = player.deployToCountry(country, reapply);
  res.json({
    snapshot: player.getSnapshot(),
    config: player.getConfig(),
    blocked: result.blocked,
    challenge: result.challenge
  });
});

// --- Error handling ------------------------------------------------------

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

app.listen(port, async () => {
  await loadWasm();
  simulationManager.start();
  console.log(`>> Server running on http://localhost:${port}`);
});




