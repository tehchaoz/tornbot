const KNOWLEDGE = {
  leveling: {
    strategy: 'attack-and-leave',
    description: 'Attack suitable targets until defeated, then leave. Do NOT mug or hospitalize when the objective is leveling XP.',
    targetCriteria: 'High level relative to your stats, inactive players on oran.pw/baldrstargets',
    xpPerAttack: 0.5,
    xpPerLeave: 1.0,
    maxAttacksPerTarget: 5,
  },
  gym: {
    priority: 'train when energy available and targets are inefficient',
    description: 'Energy is best spent training stats. Gym gains compound over time.',
  },
  crimes: {
    priority: 'use nerve for crimes',
    description: 'Nerve is only useful for crimes. Build toward 60 Natural Nerve Bar.',
    recommended: ['Search for Cash (2 nerve)', 'Bootlegging (1+ nerve)', 'Shoplifting (4 nerve)'],
  },
  education: {
    rule: 'NEVER let the education slot sit empty without a reason',
    priority: ['Education Length', 'Bank Interest', 'Sports Science'],
  },
  merits: {
    priority: ['Education Length (1-10)', 'Bank Interest (1-10)'],
  },
  travel: {
    levelRequired: 15,
    description: 'At Level 15, travel becomes a major economic system. Plushies/flowers → Museum → Points → cash.',
  },
  museum: {
    requirement: 'History Studies Bachelor for relevant Museum exchange',
    chain: 'Level 15 → Travel → Foreign-item economy → History Studies → Museum → Set completion → Museum Points → Economic strategy',
  },
};

function analyzeState(profile, bars, battlestats) {
  const state = {
    level: profile.level || 0,
    cash: profile.money_onhand || 0,
    bank: profile.bank || 0,
    points: profile.points || 0,
    energy: bars.energy?.current || 0,
    energyMaximum: bars.energy?.maximum || 100,
    nerve: bars.nerve?.current || 0,
    nerveMaximum: bars.nerve?.maximum || 15,
    happy: bars.happy?.current || 0,
    happyMaximum: bars.happy?.maximum || 100,
    life: bars.life?.current || 0,
    lifeMaximum: bars.life?.maximum || 150,
    battlestats: {
      strength: battlestats.strength || 0,
      defense: battlestats.defense || 0,
      speed: battlestats.speed || 0,
      dexterity: battlestats.dexterity || 0,
    },
    totalStats: (battlestats.strength || 0) + (battlestats.defense || 0) + (battlestats.speed || 0) + (battlestats.dexterity || 0),
  };

  state.isLowLife = state.life < state.lifeMaximum * 0.5;
  state.isLowEnergy = state.energy < 10;
  state.isHighEnergy = state.energy >= state.energyMaximum * 0.5;
  state.hasNerve = state.nerve > 0;
  state.isLowHappy = state.happy < 50;
  state.isNearLevel15 = state.level >= 13 && state.level < 15;
  state.isPastLevel15 = state.level >= 15;

  return state;
}

