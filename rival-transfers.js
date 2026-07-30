/**
 * rival-transfers.js
 * ---------------------------------------------------------------------------
 * Makes rival clubs a living, managed squad instead of a static roster.
 * Every season: their contracts expire and get resolved just like yours,
 * gaps left by expiry/injury/sale get filled with a replacement scaled to
 * their budget, and a handful of AI-to-AI transfers happen between clubs
 * with genuine surplus/need - a rival losing a player to injury or to YOU
 * no longer just plays a player short forever.
 * ---------------------------------------------------------------------------
 */

import { createPlayer } from './attributes.js';
import { computeMarketValue } from './development.js';
import { tickContract } from './contracts.js';

const MIN_PER_POSITION = { GK: 2, CB: 2, FB: 2, CM: 2, LW: 1, ST: 2 };

/** Rough signing quality a club can support, derived from its budget. */
function clubQualityTier(club) {
    const budget = club.budget ?? 20;
    return Math.max(2, Math.min(9, Math.round(budget / 6)));
}

/** Tick every squad member's contract; expired players leave the club. */
export function tickRivalSquadContracts(club) {
    const events = [];
    club.squad.forEach(p => {
        const event = tickContract(p);
        if (event) events.push(event);
    });
    club.squad = club.squad.filter(p => p.contractYearsRemaining > 0);
    return events;
}

/** Sign replacements for any position that's dropped below a viable minimum. */
export function fillSquadGaps(club) {
    const signings = [];
    Object.entries(MIN_PER_POSITION).forEach(([position, minCount]) => {
        const current = club.squad.filter(p => p.position === position).length;
        for (let i = current; i < minCount; i++) {
            const tier = clubQualityTier(club);
            const cost = 1 + tier * 0.5;
            if ((club.budget ?? 0) < cost) continue; // can't afford even a cheap replacement this cycle
            const signing = createPlayer({
                id: `${club.id}-repl-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                name: `${club.name.split(' ')[0]} ${position}${Math.floor(Math.random() * 1000)}`,
                position, age: 20 + Math.floor(Math.random() * 10), qualityTier: tier
            });
            club.squad.push(signing);
            club.budget -= cost;
            signings.push(signing.name);
        }
    });
    return signings;
}

/** Modest season-to-season budget top-up (revenue proxy) so clubs can keep operating. */
export function replenishBudget(club) {
    const tier = clubQualityTier(club);
    club.budget = (club.budget ?? 20) + 4 + tier * 1.5;
}

/**
 * A handful of AI-to-AI transfers per window: a buyer with a genuine
 * positional gap looks for a seller with real surplus (above their own
 * minimum) at that position, and can afford the going rate.
 */
export function simulateRivalTransferWindow(clubs, maxTransfers = 4) {
    const events = [];
    const alreadyMoved = new Set();
    let count = 0;
    const shuffled = [...clubs].sort(() => Math.random() - 0.5);

    for (const buyer of shuffled) {
        if (count >= maxTransfers) break;

        const gapPositions = Object.entries(MIN_PER_POSITION)
            .filter(([pos, min]) => buyer.squad.filter(p => p.position === pos).length <= min)
            .map(([pos]) => pos);
        if (gapPositions.length === 0) continue;

        let dealMade = false;
        for (const position of gapPositions) {
            for (const seller of shuffled) {
                if (seller.id === buyer.id) continue;
                const atPosition = seller.squad.filter(p => p.position === position && !alreadyMoved.has(p.id) && !p.onLoanAt && !p.isInjured);
                if (atPosition.length <= MIN_PER_POSITION[position]) continue; // seller needs to keep their own minimum

                const target = atPosition.reduce((worst, p) => (p.ca < worst.ca ? p : worst), atPosition[0]);
                const value = computeMarketValue(target);
                if ((buyer.budget ?? 0) < value * 0.8) continue;

                seller.squad = seller.squad.filter(p => p.id !== target.id);
                buyer.squad.push(target);
                buyer.budget -= value;
                seller.budget = (seller.budget ?? 0) + value;
                alreadyMoved.add(target.id);

                events.push({ headline: `${target.name} joins ${buyer.name} from ${seller.name} for £${value}M` });
                count++;
                dealMade = true;
                break;
            }
            if (dealMade) break;
        }
    }
    return events;
}
