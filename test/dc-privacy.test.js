import test from "node:test";
import assert from "node:assert/strict";

import { fromSuite, redactDCText, redactionMode, suiteFlagged } from "../src/dc-privacy.js";

test("dc privacy: a monster's card hides every DC from players", () => {
    assert.equal(redactDCText("DC 33 basic Reflex save", "all"), "DC ? basic Reflex save");
    assert.equal(redactDCText("Athletics 25 vs DC 21: Success", "all"), "Athletics 25 vs DC ?: Success");
    assert.equal(redactDCText("Grab (DC 24, +14), or until it Escapes (DC: 24)", "all"), "Grab (DC ?, +14), or until it Escapes (DC: ?)");
    assert.equal(redactDCText("Fear (rank 1, DC 20)", "all"), "Fear (rank 1, DC ?)");
});

test("dc privacy: flat checks keep their DC", () => {
    assert.equal(redactDCText("Kobold: DC 11 flat check", "all"), "Kobold: DC 11 flat check");
    assert.equal(redactDCText("flat check DC 5 (concealed)", "all"), "flat check DC 5 (concealed)");
    assert.equal(redactDCText("Its flat check: 14, DC 15, a success", "all"), "Its flat check: 14, DC 15, a success");
    assert.equal(redactDCText("Flat check 12 against DC 11: still hits", "opposed"), "Flat check 12 against DC 11: still hits");
    assert.equal(redactDCText("A DC 11 flat check, then a DC 22 Will save.", "all"), "A DC 11 flat check, then a DC ? Will save.");
});

test("dc privacy: a player's card hides only what its roll is set against", () => {
    assert.equal(redactDCText("Demoralize 25 against DC 19 (Will): success", "opposed"), "Demoralize 25 against DC ? (Will): success");
    assert.equal(redactDCText("23 against the target's DC 30", "opposed"), "23 against the target's DC ?");
    assert.equal(redactDCText("rerolled: 18 vs. AC 22", "opposed"), "rerolled: 18 vs. AC ?");
    assert.equal(redactDCText("Fireball (rank 3, class DC 24)", "opposed"), "Fireball (rank 3, class DC 24)");
    assert.equal(redactDCText("DC 33 basic Reflex save", "opposed"), "DC 33 basic Reflex save");
    assert.equal(redactDCText("DC 33 basic Reflex save", null), "DC 33 basic Reflex save");
    // (No DC: untouched; AC alone on a monster card is left.)
    assert.equal(redactDCText("Strike +12 against the target's AC", "all"), "Strike +12 against the target's AC");
});

test("dc privacy: who sees what", () => {
    assert.equal(redactionMode({ isGM: true }), null);
    assert.equal(redactionMode({ showDCs: true }), null);
    assert.equal(redactionMode({ enabled: false }), null);
    assert.equal(redactionMode({}), "all");
    assert.equal(redactionMode({ speakerHasPlayerOwner: true }), "opposed");
});

test("dc privacy: the suite's messages", () => {
    assert.equal(fromSuite("Error\n    at wireCard (https://x/modules/pf2e-automatic-ability-resolution/scripts/live.js:157:12)"), true);
    assert.equal(fromSuite("Error\n    at async roll (https://x/systems/pf2e/pf2e.mjs:1:1)"), false);
    assert.equal(suiteFlagged({ "pf2e-automatic-item-resolution": { card: {} } }), true);
    assert.equal(suiteFlagged({ pf2e: { context: {} }, "pf2e-automatic-item-resolution": {} }), false);
});
