const XP_GROWTH_RATE = 1.18;
const BASE_XP_FOR_LEVEL = 140;

const SKILL_TREE = [
  {
    id: 'stealth-veil-weave',
    name: 'Veil Weave',
    category: 'stealth',
    description: 'Increase base stealth attribute by +0.08.',
    cost: 1,
    requires: [],
    effects: { attributes: { stealth: 0.08 } }
  },
  {
    id: 'stealth-neural-fog',
    name: 'Neural Fog',
    category: 'stealth',
    description: 'Adds +0.10 stealth and unlocks AV spoofing events.',
    cost: 1,
    requires: ['stealth-veil-weave'],
    effects: { attributes: { stealth: 0.1 }, flags: ['av_spoofing'] }
  },
  {
    id: 'stealth-quantum',
    name: 'Quantum Stealth',
    category: 'stealth',
    description: 'Harness quantum tunnelling to reduce AV detection. +0.14 stealth and slows WHO alerts.',
    cost: 2,
    requires: ['stealth-neural-fog'],
    effects: { attributes: { stealth: 0.14 }, flags: ['who_dampener'] }
  },
  {
    id: 'spread-hydra',
    name: 'Hydra Fork',
    category: 'spread',
    description: 'Boost spread attribute by +0.09.',
    cost: 1,
    requires: [],
    effects: { attributes: { spread: 0.09 } }
  },
  {
    id: 'spread-helios',
    name: 'Project Helios',
    category: 'spread',
    description: 'Adds +0.12 spread and improves passive XP pulses.',
    cost: 1,
    requires: ['spread-hydra'],
    effects: { attributes: { spread: 0.12 }, flags: ['xp_pulse_boost'] }
  },
  {
    id: 'spread-ai-worm',
    name: 'AI Worm',
    category: 'spread',
    description: 'Self-evolving worm increases neighbour spread chance. +0.16 spread and exposure surge.',
    cost: 2,
    requires: ['spread-helios'],
    effects: { attributes: { spread: 0.16 }, flags: ['exposure_burst'] }
  },
  {
    id: 'resilience-carbon',
    name: 'Carbon Shell',
    category: 'resilience',
    description: 'Increase resilience attribute by +0.08.',
    cost: 1,
    requires: [],
    effects: { attributes: { resilience: 0.08 } }
  },
  {
    id: 'resilience-scarab',
    name: 'Scarab Kernel',
    category: 'resilience',
    description: 'Adds +0.12 resilience and slows AV decay.',
    cost: 1,
    requires: ['resilience-carbon'],
    effects: { attributes: { resilience: 0.12 }, flags: ['av_decay_slow'] }
  },
  {
    id: 'resilience-zero-day',
    name: 'Zero-Day Arsenal',
    category: 'resilience',
    description: 'Persistent zero-day cache grants +0.15 resilience and +0.05 stealth.',
    cost: 2,
    requires: ['resilience-scarab', 'stealth-neural-fog'],
    effects: { attributes: { resilience: 0.15, stealth: 0.05 } }
  },
  {
    id: 'economy-blackfunds',
    name: 'Black Funds',
    category: 'economy',
    description: 'Gain +150 capital instantly and +15% capital from future XP.',
    cost: 1,
    requires: ['spread-hydra'],
    effects: { capitalImmediate: 150, flags: ['capital_bonus'] }
  },
  {
    id: 'economy-botnet-symphony',
    name: 'Botnet Symphony',
    category: 'economy',
    description: 'Automates monetisation. +0.05 spread, +0.05 resilience, chance for capital windfalls.',
    cost: 2,
    requires: ['economy-blackfunds'],
    effects: { attributes: { spread: 0.05, resilience: 0.05 }, flags: ['capital_windfall'] }
  },
  {
    id: 'blueprint-ransomware',
    name: 'Blueprint: Ransomware',
    category: 'blueprint',
    description: 'Unlock the Ransomware payload blueprint inside the builder.',
    cost: 1,
    requires: ['stealth-veil-weave'],
    effects: { unlockBlueprints: ['ransomware'] }
  },
  {
    id: 'blueprint-rootkit',
    name: 'Blueprint: Rootkit',
    category: 'blueprint',
    description: 'Unlock an advanced Rootkit payload with high stealth.',
    cost: 1,
    requires: ['stealth-neural-fog', 'resilience-carbon'],
    effects: { unlockBlueprints: ['rootkit'] }
  },
  {
    id: 'blueprint-worm',
    name: 'Blueprint: Worm',
    category: 'blueprint',
    description: 'Unlock a fast spreading Worm payload.',
    cost: 1,
    requires: ['spread-hydra'],
    effects: { unlockBlueprints: ['worm'] }
  },
  {
    id: 'blueprint-ai-phantom',
    name: 'Blueprint: AI Phantom',
    category: 'blueprint',
    description: 'Unlock an adaptive AI payload that targets critical infrastructure.',
    cost: 2,
    requires: ['spread-ai-worm', 'stealth-quantum'],
    effects: { unlockBlueprints: ['ai-phantom'], flags: ['ai_payload'] }
  }
];

