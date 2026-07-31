/**
 * international.js
 * ---------------------------------------------------------------------------
 * National team duty as a REPORT, not a job. The manager never picks a
 * national squad or sets national-team tactics - the game just recognizes
 * when one of your players is good enough to get called up during a real
 * international break, simulates that player's match(es) individually, and
 * gives you a per-match report: goals, rating, minutes played. This is what
 * a club manager actually experiences re: internationals - losing a player
 * for a week and reading about how they got on.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Real-ish FIFA international window weeks within a 38-week domestic season -
// early Sept, mid-Oct, mid-Nov, late-March are the classic disruption points.
export const INTERNATIONAL_BREAK_WEEKS = [5, 10, 14, 30];

const OPPONENT_NATIONS = ['Argentina', 'Germany', 'Portugal', 'Netherlands', 'Croatia', 'Japan', 'Morocco', 'Uruguay', 'Belgium', 'Senegal'];

/** CA threshold above which a player is a near-automatic call-up; below it, chance scales down. */
function callUpProbability(player) {
    const ca = player.ca || 100;
    if (ca >= 150) return 0.95;
    if (ca >= 130) return 0.55;
    if (ca >= 110) return 0.15;
    return 0.02; // fringe chance - uncapped squad player having a great season
}

/**
 * Decide which of your squad's players get called up this window. Capped at
 * 3 so it stays a squad-management wrinkle, not a full second game.
 */
export function selectCallUps(squad) {
    const eligible = squad.filter(p => !p.isInjured && !p.onLoanAt);
    const called = eligible.filter(p => Math.random() < callUpProbability(p));
    return called
        .sort((a, b) => (b.ca || 0) - (a.ca || 0))
        .slice(0, 3);
}

/**
 * Simulate one player's international appearance. Lightweight single-player
 * model (not a full 22-man match) - minutes, a goal chance for attacking
 * positions, and a rating, using the same attribute-driven shape as the
 * club match engine so results are directionally consistent with the player.
 */
function simulateInternationalMatch(player) {
    const startsChance = clamp(0.4 + (player.ca - 100) / 200, 0.15, 0.9);
    const starts = Math.random() < startsChance;
    const minutesPlayed = starts
        ? (Math.random() < 0.8 ? 90 : 60 + Math.floor(Math.random() * 25))
        : (Math.random() < 0.5 ? 0 : 10 + Math.floor(Math.random() * 30));

    if (minutesPlayed === 0) {
        return { opponent: OPPONENT_NATIONS[Math.floor(Math.random() * OPPONENT_NATIONS.length)], minutesPlayed: 0, goals: 0, rating: null, started: false };
    }

    const attackWeight = { ST: 1.0, LW: 0.7, CM: 0.35, FB: 0.1, CB: 0.05, GK: 0 }[player.position] ?? 0.2;
    const finishing = (player.attrs.finishing || 10) / 20;
    const minuteFactor = minutesPlayed / 90;
    const goalChance = attackWeight * finishing * minuteFactor * 0.5;
    let goals = 0;
    if (Math.random() < goalChance) goals = 1;
    if (goals === 1 && Math.random() < goalChance * 0.3) goals = 2; // rare brace

    const composure = (player.attrs.composure || 10) / 20;
    const consistency = (player.hidden.consistency || 10) / 20;
    const variance = (Math.random() * 2 - 1) * (1 - consistency) * 1.2;
    const rating = clamp(6.0 + goals * 1.0 + (minuteFactor - 0.6) * 0.8 + composure * 0.3 + variance, 1, 10);

    return {
        opponent: OPPONENT_NATIONS[Math.floor(Math.random() * OPPONENT_NATIONS.length)],
        minutesPlayed, goals, rating: +rating.toFixed(1), started: minutesPlayed >= 60
    };
}

/**
 * Run one international window. Call on INTERNATIONAL_BREAK_WEEKS. Mutates
 * called-up players' internationalCaps/internationalHistory/fitness and
 * returns a summary for the news feed.
 */
export function runInternationalWindow(squad, season, week) {
    const calledUp = selectCallUps(squad);
    const reports = [];

    for (const player of calledUp) {
        const result = simulateInternationalMatch(player);
        player.internationalCaps = (player.internationalCaps || 0) + (result.minutesPlayed > 0 ? 1 : 0);
        if (!player.internationalHistory) player.internationalHistory = [];
        player.internationalHistory.push({ season, week, ...result });
        if (player.internationalHistory.length > 40) player.internationalHistory.shift();

        // Travel + a competitive match takes something out of a player even
        // without an injury - modest fitness dip, small extra injury check
        // handled by app.js's normal weekly injury tick reading isFatigued.
        if (result.minutesPlayed > 0) {
            player.fitness = clamp(player.fitness - 2, 4, 20);
            player.isFatigued = true;
        }
        reports.push({ playerName: player.name, ...result });
    }

    return reports;
}

/** Aggregate a player's international record for the profile/report view. */
export function internationalSummary(player) {
    const history = player.internationalHistory || [];
    const caps = player.internationalCaps || 0;
    const goals = history.reduce((s, h) => s + (h.goals || 0), 0);
    const played = history.filter(h => h.minutesPlayed > 0);
    const avgRating = played.length > 0
        ? +(played.reduce((s, h) => s + (h.rating || 0), 0) / played.length).toFixed(2)
        : null;
    return { caps, goals, avgRating, recent: [...history].reverse().slice(0, 8) };
}
