/**
 * dynamics.js
 * ---------------------------------------------------------------------------
 * The "emotions" layer, modeled on Football Manager's Dynamics screen. Morale
 * used to be one number nudged by scattered events; this replaces that with:
 *   - Multi-factor Happiness (training, playing time, contract, club fit,
 *     treatment) instead of one dial - `overall` is what feeds morale.
 *   - A Hierarchy (Star Player down to Youngster, plus one Team Leader) so
 *     an unhappy influential player matters more than an unhappy fringe one.
 *   - Team Cohesion / Dressing Room Atmosphere / Managerial Support, weighted
 *     by that hierarchy - the same shape as FM's own overview screen.
 *   - Talk to Player (Praise/Criticize), with real, personality-gated risk of
 *     backfiring rather than a guaranteed morale nudge.
 *   - Real escalation: sustained unhappiness in an influential player builds
 *     toward an actual transfer request, not a stat that just sits there.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const HIERARCHY_TIERS = ['Star Player', 'Key Player', 'Regular Starter', 'Squad Player', 'Fringe Player', 'Youngster'];

const EXPECTED_MINUTES_SHARE = {
    'Star Player': 0.85, 'Key Player': 0.7, 'Regular Starter': 0.55,
    'Squad Player': 0.3, 'Fringe Player': 0.12, 'Youngster': 0.15
};

/**
 * Rank the squad and assign a hierarchy tier to each player based on true
 * ability (CA) relative to the squad and age - a squad's pecking order isn't
 * user-configured, it emerges from who's actually good. Call monthly; it's
 * a slow-moving thing, not a weekly recompute.
 */
export function assignHierarchy(squad) {
    const ranked = [...squad].sort((a, b) => (b.ca || 0) - (a.ca || 0));
    const n = ranked.length;
    ranked.forEach((p, idx) => {
        const percentile = n <= 1 ? 0 : idx / (n - 1); // 0 = best player, 1 = worst
        if (p.age <= 20 && percentile > 0.5) { p.hierarchyStatus = 'Youngster'; return; }
        if (percentile <= 0.08) p.hierarchyStatus = 'Star Player';
        else if (percentile <= 0.25) p.hierarchyStatus = 'Key Player';
        else if (percentile <= 0.55) p.hierarchyStatus = 'Regular Starter';
        else if (percentile <= 0.85) p.hierarchyStatus = 'Squad Player';
        else p.hierarchyStatus = 'Fringe Player';
    });
    // One Team Leader: the highest-leadership player among Key Player-or-better.
    const leaderPool = ranked.filter(p => p.hierarchyStatus === 'Star Player' || p.hierarchyStatus === 'Key Player');
    const leader = leaderPool.reduce((best, p) => (!best || (p.attrs.leadership || 0) > (best.attrs.leadership || 0) ? p : best), null);
    ranked.forEach(p => { p.isTeamLeader = false; });
    if (leader) leader.isTeamLeader = true;
    return ranked;
}

/**
 * Multi-factor happiness. Each factor is 1-20 like every other rating in
 * this game; `overall` is the weighted aggregate that actually feeds morale.
 */
export function computeHappiness(player, context = {}) {
    const { facilities = 10, coachingQuality = 10, clubDivision = 1, clubReputation = 100 } = context;

    // Training: does the setup match a player's own standards - a top talent
    // expects top facilities/coaching, a squad player is easily satisfied.
    const trainingExpectation = 8 + ((player.ca || 100) - 100) / 15;
    const training = clamp(10 + ((facilities + coachingQuality) / 2 - trainingExpectation) * 0.6, 1, 20);

    // Playing time: actual recent minutes share vs what their hierarchy status expects.
    const recentShare = clamp((player.recentMinutes || 0) / (90 * 4), 0, 1); // rough share over ~4 recent matches
    const expectedShare = EXPECTED_MINUTES_SHARE[player.hierarchyStatus] ?? 0.4;
    const playingTime = clamp(10 + (recentShare - expectedShare) * 20, 1, 20);

    // Contract: a fresh deal buys goodwill; entering the final year with no
    // resolution in sight is a real source of anxiety, not just a business fact.
    const yearsRemaining = player.contractYearsRemaining ?? 3;
    const contractHappiness = clamp(13 + (yearsRemaining >= 2 ? 2 : yearsRemaining === 1 ? -3 : -6), 1, 20);

    // Club fit: does this club's level match the player's own self-image -
    // a big talent at a small club is quietly unhappy regardless of treatment.
    const clubPrestige = (clubDivision === 1 ? 12 : 6) + clubReputation / 20;
    const playerSelfImage = 8 + ((player.ca || 100) - 100) / 12;
    const clubFit = clamp(10 + (clubPrestige - playerSelfImage) * 0.5, 1, 20);

    // Treatment: a running tally nudged by Talk to Player interactions and
    // promise-keeping - the one factor directly under the manager's control
    // week to week, same as FM's own design intent.
    const treatment = clamp(player.treatmentScore ?? 12, 1, 20);

    const overall = clamp(
        training * 0.15 + playingTime * 0.3 + contractHappiness * 0.2 + clubFit * 0.15 + treatment * 0.2,
        1, 20
    );

    return {
        training: Math.round(training), playingTime: Math.round(playingTime),
        contract: Math.round(contractHappiness), clubFit: Math.round(clubFit),
        treatment: Math.round(treatment), overall: Math.round(overall)
    };
}

