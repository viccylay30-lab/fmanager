/**
 * development.js
 * ---------------------------------------------------------------------------
 * Monthly, non-linear player development. PA is a ceiling, not a promise -
 * most players land somewhere below it, a few overshoot expectations, and
 * some flame out entirely despite elite potential. Every roll is independent
 * randomness on top of deterministic inputs, so identical starting players
 * diverge across saves.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Age curve multiplier for growth speed. Teens/early-20s grow fastest,
 * growth tapers through the mid-to-late 20s, and from ~30 it goes negative
 * (decline territory, handled separately in applyAgeDecline).
 */
function ageGrowthFactor(age) {
    if (age <= 20) return 1.5;
    if (age <= 23) return 1.15;
    if (age <= 26) return 0.7;
    if (age <= 29) return 0.3;
    return 0; // growth stops; applyAgeDecline takes over
}

/**
 * Run one monthly development roll for a player.
 * @param {object} player
 * @param {object} club - { facilities: 1-20, coachingQuality: 1-20 }
 * @param {object} monthInfo - { season, month } - for logging only
 */
export function developPlayer(player, club = { facilities: 10, coachingQuality: 10 }, monthInfo = {}) {
    const h = player.hidden;
    const caBefore = player.ca;
    const headroom = player.pa - player.ca;

    // Recently injured this month? Growth (and sometimes attributes) suffer.
    const recentInjury = player.injuryHistory.some(inj =>
        inj.season === monthInfo.season && Math.abs((monthInfo.week || 0) - inj.week) <= 4);

    if (player.age > 29) {
        applyAgeDecline(player, club, monthInfo);
        return logDevelopment(player, caBefore, monthInfo, 'decline-phase');
    }

    if (headroom <= 0) {
        // At or past PA: no more upward room. Small chance of a "found another
        // gear" PA re-roll for late bloomers with elite professionalism/determination
        // (requirement: late bloomer peaks at 28) - rare, and only while still young enough.
        if (player.age <= 28 && h.professionalism >= 16 && player.attrs.determination >= 16 && Math.random() < 0.03) {
            const bonus = 3 + Math.floor(Math.random() * 8);
            player.pa = clamp(player.pa + bonus, player.pa, 200);
            return logDevelopment(player, caBefore, monthInfo, `late-bloomer PA raised +${bonus}`);
        }
        return logDevelopment(player, caBefore, monthInfo, 'at-potential');
    }

    const trainingFactor = (h.professionalism / 20) * 0.5 + (player.attrs.determination / 20) * 0.3 + (club.coachingQuality / 20) * 0.2;
    const minutesFactor = clamp((player.recentMinutes || 0) / 340, 0.3, 1.25); // ~340 min/4-week tick = ever-present starter in this game's 1-fixture/week loop
    const moraleFactor = 0.85 + (player.morale / 20) * 0.3;
    const facilitiesFactor = 0.8 + (club.facilities / 20) * 0.4;
    const injuryPenalty = recentInjury ? 0.4 : 1.0;
    const adaptabilityFactor = 0.9 + (h.adaptability / 20) * 0.2; // helps settle into new club/tactics faster

    const expectedGrowth = headroom * 0.026 * ageGrowthFactor(player.age) *
        trainingFactor * minutesFactor * moraleFactor * facilitiesFactor * injuryPenalty * adaptabilityFactor;

    // Non-linearity: most months are close to expected, but there's a real
    // chance of a breakout leap or a stagnant/regressive month.
    const roll = Math.random();
    let variance;
    if (roll < 0.05) {
        variance = 2.2 + Math.random() * 1.3;              // breakout month
    } else if (roll < 0.12) {
        variance = -0.3 - Math.random() * 0.4;              // bad month, can lose a little ground
    } else {
        variance = 0.4 + Math.random() * 1.1;                // normal range
    }

    // "Failed wonderkid" pressure: low professionalism/ambition/determination
    // and low recent minutes progressively caps how much of their PA a high-CA
    // young player can realistically ever reach, even with headroom available.
    const wastedTalentRisk = (h.professionalism < 9 || h.ambition < 8) && minutesFactor < 0.5;
    const wasteMult = wastedTalentRisk && Math.random() < 0.35 ? 0.15 : 1.0;

    const actualGrowth = expectedGrowth * variance * wasteMult;
    player.ca = clamp(Math.round(player.ca + actualGrowth), 1, player.pa);

    player.recentMinutes = 0;
    player.monthsAtClub = (player.monthsAtClub || 0) + 1;

    // Translate CA growth into visible attribute nudges so the number isn't
    // floating disconnected from what the player can actually do on the pitch.
    if (player.ca > caBefore) {
        bumpRelevantAttributes(player, player.ca - caBefore);
    }

    const note = roll < 0.05 ? 'breakout month' : roll < 0.12 ? 'poor month' :
        wasteMult < 1 ? 'talent going to waste' : 'steady progress';
    return logDevelopment(player, caBefore, monthInfo, note);
}

