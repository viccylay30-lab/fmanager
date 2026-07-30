/**
 * europe.js
 * ---------------------------------------------------------------------------
 * Replaces the old cosmetic "UEL Matchday X/8" ticker with a real qualification
 * check and an 8-team knockout bracket that actually simulates matches via
 * match-engine.js. Only Division 1 clubs qualify - Division 2 has no
 * European route, same as real football's tiered access.
 * ---------------------------------------------------------------------------
 */

import { createPlayer } from './attributes.js';
import { simulateMatch } from './match-engine.js';
import { applyMatchStatsToPlayers } from './career.js';

/** Called once at season rollover with the club's FINAL league position. */
export function checkQualification(finalPosition, division) {
    if (division !== 1) return null;
    if (finalPosition <= 4) return 'Champions League';
    if (finalPosition <= 6) return 'Europa League';
    return null;
}

const EURO_CLUB_NAMES = ['Nordic Athletic', 'Iberian Sporting', 'Rhineland FC', 'Adriatic United', 'Danube City', 'Alpine Rovers', 'Baltic Town'];

function generateEuroOpponent(name) {
    const positions = ['GK', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'LW', 'ST', 'ST'];
    const tier = 4 + Math.floor(Math.random() * 6); // 4-9, continental sides skew stronger
    const squad = positions.map((pos, i) => createPlayer({
        id: `${name}-${i}`, name: `${name.split(' ')[0]} ${pos}${i}`, position: pos,
        age: 21 + Math.floor(Math.random() * 12), qualityTier: tier
    }));
    return {
        id: name, name, squad,
        tactic: ['possession', 'counter', 'press', 'defensive'][Math.floor(Math.random() * 4)],
        chemistry: 60 + Math.random() * 30, tacticalFamiliarity: 55 + Math.random() * 35,
        managerQuality: 50 + Math.random() * 40, seasonFactor: 0.9 + Math.random() * 0.2
    };
}

/** Build a fresh 8-team knockout bracket with your club in slot 0. */
export function generateEuropeanBracket(competitionName) {
    const opponents = EURO_CLUB_NAMES.slice(0, 7).map(generateEuroOpponent);
    return {
        competition: competitionName,
        stage: 'Round of 8',
        opponents,          // remaining un-played opponents pool for future rounds
        currentOpponent: opponents[0],
        eliminated: false,
        champion: false
    };
}

const STAGE_ORDER = ['Round of 8', 'Quarter-Final', 'Semi-Final', 'Final'];

/**
 * Play the next bracket fixture. Call this on Europe match weeks (existing
 * 4-week cadence in app.js). Returns the match result plus updated bracket
 * status so app.js can surface a news event.
 */
export function playBracketFixture(bracket, yourClub, weather) {
    if (bracket.eliminated || bracket.champion) return null;

    const result = simulateMatch({ home: yourClub, away: bracket.currentOpponent, weather, isBigMatch: true });
    applyMatchStatsToPlayers(result, yourClub.squad, bracket.currentOpponent.squad);
    const youWon = result.winner === yourClub.name;

    if (!youWon) {
        bracket.eliminated = true;
        return { result, headline: `Eliminated from the ${bracket.competition} by ${bracket.currentOpponent.name} (${bracket.stage})` };
    }

    const stageIdx = STAGE_ORDER.indexOf(bracket.stage);
    if (stageIdx === STAGE_ORDER.length - 1) {
        bracket.champion = true;
        return { result, headline: `CHAMPIONS! You've won the ${bracket.competition}!` };
    }

    bracket.stage = STAGE_ORDER[stageIdx + 1];
    bracket.opponents = bracket.opponents.slice(1);
    bracket.currentOpponent = bracket.opponents[0] || generateEuroOpponent('Wildcard FC');
    return { result, headline: `Through to the ${bracket.stage} of the ${bracket.competition}!` };
}
