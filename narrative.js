/**
 * narrative.js
 * ---------------------------------------------------------------------------
 * Reads the current table/results/scorer state and surfaces story flags.
 * Nothing here changes match outcomes - it only notices when the numbers
 * that already happened add up to a story worth telling the manager.
 * ---------------------------------------------------------------------------
 */

/** Keep this in gameState and push each result's outcome ('W'/'D'/'L') onto it. */
export function recordFormLetter(recentForm, letter) {
    recentForm.push(letter);
    if (recentForm.length > 8) recentForm.shift();
    return recentForm;
}

/**
 * Main entry point - call after each round's table update.
 * @returns array of { type, headline, detail } narrative events for this week
 */
export function detectNarratives({ table, week, season, recentForm, goldenBoot, yourSquad, lastMatchWasCupUpset }) {
    const stories = [];
    const sorted = [...table].sort((a, b) =>
        b.points - a.points || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf
    );
    const yourIndex = sorted.findIndex(t => t.id === 'YOU');
    const yourRow = sorted[yourIndex];
    const leader = sorted[0];

    // --- Title race ---
    if (week >= 22 && yourIndex <= 4) {
        const gapToTop = leader.points - yourRow.points;
        if (gapToTop <= 6) {
            stories.push({
                type: 'title_race',
                headline: yourIndex === 0
                    ? `You lead the table with ${38 - week} games to go`
                    : `Title race alive: ${gapToTop} points off top with ${38 - week} to play`,
                detail: `Currently ${ordinal(yourIndex + 1)}, ${yourRow.points} pts.`
            });
        }
    }

    // --- Relegation battle ---
    if (week >= 22 && yourIndex >= sorted.length - 5) {
        const safetyRow = sorted[sorted.length - 4]; // roughly the last "safe" spot in a 20-team table
        const gapToSafety = safetyRow.points - yourRow.points;
        stories.push({
            type: 'relegation_battle',
            headline: gapToSafety <= 0
                ? `Clinging to safety in ${ordinal(yourIndex + 1)}`
                : `Relegation dogfight: ${gapToSafety} points from safety`,
            detail: `${38 - week} games remaining to climb clear.`
        });
    }

    // --- Club crisis: bad run of form ---
    if (recentForm.length >= 5) {
        const lastFive = recentForm.slice(-5);
        const losses = lastFive.filter(r => r === 'L').length;
        if (losses >= 4) {
            stories.push({
                type: 'club_crisis',
                headline: 'Crisis talk grows after miserable run of form',
                detail: `${losses} defeats in the last 5 - pressure mounting on the manager.`
            });
        }
    }

    // --- Giant-killing cup run ---
    if (lastMatchWasCupUpset) {
        stories.push({
            type: 'giant_killing',
            headline: 'Cup shock! Giant-killing run continues',
            detail: 'A result nobody outside the dressing room saw coming.'
        });
    }

    // --- Surprise Golden Boot leader ---
    const scorers = Object.entries(goldenBoot).sort((a, b) => b[1] - a[1]);
    if (scorers.length > 0 && week >= 15) {
        const [topName, topGoals] = scorers[0];
        const isYourPlayer = yourSquad.some(p => p.name === topName);
        if (isYourPlayer) {
            const scorer = yourSquad.find(p => p.name === topName);
            const isSurprise = scorer && scorer.ca < 140; // a squad player, not a superstar, leading the charts
            if (isSurprise) {
                stories.push({
                    type: 'surprise_golden_boot',
                    headline: `${topName} is an unlikely Golden Boot contender`,
                    detail: `${topGoals} goals this season - nobody predicted this at the start of the year.`
                });
            }
        }
    }

    return stories;
}

/** Detect a cup giant-killing after a specific match, based on relative squad strength. */
export function isGiantKilling(yourSquad, opponentSquad, youWon) {
    if (!youWon) return false;
    const avgCA = squad => squad.reduce((s, p) => s + (p.ca || 100), 0) / squad.length;
    const gap = avgCA(opponentSquad) - avgCA(yourSquad);
    return gap > 25; // opponent was meaningfully stronger on paper and still lost
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