/**
 * Nudge a couple of attributes upward proportional to CA gained, weighted
 * toward the player's position profile so growth feels position-appropriate.
 */
function bumpRelevantAttributes(player, caGain) {
    const pointsToDistribute = Math.max(1, Math.round(caGain / 8));
    const pool = Object.keys(player.attrs);
    for (let i = 0; i < pointsToDistribute; i++) {
        const attr = pool[Math.floor(Math.random() * pool.length)];
        player.attrs[attr] = clamp(player.attrs[attr] + 1, 1, 20);
    }
}

/**
 * Age-related decline for 30+ players. Rate depends on professionalism,
 * determination and natural fitness - some veterans age gracefully, others
 * fall off a cliff.
 */
function applyAgeDecline(player, club, monthInfo) {
    const h = player.hidden;
    const resilience = (h.professionalism / 20) * 0.5 + (player.attrs.determination / 20) * 0.3 + (h.naturalFitness / 20) * 0.2;
    const baseDecline = Math.min(2.2, (player.age - 29) * 0.16); // CA points/month baseline, capped so late-30s vets don't accelerate forever
    const declineMult = 1.5 - resilience; // 0.65 (great habits) .. 1.4 (poor habits)
    const monthDecline = baseDecline * declineMult * (0.5 + Math.random());

    // Floor scales with how good the player once was - an ex-world-class veteran
    // settles as a useful squad player, not a total non-league scrub.
    const floor = clamp(Math.round(player.pa * 0.35), 45, 100);
    player.ca = clamp(Math.round(player.ca - monthDecline), floor, player.pa);
    if (Math.random() < 0.4) {
        // physical attributes go first, as in real ageing curves
        const physicalPool = ['pace', 'acceleration', 'agility', 'stamina'];
        const attr = physicalPool[Math.floor(Math.random() * physicalPool.length)];
        player.attrs[attr] = clamp(player.attrs[attr] - 1, 1, 20);
    }
    player.recentMinutes = 0;
}

function logDevelopment(player, caBefore, monthInfo, note) {
    const entry = { season: monthInfo.season, week: monthInfo.week, caBefore, caAfter: player.ca, note };
    player.developmentLog = player.developmentLog || [];
    player.developmentLog.push(entry);
    if (player.developmentLog.length > 60) player.developmentLog.shift(); // cap log size for storage
    return entry;
}

// ---------------------------------------------------------------------------
// Market value
// ---------------------------------------------------------------------------

/**
 * Compute market value (in £M) from CA plus everything scouts/pundits would
 * actually weigh: age curve, reputation (appearances/caps), contract
 * leverage, injury discount, and potential upside for young players.
 */
export function computeMarketValue(player) {
    const ca = player.ca, pa = player.pa, age = player.age;

    const baseValue = 0.001 * Math.pow(ca / 20, 5.2); // CA 100≈£4M, CA 150≈£28M, CA 190≈£110M pre-multipliers

    let ageMult;
    if (age <= 20) ageMult = 1.15;
    else if (age <= 24) ageMult = 1.35; // peak resale/prime-years premium
    else if (age <= 28) ageMult = 1.1;
    else if (age <= 31) ageMult = 0.75;
    else if (age <= 34) ageMult = 0.4;
    else ageMult = 0.2;

    // Unrealized potential adds a premium for young players with room to grow.
    const potentialPremium = age <= 23 ? 1 + clamp((pa - ca) / 200, 0, 0.6) : 1;

    const reputationMult = 1 + clamp(player.appearances / 400, 0, 0.3) + clamp(player.internationalCaps / 60, 0, 0.35);

    // Short contracts crater value (free-transfer risk); long deals hold it.
    const contractMult = player.contractYearsRemaining <= 0 ? 0.35 :
        player.contractYearsRemaining === 1 ? 0.55 :
        player.contractYearsRemaining === 2 ? 0.85 : 1.0;

    // Injury history discount - recency and severity both matter.
    const recentSeriousInjuries = player.injuryHistory.filter(i =>
        (i.severity === 'major' || i.severity === 'careerThreatening')).length;
    const injuryDiscount = clamp(1 - recentSeriousInjuries * 0.12, 0.4, 1);

    const value = baseValue * ageMult * potentialPremium * reputationMult * contractMult * injuryDiscount;
    player.marketValue = Math.round(value * 10) / 10; // £M, 1 decimal
    return player.marketValue;
}