/**
 * Team-wide readings, weighted so influential players' happiness counts for
 * more - the same "a Team Leader's mood spreads faster" idea FM uses.
 */
export function computeTeamDynamics(squad, recentFormWinPct = 0.5) {
    if (squad.length === 0) return { cohesion: 10, dressingRoomAtmosphere: 10, managerialSupport: 10 };

    let weightedSum = 0, weightTotal = 0, plainSum = 0;
    squad.forEach(p => {
        const overall = p.happiness?.overall ?? 12;
        plainSum += overall;
        const weight = p.isTeamLeader ? 3 : p.hierarchyStatus === 'Star Player' ? 2.5 : p.hierarchyStatus === 'Key Player' ? 1.8 : 1;
        weightedSum += overall * weight;
        weightTotal += weight;
    });

    const cohesion = clamp(Math.round(weightedSum / weightTotal), 1, 20);
    const dressingRoomAtmosphere = clamp(Math.round(plainSum / squad.length), 1, 20);
    const managerialSupport = clamp(Math.round(dressingRoomAtmosphere * 0.5 + recentFormWinPct * 20 * 0.5), 1, 20);

    return { cohesion, dressingRoomAtmosphere, managerialSupport };
}

/**
 * Talk to Player: Praise or Criticize. Real risk built in - low-sportsmanship
 * (temperamental) players can react badly to criticism, and low-professionalism
 * players lean on praise/ego-stroking more than genuinely professional ones do.
 */
export function talkToPlayer(player, tone) {
    const professionalism = player.hidden?.professionalism ?? 12;
    const sportsmanship = player.hidden?.sportsmanship ?? 12; // proxy for temperament
    let treatmentDelta, moraleDelta, message;

    if (tone === 'praise') {
        treatmentDelta = 1 + Math.random();
        moraleDelta = professionalism > 13 ? 1 : 2; // less professional players respond more to ego-stroking
        message = `${player.name} appreciates the kind words.`;
    } else {
        const backfireChance = clamp((20 - sportsmanship) / 28, 0.05, 0.55);
        if (Math.random() < backfireChance) {
            treatmentDelta = -(2 + Math.random() * 2);
            moraleDelta = -2;
            message = `${player.name} reacts badly to the criticism.`;
        } else if (professionalism > 13) {
            treatmentDelta = 1; moraleDelta = 1;
            message = `${player.name} takes the criticism on the chin and vows to work harder.`;
        } else {
            treatmentDelta = -1; moraleDelta = -1;
            message = `${player.name} looks unhappy but says nothing.`;
        }
    }

    player.treatmentScore = clamp((player.treatmentScore ?? 12) + treatmentDelta, 1, 20);
    player.morale = clamp((player.morale ?? 12) + moraleDelta, 1, 20);
    return { message, treatmentDelta: +treatmentDelta.toFixed(1), moraleDelta };
}

/**
 * Weekly escalation check. Sustained unhappiness in an influential player
 * builds toward a real transfer request instead of morale just sitting low
 * forever. Returns true the moment a request is newly triggered (caller
 * should surface it - don't re-trigger every week after that).
 */
export function checkTransferRequestRisk(player) {
    const unhappy = (player.happiness?.overall ?? 12) <= 7;
    player.unhappyWeeksStreak = unhappy ? (player.unhappyWeeksStreak || 0) + 1 : 0;

    const isInfluential = player.hierarchyStatus === 'Star Player' || player.hierarchyStatus === 'Key Player' || player.isTeamLeader;
    const threshold = isInfluential ? 5 : 9;

    if (player.unhappyWeeksStreak >= threshold && !player.hasActiveTransferRequest) {
        player.hasActiveTransferRequest = true;
        return true;
    }
    return false;
}

/**
 * Manager's response to an active transfer request. 'reject' risks further
 * unhappiness; 'reassure' (a promise of more playing time) gives a real
 * chance to defuse it but can be broken later if minutes don't follow;
 * 'allowSale' clears the request and flags the player as available.
 */
export function respondToTransferRequest(player, response) {
    if (response === 'reject') {
        player.morale = clamp((player.morale ?? 12) - 2, 1, 20);
        player.hasActiveTransferRequest = false;
        player.unhappyWeeksStreak = Math.max(0, (player.unhappyWeeksStreak || 0) - 2); // cools off, doesn't reset to zero
        return { message: `${player.name} isn't happy about being told no, but accepts it for now.` };
    }
    if (response === 'reassure') {
        player.hasActiveTransferRequest = false;
        player.unhappyWeeksStreak = 0;
        player.promiseMinutesMade = true; // checked later by app.js's promise-keeping tick
        player.promiseMadeAtStreak = 0;
        return { message: `${player.name} agrees to give it more time, on the understanding his playing time will improve.` };
    }
    // allowSale
    player.hasActiveTransferRequest = false;
    player.availableForTransfer = true;
    player.morale = clamp((player.morale ?? 12) + 1, 1, 20); // relief, at least there's a resolution
    return { message: `${player.name} is told the club will listen to offers.` };
}
