/**
 * calendar.js
 * ---------------------------------------------------------------------------
 * Ties the game to actual real-world dates instead of an abstract "Week 7/38"
 * counter. Season 1 starts the real upcoming season (second Saturday of
 * August of the current real year), fixtures land weekly on real Saturdays,
 * and transfer windows/player ages are computed from real calendar math.
 * ---------------------------------------------------------------------------
 */

/** Second Saturday of August in a given real year - a realistic season kickoff. */
export function seasonStartDate(seasonNumber, baseYear) {
    const year = baseYear + (seasonNumber - 1);
    const aug1 = new Date(Date.UTC(year, 7, 1)); // month 7 = August
    const dayOfWeek = aug1.getUTCDay(); // 0 = Sunday
    const firstSaturday = (6 - dayOfWeek + 7) % 7;
    const secondSaturday = firstSaturday + 7;
    return new Date(Date.UTC(year, 7, 1 + secondSaturday));
}

/** Real calendar date for a given in-season week (weekly Saturday cadence). */
export function weekToDate(season, week, baseYear) {
    const start = seasonStartDate(season, baseYear);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
    return d;
}

export function formatMatchDate(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Real transfer windows: summer (1 Jun - 31 Aug) and winter (all of January).
 * This is what gates when incoming bids/loan requests/personal-terms news
 * can happen - no window activity the rest of the year, same as real football.
 */
export function isTransferWindowOpen(date) {
    const month = date.getUTCMonth(); // 0-indexed
    if (month === 5 || month === 6 || month === 7) return 'summer'; // Jun, Jul, Aug
    if (month === 0) return 'winter'; // January
    return null;
}

/** True during the final week of either window - deadline day activity spike. */
export function isDeadlineWeek(date) {
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    if (month === 7 && day >= 25) return true; // last week of August
    if (month === 0 && day >= 25) return true; // last week of January
    return false;
}

/** Assign a random real birthdate consistent with being `age` on `referenceDate`. */
export function assignBirthdate(age, referenceDate) {
    const birthYear = referenceDate.getUTCFullYear() - age;
    const month = Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28); // avoid month-length edge cases
    const birthdate = new Date(Date.UTC(birthYear, month, day));
    // If this birthdate hasn't "happened yet" this year relative to referenceDate,
    // the player would actually still be age-1 today - nudge the birth year back one.
    const hasHadBirthdayThisYear = (referenceDate.getUTCMonth() > month) ||
        (referenceDate.getUTCMonth() === month && referenceDate.getUTCDate() >= day);
    if (!hasHadBirthdayThisYear) birthdate.setUTCFullYear(birthdate.getUTCFullYear() - 1);
    return birthdate.toISOString();
}

export function realAge(birthdateISO, currentDate) {
    const birth = new Date(birthdateISO);
    let age = currentDate.getUTCFullYear() - birth.getUTCFullYear();
    const hasHadBirthdayThisYear = (currentDate.getUTCMonth() > birth.getUTCMonth()) ||
        (currentDate.getUTCMonth() === birth.getUTCMonth() && currentDate.getUTCDate() >= birth.getUTCDate());
    if (!hasHadBirthdayThisYear) age -= 1;
    return age;
}

/** True if `currentDate` falls exactly on the player's birthday (for weekly age-up checks). */
export function isBirthdayInRange(birthdateISO, prevDate, currentDate) {
    const birth = new Date(birthdateISO);
    // Walk the 7-day window day by day (cheap - only 7 iterations) checking for a month/day match.
    const cursor = new Date(prevDate);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor <= currentDate) {
        if (cursor.getUTCMonth() === birth.getUTCMonth() && cursor.getUTCDate() === birth.getUTCDate()) return true;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return false;
}
