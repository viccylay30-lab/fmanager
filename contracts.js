/**
 * contracts.js
 * ---------------------------------------------------------------------------
 * Contract years actually count down now (they never did before - a player
 * could sit on "3 years remaining" forever). At 0, the player's hidden
 * loyalty vs ambition decides whether they re-sign or leave for a free
 * transfer at the next window - real squad-management pressure, not
 * a decorative number.
 * ---------------------------------------------------------------------------
 */

/**
 * Call once per player per season at rollover. Returns an event describing
 * what happened, or null if their contract just ticked down with no expiry.
 */
export function tickContract(player) {
    player.contractYearsRemaining = Math.max(0, (player.contractYearsRemaining ?? 3) - 1);
    if (player.contractYearsRemaining > 0) return null;

    const h = player.hidden;
    const stayScore = h.loyalty - h.ambition + (Math.random() * 6 - 3);

    if (stayScore >= 0) {
        player.contractYearsRemaining = 2 + Math.floor(Math.random() * 3);
        return { type: 'renewed', player: player.name, headline: `${player.name} signs a new contract` };
    }
    return { type: 'expiring', player: player.name, headline: `${player.name}'s contract has expired - available on a free transfer` };
}
