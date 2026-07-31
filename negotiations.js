/**
 * negotiations.js
 * ---------------------------------------------------------------------------
 * contracts.js's automatic tickContract() still exists as the end-of-season
 * fallback for anyone the manager never engaged with - but now the manager
 * gets a real say first. When a player enters their final contract year,
 * the manager can table a concrete offer (length + wage multiplier vs their
 * current market-rate wage); the player's hidden loyalty/ambition and how
 * the offer compares to their market value decide whether they sign.
 * ---------------------------------------------------------------------------
 */

import { computeWeeklyWage } from './finances.js';
import { startNegotiation } from './negotiation-engine.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Open real wage talks - an iterative haggle (see negotiation-engine.js)
 * instead of a single take-it-or-leave-it offer. Used for both your own
 * players' renewals and approaching a rival's player. The player's ideal
 * wage and how stubborn they are both come from the same hidden
 * loyalty/ambition traits (and, for a rival approach, a prestige delta
 * between your club and theirs) that drove the old one-shot functions -
 * this is the same underlying model, just negotiable round-by-round now.
 */
export function startWageTalks(player, { forRivalPoach = false, rivalClub = null, myClubContext = null } = {}) {
    const h = player.hidden;
    const currentWage = computeWeeklyWage(player);
    let demandMultiplier = 1.0 + (h.ambition - 10) * 0.02 + (Math.random() * 0.16 - 0.08);
    let toughness = clamp((h.ambition + (20 - h.loyalty)) / 40, 0.2, 0.85);

    if (forRivalPoach) {
        // A bigger club needs to offer less to tempt them; a smaller one has
        // to seriously overpay - same prestige-delta idea as the old
        // proposeRivalPreContract, now shifting the whole negotiation instead
        // of just a single accept/reject roll.
        const yourPrestige = (myClubContext?.division === 1 ? 6 : 2) + (myClubContext?.squadReputation ?? 100) / 20;
        const theirPrestige = (rivalClub?.tier ?? 5) * 1.2;
        const prestigeDelta = clamp((yourPrestige - theirPrestige) * 0.05, -0.6, 0.6);
        demandMultiplier -= prestigeDelta * 0.4;
        toughness = clamp(toughness - prestigeDelta * 0.3, 0.15, 0.9);
    }

    const idealWage = currentWage * clamp(demandMultiplier, 0.85, 1.7);
    const state = startNegotiation(idealWage, toughness);
    state.currentWage = currentWage;
    return state;
}

/**
 * Approach a RIVAL club's player whose contract has entered its final year -
 * a real "pre-contract" move: free of any transfer fee, the player commits
 * now and the move completes the moment their current deal actually expires
 * (handled by rival-ai.js forcing that expiry rather than letting their old
 * club's normal auto-renewal chance apply - a signed pre-contract is
 * binding, the old club doesn't get a say). Same wage-vs-market-rate logic
 * as `proposeRenewal`, plus a prestige delta: moving to a bigger/smaller
 * club (by division and reputation) makes the pitch easier or harder.
 */
export function proposeRivalPreContract(player, rivalClub, offerYears, wageMultiplier, myClubContext) {
    const h = player.hidden;
    const currentWage = computeWeeklyWage(player);
    const offeredWage = currentWage * wageMultiplier;
    const wageSatisfaction = clamp((offeredWage / Math.max(0.001, currentWage) - 1) * 3, -1.2, 1.2);

    // Prestige delta: your division (1 beats 2) and reputation vs their
    // club's tier. A bigger club is an easy sell regardless of wage; a
    // smaller one needs to seriously overpay to convince an ambitious player.
    const yourPrestige = (myClubContext.division === 1 ? 6 : 2) + (myClubContext.squadReputation ?? 100) / 20;
    const theirPrestige = (rivalClub?.tier ?? 5) * 1.2;
    const prestigeDelta = clamp((yourPrestige - theirPrestige) * 0.05, -0.6, 0.6);

    const ambitionPull = (h.ambition - 10) * 0.03 * (prestigeDelta >= 0 ? 1 : -1); // ambitious players chase prestige harder, both ways
    const loyaltyResistance = -(h.loyalty - 10) * 0.035; // loyal players are harder to prise away mid-career, regardless of terms

    const acceptScore = 0.42 + wageSatisfaction * 0.35 + prestigeDelta + ambitionPull + loyaltyResistance + (Math.random() * 0.3 - 0.15);
    const accepted = acceptScore >= 0.45;

    if (accepted) {
        return { accepted: true, offerYears, reason: `${player.name} agrees a pre-contract - he'll join on a free transfer once his current deal expires.` };
    }
    const reason = wageSatisfaction < -0.3
        ? `${player.name} isn't tempted - the wages on offer don't match his current terms.`
        : prestigeDelta < -0.2
            ? `${player.name} isn't interested in a move that looks like a step down right now.`
            : `${player.name} turns down the approach and says he wants to focus on his current club.`;
    return { accepted: false, reason };
}

/** True if this player should be flagged for negotiation this window. */
export function needsContractDecision(player) {
    return (player.contractYearsRemaining ?? 3) <= 1 && !player.onLoanAt;
}

/**
 * Propose a renewal. wageMultiplier: 1.0 = current market-rate wage, 1.2 =
 * a 20% pay rise offer, 0.8 = a cut. Returns { accepted, reason }.
 */
export function proposeRenewal(player, offerYears, wageMultiplier) {
    const h = player.hidden;
    const currentWage = computeWeeklyWage(player);
    const offeredWage = currentWage * wageMultiplier;

    // Players want at least market rate; falling well short of it is the
    // single biggest driver of a rejection, ahead of loyalty.
    const wageSatisfaction = clamp((offeredWage / Math.max(0.001, currentWage) - 1) * 3, -1.2, 1.2);

    const ambitionPenalty = offerYears >= 3 ? (h.ambition - 12) * 0.03 : 0; // ambitious players resist long deals if unsure of project
    const loyaltyBonus = (h.loyalty - 10) * 0.04;
    const ageFactor = player.age >= 30 ? 0.15 : 0; // veterans value a longer deal/security more, easier to please

    const acceptScore = 0.5 + wageSatisfaction * 0.4 + loyaltyBonus - ambitionPenalty + ageFactor + (Math.random() * 0.3 - 0.15);
    const accepted = acceptScore >= 0.45;

    if (accepted) {
        player.contractYearsRemaining = offerYears;
        return { accepted: true, reason: `${player.name} agrees to a new ${offerYears}-year deal.` };
    }
    const reason = wageSatisfaction < -0.3
        ? `${player.name} rejects the offer - wage falls well short of expectations.`
        : `${player.name} rejects the offer and wants time to consider his future.`;
    return { accepted: false, reason };
}
