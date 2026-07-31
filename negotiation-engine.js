/**
 * negotiation-engine.js
 * ---------------------------------------------------------------------------
 * Real back-and-forth haggling instead of a single accept/reject roll - the
 * exact gap this game had: no negotiate button anywhere. One generic engine
 * powers both transfer fee talks (club vs club) and wage talks (club vs
 * player/agent): you make an offer, the other side either accepts, counters
 * partway toward your number, or breaks off talks if the gap is too wide or
 * too many rounds have passed. `toughness` (0-1) governs how stubborn the
 * other side is - a low-toughness negotiation concedes fast, a high-toughness
 * one barely moves and gives up sooner.
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Start a negotiation. `askingValue` is what the other side currently wants
 * (asking price, or demanded wage).
 */
export function startNegotiation(askingValue, toughness = 0.5) {
    return {
        askingValue, initialAsking: askingValue,
        toughness: clamp(toughness, 0, 1),
        round: 0, status: 'open', history: []
    };
}

/**
 * Make an offer. Mutates and returns the negotiation state. Status becomes:
 *   'accepted'  - offer was close enough to the current asking value
 *   'countered' - gap remains; askingValue has moved partway toward the offer
 *   'rejected'  - talks broken off (gap too wide, or out of rounds)
 * Once status is 'accepted'/'rejected'/'walked_away', further offers no-op.
 */
export function makeOffer(state, offerValue) {
    if (state.status !== 'open' && state.status !== 'countered') return state;
    state.round += 1;
    const gapRatio = (state.askingValue - offerValue) / Math.max(0.0001, state.askingValue); // >0 = offer below asking

    if (gapRatio <= 0.03) {
        state.status = 'accepted';
        state.finalValue = offerValue;
        state.history.push({ round: state.round, offer: offerValue, result: 'accepted' });
        return state;
    }
    if (state.round >= 4 || gapRatio > 0.6) {
        state.status = 'rejected';
        state.history.push({ round: state.round, offer: offerValue, result: 'rejected' });
        return state;
    }

    // Concede part of the gap - tougher negotiators move less, and everyone
    // loosens up a little as rounds go on (nobody wants talks to drag forever).
    const concession = gapRatio * (1 - state.toughness) * (0.35 + state.round * 0.1);
    state.askingValue = Math.round(state.askingValue * (1 - concession) * 1000) / 1000;
    state.status = 'countered';
    state.history.push({ round: state.round, offer: offerValue, result: 'countered', newAsking: state.askingValue });
    return state;
}

/** Manager ends talks voluntarily rather than being rejected. */
export function walkAway(state) {
    state.status = 'walked_away';
    return state;
}
