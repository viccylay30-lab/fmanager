/**
 * training.js
 * ---------------------------------------------------------------------------
 * A real training screen instead of development.js running on an invisible
 * flat "normal" intensity every week. The manager picks a weekly focus; that
 * choice feeds two systems that already existed but had no lever attached to
 * them: injuries.js's trainingIntensity, and a per-area attribute nudge on
 * top of development.js's monthly CA roll.
 *
 * Deliberately a trade-off, not a free lunch: sharper focus = faster growth
 * in that area + higher injury risk. Rest lowers both.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const TRAINING_FOCI = {
    balanced: {
        label: 'Balanced', intensity: 'normal', attrGroups: ['technical', 'mental', 'physical'],
        growthMult: 1.0, description: 'Even workload across all areas - no particular edge, no particular risk.'
    },
    attacking: {
        label: 'Attacking Drills', intensity: 'high', attrGroups: ['technical'],
        growthMult: 1.35, description: 'Finishing, dribbling, technique sharpen faster - higher injury load.'
    },
    defensive: {
        label: 'Defensive Shape', intensity: 'high', attrGroups: ['mental'],
        growthMult: 1.3, description: 'Positioning and decision-making sharpen faster - higher injury load.'
    },
    physical: {
        label: 'Physical Conditioning', intensity: 'high', attrGroups: ['physical'],
        growthMult: 1.3, description: 'Pace, stamina, strength improve faster - highest injury load of any focus.'
    },
    setpieces: {
        label: 'Set-Piece Practice', intensity: 'normal', attrGroups: ['technical'],
        growthMult: 1.1, description: 'Crossing, technique, composure get targeted reps - normal injury load.'
    },
    rest: {
        label: 'Rest & Recovery', intensity: 'low', attrGroups: [],
        growthMult: 0.6, description: 'Lighter week. Slower development, but fatigue and injury risk both ease off.'
    }
};

const GROUP_ATTRS = {
    technical: ['finishing', 'passing', 'firstTouch', 'dribbling', 'crossing', 'tackling', 'technique', 'heading'],
    mental: ['decisions', 'anticipation', 'composure', 'vision', 'positioning', 'workRate', 'teamwork', 'leadership', 'offTheBall'],
    physical: ['pace', 'acceleration', 'agility', 'balance', 'stamina', 'strength', 'jumpingReach']
};

export function trainingIntensityFor(focusKey) {
    return (TRAINING_FOCI[focusKey] || TRAINING_FOCI.balanced).intensity;
}

/**
 * Small weekly chance of a direct +1 attribute nudge in the focus area,
 * separate from (and additive to) development.js's monthly CA roll - this
 * is what makes the choice of focus visibly matter attribute-by-attribute,
 * not just as a hidden growth-rate multiplier.
 */
export function applyWeeklyTrainingNudge(player, focusKey, coachingQuality = 12) {
    const focus = TRAINING_FOCI[focusKey] || TRAINING_FOCI.balanced;
    if (focus.attrGroups.length === 0) return null;
    const chance = 0.015 * focus.growthMult * (0.6 + coachingQuality / 20 * 0.6);
    if (Math.random() >= chance) return null;

    const group = focus.attrGroups[Math.floor(Math.random() * focus.attrGroups.length)];
    const pool = GROUP_ATTRS[group];
    const attr = pool[Math.floor(Math.random() * pool.length)];
    if (player.attrs[attr] >= 20) return null;
    player.attrs[attr] = clamp(player.attrs[attr] + 1, 1, 20);
    return { attr, group };
}

/** Growth multiplier to feed into development.js's monthly roll as an extra factor. */
export function developmentGrowthMultiplier(focusKey) {
    return (TRAINING_FOCI[focusKey] || TRAINING_FOCI.balanced).growthMult;
}
