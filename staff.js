/**
 * staff.js
 * ---------------------------------------------------------------------------
 * Backroom staff beyond the manager. Each role has a real mechanical hook
 * elsewhere in the codebase rather than being a cosmetic hire:
 *   - Coach:    lifts effective coachingQuality (development.js growth speed)
 *   - Physio:   lowers injury risk and shortens recovery (injuries.js)
 *   - Scout:    raises scoutKnowledge gain and market-find quality
 *   - Assistant Manager: small managerQuality bump + a pre-match opposition tip
 * ---------------------------------------------------------------------------
 */

const STAFF_FIRST_NAMES = ['Gerard', 'Ian', 'Patrice', 'Nuno', 'Sean', 'Colm', 'Didier', 'Ravi', 'Erik', 'Tomasz', 'Owen', 'Femi'];
const STAFF_LAST_NAMES = ['Whitmore', 'Blackwell', 'Nkemdirim', 'Souza', 'Callaghan', 'Baptiste', 'Krol', 'Sharma', 'Halvorsen', 'Wojcik', 'Bramwell', 'Odejayi'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const STAFF_ROLES = {
    assistantManager: { label: 'Assistant Manager', max: 1, baseWage: 0.012 },
    coach: { label: 'Coach', max: 2, baseWage: 0.008 },
    physio: { label: 'Physio', max: 1, baseWage: 0.007 },
    scout: { label: 'Scout', max: 3, baseWage: 0.006 }
};

/** Generate a pool of candidates for a role, priced roughly by quality. */
export function generateStaffCandidates(role, count = 3) {
    const candidates = [];
    for (let i = 0; i < count; i++) {
        const quality = 4 + Math.floor(Math.random() * 16); // 4-19
        const name = `${pick(STAFF_FIRST_NAMES)} ${pick(STAFF_LAST_NAMES)}`;
        const wage = Math.round((STAFF_ROLES[role].baseWage * (0.5 + quality / 20 * 1.3)) * 1000) / 1000;
        candidates.push({ id: `staff-${role}-${Date.now()}-${i}`, role, name, quality, wage });
    }
    return candidates.sort((a, b) => b.quality - a.quality);
}

/** Total weekly wage bill for currently-hired staff, to feed into finances.js. */
export function computeStaffWageBill(staff) {
    if (!staff) return 0;
    let total = 0;
    if (staff.assistantManager) total += staff.assistantManager.wage;
    (staff.coaches || []).forEach(s => total += s.wage);
    if (staff.physio) total += staff.physio.wage;
    (staff.scouts || []).forEach(s => total += s.wage);
    return total;
}

/** Effective coaching quality: base club value lifted by hired coaches. */
export function effectiveCoachingQuality(baseCoachingQuality, staff) {
    const coaches = staff?.coaches || [];
    if (coaches.length === 0) return baseCoachingQuality;
    const bonus = coaches.reduce((s, c) => s + c.quality, 0) / coaches.length * 0.3;
    return clamp(Math.round(baseCoachingQuality + bonus / 3), 1, 20);
}

/** Physio quality (0 if none hired) - passed into injuries.js as a risk/recovery modifier. */
export function physioQuality(staff) {
    return staff?.physio ? staff.physio.quality : 0;
}

/** Scout quality boost applied to a freshly-scouted player's scoutKnowledge. */
export function scoutKnowledgeBonus(staff) {
    const scouts = staff?.scouts || [];
    if (scouts.length === 0) return 0;
    return Math.round(scouts.reduce((s, c) => s + c.quality, 0) / scouts.length);
}

/** Effective manager quality: base + a modest assistant manager bump. */
export function effectiveManagerQuality(baseManagerQuality, staff) {
    if (!staff?.assistantManager) return baseManagerQuality;
    return clamp(Math.round(baseManagerQuality + staff.assistantManager.quality * 0.4), 1, 100);
}

/** Assistant manager's pre-match scouting tip on the next opponent - flavor text with a real basis (their tactic + top threat). */
export function assistantOppositionTip(staff, opponentTeam) {
    if (!staff?.assistantManager || !opponentTeam) return null;
    const topThreat = [...opponentTeam.squad].filter(p => !p.isInjured)
        .reduce((best, p) => (!best || (p.ca || 0) > (best.ca || 0) ? p : best), null);
    if (!topThreat) return null;
    return `${staff.assistantManager.name}'s notes: watch for ${topThreat.name} (${topThreat.position}) - ` +
        `${opponentTeam.name} typically set up in a ${opponentTeam.tactic} shape.`;
}
