// (2026-11-21, Cole after a playtest: "Automation modules shouldn't reveal monster DCs to players when rolling".)
// The pure half of the core's DC privacy (scripts/dc-privacy.js wires it into Foundry's chat log).
//
// PF2e itself hides a DC from players unless the creature it belongs to has a player owner, or the
// world's metagame setting "Show DCs" is on. The suite's own cards ("DC 33 basic Reflex save",
// "Athletics 25 vs DC 21") are plain text, so they're redacted when a player's client renders them:
//
//   "all"      a card from a creature no player owns (a monster, a hazard, the environment): every DC.
//   "opposed"  a card from a player's creature: only a DC or AC the roll is set against ("14 vs DC 21",
//              "against the target's DC 19"), since that one is the other creature's. Its own DCs stay.
//
// Flat checks keep their DC either way: PF2e shows them, and the rules give them to the players.

// The suite's modules: a chat message one of them creates is redacted for players.
export const SUITE_MODULE_IDS = Object.freeze([
    "pf2e-resolution-core",
    "pf2e-automatic-ability-resolution",
    "pf2e-automatic-item-resolution",
    "pf2e-automatic-resolution",
    "pf2e-automatic-feat-resolution",
    "pf2e-automatic-kineticist-resolution",
    "pf2e-automatic-environment-resolution",
    "pf2e-e7-rules"
]);

export const HIDDEN_DC = "?";

/** Whether a stack trace (taken while a chat message is being created) runs through one of the suite's scripts. */
export function fromSuite(stack) {
    const text = String(stack ?? "");
    return SUITE_MODULE_IDS.some((id) => text.includes(`/modules/${id}/`));
}

/** Whether a message's flags say a suite module made it. */
export function suiteFlagged(flags) {
    if (!flags || typeof flags !== "object") return false;
    return SUITE_MODULE_IDS.some((id) => flags[id] && typeof flags[id] === "object" && Object.keys(flags[id]).length > 0);
}

/** "all", "opposed", or null (nothing hidden) for a player looking at a suite message. */
export function redactionMode({ isGM = false, showDCs = false, enabled = true, speakerHasPlayerOwner = false } = {}) {
    if (isGM || showDCs || !enabled) return null;
    return speakerHasPlayerOwner ? "opposed" : "all";
}

// A flat check near the DC (in the same clause): left as it is.
const FLAT_BEFORE = /flat[\s-]*check\b[\s:(]*(?:\d+[\s,]*)?(?:(?:against|vs\.?)\s+)?$/i;
const FLAT_AFTER = /^[^.;!?]{0,14}flat\b/i;
const isFlat = (text, start, end) => FLAT_BEFORE.test(text.slice(Math.max(0, start - 40), start)) || FLAT_AFTER.test(text.slice(end, end + 30));

// "DC 21", "DC: 21", "DC21".
const ANY_DC = /\bDC(\s*:?\s*)(\d+)\b/g;
// "vs DC 21", "against DC 21", "against the target's DC 19", "vs. AC 18", "against Kobold's Reflex DC 17".
const OPPOSED = /\b(against|vs\.?|versus)(\s+(?:[^\s.;:,()]+\s+){0,3}?)(DC|AC)(\s*:?\s*)(\d+)\b/gi;

/** A piece of text with the DCs players shouldn't see replaced by "?". mode: "all" | "opposed" | null. */
export function redactDCText(text, mode) {
    if (!mode || typeof text !== "string" || !/\b(?:DC|AC)\s*:?\s*\d/i.test(text)) return text;
    // A DC or AC the roll is set against: hidden in both modes.
    let out = text.replace(OPPOSED, (match, word, between, kind, gap, number, offset, whole) => {
        if (kind.toUpperCase() === "DC" && isFlat(whole, offset, offset + match.length)) return match;
        return `${word}${between}${kind}${gap}${HIDDEN_DC}`;
    });
    if (mode !== "all") return out;
    out = out.replace(ANY_DC, (match, gap, number, offset, whole) => (isFlat(whole, offset, offset + match.length) ? match : `DC${gap}${HIDDEN_DC}`));
    return out;
}