const COMPANY_CATALOG = [
  {
    id: 'ghostworks',
    name: 'GhostWorks GmbH',
    description: 'Elite stealth lab that fine-tunes malware obfuscation.',
    cost: 320,
    upkeep: 25,
    bonuses: { stealth: 0.06 },
    employees: [
      {
        id: 'ghost-analyst',
        name: 'Signal Analyst',
        cost: 180,
        bonuses: { stealth: 0.05 }
      },
      {
        id: 'ghost-liaison',
        name: 'Insider Liaison',
        cost: 220,
        bonuses: { stealth: 0.03, spread: 0.02 }
      }
    ]
  },
  {
    id: 'hydra-labs',
    name: 'Hydra Labs',
    description: 'Distributed botnet incubator to amplify spread.',
    cost: 280,
    upkeep: 18,
    bonuses: { spread: 0.07 },
    employees: [
      {
        id: 'hydra-swe',
        name: 'Botnet SWE',
        cost: 160,
        bonuses: { spread: 0.06 }
      },
      {
        id: 'hydra-splicer',
        name: 'Payload Splicer',
        cost: 200,
        bonuses: { spread: 0.04, resilience: 0.02 }
      }
    ]
  },
  {
    id: 'scarab-systems',
    name: 'Scarab Systems',
    description: 'Firmware bunker that hardens payload resilience.',
    cost: 260,
    upkeep: 22,
    bonuses: { resilience: 0.08 },
    employees: [
      {
        id: 'scarab-kernel',
        name: 'Kernel Engineer',
        cost: 150,
        bonuses: { resilience: 0.06 }
      },
      {
        id: 'scarab-ops',
        name: 'Ops Strategist',
        cost: 210,
        bonuses: { resilience: 0.04, stealth: 0.02 }
      }
    ]
  },
  {
    id: 'tachyon-forge',
    name: 'Tachyon Forge',
    description: 'Quantum compute farm that prototypes ultra-dense payloads.',
    cost: 420,
    upkeep: 34,
    bonuses: { stealth: 0.05, spread: 0.05 },
    employees: [
      {
        id: 'tachyon-architect',
        name: 'Quantum Architect',
        cost: 260,
        bonuses: { stealth: 0.07 }
      },
      {
        id: 'tachyon-liaison',
        name: 'Cobalt Liaison',
        cost: 280,
        bonuses: { spread: 0.05, resilience: 0.03 }
      }
    ]
  }
];

