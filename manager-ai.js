/**
 * manager-ai.js
 * ---------------------------------------------------------------------------
 * This is NOT a learning system - it doesn't observe and adapt to a specific
 * opponent's tactics over time (that's a persistent myth about how FM's AI
 * works; SI has directly denied it). It's a rules-and-weights system: each
 * rival manager has a fixed personality profile, and that profile biases
 * which rule fires and how strongly, every time a decision point comes up.
 * Same idea as player hidden attributes, applied to decision-making instead
 * of match performance.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const TACTICS = ['possession', 'counter', 'press', 'defensive'];
const ATTACKING_TACTICS = ['possession', 'press'];

/** Roll a persistent behavioral profile for one AI manager. */
export function generateManagerProfile() {
    return {
        adaptability: 1 + Math.floor(Math.random() * 20),      // will they actually change tactic under pressure?
        aggression: 1 + Math.floor(Math.random() * 20),         // how far they push mentality when chasing a game
        patience: 1 + Math.floor(Math.random() * 20),           // how long a bad run has to get before they react
        transferAggression: 1 + Math.floor(Math.random() * 20)  // how proactively they chase bid targets
    };
}

/**
 * Call after updating a rival's recent form (keep a rolling W/D/L array per
 * rival, same shape as gameState.recentForm). Returns the rival's tactic
 * unchanged, or a new one if their profile decides to react to a bad run.
 */
export function maybeSwitchTactic(rival) {
    const form = rival.recentForm || [];
    if (form.length < 4) return rival.tactic; // not enough signal yet

    const lastFour = form.slice(-4);
    const losses = lastFour.filter(r => r === 'L').length;

    // Patience gates whether a run even counts as "bad enough to react to" -
    // a high-patience manager rides out a slump a low-patience one panics over.
    const badRunThreshold = rival.managerProfile.patience >= 14 ? 3 : rival.managerProfile.patience >= 7 ? 2 : 1;
    if (losses < badRunThreshold) return rival.tactic;

    // Adaptability gates whether they actually DO something about it, even
    // once a bad run is recognized - some managers just stubbornly stick to plan A.
    const willAct = Math.random() * 20 < rival.managerProfile.adaptability;
    if (!willAct) return rival.tactic;

    // High aggression under pressure skews toward a more attacking switch;
    // low aggression retreats defensively instead.
    const pool = rival.managerProfile.aggression >= 12
        ? ATTACKING_TACTICS
        : TACTICS.filter(t => t !== 'possession'); // cautious managers avoid the highest-risk-reward style
    const next = pool[Math.floor(Math.random() * pool.length)];
    return next === rival.tactic ? rival.tactic : next;
}

/**
 * In-match "chasing the game" adjustment - a small, temporary attack boost
 * when an AI-controlled team is behind, scaled by their aggression trait.
 * Pass this back into match-engine.js as a multiplier on top of tactic/season
 * factors; it's intentionally light so it nudges rather than swings games.
 */
export function chasingGameBoost(managerProfile, goalsBehind) {
    if (goalsBehind <= 0) return 1.0;
    const aggressionFactor = managerProfile.aggression / 20; // 0.05 - 1.0
    return 1 + clamp(goalsBehind * 0.04 * aggressionFactor, 0, 0.15);
}

/**
 * Scales how often a rival actually acts on transfer-target eligibility
 * (transfers.js already filters WHO they can realistically target - this
 * decides how often an eligible pairing turns into an actual bid).
 */
export function transferActivityMultiplier(managerProfile) {
    return 0.5 + (managerProfile.transferAggression / 20) * 1.2; // 0.5x - 1.7x
}
