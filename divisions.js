/**
 * divisions.js
 * ---------------------------------------------------------------------------
 * Two-tier league structure. Your club sits in exactly one division at a
 * time; the other division runs fully independently (its own 20 clubs, own
 * schedule, own table) so it can be simulated in parallel every week. At
 * season rollover, the bottom 3 of the higher division swap places with the
 * top 3 of the lower division - if YOUR club is among those swapping, your
 * division changes and your next season's rivals are rebuilt around that.
 * ---------------------------------------------------------------------------
 */

import { generateRivals, generateSchedule, simulateRound, sortTable } from './league.js';

/** Build a fresh, fully independent division of 20 AI clubs (no human club in it). */
export function generateIndependentDivision(referenceDate = new Date()) {
    const rivals = generateRivals(referenceDate); // 19 named clubs
    const extra = generateRivals(referenceDate)[0]; // borrow one more generated club to reach 20
    extra.id = extra.id + '-x2';
    extra.name = extra.name + ' II';
    const allClubs = [...rivals, extra];
    // Force every id to be unique to THIS division - both divisions draw names
    // from the same fixed pool, so ids would otherwise collide across divisions
    // and corrupt promotion/relegation filtering (a real bug caught by testing).
    // Player ids need the same treatment as club ids: two same-named clubs in
    // each division independently generate players with identical
    // `${name}-${index}` ids, and once a club is promoted/relegated those
    // colliding ids end up sitting in the same gameState.rivals list (or even
    // gameState.squad, via a pre-contract signing) as a DIFFERENT, unrelated
    // player - a real cross-division id collision caught by testing.
    allClubs.forEach(c => {
        c.id = c.id + '-D2';
        c.squad.forEach(p => { p.id = p.id + '-D2'; });
    });
    const schedule = generateSchedule(20);
    const cleanTable = allClubs.map(c => ({ id: c.id, name: c.name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 }));
    return { clubs: allClubs, schedule, table: cleanTable };
}

/** Simulate one week's round for an independent division (no human club involved). */
export function simulateIndependentRound(division, week, weather) {
    const round = division.schedule[(week - 1) % division.schedule.length];
    simulateRound(round, division.clubs, division.table, weather, false);
}

/**
 * At season rollover: bottom 3 of the TOP division swap with top 3 of the
 * BOTTOM division. Pass tables/club-lists explicitly (always top-division-first)
 * regardless of which one your club is currently in - app.js decides which
 * table is "top" vs "bottom" based on gameState.division.
 *
 * Returns the new club lists for each tier, and which tier YOUR club (id
 * 'YOU') ends up in for next season.
 */
export function applyPromotionRelegation(topTable, topClubs, bottomTable, bottomClubs) {
    const topSorted = sortTable(topTable);
    const bottomSorted = sortTable(bottomTable);

    const relegatedIds = topSorted.slice(-3).map(r => r.id);   // leaving the top division
    const promotedIds = bottomSorted.slice(0, 3).map(r => r.id); // leaving the bottom division

    const youRelegated = relegatedIds.includes('YOU');
    const youPromoted = promotedIds.includes('YOU');

    const relegatedClubs = topClubs.filter(c => relegatedIds.includes(c.id));
    const promotedClubs = bottomClubs.filter(c => promotedIds.includes(c.id));

    const newTopClubs = [...topClubs.filter(c => !relegatedIds.includes(c.id)), ...promotedClubs];
    const newBottomClubs = [...bottomClubs.filter(c => !promotedIds.includes(c.id)), ...relegatedClubs];

    return { youRelegated, youPromoted, newTopClubs, newBottomClubs, relegatedClubs, promotedClubs };
}
