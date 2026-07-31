/**
 * youth.js
 * ---------------------------------------------------------------------------
 * Annual youth intake. Better facilities/coaching don't just make your
 * current squad develop faster (development.js already does that) - they
 * also raise the floor and ceiling of who your academy actually produces,
 * same as a real club's academy reputation compounding over years.
 * ---------------------------------------------------------------------------
 */

import { createPlayer } from './attributes.js';

const YOUTH_FIRST_NAMES = ['Archie', 'Kai', 'Bilal', 'Leo', 'Junior', 'Otis', 'Zion', 'Reggie', 'Ashton', 'Malik', 'Corey', 'Finn', 'Yannick', 'Idris', 'Beni'];
const YOUTH_LAST_NAMES = ['Broome', 'Sarpong', 'Villar', 'Duke', 'Onyango', 'Mackay', 'Frimpong', 'Solano', 'Whitlock', 'Ekwueme', 'Carden', 'Njie', 'Ristic', 'Falade', 'Grewal'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * Roll this season's academy intake. Call once at season rollover.
 * @param {number} facilities 1-20
 * @param {number} coachingQuality 1-20
 * @returns array of fresh 15-17 year old players (not yet part of the first-team squad)
 */
export function generateYouthIntake(facilities = 12, coachingQuality = 12, idSeed = Date.now()) {
    const academyStrength = (facilities + coachingQuality) / 2; // 1-20
    const intakeSize = 2 + Math.floor(academyStrength / 5); // weak academy: 2-3, elite: 6

    const positions = ['GK', 'CB', 'FB', 'CM', 'LW', 'ST'];
    const prospects = [];
    for (let i = 0; i < intakeSize; i++) {
        // Quality tier centers on academy strength but with wide variance -
        // even a great academy mostly produces squad players, occasionally a gem.
        const roll = Math.random();
        let qualityTier;
        if (roll < 0.05 + academyStrength * 0.003) {
            qualityTier = clamp(6 + Math.round(academyStrength / 5), 5, 10); // rare gem
        } else {
            qualityTier = clamp(2 + Math.round(academyStrength / 6) + (Math.random() < 0.5 ? 0 : -1), 1, 7);
        }
        const age = 15 + Math.floor(Math.random() * 3); // 15-17
        const name = `${pick(YOUTH_FIRST_NAMES)} ${pick(YOUTH_LAST_NAMES)}`;
        const p = createPlayer({ id: `youth-${idSeed}-${i}`, name, age, position: pick(positions), qualityTier });
        // Youngsters have high PA variance already baked into createPlayer's generatePA
        // age factor; scouting knowledge starts low - your own academy but still unproven.
        p.scoutKnowledge = 40 + Math.floor(Math.random() * 20);
        p.isYouthProspect = true;
        prospects.push(p);
    }
    return prospects;
}

/** Promote a youth prospect into the first-team squad. Returns the player, or null if not found. */
export function promoteYouthPlayer(youthSquad, squad, playerId) {
    const idx = youthSquad.findIndex(p => p.id === playerId);
    if (idx === -1) return null;
    const [player] = youthSquad.splice(idx, 1);
    player.isYouthProspect = false;
    player.scoutKnowledge = 95; // fully known once in the first-team fold
    squad.push(player);
    return player;
}
