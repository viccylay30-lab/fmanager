/**
 * awards.js
 * ---------------------------------------------------------------------------
 * End-of-season "best player" award. Deliberately NOT just "highest average
 * rating" - a star on a title-winning superclub should not automatically
 * win over a very good player who single-handedly dragged a mid-table club
 * above its station. Influence = how much of the team's output was theirs,
 * weighted by how far the team overperformed what its size/budget suggested
 * it should achieve.
 * ---------------------------------------------------------------------------
 */

import { clubTier } from './boardroom.js';

const EXPECTED_POSITION_MAX = { big: 5, mid: 12, small: 20 };

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * @param clubs - array of { name, squad, budget (for clubTier) }
 * @param table - sorted or unsorted table rows { id, name, points, gf, ga }
 * @param minAppearances - ignore small-sample flukes
 */
export function computeSeasonAwards(clubs, table, minAppearances = 12) {
    const sorted = [...table].sort((a, b) =>
        b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
    );

    const candidates = [];

    clubs.forEach(club => {
        const position = sorted.findIndex(t => t.name === club.name) + 1;
        if (position === 0) return; // club not found in this table, skip

        const tier = clubTier(club);
        const expectedMax = EXPECTED_POSITION_MAX[tier];
        const overperformance = clamp(expectedMax - position, -10, 15); // positive = did better than expected

        const teamTotals = club.squad.reduce((acc, p) => {
            const s = p.seasonStats;
            if (s) { acc.goals += s.goals; acc.assists += s.assists; }
            return acc;
        }, { goals: 0, assists: 0 });
        const teamOutput = Math.max(1, teamTotals.goals + teamTotals.assists);

        club.squad.forEach(p => {
            const s = p.seasonStats;
            if (!s || s.appearances < minAppearances) return;

            const contributionShare = (s.goals + s.assists) / teamOutput;
            const avgRating = s.ratingCount > 0 ? s.ratingSum / s.ratingCount : 6.0;

            const influenceScore = (contributionShare * 40) + (avgRating * 3) + (overperformance * 1.5);

            candidates.push({
                name: p.name, club: club.name, position, tier,
                goals: s.goals, assists: s.assists, avgRating: +avgRating.toFixed(2),
                overperformance, influenceScore: +influenceScore.toFixed(2)
            });
        });
    });

    return candidates.sort((a, b) => b.influenceScore - a.influenceScore).slice(0, 10);
}