function generateRecommendations(state) {
  const recs = [];

  if (state.isLowLife) {
    recs.push({
      action: 'HEAL',
      priority: 'CRITICAL',
      reason: 'Your life is low. Heal before doing anything else.',
      confidence: 'HIGH',
      requiredResources: `${state.lifeMaximum - state.life} life`,
      expectedBenefit: 'Survival',
      warnings: [],
      emoji: '❤️',
    });
  }

  if (state.isLowHappy && !state.isLowLife) {
    recs.push({
      action: 'BOOST HAPPY',
      priority: 'HIGH',
      reason: 'Low happiness reduces gym gains and crime success.',
      confidence: 'HIGH',
      requiredResources: 'Happy items or Nerve bars',
      expectedBenefit: 'Better gains and crime success',
      warnings: [],
      emoji: '😊',
    });
  }

  if (state.isHighEnergy && state.level < 15) {
    recs.push({
      action: 'GYM',
      priority: state.isLowLife ? 'MEDIUM' : 'HIGH',
      reason: `You have ${state.energy} energy. Training now builds stats for better targets.`,
      confidence: 'HIGH',
      requiredResources: `${Math.min(state.energy, 25)} energy`,
      expectedBenefit: 'Battle stat growth',
      warnings: state.isLowHappy ? ['Low happiness may reduce gains'] : [],
      emoji: '🏋️',
    });
  }

  if (state.hasNerve && state.level < 15) {
    recs.push({
      action: 'CRIME',
      priority: 'MEDIUM',
      reason: `You have ${state.nerve} nerve available. Use it for crimes to progress toward 60 Nerve.`,
      confidence: 'MEDIUM',
      requiredResources: `${state.nerve} nerve`,
      expectedBenefit: 'Crime skill progression, cash',
      warnings: ['Choose crimes appropriate for your nerve pool'],
      emoji: '🥷',
    });
  }

  if (state.level >= 15) {
    recs.push({
      action: 'TRAVEL',
      priority: 'HIGH',
      reason: 'At Level 15, travel is your primary income source. Plushies/flowers → Museum.',
      confidence: 'MEDIUM',
      requiredResources: 'Travel ticket + cash for items',
      expectedBenefit: 'Major economic progression',
      warnings: ['Check market prices before buying travel items'],
      emoji: '✈️',
    });
  }

  if (state.level < 15 && state.isHighEnergy) {
    recs.push({
      action: 'ATTACK',
      priority: 'MEDIUM',
      reason: 'Attack suitable leveling targets. Attack until defeated, then leave.',
      confidence: 'MEDIUM',
      requiredResources: 'Energy for attacks',
      expectedBenefit: 'XP and leveling progress',
      warnings: ['Use oran.pw/baldrstargets for target selection'],
      emoji: '⚔️',
    });
  }

  recs.push({
    action: 'EDUCATION',
    priority: recs.length === 0 ? 'HIGH' : 'LOW',
    reason: 'Ensure your education slot is active. Never let it sit empty.',
    confidence: 'HIGH',
    requiredResources: 'Time',
    expectedBenefit: 'Skill progression',
    warnings: [],
    emoji: '🎓',
  });

  recs.sort((a, b) => {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (order[a.priority] || 4) - (order[b.priority] || 4);
  });

  return recs;
}

function formatCoachResponse(state, recs) {
  const lines = [];
  lines.push('**TORN COACH**');
  lines.push('');
  lines.push(`Level: ${state.level}`);
  lines.push(`Cash: $${state.cash.toLocaleString()}`);
  lines.push(`Energy: ${state.energy}/${state.energyMaximum}`);
  lines.push(`Nerve: ${state.nerve}/${state.nerveMaximum}`);
  lines.push(`Happy: ${state.happy}/${state.happyMaximum}`);
  lines.push(`Life: ${state.life}/${state.lifeMaximum}`);
  lines.push('');

  const stats = state.battlestats;
  lines.push(`Stats: ${stats.strength.toLocaleString()} / ${stats.defense.toLocaleString()} / ${stats.speed.toLocaleString()} / ${stats.dexterity.toLocaleString()}`);
  lines.push('');

  if (recs.length > 0) {
    const best = recs[0];
    lines.push(`**BEST ACTION:** ${best.emoji} ${best.action}`);
    lines.push('');
    lines.push(`**WHY:** ${best.reason}`);

    if (best.warnings.length > 0) {
      lines.push('');
      lines.push(`**WARNINGS:** ${best.warnings.join('; ')}`);
    }

    if (recs.length > 1) {
      lines.push('');
      lines.push('**ALSO:**');
      for (let i = 1; i < Math.min(recs.length, 4); i++) {
        lines.push(`${recs[i].emoji} ${recs[i].action} — ${recs[i].reason}`);
      }
    }
  }

  lines.push('');
  lines.push(`Level 15: ${state.level} / 15`);

  return lines.join('\n');
}

module.exports = {
  KNOWLEDGE,
  analyzeState,
  generateRecommendations,
  formatCoachResponse,
};
