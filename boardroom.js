/**
 * boardroom.js
 * ---------------------------------------------------------------------------
 * Job security for AI-managed clubs. Big clubs have short patience regardless
 * of table position; small clubs tolerate long winless runs UNLESS they're
 * actually in the relegation zone, where patience collapses for everyone
 * equally - staying up matters more than reputation once you're down there.
 * A squad's most influential player (highest Leadership) can publicly swing
 * the pressure either way during an actual crisis week.
 * ---------------------------------------------------------------------------
 */

import { generateManagerProfile } from './manager-ai.js';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Bucket a rival club's size/expectation level from its budget. */
export function clubTier(club) {
    const budget = club.budget ?? 20;
    if (budget >= 38) return 'big';
    if (budget >= 22) return 'mid';
    return 'small';
}

/** Winless streak counted from the end of a recentForm array. */
function winlessStreak(recentForm) {
    let streak = 0;
    for (let i = recentForm.length - 1; i >= 0; i--) {
        if (recentForm[i] === 'W') break;
        streak++;
    }
    return streak;
}

const BASE_PATIENCE = { big: 5, mid: 9, small: 15 }; // winless games tolerated before real pressure builds

// Where each tier's board expects to finish, out of 20 - underperforming
// THIS is what actually drives most big-club sackings in real football,
// independent of any specific losing streak (a big club going 6-4-4 while
// sitting 9th is exactly the profile that gets a manager fired).
const EXPECTED_POSITION_MAX = { big: 5, mid: 12, small: 20 };

/**
 * Find the squad's most influential player (highest Leadership attribute)
 * and let them publicly react during a crisis week - backing the manager
 * eases pressure, undermining him accelerates it.
 */
function leadershipIntervention(squad) {
    const eligible = squad.filter(p => !p.isInjured && !p.onLoanAt);
    if (eligible.length === 0) return null;
    const leader = eligible.reduce((best, p) => (p.attrs.leadership > best.attrs.leadership ? p : best), eligible[0]);
    if (leader.attrs.leadership < 12) return null; // no one influential enough to make news either way

    const character = (leader.hidden.loyalty + leader.hidden.professionalism) / 2;
    if (character >= 14) {
        return { player: leader.name, stance: 'backs', pressureDelta: -0.15, moraleDelta: +1 };
    }
    if (character <= 8) {
        return { player: leader.name, stance: 'undermines', pressureDelta: +0.2, moraleDelta: -2 };
    }
    return null; // most leaders stay neutral/private about it
}

/**
 * Evaluate one rival club's job security for this week. Call after the
 * table has been updated for the round. Returns null if nothing newsworthy
 * happened, or an event describing a warning / leadership moment / sacking.
 */
export function evaluateSackRisk(club, tablePosition, leagueSize, week) {
    const tier = clubTier(club);
    const streak = winlessStreak(club.recentForm || []);
    const inRelegationZone = tablePosition > leagueSize - 3;

    let patience = BASE_PATIENCE[tier];
    if (inRelegationZone) patience = Math.min(patience, 4); // relegation battle overrides reputation for everyone

    // Two independent pressure sources - either one alone can trigger a review.
    const streakOverBy = streak - patience;
    const positionGap = tablePosition - EXPECTED_POSITION_MAX[tier]; // positive = underperforming expectations
    const streakTriggered = streakOverBy >= 0;
    const positionTriggered = positionGap > 2 && (club.recentForm || []).length >= 8; // need a real sample, not week 3

    if (!streakTriggered && !positionTriggered) return null; // no pressure yet, nothing to report

    // Base probability from whichever pathway is more severe, plus a flat
    // tier bump - big clubs simply have less patience once ANY pressure exists.
    const streakPressure = streakTriggered ? clamp(0.06 + streakOverBy * 0.05, 0, 0.4) : 0;
    const positionPressure = positionTriggered
        ? clamp(positionGap * 0.02 * (tier === 'big' ? 1.6 : tier === 'mid' ? 1.1 : 0.6), 0, 0.3)
        : 0;
    let sackProbability = clamp(
        Math.max(streakPressure, positionPressure) + (tier === 'big' ? 0.06 : tier === 'small' ? -0.03 : 0),
        0.02, 0.55
    );

    const intervention = leadershipIntervention(club.squad);
    if (intervention) {
        sackProbability = clamp(sackProbability + intervention.pressureDelta, 0.01, 0.7);
        club.squad.forEach(p => { p.morale = clamp(p.morale + intervention.moraleDelta, 1, 20); });
    }

    if (Math.random() < sackProbability) {
        const newProfile = generateManagerProfile(); // a genuinely new manager, not the same brain reset
        club.managerProfile = newProfile;
        club.recentForm = [];
        const reason = inRelegationZone
            ? `after ${streak} games without a win amid a relegation battle`
            : streakTriggered
                ? `after ${streak} games without a win`
                : `with the club sitting ${ordinal(tablePosition)}, well below the board's expectations`;
        return {
            type: 'sacked',
            headline: `${club.name} sack their manager ${reason}`,
            detail: intervention ? `Dressing room fractures had already surfaced - reports suggested unrest before the decision.` : `The board ran out of patience.`
        };
    }

    // Not sacked, but pressure is real - surface it as a warning story even
    // when nothing changes, so a save can show tension building over weeks.
    if (intervention) {
        return {
            type: 'leadership_moment',
            headline: `${intervention.player} ${intervention.stance} ${club.name}'s manager amid mounting pressure`,
            detail: streak >= patience + 2 ? 'The board are known to be reviewing the situation.' : 'Results need to turn around soon.'
        };
    }
    if (streak >= patience + 1) {
        return {
            type: 'pressure_warning',
            headline: `${club.name}'s manager under pressure after ${streak} games without a win`,
            detail: inRelegationZone ? 'The relegation battle is sharpening the board\'s patience.' : 'Reputation alone won\'t save the job much longer.'
        };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Your own club: a job-security METER, not an automatic sacking - you're the
// human manager, so this surfaces real pressure and warnings without ending
// the save out from under you. A full "you're sacked, pick a new job" flow
// is a bigger feature than this covers.
// ---------------------------------------------------------------------------

export function evaluateYourJobSecurity(gameState) {
    const tier = clubTier({ budget: (gameState.squadReputation ?? 100) / 2 });
    const streak = winlessStreak(gameState.recentForm || []);
    const inRelegationZone = gameState.leaguePosition > 17;

    let patience = BASE_PATIENCE[tier];
    if (inRelegationZone) patience = Math.min(patience, 4);

    const securityPct = clamp(100 - (streak - patience + 3) * 12, 0, 100);

    let status = 'Secure';
    if (securityPct <= 20) status = 'Under severe pressure';
    else if (securityPct <= 45) status = 'On thin ice';
    else if (securityPct <= 70) status = 'Board watching closely';

    return { securityPct, status, streak, inRelegationZone };
}
