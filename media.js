/**
 * media.js
 * ---------------------------------------------------------------------------
 * Weekly press conference - separate from the Gemini-driven incident/AI
 * ruling system, which reacts to specific events. This is proactive: every
 * week the manager picks a tone, and that tone has small, real effects on
 * squad morale and board patience, same shape as everything else in this
 * codebase (a nudge, not a swing).
 * ---------------------------------------------------------------------------
 */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const QUESTION_BANK = [
    (gs) => `How do you assess the squad's form after ${gs.recentForm.slice(-1)[0] === 'W' ? 'that win' : 'recent results'}?`,
    (gs) => `Some fans think the club should be pushing for more this season - your response?`,
    (gs) => `There's transfer speculation around your squad - anything to add?`,
    (gs) => `The board's patience is a talking point in the media this week - how do you feel about your position?`
];

export const TONES = {
    confident: {
        label: 'Confident', moraleDelta: 2, boardPatienceDelta: -0.03,
        rivalMoraleDelta: -1,
        line: (name) => `"We know exactly what we're capable of," said the manager, backing the squad publicly.`
    },
    humble: {
        label: 'Humble', moraleDelta: 1, boardPatienceDelta: 0.02,
        rivalMoraleDelta: 0,
        line: () => `"There's still work to do - we're taking it one game at a time," the manager said, deflecting expectation.`
    },
    combative: {
        label: 'Combative', moraleDelta: 3, boardPatienceDelta: -0.08,
        rivalMoraleDelta: -2,
        line: () => `"Frankly, I think some people are too quick to write this squad off," the manager fired back at critics.`
    }
};

/** Build this week's press conference: one question, three tone options. */
export function generatePressConference(gameState) {
    const questionFn = QUESTION_BANK[Math.floor(Math.random() * QUESTION_BANK.length)];
    return {
        question: questionFn(gameState),
        options: Object.entries(TONES).map(([key, t]) => ({ key, label: t.label }))
    };
}

/**
 * Resolve the manager's chosen tone. Applies a small morale nudge to the
 * player's own squad and returns a headline plus a board-pressure delta the
 * caller can fold into job-security tracking (boardroom.js's securityPct is
 * derived fresh each render, so we store a light-touch running adjustment
 * on gameState instead of mutating boardroom.js's pure functions).
 */
export function resolvePressTone(gameState, toneKey) {
    const tone = TONES[toneKey] || TONES.humble;
    gameState.squad.forEach(p => { p.morale = clamp(p.morale + tone.moraleDelta, 1, 20); });
    gameState.pressBoardModifier = clamp((gameState.pressBoardModifier || 0) + tone.boardPatienceDelta, -0.3, 0.3);
    return { headline: tone.line(), moraleDelta: tone.moraleDelta };
}
