/**
 * career.js
 * ---------------------------------------------------------------------------
 * Turns match-engine.js's per-match playerRatings/mvp output into permanent
 * career history: goals, assists, appearances, average rating, and MVP count
 * per player, per season, per club - closed out and archived at season end
 * so a transfer mid-career still shows correctly under the club they were
 * actually at that year.
 * ---------------------------------------------------------------------------
 */

function ensureSeasonStats(player) {
    if (!player.seasonStats) {
        player.seasonStats = { goals: 0, assists: 0, appearances: 0, ratingSum: 0, ratingCount: 0, mvpCount: 0 };
    }
    return player.seasonStats;
}

/**
 * Call once per match with the result from simulateMatch and the two squads
 * that were actually involved (by reference, so stats land on the real
 * player objects, not copies).
 */
export function applyMatchStatsToPlayers(result, homeSquad, awaySquad) {
    if (!result.playerRatings) return;
    const allSquad = [...homeSquad, ...awaySquad];
    result.playerRatings.forEach(r => {
        const player = allSquad.find(p => p.name === r.name);
        if (!player) return;
        const stats = ensureSeasonStats(player);
        stats.goals += r.goals;
        stats.assists += r.assists;
        stats.appearances += 1;
        stats.ratingSum += r.rating;
        stats.ratingCount += 1;
        if (result.mvp === r.name) stats.mvpCount += 1;
    });
}

/**
 * Close out one player's current season into permanent career history and
 * reset their season counters. Call for every player across every squad at
 * season rollover, passing whichever club they were actually at.
 */
export function closeOutPlayerSeason(player, season, clubName) {
    const stats = player.seasonStats;
    if (!stats || stats.appearances === 0) return; // didn't play this season - no history entry
    if (!player.careerHistory) player.careerHistory = [];
    player.careerHistory.push({
        season, clubName,
        appearances: stats.appearances,
        goals: stats.goals,
        assists: stats.assists,
        avgRating: stats.ratingCount > 0 ? +(stats.ratingSum / stats.ratingCount).toFixed(2) : null,
        mvpCount: stats.mvpCount
    });
    if (player.careerHistory.length > 25) player.careerHistory.shift(); // cap storage for a 30-year save
    player.seasonStats = { goals: 0, assists: 0, appearances: 0, ratingSum: 0, ratingCount: 0, mvpCount: 0 };
}
