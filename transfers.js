/**
 * transfers.js
 * ---------------------------------------------------------------------------
 * Incoming interest in YOUR players. Only rivals with a realistic chance of
 * landing a given player will bid - a bottom-table club shouldn't be tabling
 * bids for your best striker unless they're one of the bigger clubs in the
 * division. Personal terms can be agreed with the player before your board
 * (the user) decides on the fee - that's the classic "medical booked, fee
 * still not agreed" news story, and it raises the morale stakes of rejecting.
 * ---------------------------------------------------------------------------
 */

import { computeMarketValue } from './development.js';
import { transferActivityMultiplier } from './manager-ai.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rivalAvgCA(rival) {
    return rival.squad.reduce((s, p) => s + (p.ca || 100), 0) / rival.squad.length;
}

/**
 * Roll for new incoming bids. Call this weekly, but it only does anything
 * while a transfer window is open (pass the result of isTransferWindowOpen).
 */
export function generateIncomingBids(gameState, windowType, isDeadline = false) {
    if (!windowType) return [];
    const newBids = [];

    for (const rival of gameState.rivals) {
        const avgCA = rivalAvgCA(rival);
        const rivalBudget = rival.budget ?? (avgCA * 0.6); // rough budget proxy if not tracked explicitly

        for (const player of gameState.squad) {
            if (player.isInjured) continue; // clubs don't chase injured players mid-recovery
            if (player.onLoanAt) continue; // can't buy a player who's out on loan elsewhere until the loan ends
            if ((player.contractYearsRemaining ?? 3) <= 0) continue; // already handled as a free elsewhere

            // Realistic targeting: a rival will only seriously come in for a player
            // whose CA isn't too far above their own squad's level - UNLESS the
            // rival is genuinely one of the strongest clubs in the division.
            const reachGap = player.ca - avgCA;
            const isReachable = reachGap <= 20 || avgCA >= 140; // big clubs can reach further

            const value = computeMarketValue(player);
            const canAfford = rivalBudget >= value * 0.7; // lowball bids still happen even if slightly short

            if (!isReachable || !canAfford) continue;

            // Base weekly probability, scaled by the rival's transfer-aggression
            // trait, and roughly tripled in the final week of a window - real
            // deadline day activity is a genuine spike, not a flat rate.
            const activityMult = rival.managerProfile ? transferActivityMultiplier(rival.managerProfile) : 1.0;
            const deadlineMult = isDeadline ? 3.0 : 1.0;
            if (Math.random() > 0.045 * activityMult * deadlineMult) continue;

            const offerAmount = Math.round(value * (0.75 + Math.random() * 0.5) * 10) / 10;

            // Personal terms: rolled independently, influenced by the player's
            // ambition (wants a bigger stage) vs loyalty (wants to stay) and how
            // much bigger the suitor is than your own club's reputation.
            const h = player.hidden;
            const stepUp = avgCA - (gameState.squadReputation ?? 100);
            const personalTermsChance = clamp(
                0.15 + (h.ambition - 10) * 0.02 - (h.loyalty - 10) * 0.015 + clamp(stepUp, -20, 20) * 0.004,
                0.03, 0.6
            );
            const personalTermsAgreed = Math.random() < personalTermsChance;

            newBids.push({
                id: `bid-${rival.id}-${player.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                rivalName: rival.name,
                rivalId: rival.id,
                playerId: player.id,
                playerName: player.name,
                offerAmount,
                marketValue: value,
                rivalBudget,
                personalTermsAgreed,
                status: 'pending'
            });
        }
    }
    return newBids;
}

/**
 * Counter a bid with a higher asking price. The rival accepts if the new
 * amount is still within their budget and not absurdly above market value;
 * otherwise they walk away rather than negotiate indefinitely (one counter
 * round, not an open-ended auction - keeps this decisive rather than fiddly).
 */
export function counterBid(bid, counterAmount) {
    const rivalBudget = bid.rivalBudget ?? bid.marketValue * 1.3;
    const withinBudget = counterAmount <= rivalBudget;
    const withinCeiling = counterAmount <= bid.marketValue * 1.5; // won't blow the valuation out of the water
    const accepted = withinBudget && withinCeiling && Math.random() < 0.55; // even a fair counter isn't guaranteed

    return {
        accepted,
        finalAmount: accepted ? counterAmount : null,
        headline: accepted
            ? `${bid.rivalName} accept the improved offer of £${counterAmount}M for ${bid.playerName}`
            : `${bid.rivalName} walk away after their bid for ${bid.playerName} was countered`
    };
}

/**
 * Describe the outcome of a bid decision. Rejecting a bid where personal
 * terms were already agreed is a much bigger deal than a clean rejection -
 * the player already had one foot out the door and the dressing room knows it.
 */
export function describeBidOutcome(bid, accepted) {
    if (accepted) {
        return {
            headline: `${bid.playerName} joins ${bid.rivalName} for £${bid.offerAmount}M`,
            moraleDelta: 0
        };
    }
    return {
        headline: bid.personalTermsAgreed
            ? `${bid.playerName} left frustrated as board rejects ${bid.rivalName} bid despite agreed personal terms`
            : `Board rejects ${bid.rivalName}'s £${bid.offerAmount}M bid for ${bid.playerName}`,
        moraleDelta: bid.personalTermsAgreed ? -4 : -1
    };
}
