const { PlayerSimulation } = require('./playerSimulation');

class SimulationManager {
  constructor({ tickMs = 1000 } = {}) {
    this.sessions = new Map();
    this.tickMs = tickMs;
    this.interval = null;
  }

  start() {
    if (this.interval) {
      return;
    }
    this.interval = setInterval(() => {
      this.tickAll(Date.now());
    }, this.tickMs);

    if (this.interval.unref) {
      this.interval.unref();
    }
  }

  stop() {
    if (!this.interval) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  ensureTicker() {
    if (!this.interval) {
      this.start();
    }
  }

  getPlayer(playerId) {
    return this.sessions.get(String(playerId));
  }

  upsertPlayer(playerId, config = {}) {
    const id = String(playerId);
    let session = this.sessions.get(id);
    if (!session) {
      session = new PlayerSimulation(id, config);
      this.sessions.set(id, session);
    } else {
      session.updateConfig(config);
      if (config.progression) {
        session.applyProgression(config.progression, { silent: true });
      }
    }
    this.ensureTicker();
    return session;
  }

  removePlayer(playerId) {
    const removed = this.sessions.delete(String(playerId));
    if (this.sessions.size === 0) {
      this.stop();
    }
    return removed;
  }

  listPlayers() {
    return Array.from(this.sessions.keys());
  }

  getPlayerSummaries() {
    return Array.from(this.sessions.values()).map((session) => session.getSummary());
  }

  tickAll(now = Date.now()) {
    for (const session of this.sessions.values()) {
      session.tick(now);
    }
  }
}

module.exports = SimulationManager;
