/**
 * attributes.js
 * ---------------------------------------------------------------------------
 * Football Manager-style player model. Replaces the old single `rating`
 * FIFA-card number with 26 visible attributes (1-20 each), 9 hidden
 * attributes, and derived CA (Current Ability) / PA (Potential Ability)
 * values that are NEVER shown to the user directly.
 *
 * What the UI is allowed to show: a 1-5 star scouting estimate, computed
 * from CA + noise that shrinks as scoutKnowledge for that player increases.
 * ---------------------------------------------------------------------------
 */

// ---- Attribute groups --------------------------------------------------

export const TECHNICAL = [
    'finishing', 'passing', 'firstTouch', 'dribbling',
    'crossing', 'tackling', 'technique', 'heading'
];

export const MENTAL = [
    'decisions', 'anticipation', 'composure', 'vision', 'positioning',
    'workRate', 'determination', 'teamwork', 'leadership', 'offTheBall'
];

export const PHYSICAL = [
    'pace', 'acceleration', 'agility', 'balance',
    'stamina', 'strength', 'jumpingReach'
];

export const HIDDEN = [
    'consistency', 'professionalism', 'ambition', 'loyalty',
    'pressureHandling', 'injuryProneness', 'adaptability',
    'sportsmanship', 'importantMatches',
    'naturalFitness', 'recoveryRate'
];
// Note: "Determination" is intentionally NOT duplicated here - it's already
// a visible Mental attribute (attrs.determination). The development system
// reads it from there so there's a single source of truth for it.

export const ALL_VISIBLE = [...TECHNICAL, ...MENTAL, ...PHYSICAL];

// ---- Position weight profiles ------------------------------------------
// Only the attributes that matter for a position get weight; everything
// else defaults to a small "general ability" trickle so no attribute is
// fully wasted. Weights don't need to sum to 1 — they're normalized at
// calculation time.

export const POSITION_PROFILES = {
    GK: {
        positioning: 3, anticipation: 2.5, agility: 2.5, composure: 2,
        decisions: 2, jumpingReach: 1.5, balance: 1
    },
    CB: {
        tackling: 3, positioning: 3, strength: 2.5, heading: 2.5,
        anticipation: 2, composure: 1.5, jumpingReach: 1.5
    },
    FB: {
        tackling: 2, positioning: 2, pace: 2.5, stamina: 2.5,
        crossing: 2, workRate: 2, decisions: 1.5
    },
    CM: {
        passing: 3, vision: 2.5, decisions: 2.5, teamwork: 2,
        stamina: 2, technique: 1.5, workRate: 1.5
    },
    LW: {
        dribbling: 2.5, pace: 2.5, crossing: 2, technique: 2,
        offTheBall: 2, decisions: 1.5, agility: 1.5
    },
    ST: {
        finishing: 3, composure: 2.5, offTheBall: 2.5, pace: 2,
        decisions: 2, anticipation: 1.5, strength: 1
    }
};

// ---- Random helpers ------------------------------------------------------

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Bounded Gaussian sample, 1-20 attribute scale. */
function attrRoll(mean, spread = 3) {
    // Box-Muller
    const u1 = Math.random(), u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return clamp(Math.round(mean + z * spread), 1, 20);
}

// ---- Player generation ---------------------------------------------------

/**
 * Generate a full attribute set for a player.
 * @param {string} position - one of POSITION_PROFILES keys
 * @param {number} qualityTier - 1 (lower league) to 10 (world class), sets the mean attribute level
 * @param {number} age
 */
export function generatePlayerAttributes(position, qualityTier = 5, age = 24) {
    const baseMean = 6 + qualityTier * 1.3; // tier 1 ~7.3, tier 10 ~19
    const profile = POSITION_PROFILES[position] || POSITION_PROFILES.CM;

    const attrs = {};
    for (const key of ALL_VISIBLE) {
        // Attributes relevant to this position roll higher on average;
        // irrelevant ones roll lower/wider (a striker's tackling is a crapshoot).
        const weight = profile[key] || 0;
        const relevance = weight > 0 ? 1 : 0.6;
        attrs[key] = attrRoll(baseMean * relevance, weight > 0 ? 2.5 : 3.5);
    }

    const hidden = {};
    for (const key of HIDDEN) {
        // Hidden attributes are independent of quality tier — a world class
        // player can still be inconsistent, injury-prone, or fold under pressure.
        hidden[key] = attrRoll(11, 4);
    }

    return { attrs, hidden };
}

