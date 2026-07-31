/**
 * formations.js
 * ---------------------------------------------------------------------------
 * Real formations and a real Starting XI, replacing "the whole 21-man squad
 * counts as the team" with an actual 11-player selection built from formation
 * slots. This is what makes substitutions and bench management mean anything
 * - there has to be a bench for there to be a substitute.
 *
 * Each formation is a slot list (position group + a "line" for display) plus
 * a shape modifier that nudges attack/defense/creativity - a back five is
 * sturdier than it is threatening, and a front three is the reverse.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const FORMATIONS = {
    '4-4-2': {
        label: '4-4-2', slots: ['GK', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'LW', 'LW', 'ST', 'ST'],
        shapeMod: { attack: 1.0, defense: 1.0, creativity: 0.98 }
    },
    '4-3-3': {
        label: '4-3-3', slots: ['GK', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'CM', 'LW', 'LW', 'ST'],
        shapeMod: { attack: 1.08, defense: 0.95, creativity: 1.05 }
    },
    '4-2-3-1': {
        label: '4-2-3-1', slots: ['GK', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'LW', 'LW', 'CM', 'ST'],
        shapeMod: { attack: 1.03, defense: 1.0, creativity: 1.08 }
    },
    '3-5-2': {
        label: '3-5-2', slots: ['GK', 'CB', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'CM', 'ST', 'ST'],
        shapeMod: { attack: 1.02, defense: 1.05, creativity: 1.0 }
    },
    '5-3-2': {
        label: '5-3-2', slots: ['GK', 'CB', 'CB', 'CB', 'FB', 'FB', 'CM', 'CM', 'CM', 'ST', 'ST'],
        shapeMod: { attack: 0.9, defense: 1.15, creativity: 0.92 }
    }
};

/** CA-ish score for how well a player fits a slot position (exact match wins, adjacent positions get partial credit). */
const POSITION_ADJACENCY = {
    GK: { GK: 1.0 },
    CB: { CB: 1.0, FB: 0.5 },
    FB: { FB: 1.0, CB: 0.55, LW: 0.4 },
    CM: { CM: 1.0, LW: 0.45, ST: 0.35 },
    LW: { LW: 1.0, CM: 0.5, ST: 0.5 },
    ST: { ST: 1.0, LW: 0.55, CM: 0.3 }
};

function fitScore(player, slotPosition) {
    const adj = POSITION_ADJACENCY[slotPosition]?.[player.position] ?? 0.15;
    const conditionPenalty = player.isInjured ? -9999 : player.onLoanAt ? -9999 :
        (player.isFatigued ? 0.85 : 1.0) * (player.fitness / 20);
    return (player.ca || 100) * adj * conditionPenalty;
}

/**
 * Pick the best-fit Starting XI for a given formation from an available squad.
 * Greedy slot-by-slot assignment (best remaining player per slot) - not
 * globally optimal, but good enough and fast, and it's how a manager
 * actually thinks about a teamsheet (fill the most specific slots first).
 * @returns { startingXI: [player...], bench: [player...] }
 */
export function selectStartingXI(squad, formationKey = '4-3-3') {
    const formation = FORMATIONS[formationKey] || FORMATIONS['4-3-3'];
    const available = squad.filter(p => !p.isInjured && !p.onLoanAt);
    const used = new Set();
    const startingXI = [];

    // Fill scarcest slot types first (GK has least depth pressure but must be filled;
    // sort slots so duplicate-heavy lines get first pick of the deepest pool).
    const slotsSorted = [...formation.slots];
    for (const slotPos of slotsSorted) {
        let best = null, bestScore = -Infinity;
        for (const p of available) {
            if (used.has(p.id)) continue;
            const score = fitScore(p, slotPos);
            if (score > bestScore) { bestScore = score; best = p; }
        }
        if (best) { used.add(best.id); startingXI.push(best); }
    }

    const bench = available.filter(p => !used.has(p.id))
        .sort((a, b) => (b.ca || 0) - (a.ca || 0))
        .slice(0, 7); // 7-man bench, realistic squad-matchday size

    return { startingXI, bench, formationKey };
}

/**
 * Apply a substitution: swap `outPlayer` out of the XI for `inPlayer` from
 * the bench. Returns new { startingXI, bench } - doesn't mutate in place so
 * callers can diff before/after for a "sub made" news line.
 */
export function applySubstitution(startingXI, bench, outPlayerId, inPlayerId) {
    const outIdx = startingXI.findIndex(p => p.id === outPlayerId);
    const inIdx = bench.findIndex(p => p.id === inPlayerId);
    if (outIdx === -1 || inIdx === -1) return { startingXI, bench };
    const newXI = [...startingXI];
    const newBench = [...bench];
    const [outPlayer] = newXI.splice(outIdx, 1, newBench[inIdx]);
    newBench.splice(inIdx, 1, outPlayer);
    return { startingXI: newXI, bench: newBench };
}

/**
 * Pick set-piece specialists from a starting XI: best crosser/finisher for
 * corners, best technique+finishing for free kicks, best composure+finishing
 * for penalties. Returns names for display; the actual match-engine bonus is
 * a small flat attack multiplier if a genuine outlier specialist exists.
 */
export function pickSetPieceTakers(startingXI) {
    const outfield = startingXI.filter(p => p.position !== 'GK');
    if (outfield.length === 0) return null;
    const best = (scoreFn) => outfield.reduce((a, b) => (scoreFn(b) > scoreFn(a) ? b : a), outfield[0]);
    const corners = best(p => (p.attrs.crossing || 0) * 0.6 + (p.attrs.technique || 0) * 0.4);
    const freeKicks = best(p => (p.attrs.technique || 0) * 0.5 + (p.attrs.finishing || 0) * 0.5);
    const penalties = best(p => (p.attrs.composure || 0) * 0.6 + (p.attrs.finishing || 0) * 0.4);
    return { corners: corners.name, freeKicks: freeKicks.name, penalties: penalties.name };
}

/** Small match-engine bonus for having genuine set-piece outliers (attr 17+) rather than a generic taker. */
export function setPieceBonus(startingXI) {
    const takers = pickSetPieceTakers(startingXI);
    if (!takers) return 1.0;
    const specialistCount = startingXI.filter(p =>
        p.name === takers.corners || p.name === takers.freeKicks || p.name === takers.penalties
    ).filter(p => Math.max(p.attrs.crossing || 0, p.attrs.technique || 0, p.attrs.finishing || 0) >= 17).length;
    return clamp(1.0 + specialistCount * 0.015, 1.0, 1.045); // small, deliberately modest edge
}
