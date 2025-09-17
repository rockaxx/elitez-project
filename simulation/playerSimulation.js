const countries = require('./countryGraph');

const DEFAULT_ATTRIBUTES = Object.freeze({
  spread: 0.5,
  stealth: 0.5,
  resilience: 0.5
});

const canonicalNameMap = new Map();
for (const [name, data] of Object.entries(countries)) {
  canonicalNameMap.set(name.toLowerCase(), name);
  if (data.code) {
    canonicalNameMap.set(data.code.toLowerCase(), name);
  }
}

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

class PlayerSimulation {
  constructor(playerId, options = {}) {
    if (!playerId) {
      throw new Error('playerId is required to create a simulation session.');
    }

    this.playerId = String(playerId);
    this.infections = new Map();
    this.exposure = new Map();
    this.events = [];
    this.lastTick = Date.now();
    this.totalInfected = 0;
    this.maxEventLog = 60;

    this.malwareQuality = 0.5;
    this.attributes = { ...DEFAULT_ATTRIBUTES };

    this.updateConfig(options, { silent: true });
  }

  updateConfig(config = {}, { silent = false } = {}) {
    if (config.malwareQuality !== undefined) {
      const parsedQuality = parseNumber(config.malwareQuality, this.malwareQuality);
      this.malwareQuality = clamp01(parsedQuality);
    } else if (this.malwareQuality === undefined) {
      this.malwareQuality = 0.5;
    }

    const mergedAttributes = { ...this.attributes, ...(config.attributes || {}) };
    this.attributes = sanitizeAttributes(mergedAttributes);

    if (!silent) {
      this.recordEvent('CONFIG_UPDATED', {
        malwareQuality: this.malwareQuality,
        attributes: { ...this.attributes }
      });
    }

    return {
      malwareQuality: this.malwareQuality,
      attributes: { ...this.attributes }
    };
  }

  recordEvent(type, payload = {}) {
    const event = {
      type,
      timestamp: Date.now(),
      ...payload
    };
    this.events.push(event);
    if (this.events.length > this.maxEventLog) {
      this.events.shift();
    }
    return event;
  }

  computeBasePower() {
    const quality = this.malwareQuality ?? 0.5;
    const spread = this.attributes?.spread ?? 0.5;
    const resilience = this.attributes?.resilience ?? 0.5;

    const weighted = 0.5 * quality + 0.35 * spread + 0.15 * resilience;
    return clamp01(0.02 + 0.18 * weighted);
  }

  computeSpreadRate(sourceName, targetName, basePower = this.computeBasePower()) {
    const source = countries[sourceName];
    const target = countries[targetName];
    if (!source || !target) {
      return 0;
    }

    const connectivity = (source.connectivity + target.connectivity) / 2;
    const populationPressure = 0.5 + (target.population || 0) * 0.5;
    const securityMitigation = 1 - (target.security || 0);
    if (securityMitigation <= 0) {
      return 0;
    }

    const resilienceBoost = 0.8 + (this.attributes.resilience || 0) * 0.4;

    const rate = basePower * connectivity * populationPressure * securityMitigation * resilienceBoost;
    return Math.max(0, rate);
  }

  startInfection(countryName, options = {}) {
    const resolved = getCanonicalCountryName(countryName);
    if (!resolved) {
      throw new Error(`Unknown country: ${countryName}`);
    }

    const now = Date.now();
    const existing = this.infections.get(resolved);
    if (existing) {
      if (options.reapply) {
        existing.intensity = clamp01((existing.intensity || this.computeBasePower()) + this.computeBasePower() * 0.25);
        existing.lastBoostedAt = now;
        this.recordEvent('INTENSIFIED', {
          country: resolved,
          intensity: existing.intensity
        });
      }
      return { alreadyInfected: true, country: resolved };
    }

    const intensity = clamp01(options.intensity !== undefined
      ? parseNumber(options.intensity, 0.5)
      : 0.4 + 0.6 * (0.5 * this.malwareQuality + 0.5 * this.attributes.spread));

    this.infections.set(resolved, {
      infectedAt: now,
      intensity
    });
    this.totalInfected += 1;
    this.exposure.delete(resolved);

    this.recordEvent('INFECTED', {
      country: resolved,
      source: options.source || 'direct',
      intensity
    });

    return { country: resolved, intensity };
  }

  tick(now = Date.now()) {
    const currentTime = Number(now);
    if (!Number.isFinite(currentTime)) {
      return;
    }

    const deltaSeconds = (currentTime - this.lastTick) / 1000;
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      this.lastTick = currentTime;
      return;
    }

    // Natural decay of pending exposures based on security and malware stealth/resilience
    for (const [countryName, progress] of [...this.exposure.entries()]) {
      const country = countries[countryName];
      if (!country) {
        this.exposure.delete(countryName);
        continue;
      }

      const baseDecay = (0.01 + (country.security || 0) * 0.05) * deltaSeconds;
      const stealthMitigation = 1 + (this.attributes.stealth || 0) * 0.8;
      const resilienceMitigation = 1 + (this.attributes.resilience || 0) * 0.4;
      const adjustedDecay = baseDecay / (stealthMitigation * resilienceMitigation);
      const newProgress = progress - adjustedDecay;
      if (newProgress <= 0.0001) {
        this.exposure.delete(countryName);
      } else {
        this.exposure.set(countryName, newProgress);
      }
    }

    if (this.infections.size === 0) {
      this.lastTick = currentTime;
      return;
    }

    const basePower = this.computeBasePower();

    for (const [sourceName, infection] of [...this.infections.entries()]) {
      const source = countries[sourceName];
      if (!source) {
        continue;
      }

      infection.intensity = clamp01((infection.intensity || basePower) + basePower * deltaSeconds * 0.1);

      for (const neighborRaw of source.neighbors) {
        const neighborName = getCanonicalCountryName(neighborRaw);
        if (!neighborName || this.infections.has(neighborName)) {
          continue;
        }

        const spreadRate = this.computeSpreadRate(sourceName, neighborName, basePower);
        if (spreadRate <= 0) {
          continue;
        }

        const current = this.exposure.get(neighborName) || 0;
        const next = current + spreadRate * deltaSeconds;
        if (next >= 1) {
          const intensity = clamp01(basePower + spreadRate);
          this.infections.set(neighborName, {
            infectedAt: currentTime,
            intensity
          });
          this.exposure.delete(neighborName);
          this.totalInfected += 1;
          this.recordEvent('INFECTED', {
            country: neighborName,
            source: sourceName,
            via: 'neighbor',
            intensity
          });
        } else {
          this.exposure.set(neighborName, Math.min(next, 0.999));
        }
      }
    }

    this.lastTick = currentTime;
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
      population: data.population
    };
  }

  getSnapshot() {
    const infectedCountries = Array.from(this.infections.entries())
      .map(([country, details]) => ({
        country,
        infectedAt: details.infectedAt,
        intensity: Number(((details.intensity ?? 0)).toFixed(3)),
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
      events: this.events.slice(-25),
      lastTick: this.lastTick
    };
  }

  getSummary() {
    return {
      playerId: this.playerId,
      malwareQuality: this.malwareQuality,
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
