const countries = require('./countryGraph');
const {
  SKILL_TREE,
  COMPANY_CATALOG,
  getXpForLevel,
  buildAvChallenge
} = require('./progressionData');

const EVENT_TYPES = Object.freeze({
  INFECTED: 'INFECTED',
  EXPOSURE: 'EXPOSURE',
  BOOST: 'BOOST',
  SPREAD: 'SPREAD',
  AV_BLOCK: 'AV_BLOCK',
  AV_BYPASSED: 'AV_BYPASSED',
  WHO_ALERT: 'WHO_ALERT',
  WORLD_EVENT: 'WORLD_EVENT'
});

const DEFAULT_ATTRIBUTES = Object.freeze({
  spread: 0.5,
  stealth: 0.5,
  resilience: 0.5
});

const DEFAULT_PROGRESSION = Object.freeze({
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

const XP_REWARD_DIRECT = 60;
const XP_REWARD_SPREAD = 35;
const XP_REWARD_EXPOSURE = 12;

const skillLookup = new Map(SKILL_TREE.map((skill) => [skill.id, skill]));
const companyLookup = new Map(COMPANY_CATALOG.map((company) => [company.id, company]));
const employeeLookup = (() => {
  const map = new Map();
  for (const company of COMPANY_CATALOG) {
    for (const employee of company.employees || []) {
      map.set(employee.id, { ...employee, companyId: company.id });
    }
  }
  return map;
})();

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeAttributes(attrs = {}) {
  const withDefaults = { ...DEFAULT_ATTRIBUTES, ...attrs };
  return {
    spread: clamp01(parseNumber(withDefaults.spread, DEFAULT_ATTRIBUTES.spread)),
    stealth: clamp01(parseNumber(withDefaults.stealth, DEFAULT_ATTRIBUTES.stealth)),
    resilience: clamp01(parseNumber(withDefaults.resilience, DEFAULT_ATTRIBUTES.resilience))
  };
}

const canonicalNameMap = new Map();
for (const [name, data] of Object.entries(countries)) {
  canonicalNameMap.set(name.toLowerCase(), name);
  if (data.code) {
    canonicalNameMap.set(data.code.toLowerCase(), name);
  }
}

function resolveCountryName(input) {
  if (!input) {
    return null;
  }
  const normalized = String(input).trim().toLowerCase();
  return canonicalNameMap.get(normalized) || null;
}

function getCanonicalCountryName(name) {
  if (!name) {
    return null;
  }
  if (countries[name]) {
    return name;
  }
  return resolveCountryName(name);
}

function nowTimestamp() {
  return Date.now();
}

class PlayerSimulation {
  constructor(playerId, options = {}) {
    if (!playerId) {
      throw new Error('playerId is required to create a simulation session.');
    }

    this.playerId = String(playerId);
    this.infections = new Map();
    this.exposure = new Map();
    this.events = [];
    this.lastTick = nowTimestamp();
    this.totalInfected = 0;
    this.maxEventLog = 100;

    this.baseAttributes = { ...DEFAULT_ATTRIBUTES };
    this.attributes = { ...DEFAULT_ATTRIBUTES };
    this.malwareQuality = clamp01(parseNumber(options.malwareQuality, 0.5));

    this.progressionState = {
      level: 1,
      xp: 0,
      xpToNext: getXpForLevel(1),
      skillPoints: 0,
      capital: 0,
      lastRandomXpAt: nowTimestamp()
    };
    this.unlockedBlueprints = new Set();
    this.skillSet = new Set();
    this.flagSet = new Set();
    this.companyRoster = [];
    this.employeeRoster = [];
    this.avBypassMap = new Map();
    this.pendingAvChallenges = new Map();
    this.progressionDirty = false;

    this.worldEventCooldownMs = 45000;
    this.lastWorldEventAt = 0;

    this.updateConfig(options, { silent: true });
    if (options.progression) {
      this.applyProgression(options.progression, { silent: true });
    }
  }

  updateConfig(config = {}, { silent = false } = {}) {
    if (config.malwareQuality !== undefined) {
      const parsedQuality = parseNumber(config.malwareQuality, this.malwareQuality);
      this.malwareQuality = clamp01(parsedQuality);
    } else if (this.malwareQuality === undefined) {
      this.malwareQuality = 0.5;
    }

    const mergedAttributes = { ...this.baseAttributes, ...(config.attributes || {}) };
    this.baseAttributes = sanitizeAttributes(mergedAttributes);
    this.recomputeAttributes();

    if (!silent) {
      this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
        label: 'CONFIG_UPDATE',
        malwareQuality: this.malwareQuality,
        attributes: { ...this.attributes }
      });
    }

    return {
      malwareQuality: this.malwareQuality,
      attributes: { ...this.attributes }
    };
  }

  applyProgression(progression = {}, { silent = false } = {}) {
    const merged = { ...DEFAULT_PROGRESSION, ...progression };
    const level = Math.max(1, parseInt(merged.level, 10) || 1);
    const xp = Math.max(0, parseInt(merged.xp, 10) || 0);
    const skillPoints = Math.max(0, parseInt(merged.skillPoints, 10) || 0);
    const capital = Math.max(0, parseInt(merged.capital, 10) || 0);
    const lastRandomXpAt = merged.lastRandomXpAt ? parseNumber(merged.lastRandomXpAt, nowTimestamp()) : nowTimestamp();

    this.progressionState = {
      level,
      xp,
      xpToNext: getXpForLevel(level),
      skillPoints,
      capital,
      lastRandomXpAt
    };

    this.unlockedBlueprints = new Set(Array.isArray(merged.unlockedBlueprints) ? merged.unlockedBlueprints : []);
    this.skillSet = new Set(Array.isArray(merged.skillsUnlocked) ? merged.skillsUnlocked : []);
    this.flagSet = new Set(Array.isArray(merged.flags) ? merged.flags : []);

    this.companyRoster = Array.isArray(merged.companies)
      ? merged.companies.map((company) => ({
          id: company.id,
          acquiredAt: company.acquiredAt || nowTimestamp()
        }))
      : [];

    this.employeeRoster = Array.isArray(merged.employees)
      ? merged.employees.map((employee) => ({
          id: employee.id,
          companyId: employee.companyId,
          hiredAt: employee.hiredAt || nowTimestamp()
        }))
      : [];

    this.avBypassMap = new Map();
    if (merged.avBypasses && typeof merged.avBypasses === 'object') {
      for (const [key, data] of Object.entries(merged.avBypasses)) {
        if (!data) {
          continue;
        }
        this.avBypassMap.set(key, {
          country: data.country,
          vendor: data.vendor,
          tier: data.tier,
          unlocked: Boolean(data.unlocked),
          unlockedAt: data.unlockedAt || null
        });
      }
    }

    this.recomputeAttributes();

    if (!silent) {
      this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
        label: 'PROGRESSION_SYNCED',
        level: this.progressionState.level,
        skillPoints: this.progressionState.skillPoints
      });
    }

    this.progressionDirty = false;
  }

  recomputeAttributes() {
    const totals = { ...this.baseAttributes };
    const applyBonus = (bonus = {}) => {
      for (const [attr, delta] of Object.entries(bonus)) {
        if (totals[attr] === undefined) {
          continue;
        }
        totals[attr] = clamp01(totals[attr] + parseNumber(delta, 0));
      }
    };

    for (const skillId of this.skillSet) {
      const skill = skillLookup.get(skillId);
      if (skill?.effects?.attributes) {
        applyBonus(skill.effects.attributes);
      }
    }

    for (const companyEntry of this.companyRoster) {
      const company = companyLookup.get(companyEntry.id);
      if (company?.bonuses) {
        applyBonus(company.bonuses);
      }
    }

    for (const employeeEntry of this.employeeRoster) {
      const employee = employeeLookup.get(employeeEntry.id);
      if (employee?.bonuses) {
        applyBonus(employee.bonuses);
      }
    }

    this.attributes = sanitizeAttributes(totals);
  }

  recordEvent(type, payload = {}) {
    const event = {
      type,
      timestamp: nowTimestamp(),
      ...payload
    };
    this.events.push(event);
    if (this.events.length > this.maxEventLog) {
      this.events.shift();
    }
    return event;
  }

  hasFlag(flag) {
    return this.flagSet.has(flag);
  }

  computeBasePower() {
    const quality = this.malwareQuality ?? 0.5;
    const spread = this.attributes?.spread ?? 0.5;
    const resilience = this.attributes?.resilience ?? 0.5;
    const stealth = this.attributes?.stealth ?? 0.5;
    const companyBoost = this.companyRoster.length * 0.02;
    const aiBonus = this.hasFlag('ai_payload') ? 0.04 : 0;
    const weighted = 0.35 * quality + 0.3 * spread + 0.2 * resilience + 0.15 * stealth;
    return clamp01(0.05 + 0.2 * weighted + companyBoost + aiBonus);
  }

  computeSpreadRate(sourceName, targetName, basePower = this.computeBasePower()) {
    const source = countries[sourceName];
    const target = countries[targetName];
    if (!source || !target) {
      return 0;
    }

    const connectivity = (source.connectivity + target.connectivity) / 2;
    const populationPressure = 0.6 + (target.population || 0) * 0.5;
    const securityMitigation = 1 - (target.security || 0);
    if (securityMitigation <= 0) {
      return 0;
    }

    const resilienceBoost = 0.8 + (this.attributes.resilience || 0) * 0.5;
    const stealthFactor = 0.85 + (this.attributes.stealth || 0) * 0.35;
    let spreadFactor = basePower * connectivity * populationPressure * securityMitigation * resilienceBoost * stealthFactor;

    if (this.hasFlag('exposure_burst')) {
      spreadFactor *= 1.25;
    }

    return Math.max(0, spreadFactor);
  }

  getAvKey(countryName) {
    const country = getCanonicalCountryName(countryName);
    if (!country) {
      return null;
    }
    return country;
  }

  hasAvBypass(countryName) {
    const key = this.getAvKey(countryName);
    if (!key) {
      return false;
    }
    const bypass = this.avBypassMap.get(key);
    return Boolean(bypass?.unlocked);
  }

  queueAvChallenge(countryName, source = 'spread') {
    const key = this.getAvKey(countryName);
    if (!key) {
      return null;
    }

    if (this.pendingAvChallenges.has(key)) {
      const challenge = this.pendingAvChallenges.get(key);
      return { ...challenge, expected: undefined };
    }

    const country = countries[key];
    const profile = country?.antivirus || {};
    const challenge = buildAvChallenge(key, profile);
    this.pendingAvChallenges.set(key, challenge);

    this.recordEvent(EVENT_TYPES.AV_BLOCK, {
      country: key,
      vendor: challenge.vendor,
      blocked: true,
      tier: challenge.tier,
      source
    });

    return { ...challenge, expected: undefined };
  }

  ensureAvEntry(countryName) {
    const key = this.getAvKey(countryName);
    if (!key) {
      return null;
    }
    if (!this.avBypassMap.has(key)) {
      const country = countries[key];
      if (!country?.antivirus) {
        return null;
      }
      this.avBypassMap.set(key, {
        country: key,
        vendor: country.antivirus.vendor,
        tier: country.antivirus.tier,
        unlocked: false,
        unlockedAt: null
      });
      this.progressionDirty = true;
    }
    return this.avBypassMap.get(key);
  }

  startInfection(countryName, options = {}) {
    const resolved = getCanonicalCountryName(countryName);
    if (!resolved) {
      throw new Error(`Unknown country: ${countryName}`);
    }

    const country = countries[resolved];
    if (country?.antivirus && !options.force && !this.hasAvBypass(resolved)) {
      const challenge = this.queueAvChallenge(resolved, options.source || 'direct');
      this.ensureAvEntry(resolved);
      return {
        blocked: true,
        country: resolved,
        challenge: challenge ? { id: challenge.id, prompt: challenge.prompt, vendor: challenge.vendor, tier: challenge.tier } : null
      };
    }

    const now = nowTimestamp();
    const existing = this.infections.get(resolved);
    if (existing) {
      if (options.reapply) {
        existing.intensity = clamp01((existing.intensity || this.computeBasePower()) + this.computeBasePower() * 0.25);
        existing.lastBoostedAt = now;
        this.recordEvent(EVENT_TYPES.BOOST, {
          country: resolved,
          intensity: existing.intensity
        });
        this.grantXp(18, 'REAPPLY', { country: resolved, source: options.source || 'direct' });
      }
      return { alreadyInfected: true, country: resolved };
    }

    const baseIntensity = 0.35 + 0.65 * (0.5 * this.malwareQuality + 0.5 * this.attributes.spread);
    const intensity = clamp01(options.intensity !== undefined ? parseNumber(options.intensity, 0.5) : baseIntensity);

    this.infections.set(resolved, {
      infectedAt: now,
      intensity
    });
    this.totalInfected += 1;
    this.exposure.delete(resolved);

    this.recordEvent(EVENT_TYPES.INFECTED, {
      country: resolved,
      source: options.source || 'direct',
      intensity
    });

    this.progressionDirty = true;
    this.grantXp(XP_REWARD_DIRECT, 'DIRECT_INFECTION', { country: resolved });

    return { country: resolved, intensity };
  }

  processBackgroundXp(now) {
    const baseInterval = this.hasFlag('xp_pulse_boost') ? 22000 : 30000;
    if (now - this.progressionState.lastRandomXpAt < baseInterval) {
      return;
    }
    const base = 14 + Math.random() * 18;
    const amount = Math.floor(base);
    const context = { source: 'PASSIVE_TICK' };
    this.grantXp(amount, 'PASSIVE', context);
    this.progressionState.lastRandomXpAt = now;

    if (this.hasFlag('capital_windfall') && Math.random() < 0.18) {
      const windfall = 80 + Math.floor(Math.random() * 120);
      this.progressionState.capital += windfall;
      this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
        label: 'BLACK_MARKET_WINDALL',
        capital: windfall
      });
      this.progressionDirty = true;
    }
  }

  grantXp(amount, reason = 'UNKNOWN', context = {}) {
    const xp = Math.max(0, Math.floor(amount));
    if (xp <= 0) {
      return { xpGained: 0, levelUps: [] };
    }

    this.progressionState.xp += xp;
    const capitalMultiplier = this.hasFlag('capital_bonus') ? 1.15 : 1;
    const capitalGain = Math.floor(xp * 0.45 * capitalMultiplier);
    this.progressionState.capital += capitalGain;

    const levelUps = [];
    while (this.progressionState.xp >= this.progressionState.xpToNext) {
      this.progressionState.xp -= this.progressionState.xpToNext;
      this.progressionState.level += 1;
      this.progressionState.skillPoints += 1;
      this.progressionState.capital += Math.floor(180 * capitalMultiplier);
      this.progressionState.xpToNext = getXpForLevel(this.progressionState.level);
      levelUps.push(this.progressionState.level);
      this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
        label: 'LEVEL_UP',
        level: this.progressionState.level
      });
    }

    this.progressionDirty = true;

    this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
      label: 'XP_GAIN',
      amount: xp,
      capitalGain,
      reason,
      ...context
    });

    return { xpGained: xp, capitalGain, levelUps };
  }

  maybeTriggerWorldEvent(now) {
    if (now - this.lastWorldEventAt < this.worldEventCooldownMs) {
      return;
    }
    let chance = 0.08;
    if (this.hasFlag('who_dampener')) {
      chance -= 0.025;
    }
    if (Math.random() >= chance) {
      return;
    }

    const templates = [
      () => {
        const affected = Array.from(this.infections.keys());
        if (affected.length === 0) {
          return null;
        }
        const drop = 0.08 + Math.random() * 0.07;
        affected.forEach((country) => {
          const infection = this.infections.get(country);
          if (!infection) {
            return;
          }
          infection.intensity = clamp01(infection.intensity - drop);
          if (infection.intensity <= 0.05) {
            this.infections.delete(country);
          }
        });
        return {
          type: EVENT_TYPES.WHO_ALERT,
          label: 'WHO Lockdown',
          payload: {
            severity: drop.toFixed(2),
            countries: affected
          }
        };
      },
      () => {
        const bonus = 120 + Math.floor(Math.random() * 140);
        this.progressionState.capital += bonus;
        this.progressionDirty = true;
        return {
          type: EVENT_TYPES.WORLD_EVENT,
          label: 'Stock Market Crash',
          payload: {
            capital: bonus,
            effect: 'Capital seized from unstable exchanges.'
          }
        };
      },
      () => {
        const xp = 80 + Math.floor(Math.random() * 90);
        this.grantXp(xp, 'WORLD_EVENT', { label: 'Backdoor Cache' });
        return {
          type: EVENT_TYPES.WORLD_EVENT,
          label: 'Backdoor Cache',
          payload: {
            xp
          }
        };
      },
      () => {
        const countriesList = Object.keys(countries);
        const sample = countriesList[Math.floor(Math.random() * countriesList.length)];
        if (!sample) {
          return null;
        }
        const country = countries[sample];
        const exposureBoost = 0.45 + Math.random() * 0.25;
        const current = this.exposure.get(sample) || 0;
        this.exposure.set(sample, Math.min(0.99, current + exposureBoost));
        this.recordEvent(EVENT_TYPES.EXPOSURE, {
          country: sample,
          progress: this.exposure.get(sample),
          via: 'WORLD_EVENT'
        });
        return {
          type: EVENT_TYPES.WORLD_EVENT,
          label: 'Insider Leak',
          payload: {
            country: sample,
            exposureBoost: exposureBoost.toFixed(2)
          }
        };
      }
    ];

    const template = templates[Math.floor(Math.random() * templates.length)];
    const result = template && template();
    if (result) {
      this.recordEvent(result.type, result.payload || { label: result.label });
      this.lastWorldEventAt = now;
    }
  }

  tick(now = nowTimestamp()) {
    const currentTime = Number(now);
    if (!Number.isFinite(currentTime)) {
      return;
    }

    this.processBackgroundXp(currentTime);
    this.maybeTriggerWorldEvent(currentTime);

    const deltaSeconds = (currentTime - this.lastTick) / 1000;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      this.lastTick = currentTime;
      return;
    }

    for (const [countryName, progress] of [...this.exposure.entries()]) {
      const country = countries[countryName];
      if (!country) {
        this.exposure.delete(countryName);
        continue;
      }

      const baseDecay = (0.015 + (country.security || 0) * 0.05) * deltaSeconds;
      const stealthMitigation = 1 + (this.attributes.stealth || 0) * 0.8;
      const resilienceMitigation = 1 + (this.attributes.resilience || 0) * 0.4;
      let decayDivisor = stealthMitigation * resilienceMitigation;
      if (this.hasFlag('av_decay_slow')) {
        decayDivisor *= 1.2;
      }
      const adjustedDecay = baseDecay / decayDivisor;
      const newProgress = progress - adjustedDecay;
      if (newProgress <= 0.0001) {
        this.exposure.delete(countryName);
      } else {
        this.exposure.set(countryName, newProgress);
      }
    }

    if (this.infections.size === 0 && this.exposure.size === 0) {
      this.lastTick = currentTime;
      return;
    }

    const basePower = this.computeBasePower();

    for (const infectionEntry of [...this.infections.entries()]) {
      const [countryName, infection] = infectionEntry;
      const country = countries[countryName];
      if (!country) {
        this.infections.delete(countryName);
        continue;
      }

      infection.intensity = clamp01((infection.intensity || basePower) + basePower * deltaSeconds * 0.12);

      for (const neighborRaw of country.neighbors) {
        const neighborName = getCanonicalCountryName(neighborRaw);
        if (!neighborName || this.infections.has(neighborName)) {
          continue;
        }

        const neighborCountry = countries[neighborName];
        if (neighborCountry?.antivirus && !this.hasAvBypass(neighborName)) {
          this.ensureAvEntry(neighborName);
          this.queueAvChallenge(neighborName, 'spread');
          continue;
        }

        const spreadRate = this.computeSpreadRate(countryName, neighborName, basePower);
        if (spreadRate <= 0) {
          continue;
        }

        const current = this.exposure.get(neighborName) || 0;
        const next = current + spreadRate * deltaSeconds;
        if (next >= 1) {
          const result = this.startInfection(neighborName, { source: countryName, intensity: basePower + spreadRate });
          if (!result.blocked) {
            this.recordEvent(EVENT_TYPES.SPREAD, {
              from: countryName,
              to: neighborName
            });
            this.grantXp(XP_REWARD_SPREAD, 'SPREAD', { from: countryName, to: neighborName });
          }
        } else {
          this.exposure.set(neighborName, Math.min(next, 0.999));
          this.recordEvent(EVENT_TYPES.EXPOSURE, {
            country: neighborName,
            progress: Number(this.exposure.get(neighborName).toFixed(3)),
            via: countryName
          });
          this.grantXp(XP_REWARD_EXPOSURE * deltaSeconds, 'EXPOSURE_PROGRESS', { country: neighborName });
        }
      }
    }

    for (const [countryName, progress] of [...this.exposure.entries()]) {
      if (progress >= 1) {
        this.startInfection(countryName, { source: 'exposure' });
      }
    }

    this.lastTick = currentTime;
  }

  unlockSkill(skillId) {
    const skill = skillLookup.get(skillId);
    if (!skill) {
      throw new Error('Unknown skill.');
    }
    if (this.skillSet.has(skillId)) {
      throw new Error('Skill already unlocked.');
    }
    for (const requirement of skill.requires || []) {
      if (!this.skillSet.has(requirement)) {
        throw new Error('Missing prerequisite skill.');
      }
    }
    const cost = Math.max(1, parseInt(skill.cost, 10) || 1);
    if (this.progressionState.skillPoints < cost) {
      throw new Error('Not enough skill points.');
    }

    this.progressionState.skillPoints -= cost;
    this.skillSet.add(skillId);
    if (Array.isArray(skill.effects?.flags)) {
      for (const flag of skill.effects.flags) {
        this.flagSet.add(flag);
      }
    }
    if (Array.isArray(skill.effects?.unlockBlueprints)) {
      for (const blueprint of skill.effects.unlockBlueprints) {
        this.unlockedBlueprints.add(blueprint);
      }
    }
    if (skill.effects?.capitalImmediate) {
      this.progressionState.capital += Math.max(0, parseInt(skill.effects.capitalImmediate, 10) || 0);
    }

    this.recomputeAttributes();
    this.progressionDirty = true;

    this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
      label: 'SKILL_UNLOCKED',
      skillId,
      skillName: skill.name,
      remainingSkillPoints: this.progressionState.skillPoints
    });

    return {
      skillId,
      remainingSkillPoints: this.progressionState.skillPoints
    };
  }

  purchaseCompany(companyId) {
    const company = companyLookup.get(companyId);
    if (!company) {
      throw new Error('Unknown company.');
    }
    if (this.companyRoster.some((entry) => entry.id === companyId)) {
      throw new Error('Company already owned.');
    }
    if (this.progressionState.capital < company.cost) {
      throw new Error('Not enough capital.');
    }

    this.progressionState.capital -= company.cost;
    const acquiredAt = nowTimestamp();
    this.companyRoster.push({ id: company.id, acquiredAt });
    this.recomputeAttributes();
    this.progressionDirty = true;

    this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
      label: 'COMPANY_ACQUIRED',
      companyId: company.id,
      name: company.name,
      capitalRemaining: this.progressionState.capital
    });

    return {
      companyId: company.id,
      capitalRemaining: this.progressionState.capital
    };
  }

  hireEmployee(companyId, employeeId) {
    const company = companyLookup.get(companyId);
    if (!company) {
      throw new Error('Unknown company.');
    }
    if (!this.companyRoster.some((entry) => entry.id === companyId)) {
      throw new Error('Company not owned.');
    }

    const employee = (company.employees || []).find((entry) => entry.id === employeeId);
    if (!employee) {
      throw new Error('Unknown employee.');
    }
    if (this.employeeRoster.some((entry) => entry.id === employeeId)) {
      throw new Error('Employee already hired.');
    }
    if (this.progressionState.capital < employee.cost) {
      throw new Error('Not enough capital.');
    }

    this.progressionState.capital -= employee.cost;
    const hiredAt = nowTimestamp();
    this.employeeRoster.push({ id: employee.id, companyId: company.id, hiredAt });
    this.recomputeAttributes();
    this.progressionDirty = true;

    this.recordEvent(EVENT_TYPES.WORLD_EVENT, {
      label: 'EMPLOYEE_HIRED',
      companyId: company.id,
      employeeId: employee.id,
      name: employee.name,
      capitalRemaining: this.progressionState.capital
    });

    return {
      employeeId: employee.id,
      capitalRemaining: this.progressionState.capital
    };
  }

  attemptAvBypass(challengeId, answer) {
    const trimmed = typeof answer === 'string' ? answer.trim() : '';
    if (!challengeId || !trimmed) {
      throw new Error('Challenge response is required.');
    }

    const challenge = Array.from(this.pendingAvChallenges.values()).find((entry) => entry.id === challengeId);
    if (!challenge) {
      throw new Error('Challenge not found or already resolved.');
    }

    if (trimmed !== challenge.expected) {
      this.recordEvent(EVENT_TYPES.AV_BLOCK, {
        country: challenge.country,
        vendor: challenge.vendor,
        error: 'Incorrect bypass code'
      });
      throw new Error('Bypass code incorrect.');
    }

    this.pendingAvChallenges.delete(challenge.country);
    const bypassEntry = this.ensureAvEntry(challenge.country) || {
      country: challenge.country,
      vendor: challenge.vendor,
      tier: challenge.tier,
      unlocked: false,
      unlockedAt: null
    };
    bypassEntry.unlocked = true;
    bypassEntry.unlockedAt = nowTimestamp();
    this.avBypassMap.set(challenge.country, bypassEntry);

    const xpReward = challenge.rewardXp || 60;
    const xpResult = this.grantXp(xpReward, 'AV_BYPASS', {
      country: challenge.country,
      vendor: challenge.vendor
    });

    this.recordEvent(EVENT_TYPES.AV_BYPASSED, {
      country: challenge.country,
      vendor: challenge.vendor,
      xpReward
    });

    this.progressionDirty = true;

    return {
      country: challenge.country,
      vendor: challenge.vendor,
      xpReward,
      levelUps: xpResult.levelUps
    };
  }

  getCountryMetrics(name) {
    const data = countries[name];
    if (!data) {
      return null;
    }
    return {
      code: data.code,
      region: data.region,
      security: data.security,
      connectivity: data.connectivity,
      population: data.population,
      antivirus: data.antivirus || null
    };
  }

  getPendingChallengesForExport() {
    return Array.from(this.pendingAvChallenges.values()).map((challenge) => ({
      id: challenge.id,
      country: challenge.country,
      vendor: challenge.vendor,
      prompt: challenge.prompt,
      tier: challenge.tier
    }));
  }

  getAvBypassesForExport() {
    return Array.from(this.avBypassMap.entries()).map(([country, entry]) => ({
      country,
      vendor: entry.vendor,
      tier: entry.tier,
      unlocked: Boolean(entry.unlocked),
      unlockedAt: entry.unlockedAt
    }));
  }

  getProgressionSnapshot() {
    return {
      level: this.progressionState.level,
      xp: this.progressionState.xp,
      xpToNext: this.progressionState.xpToNext,
      xpProgress: this.progressionState.xpToNext ? this.progressionState.xp / this.progressionState.xpToNext : 0,
      skillPoints: this.progressionState.skillPoints,
      capital: this.progressionState.capital,
      unlockedBlueprints: Array.from(this.unlockedBlueprints),
      skillsUnlocked: Array.from(this.skillSet),
      flags: Array.from(this.flagSet),
      companies: this.companyRoster.map((entry) => ({
        id: entry.id,
        acquiredAt: entry.acquiredAt
      })),
      employees: this.employeeRoster.map((entry) => ({
        id: entry.id,
        companyId: entry.companyId,
        hiredAt: entry.hiredAt
      })),
      avBypasses: this.getAvBypassesForExport(),
      pendingChallenges: this.getPendingChallengesForExport(),
      lastRandomXpAt: this.progressionState.lastRandomXpAt
    };
  }

  isProgressionDirty() {
    return this.progressionDirty;
  }

  getPersistableProgression() {
    return {
      level: this.progressionState.level,
      xp: this.progressionState.xp,
      skillPoints: this.progressionState.skillPoints,
      capital: this.progressionState.capital,
      unlockedBlueprints: Array.from(this.unlockedBlueprints),
      skillsUnlocked: Array.from(this.skillSet),
      flags: Array.from(this.flagSet),
      companies: this.companyRoster.map((entry) => ({
        id: entry.id,
        acquiredAt: entry.acquiredAt
      })),
      employees: this.employeeRoster.map((entry) => ({
        id: entry.id,
        companyId: entry.companyId,
        hiredAt: entry.hiredAt
      })),
      avBypasses: Object.fromEntries(
        Array.from(this.avBypassMap.entries()).map(([country, entry]) => [country, { ...entry }])
      ),
      lastRandomXpAt: this.progressionState.lastRandomXpAt
    };
  }

  markProgressionSaved() {
    this.progressionDirty = false;
  }

  getSnapshot() {
    const infectedCountries = Array.from(this.infections.entries())
      .map(([country, details]) => ({
        country,
        infectedAt: details.infectedAt,
        intensity: Number((details.intensity ?? 0).toFixed(3)),
        metrics: this.getCountryMetrics(country)
      }))
      .sort((a, b) => a.infectedAt - b.infectedAt);

    const pendingExposures = Array.from(this.exposure.entries())
      .map(([country, progress]) => ({
        country,
        progress: Number(Math.min(progress, 1).toFixed(3)),
        metrics: this.getCountryMetrics(country)
      }))
      .sort((a, b) => b.progress - a.progress);

    return {
      playerId: this.playerId,
      malwareQuality: this.malwareQuality,
      attributes: { ...this.attributes },
      totalInfected: this.totalInfected,
      activeInfections: this.infections.size,
      infectedCountries,
      pendingExposures,
      events: this.events.slice(-35),
      progression: this.getProgressionSnapshot(),
      lastTick: this.lastTick
    };
  }

  getSummary() {
    return {
      playerId: this.playerId,
      malwareQuality: this.malwareQuality,
      level: this.progressionState.level,
      activeInfections: this.infections.size,
      pendingTargets: this.exposure.size,
      totalInfected: this.totalInfected,
      lastTick: this.lastTick
    };
  }
}

module.exports = {
  PlayerSimulation,
  countries,
  resolveCountryName
};
