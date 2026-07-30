/**
 * match-engine.js
 * ---------------------------------------------------------------------------
 * xG-based match simulation. Replaces "compute one strength number per team,
 * roll two Gaussians for goals" with:
 *
 *   1. Team attacking/defensive strength from position-weighted player attrs
 *   2. Context modifiers: form, morale, fitness, sharpness, chemistry,
 *      tactical familiarity, manager quality, home advantage, weather
 *   3. Tactical matchup modifier (counter beats possession, etc.)
 *   4. Chance generation (how many "big moments" each team gets)
 *   5. Per-chance conversion rolled against the specific attacker's
 *      finishing-relevant attributes, with a luck term
 *
 * This is what creates upsets that feel earned rather than a raw dice roll:
 * a weak team can generate few chances but finish them clinically, or a
 * strong team can dominate territory and still draw a blank.
 * ---------------------------------------------------------------------------
 */

import { POSITION_PROFILES } from './attributes.js';
import { chasingGameBoost } from './manager-ai.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** 1-20 attribute scale -> roughly 0-1 normalized strength. */
function norm(attr) { return clamp(attr / 20, 0.05, 1); }

/**
 * Aggregate a squad's attacking and defensive strength from individual
 * player attributes, weighted by position relevance - not by CA/PA, since
 * those are hidden and match performance should be attribute-driven.
 */
function teamPhaseStrength(squad, phaseAttrs) {
    const onPitch = squad.filter(p => !p.isInjured);
    if (onPitch.length === 0) return 0.3; // skeleton crew penalty

    let total = 0;
    for (const p of onPitch) {
        const profile = POSITION_PROFILES[p.position] || POSITION_PROFILES.CM;
        let playerScore = 0, weightSum = 0;
        for (const attr of phaseAttrs) {
            const w = profile[attr] || 0.5;
            playerScore += norm(p.attrs[attr]) * w;
            weightSum += w;
        }
        const conditionMultiplier =
            (p.form / 20) * 0.3 +
            (p.morale / 20) * 0.2 +
            (p.fitness / 20) * 0.25 +
            (p.sharpness / 20) * 0.15 +
            (p.isFatigued ? 0.7 : 1.0) * 0.1 + 0.9; // fatigue trims rather than craters
        total += (playerScore / weightSum) * clamp(conditionMultiplier, 0.5, 1.3);
    }
    return total / onPitch.length;
}

const ATTACK_ATTRS = ['finishing', 'offTheBall', 'composure', 'dribbling', 'pace'];
const DEFENSE_ATTRS = ['tackling', 'positioning', 'anticipation', 'strength', 'heading'];
const CREATIVITY_ATTRS = ['passing', 'vision', 'decisions', 'crossing', 'technique'];

// Tactical matchup matrix: how style A fares vs style B (multiplier on A's attack).
// This is intentionally simple and easy to extend with more styles later.
const TACTIC_MATCHUPS = {
    counter: { possession: 1.15, counter: 1.0, press: 0.95, defensive: 1.05 },
    possession: { counter: 0.92, possession: 1.0, press: 1.05, defensive: 1.1 },
    press: { possession: 1.08, counter: 1.0, press: 1.0, defensive: 0.95 },
    defensive: { possession: 0.95, counter: 0.98, press: 1.05, defensive: 1.0 }
};

const WEATHER_EFFECTS = {
    clear: { attack: 1.0, stamina: 1.0 },
    rain: { attack: 0.94, stamina: 0.96 },   // slicker ball, more errors
    wind: { attack: 0.92, stamina: 1.0 },    // crossing/long balls suffer
    heat: { attack: 0.97, stamina: 0.88 }    // fatigue bites harder
};

/**
 * Compute a team's effective attack/defense/creativity strength for one match.
 */
export function computeMatchStrength(team, opponentTactic, weather, isHome, manager) {
    const seasonFactor = team.seasonFactor || 1.0; // some teams just run hot/cold for a whole season
    const attack = teamPhaseStrength(team.squad, ATTACK_ATTRS);
    const defense = teamPhaseStrength(team.squad, DEFENSE_ATTRS);
    const creativity = teamPhaseStrength(team.squad, CREATIVITY_ATTRS);

    const tacticMod = (TACTIC_MATCHUPS[team.tactic] || TACTIC_MATCHUPS.possession)[opponentTactic] || 1.0;
    const weatherMod = WEATHER_EFFECTS[weather] || WEATHER_EFFECTS.clear;
    const homeMod = isHome ? 1.06 : 1.0;
    const chemistryMod = 0.9 + (team.chemistry / 100) * 0.2; // chemistry 0-100 -> 0.9-1.1
    const familiarityMod = 0.92 + (team.tacticalFamiliarity / 100) * 0.16; // new tactic = shakier execution
    const managerMod = 0.95 + (manager / 100) * 0.1;

    const effectiveAttack = attack * tacticMod * weatherMod.attack * homeMod *
        chemistryMod * familiarityMod * managerMod;

    // High pressing tires the press team out over 90 mins, modeled as a
    // creativity/defense penalty that scales with how long they've been at it.
    const pressFatiguePenalty = team.tactic === 'press' ? (1 - weatherMod.stamina) * 0.15 : 0;

    return {
        attack: effectiveAttack * seasonFactor,
        defense: (defense * chemistryMod * familiarityMod) * seasonFactor,
        creativity: ((creativity * chemistryMod) - pressFatiguePenalty) * seasonFactor
    };
}