const COUNTRY_AV_OVERRIDES = {
  'United States': { vendor: 'Sentinel ICE', tier: 5, difficulty: 0.9, rewardXp: 140 },
  Germany: { vendor: 'Aegis Shield', tier: 4, difficulty: 0.82, rewardXp: 115 },
  France: { vendor: 'Aegis Shield', tier: 4, difficulty: 0.8, rewardXp: 110 },
  China: { vendor: 'Great Firewall++', tier: 4, difficulty: 0.88, rewardXp: 130 },
  Japan: { vendor: 'Kitsune Watch', tier: 4, difficulty: 0.86, rewardXp: 120 },
  Australia: { vendor: 'WardTek Horizon', tier: 3, difficulty: 0.72, rewardXp: 95 },
  Canada: { vendor: 'Sentinel ICE', tier: 4, difficulty: 0.78, rewardXp: 100 },
  'United Kingdom': { vendor: 'Sentinel ICE', tier: 4, difficulty: 0.82, rewardXp: 110 },
  Russia: { vendor: 'VolkShield', tier: 3, difficulty: 0.7, rewardXp: 90 },
  India: { vendor: 'Chimera Watch', tier: 2, difficulty: 0.6, rewardXp: 80 },
  Brazil: { vendor: 'Iara Sentinel', tier: 2, difficulty: 0.58, rewardXp: 75 },
  Mexico: { vendor: 'Iara Sentinel', tier: 2, difficulty: 0.55, rewardXp: 70 },
  Spain: { vendor: 'Aegis Shield', tier: 3, difficulty: 0.68, rewardXp: 85 },
  'South Africa': { vendor: 'Obsidian Gate', tier: 2, difficulty: 0.5, rewardXp: 65 },
  Nigeria: { vendor: 'Obsidian Gate', tier: 2, difficulty: 0.45, rewardXp: 60 },
  Egypt: { vendor: 'Obsidian Gate', tier: 2, difficulty: 0.52, rewardXp: 68 },
  'Saudi Arabia': { vendor: 'Chimera Watch', tier: 3, difficulty: 0.65, rewardXp: 85 }
};

const AV_PROMPT_TEMPLATES = [
  {
    id: 'inject-patch',
    prompt: ({ vendor, country, token }) =>
      `Bypass ${vendor} in ${country}: type patch.override("${token}") to inject the patch.`,
    expected: (token) => `patch.override("${token}")`
  },
  {
    id: 'cipher-scramble',
    prompt: ({ vendor, country, token }) =>
      `Firewall ${vendor} blocks outbound payloads in ${country}. Enter cipher.scramble('${token}') to re-key packets.`,
    expected: (token) => `cipher.scramble('${token}')`
  },
  {
    id: 'handshake',
    prompt: ({ vendor, country, token }) =>
      `Synthetic handshake required: confirm with handshake.sign('${token}', 'OK') to pierce ${vendor} in ${country}.`,
    expected: (token) => `handshake.sign('${token}', 'OK')`
  }
];

function getXpForLevel(level = 1) {
  if (level <= 1) {
    return BASE_XP_FOR_LEVEL;
  }
  return Math.round(BASE_XP_FOR_LEVEL * Math.pow(XP_GROWTH_RATE, level - 1));
}

function pickRandomTemplate() {
  return AV_PROMPT_TEMPLATES[Math.floor(Math.random() * AV_PROMPT_TEMPLATES.length)];
}

function generateAvToken({ vendor, country, tier }) {
  const base = vendor.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6);
  const countryTag = country.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 3);
  const entropy = Math.floor(1000 + Math.random() * 9000);
  return `${base}_${countryTag}_${tier}${entropy}`;
}

function buildAvChallenge(country, profile = {}) {
  const vendor = profile.vendor || 'Generic Shield';
  const tier = profile.tier || 1;
  const template = pickRandomTemplate();
  const token = generateAvToken({ vendor, country, tier });
  const prompt = template.prompt({ vendor, country, token });
  const expected = template.expected(token);
  const rewardXp = profile.rewardXp || 60 + tier * 10;

  return {
    id: `av-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    country,
    vendor,
    prompt,
    expected,
    rewardXp,
    tier
  };
}

module.exports = {
  XP_GROWTH_RATE,
  BASE_XP_FOR_LEVEL,
  SKILL_TREE,
  COMPANY_CATALOG,
  COUNTRY_AV_OVERRIDES,
  getXpForLevel,
  buildAvChallenge
};