/** Weighted CA from a position profile + a hidden-attribute nudge. */
export function computeCA(attrs, hidden, position) {
    const profile = POSITION_PROFILES[position] || POSITION_PROFILES.CM;
    let weightedSum = 0;
    let weightTotal = 0;
    for (const key of ALL_VISIBLE) {
        const w = profile[key] || 0.3; // small trickle weight for "general ability"
        weightedSum += attrs[key] * w;
        weightTotal += w;
    }
    const rawCA = (weightedSum / weightTotal) * 10; // scale to ~roughly 1-200

    // Professionalism slightly lifts effective CA - players who train hard
    // and are disciplined squeeze a bit more out of raw attributes.
    return clamp(Math.round(rawCA * (1 + (hidden.professionalism - 10) / 100)), 1, 200);
}

/**
 * Roll a Potential Ability ceiling. Young players get a wide possible range;
 * PA is fixed at creation and CA grows toward it (or fails to) in development.js.
 */
export function generatePA(currentCA, age) {
    const ageFactor = age <= 21 ? 1.6 : age <= 25 ? 1.15 : 1.0;
    const headroom = attrRoll(30, 20) * ageFactor; // can be small (bust) or huge (wonderkid)
    return clamp(Math.round(currentCA + Math.max(0, headroom)), currentCA, 200);
}

/**
 * Build a complete player object ready to drop into gameState.squad.
 */
export function createPlayer({ id, name, position, age, qualityTier = 5, trait = null }) {
    const { attrs, hidden } = generatePlayerAttributes(position, qualityTier, age);
    const ca = computeCA(attrs, hidden, position);
    const pa = generatePA(ca, age);

    return {
        id, name, position, age,
        trait, // kept for compatibility with existing narrative/AI-event code
        attrs,
        hidden,
        ca,             // NEVER render this directly in the UI
        pa,             // NEVER render this directly in the UI
        scoutKnowledge: qualityTier <= 3 ? 70 : 25, // your own academy/lower-tier players are better known
        form: 10,       // 1-20 rolling short-term form, separate from attributes
        morale: 14,
        fitness: 18,
        sharpness: 12,  // match sharpness, distinct from fitness - builds with minutes played
        isFatigued: false,

        // --- Injury system (injuries.js) ---
        isInjured: false,
        injuryWeeksRemaining: 0,
        injuryHistory: [],       // [{ season, week, severity, days, permanentHit }]
        recentMatchLoad: 0,      // rolling count of matches played in last ~4 weeks

        // --- Development system (development.js) ---
        monthsAtClub: 0,
        recentMinutes: 0,        // minutes played this "month" tick, resets after development roll
        appearances: 0,
        internationalCaps: 0,
        contractYearsRemaining: 1 + Math.floor(Math.random() * 4), // 1-4 years, staggered like a real squad
        marketValue: null,       // computed lazily by development.js on first call
        developmentLog: []       // [{ month, caBefore, caAfter, note }]
    };
}

// ---- Scouting: what the user actually sees --------------------------------

/**
 * Convert CA into a 1-5 star display rating, distorted by how well-scouted
 * the player is. Low scoutKnowledge = wide, unreliable noise band; a fully
 * scouted (100) player's stars reflect CA almost exactly.
 */
export function scoutedStarRating(ca, scoutKnowledge = 25) {
    const noiseRange = (100 - clamp(scoutKnowledge, 0, 100)) / 100; // 0 (perfect) to 1 (blind)
    const noise = (Math.random() * 2 - 1) * noiseRange * 60; // up to +/-60 CA points of error when unscouted
    const perceivedCA = clamp(ca + noise, 1, 200);
    const stars = clamp(Math.round((perceivedCA / 200) * 5 * 2) / 2, 0.5, 5); // half-star granularity
    return stars;
}

/**
 * A short scouting report string using bands rather than exact numbers -
 * this is the FM-style "what your scouts think" text, not ground truth.
 */
export function scoutingReport(player) {
    const stars = scoutedStarRating(player.ca, player.scoutKnowledge);
    const confidence = player.scoutKnowledge >= 70 ? 'High' : player.scoutKnowledge >= 35 ? 'Moderate' : 'Low';
    const band = stars >= 4.5 ? 'World Class Potential' :
                 stars >= 3.5 ? 'Quality First-Teamer' :
                 stars >= 2.5 ? 'Squad Player' :
                 stars >= 1.5 ? 'Fringe / Depth' : 'Unproven';
    return { stars, confidence, band };
}
