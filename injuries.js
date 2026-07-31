/**
 * injuries.js
 * ---------------------------------------------------------------------------
 * Probabilistic injury system. Nothing here is deterministic - injury-prone
 * players get a HIGHER RISK, never a guarantee. Two saves with an identical
 * starting squad will produce completely different injury histories because
 * every check is an independent weighted coin flip against Math.random().
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Weekly baseline risk for an "average" outfield player with a normal
// week's workload. Everything else is a multiplier on top of this.
const BASE_WEEKLY_RISK = 0.01; // 1%
const RISK_CEILING = 0.16;     // hard cap - even the most fragile, exhausted,
                                // old, previously-injured player is never
                                // "guaranteed" to get hurt in a given week.

/**
 * Compute this week's injury probability for a player.
 * @param {object} player - a player object from attributes.js/createPlayer
 * @param {object} context - { matchLoad: 0-2 (fixture congestion), trainingIntensity: 'low'|'normal'|'high' }
 */
export function computeWeeklyInjuryRisk(player, context = {}) {
    const { matchLoad = 1, trainingIntensity = 'normal', physioQuality = 0 } = context;
    const h = player.hidden;

    const proneMult = 0.4 + (h.injuryProneness / 20) * 1.6;
    const fitnessMult = 1.3 - (h.naturalFitness / 20) * 0.6;

    const ageMult = 1
        + Math.max(0, 21 - player.age) * 0.015
        + Math.max(0, player.age - 29) * 0.045;

    const fatigueMult = (player.isFatigued ? 1.5 : 1.0) + (20 - player.fitness) / 20 * 0.4;
    const loadMult = 1 + matchLoad * 0.35;
    const trainingMult = { low: 0.85, normal: 1.0, high: 1.3 }[trainingIntensity] ?? 1.0;
    const priorInjuryMult = clamp(1 + player.injuryHistory.length * 0.07, 1, 1.6);
    // A good physio catches niggles before they become injuries - up to ~24% risk reduction at quality 20.
    const physioMult = 1 - clamp(physioQuality / 20, 0, 1) * 0.24;

    const risk = BASE_WEEKLY_RISK * proneMult * fitnessMult * ageMult *
        fatigueMult * loadMult * trainingMult * priorInjuryMult * physioMult;

    return clamp(risk, 0.001, RISK_CEILING);
}

const SEVERITY_BANDS = {
    minor: [1, 7],
    moderate: [7, 42],
    major: [60, 365],
    careerThreatening: [365, 730]
};

function rollSeverity(player) {
    const h = player.hidden;
    const severityShift = clamp(
        (h.injuryProneness - 10) / 40 +
        Math.max(0, player.age - 29) * 0.01 +
        player.injuryHistory.length * 0.01,
        -0.1, 0.25
    );

    const weights = {
        minor: clamp(0.62 - severityShift * 0.5, 0.35, 0.68),
        moderate: 0.30,
        major: clamp(0.06 + severityShift * 0.35, 0.02, 0.16),
        careerThreatening: clamp(0.012 + severityShift * 0.06, 0.002, 0.04)
    };
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (const [band, w] of Object.entries(weights)) {
        roll -= w;
        if (roll <= 0) return band;
    }
    return 'minor';
}

function rollDuration(severity, player) {
    const [lo, hi] = SEVERITY_BANDS[severity];
    const raw = lo + Math.random() * (hi - lo);
    const recoveryMult = 1.15 - (player.hidden.recoveryRate / 20) * 0.4;
    return Math.max(1, Math.round(raw * recoveryMult));
}

function maybeApplyPermanentDamage(player, severity) {
    const hitChance = severity === 'careerThreatening' ? 0.7 : severity === 'major' ? 0.3 : 0;
    if (Math.random() >= hitChance) return null;

    const physicalPool = ['pace', 'acceleration', 'agility', 'balance', 'stamina', 'jumpingReach'];
    const numAttrsHit = severity === 'careerThreatening' ? 2 + Math.floor(Math.random() * 2) : 1;
    const hitAttrs = [];
    for (let i = 0; i < numAttrsHit; i++) {
        const attr = physicalPool[Math.floor(Math.random() * physicalPool.length)];
        const drop = 1 + Math.floor(Math.random() * (severity === 'careerThreatening' ? 4 : 3));
        player.attrs[attr] = clamp(player.attrs[attr] - drop, 1, 20);
        hitAttrs.push({ attr, drop });
    }
    return hitAttrs;
}

export function weeklyInjuryCheck(player, context = {}, seasonWeek = { season: 1, week: 1 }) {
    if (player.isInjured) return { injured: false, alreadyOut: true };

    const risk = computeWeeklyInjuryRisk(player, context);
    if (Math.random() >= risk) {
        return { injured: false, risk };
    }

    const severity = rollSeverity(player);
    const days = rollDuration(severity, player);
    const permanentHit = maybeApplyPermanentDamage(player, severity);

    player.isInjured = true;
    player.injuryWeeksRemaining = Math.ceil(days / 7);
    player.injuryHistory.push({
        season: seasonWeek.season, week: seasonWeek.week,
        severity, days, permanentHit
    });

    return { injured: true, severity, days, permanentHit, risk };
}

/**
 * Call once per in-game week for every injured player to tick recovery down.
 * Applies a short post-recovery form/sharpness dip once they're back.
 */
export function tickRecovery(player, physioQuality = 0) {
    if (!player.isInjured) return;
    // A good physio can shave recovery time down - roughly a 1-in-4 chance
    // of an extra week knocked off at max physio quality, never guaranteed.
    const extraRecoveryChance = clamp(physioQuality / 20, 0, 1) * 0.25;
    const weeksOff = 1 + (Math.random() < extraRecoveryChance ? 1 : 0);
    player.injuryWeeksRemaining -= weeksOff;
    if (player.injuryWeeksRemaining <= 0) {
        player.isInjured = false;
        player.injuryWeeksRemaining = 0;
        player.fitness = clamp(player.fitness - 4, 4, 20);
        player.sharpness = clamp(player.sharpness - 6, 2, 20);
        player.form = clamp(player.form - 2, 1, 20);
    }
}

export function injuryProfileLabel(player) {
    const count = player.injuryHistory.length;
    const majorCount = player.injuryHistory.filter(i => i.severity === 'major' || i.severity === 'careerThreatening').length;
    if (majorCount >= 2) return 'Chronically Injury-Prone';
    if (count >= 4) return 'Injury Concerns';
    if (count >= 1) return 'Some Injury History';
    return 'Clean Bill of Health';
}
