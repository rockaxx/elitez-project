const { COUNTRY_AV_OVERRIDES } = require('./progressionData');

const graph = {
  "United States": {
    code: "US",
    region: "North America",
    neighbors: ["Canada", "Mexico", "United Kingdom", "Brazil"],
    security: 0.85,
    connectivity: 0.9,
    population: 0.9
  },
  "Canada": {
    code: "CA",
    region: "North America",
    neighbors: ["United States", "United Kingdom"],
    security: 0.8,
    connectivity: 0.7,
    population: 0.3
  },
  "Mexico": {
    code: "MX",
    region: "North America",
    neighbors: ["United States", "Brazil", "Spain"],
    security: 0.55,
    connectivity: 0.6,
    population: 0.6
  },
  "Brazil": {
    code: "BR",
    region: "South America",
    neighbors: ["Mexico", "United States", "Spain", "South Africa"],
    security: 0.5,
    connectivity: 0.7,
    population: 0.8
  },
  "United Kingdom": {
    code: "GB",
    region: "Europe",
    neighbors: ["United States", "Canada", "Germany", "France", "India"],
    security: 0.82,
    connectivity: 0.85,
    population: 0.4
  },
  "Germany": {
    code: "DE",
    region: "Europe",
    neighbors: ["United Kingdom", "France", "Russia"],
    security: 0.88,
    connectivity: 0.8,
    population: 0.5
  },
  "France": {
    code: "FR",
    region: "Europe",
    neighbors: ["United Kingdom", "Germany", "Spain", "Egypt"],
    security: 0.78,
    connectivity: 0.75,
    population: 0.5
  },
  "Spain": {
    code: "ES",
    region: "Europe",
    neighbors: ["France", "Mexico", "Brazil", "Nigeria"],
    security: 0.7,
    connectivity: 0.7,
    population: 0.45
  },
  "Russia": {
    code: "RU",
    region: "Europe",
    neighbors: ["Germany", "China", "India"],
    security: 0.8,
    connectivity: 0.65,
    population: 0.7
  },
  "China": {
    code: "CN",
    region: "Asia",
    neighbors: ["Russia", "India", "Japan", "Australia"],
    security: 0.75,
    connectivity: 0.9,
    population: 1
  },
  "India": {
    code: "IN",
    region: "Asia",
    neighbors: ["United Kingdom", "Russia", "China", "Saudi Arabia"],
    security: 0.6,
    connectivity: 0.8,
    population: 1
  },
  "Japan": {
    code: "JP",
    region: "Asia",
    neighbors: ["China", "Australia"],
    security: 0.83,
    connectivity: 0.85,
    population: 0.45
  },
  "Australia": {
    code: "AU",
    region: "Oceania",
    neighbors: ["China", "Japan", "India"],
    security: 0.76,
    connectivity: 0.7,
    population: 0.25
  },
  "South Africa": {
    code: "ZA",
    region: "Africa",
    neighbors: ["Brazil", "Nigeria", "Egypt", "Saudi Arabia"],
    security: 0.55,
    connectivity: 0.6,
    population: 0.35
  },
  "Nigeria": {
    code: "NG",
    region: "Africa",
    neighbors: ["Spain", "South Africa", "Egypt"],
    security: 0.45,
    connectivity: 0.55,
    population: 0.7
  },
  "Egypt": {
    code: "EG",
    region: "Africa",
    neighbors: ["France", "Nigeria", "Saudi Arabia", "South Africa"],
    security: 0.58,
    connectivity: 0.6,
    population: 0.5
  },
  "Saudi Arabia": {
    code: "SA",
    region: "Asia",
    neighbors: ["India", "Egypt", "South Africa"],
    security: 0.65,
    connectivity: 0.65,
    population: 0.4
  }
};

for (const [country, profile] of Object.entries(COUNTRY_AV_OVERRIDES)) {
  if (!graph[country]) {
    continue;
  }
  graph[country].antivirus = {
    vendor: profile.vendor,
    tier: profile.tier,
    difficulty: profile.difficulty,
    rewardXp: profile.rewardXp
  };
}

module.exports = graph;
