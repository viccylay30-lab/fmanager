/**
 * rival-ai.js
 * ---------------------------------------------------------------------------
 * Keeps rival clubs alive as living squads over many seasons instead of
 * slowly hollowing out. Two jobs, both reusing machinery already built for
 * your own club:
 *   1. Contracts count down and expire for rivals too (contracts.js's
 *      tickContract, completely unchanged - a rival's players were never
 *      actually leaving before, no matter how long a save ran).
 *   2. Whenever a rival's squad drops thin at a position - contract expiry,
 *      or a genuine injury wipeout - the rival scouts and signs a
 *      replacement, scaled to their own tier rather than a flat generic
 *      quality for every club, so a title-chasing side's emergency cover is
 *      visibly better than a relegation-battler's.
 *
 * Deliberately NOT covered here (out of scope for this pass): rival-to-rival
 * transfers, and a rival reacting specifically to losing a player TO you -
 * this codebase's transfer market doesn't currently pull signings out of a
 * rival's actual roster (your "scout market" generates a free-floating
 * candidate, not a player lifted from a rival's squad), so that trigger
 * doesn't exist yet to hook into. The depth-check below still catches the
 * downstream effect generically any time a rival's numbers thin out.
 * ---------------------------------------------------------------------------
 */

import { createPlayer } from './attributes.js';
import { tickContract } from './contracts.js';
import { assignBirthdate } from './calendar.js';

const REPLACEMENT_SURNAME_POOL = [
    'Adeyemi', 'Kowalski', 'Bergstrom', 'Okafor', 'Lindqvist', 'Marchetti',
    'Delacroix', 'Novak', 'Tanaka', 'Silva', 'Haugen', 'Petrov', 'Okonkwo', 'Ferrante'
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** Recover a rough generation-time tier from a club's (static) budget - for saves from before `tier` was stored explicitly on rival objects. */
export function estimateTierFromBudget(budget) {
    return clamp(Math.round(((budget ?? 40) - 10) / 4), 2, 9);
}

/**
 * Contract countdown for one club's whole squad - the exact same
 * tickContract() your own players use. Call once per season, at rollover,
 * same moment as your own squad's tick. Mutates club.squad in place
 * (filters out anyone whose contract expired and wasn't renewed) and
 * returns the events, in case a caller wants to log anything notable.
 */
export function tickRivalContracts(club) {
    const events = [];
    club.squad.forEach(p => {
        if (p.preContractAgreedWith === 'YOU') {
            // Binding - the old club doesn't get a renewal roll on a player
            // who has already committed elsewhere.
            p.contractYearsRemaining = 0;
            events.push({ club: club.name, type: 'pre_contract_departure', player: p.name, headline: `${p.name} leaves on a pre-agreed free transfer` });
            return;
        }
        const event = tickContract(p);
        if (event) events.push({ club: club.name, ...event });
    });
    club.squad = club.squad.filter(p => p.contractYearsRemaining > 0);
    return events;
}

// Raw floor per position before a rival scouts a replacement - deliberately
// looser than your own emergency-signing floor (a rival is allowed to run
// thinner for a while; it's THEIR squad management under the same pressures
// you face, not a state that has to be perfect for the game to function).
const MIN_PER_POSITION = { GK: 2, CB: 3, FB: 3, CM: 3, LW: 2, ST: 2 };
// Fit-and-available floor (excludes injured players) - this is what actually
// catches an injury crisis: a club can look fine on paper (3 CBs) and still
// have zero fit ones during a bad run of luck.
const MIN_FIT_PER_POSITION = { GK: 1, CB: 1, FB: 1, CM: 1, LW: 1, ST: 1 };

/**
 * Check one club's squad depth and sign whatever's needed to cover both the
 * raw floor (typically hit right after contract expiry) and the
 * fit-and-available floor (typically hit after an injury wave). Replacement
 * quality scales with the club's own tier - call this on a monthly cadence
 * during the season (to catch injury crises as they happen) and again right
 * after the contract tick at rollover. `referenceDate` is the current
 * in-game date, used to give the new signing a real birthdate (so they age
 * and develop correctly afterwards, same as every other rival player).
 */
export function maintainRivalDepth(club, referenceDate = new Date()) {
    const tier = club.tier ?? estimateTierFromBudget(club.budget);
    const signings = [];

    Object.keys(MIN_PER_POSITION).forEach(position => {
        const atPosition = club.squad.filter(p => p.position === position);
        const fitAtPosition = atPosition.filter(p => !p.isInjured);

        const rawNeeded = Math.max(0, MIN_PER_POSITION[position] - atPosition.length);
        // Only chase the "fit" floor with a fresh signing if NOBODY at the
        // position is currently available - a single knock doesn't trigger a
        // buy, a full positional wipeout does (same threshold philosophy as
        // your own club's emergency-signing safety net).
        const wipedOut = atPosition.length > 0 && fitAtPosition.length === 0;
        const needed = Math.max(rawNeeded, wipedOut ? 1 : 0);

        for (let i = 0; i < needed; i++) {
            const age = 21 + Math.floor(Math.random() * 10);
            const signing = createPlayer({
                id: `${club.id}-repl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: `${pick(REPLACEMENT_SURNAME_POOL)} ${position}${club.squad.length}`,
                age, position, qualityTier: tier
            });
            signing.scoutKnowledge = 30;
            signing.birthdate = assignBirthdate(age, referenceDate);
            club.squad.push(signing);
            signings.push(signing.name);
        }
    });

    return signings;
}
