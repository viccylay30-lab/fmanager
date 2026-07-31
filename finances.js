/**
 * finances.js
 * ---------------------------------------------------------------------------
 * Replaces "budget is a single number that only moves on transfers" with an
 * actual weekly ledger: wages going out every week whether you win or lose,
 * sponsorship trickling in, and matchday revenue tied to attendance -
 * which itself is driven by reputation and league form, so a relegation
 * fight hurts you financially as well as on the pitch.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Weekly wage for a player, in £M/week, from CA/age/contract leverage - deliberately modest vs transfer fees. */
export function computeWeeklyWage(player) {
    const ca = player.ca || 100;
    const base = 0.0000015 * Math.pow(ca / 20, 4.8); // CA 100 ~ £3.4k/wk, CA 160 ~ £32k/wk, CA 190 ~ £74k/wk
    const ageMult = player.age <= 22 ? 0.75 : player.age >= 32 ? 0.9 : 1.0;
    const leverageMult = (player.contractYearsRemaining ?? 3) <= 1 ? 0.85 : 1.0; // running down a deal = weaker wage demands
    return Math.round(base * ageMult * leverageMult * 1000000) / 1000000;
}

export function computeWeeklyWageBill(squad) {
    return squad.reduce((sum, p) => sum + computeWeeklyWage(p), 0);
}

/** Flat weekly sponsorship income, scaled by club reputation. */
export function computeSponsorIncome(squadReputation = 100) {
    return Math.round((0.05 + squadReputation * 0.0015) * 100) / 100;
}

/**
 * Matchday income for a home fixture, scaled by reputation, current league
 * position (better form draws bigger crowds/hospitality spend) and division.
 */
export function computeMatchdayIncome(squadReputation = 100, leaguePosition = 10, division = 1) {
    const attendanceFactor = clamp(1.3 - (leaguePosition / 20) * 0.5, 0.6, 1.3);
    const divisionMult = division === 1 ? 1.0 : 0.4;
    return Math.round((0.3 + squadReputation * 0.006) * attendanceFactor * divisionMult * 100) / 100;
}

/**
 * Run one week of finances. Call every week regardless of fixtures; pass
 * `isHomeFixtureThisWeek` so matchday income only lands on home weeks.
 * Mutates gameState.budget and returns a ledger entry for the Finances tab.
 */
export function applyWeeklyFinances(gameState, { staffWageBill = 0, isHomeFixtureThisWeek = false } = {}) {
    const wageBill = computeWeeklyWageBill(gameState.squad);
    const sponsor = computeSponsorIncome(gameState.squadReputation);
    const matchday = isHomeFixtureThisWeek
        ? computeMatchdayIncome(gameState.squadReputation, gameState.leaguePosition, gameState.division)
        : 0;

    const income = sponsor + matchday;
    const expense = wageBill + staffWageBill;
    gameState.budget = Math.round((gameState.budget + income - expense) * 100) / 100;

    const entry = {
        season: gameState.season, week: gameState.week,
        wageBill: +wageBill.toFixed(3), staffWageBill: +staffWageBill.toFixed(3),
        sponsor: +sponsor.toFixed(2), matchday: +matchday.toFixed(2),
        net: +(income - expense).toFixed(3), balanceAfter: gameState.budget
    };
    gameState.financeLog = [entry, ...(gameState.financeLog || [])].slice(0, 20);
    return entry;
}