/**
 * Pick which attacker gets credited with a given chance, weighted toward
 * players strong in the relevant attacking attributes (so your striker gets
 * most chances, but a midfielder can poach one occasionally).
 */
function pickChanceTaker(squad) {
    const eligible = squad.filter(p => !p.isInjured && p.position !== 'GK');
    if (eligible.length === 0) return null;
    const weights = eligible.map(p => {
        const profile = POSITION_PROFILES[p.position] || {};
        const offenseWeight = (profile.finishing || 0.3) + (profile.offTheBall || 0.3) + 0.2;
        return Math.max(0.05, offenseWeight * norm(p.attrs.finishing));
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < eligible.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
}

/**
 * Convert a single chance into a goal or a miss, using the taker's
 * finishing-relevant attributes + hidden attributes (consistency narrows
 * their variance, importantMatches/pressureHandling apply in big games).
 */
function resolveChance(taker, baseQuality, isBigMatch) {
    if (!taker) return false;

    const finishing = norm(taker.attrs.finishing);
    const composure = norm(taker.attrs.composure);
    const offTheBall = norm(taker.attrs.offTheBall);

    let convertChance = baseQuality * (0.55 + finishing * 0.32 + composure * 0.15 + offTheBall * 0.05);

    // Consistency narrows the random swing around a player's true level;
    // an inconsistent player can wildly over/underperform this chance.
    const consistencySpread = (20 - taker.hidden.consistency) / 20 * 0.25;
    convertChance += (Math.random() * 2 - 1) * consistencySpread;

    if (isBigMatch) {
        const pressureFactor = (taker.hidden.pressureHandling + taker.hidden.importantMatches) / 40; // 0-1
        convertChance *= 0.85 + pressureFactor * 0.3; // chokers dip, big-game players rise
    }

    return Math.random() < clamp(convertChance, 0.02, 0.85);
}

/**
 * Pick an assist provider for a goal - weighted toward passing/vision,
 * excludes the scorer and goalkeepers. Not every goal gets an assist
 * (some are solo efforts), matching real football.
 */
function pickAssister(squad, scorerName) {
    if (Math.random() < 0.25) return null; // solo goal, no assist
    const eligible = squad.filter(p => !p.isInjured && p.position !== 'GK' && p.name !== scorerName);
    if (eligible.length === 0) return null;
    const weights = eligible.map(p => norm(p.attrs.passing) + norm(p.attrs.vision));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < eligible.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return eligible[i].name;
    }
    return eligible[eligible.length - 1].name;
}

/**
 * Compute a simple per-match rating (1-10 scale) for every available player
 * on both sides. Not a full minute-by-minute model - built from goals,
 * assists, and team result, with variance scaled by the player's
 * consistency hidden attribute (inconsistent players swing further from
 * their "true" level match to match).
 */
function computeMatchRatings(squad, teamGoals, opponentGoals, goalScorers, assisters) {
    const teamWon = teamGoals > opponentGoals, teamLost = teamGoals < opponentGoals;
    return squad.filter(p => !p.isInjured && !p.onLoanAt).map(p => {
        const goals = goalScorers.filter(n => n === p.name).length;
        const assists = assisters.filter(n => n === p.name).length;
        const resultBonus = teamWon ? 0.25 : teamLost ? -0.2 : 0.05;
        const variance = (Math.random() * 2 - 1) * (1 - p.hidden.consistency / 20) * 0.6;
        const rating = clamp(6.0 + goals * 0.9 + assists * 0.5 + resultBonus + variance, 1, 10);
        return { name: p.name, goals, assists, rating: +rating.toFixed(1) };
    });
}

/**
 * Simulate one match as a chronological sequence of "moments" (abstracted
 * minute windows, not full tick-by-tick) rather than pre-rolling both teams'
 * total chance counts up front. This matters for one reason: a team's
 * chasing-the-game boost needs to know the score AS IT STANDS at that point
 * in the match, not the final score - a team that concedes early plays the
 * next 80 minutes differently than one that concedes in the 89th.
 */
export function simulateMatch({ home, away, weather = 'clear', isBigMatch = false }) {
    const homeStrength = computeMatchStrength(home, away.tactic, weather, true, home.managerQuality);
    const awayStrength = computeMatchStrength(away, home.tactic, weather, false, away.managerQuality);

    const baseHomeChanceRate = clamp(1.9 * (homeStrength.attack + homeStrength.creativity * 0.5) /
        Math.max(0.3, awayStrength.defense), 0.5, 6.5);
    const baseAwayChanceRate = clamp(1.9 * (awayStrength.attack + awayStrength.creativity * 0.5) /
        Math.max(0.3, homeStrength.defense), 0.5, 6.5);

    // Managers without a manager-ai profile (your own club, or any team that
    // doesn't have one attached) get a neutral baseline chasing instinct.
    const homeProfile = home.managerProfile || { aggression: 12 };
    const awayProfile = away.managerProfile || { aggression: 12 };

    const MOMENTS = 24; // abstracted attacking "moments" across 90 minutes - not literal minutes
    let homeGoals = 0, awayGoals = 0;
    let homeXGAccum = 0, awayXGAccum = 0;
    const events = [];

    for (let moment = 0; moment < MOMENTS; moment++) {
        // Chasing-the-game: whichever side is behind RIGHT NOW gets a small
        // temporary boost to their chance rate, scaled by their manager's
        // aggression trait. Recomputed every moment since the score can change.
        const homeChasing = chasingGameBoost(homeProfile, awayGoals - homeGoals);
        const awayChasing = chasingGameBoost(awayProfile, homeGoals - awayGoals);

        const homeMomentRate = (baseHomeChanceRate / MOMENTS) * homeChasing;
        const awayMomentRate = (baseAwayChanceRate / MOMENTS) * awayChasing;
        homeXGAccum += homeMomentRate;
        awayXGAccum += awayMomentRate;

        if (Math.random() < homeMomentRate) {
            const taker = pickChanceTaker(home.squad);
            const baseQuality = 0.3 + Math.random() * 0.4;
            if (resolveChance(taker, baseQuality, isBigMatch)) {
                homeGoals++;
                const assister = taker ? pickAssister(home.squad, taker.name) : null;
                events.push({ team: 'home', type: 'goal', player: taker?.name, assist: assister, moment });
            }
        }
        if (Math.random() < awayMomentRate) {
            const taker = pickChanceTaker(away.squad);
            const baseQuality = 0.3 + Math.random() * 0.4;
            if (resolveChance(taker, baseQuality, isBigMatch)) {
                awayGoals++;
                const assister = taker ? pickAssister(away.squad, taker.name) : null;
                events.push({ team: 'away', type: 'goal', player: taker?.name, assist: assister, moment });
            }
        }
    }

    // Rare chaos event: red card, freak own goal, etc. Kept low-probability
    // and separate from the xG model so it doesn't distort long-run balance,
    // but gives each save small one-off stories.
    if (Math.random() < 0.04) {
        const side = Math.random() < 0.5 ? 'home' : 'away';
        events.push({ team: side, type: 'red_card' });
    }

    const homeScorers = events.filter(e => e.team === 'home' && e.type === 'goal').map(e => e.player);
    const homeAssisters = events.filter(e => e.team === 'home' && e.type === 'goal' && e.assist).map(e => e.assist);
    const awayScorers = events.filter(e => e.team === 'away' && e.type === 'goal').map(e => e.player);
    const awayAssisters = events.filter(e => e.team === 'away' && e.type === 'goal' && e.assist).map(e => e.assist);

    const homeRatings = computeMatchRatings(home.squad, homeGoals, awayGoals, homeScorers, homeAssisters);
    const awayRatings = computeMatchRatings(away.squad, awayGoals, homeGoals, awayScorers, awayAssisters);
    const playerRatings = [...homeRatings, ...awayRatings];
    const mvp = playerRatings.reduce((best, p) => (!best || p.rating > best.rating ? p : best), null);

    return {
        homeGoals, awayGoals,
        homeXG: +homeXGAccum.toFixed(2),
        awayXG: +awayXGAccum.toFixed(2),
        events,
        playerRatings,
        mvp: mvp ? mvp.name : null,
        winner: homeGoals > awayGoals ? home.name : awayGoals > homeGoals ? away.name : 'Draw'
    };
}
