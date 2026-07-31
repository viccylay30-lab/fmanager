/**
 * loans.js
 * ---------------------------------------------------------------------------
 * Smaller rival clubs specifically request loans of your young or fringe
 * players - a gentler, no-fee pathway distinct from a permanent transfer bid.
 * While on loan, a player is unavailable for your own fixtures but keeps
 * developing (regular first-team football elsewhere is exactly how loans
 * are used to develop young players in real football).
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rivalAvgCA(rival) {
    return rival.squad.reduce((s, p) => s + (p.ca || 100), 0) / rival.squad.length;
}

const LOAN_ELIGIBLE_MAX_AGE = 21;
const LOAN_ELIGIBLE_MAX_APPEARANCES = 15; // fringe players too, not just teenagers

/**
 * Roll for new incoming loan requests. Only smaller/mid clubs request loans -
 * a top rival signs players outright, not on loan, for a young talent.
 */
export function generateLoanRequests(gameState, windowType) {
    if (!windowType) return [];
    const requests = [];

    // Sort rivals so the "smaller half" of the division is loan-request eligible.
    const sortedByStrength = [...gameState.rivals].sort((a, b) => rivalAvgCA(a) - rivalAvgCA(b));
    const smallerHalf = sortedByStrength.slice(0, Math.ceil(sortedByStrength.length / 2));

    for (const rival of smallerHalf) {
        for (const player of gameState.squad) {
            if (player.isInjured || player.onLoanAt) continue;
            const eligible = player.age <= LOAN_ELIGIBLE_MAX_AGE || (player.appearances || 0) <= LOAN_ELIGIBLE_MAX_APPEARANCES;
            if (!eligible) continue;

            if (Math.random() > 0.02) continue;

            requests.push({
                id: `loan-${rival.id}-${player.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                rivalName: rival.name,
                rivalId: rival.id,
                playerId: player.id,
                playerName: player.name,
                durationWeeks: [19, 38][Math.floor(Math.random() * 2)], // half-season or season-long
                status: 'pending'
            });
        }
    }
    return requests;
}

/** Send a player out on loan - development.js continues to run on them normally. */
export function sendOnLoan(player, request, currentWeek) {
    player.onLoanAt = request.rivalName;
    player.loanReturnWeek = currentWeek + request.durationWeeks;
    // A young player getting regular men's football is a professionalism/confidence
    // boost - reflected as a small morale bump, distinct from CA growth itself.
    player.morale = clamp(player.morale + 2, 1, 20);
}

/** Weekly tick for anyone out on loan: simulated minutes feed their development. */
export function tickLoanedPlayer(player) {
    if (!player.onLoanAt) return;
    player.recentMinutes = (player.recentMinutes || 0) + 75; // regular game-time at a smaller club, slightly fewer minutes than a guaranteed starter
    player.appearances = (player.appearances || 0) + 1;
}

/** Check if a loan spell has ended and bring the player home. */
export function checkLoanReturn(player, currentWeek) {
    if (player.onLoanAt && currentWeek >= player.loanReturnWeek) {
        const club = player.onLoanAt;
        player.onLoanAt = null;
        player.loanReturnWeek = null;
        return club;
    }
    return null;
}
