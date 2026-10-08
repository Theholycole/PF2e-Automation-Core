import test from "node:test";
import assert from "node:assert/strict";

import { mentionsStrike, noMultipleAttackPenalty, parseDisable, routineActions } from "../src/index.js";

test("hazard text: Disable options and successes, routine actions, no multiple attack penalty, reactions that Strike", () => {
    assert.deepEqual(parseDisable("<p>@Check[thievery|dc:21|name:Disable Pillar|traits:action:disable-a-device] (trained) twice on the pillar, or @Check[thievery|dc:19|name:Disable Trap (Control Panel)] (expert) once on the control panel</p>"),
        [{ skill: "thievery", dc: 21, needed: 2 }, { skill: "thievery", dc: 19, needed: 1 }]);
    assert.deepEqual(parseDisable("@Check[thievery|dc:37]{Thievery (master)} to jam a mannequin or a @Check[religion|dc:35]{Religion (expert)} twice to exorcise"), [{ skill: "thievery", dc: 37, needed: 1 }, { skill: "religion", dc: 35, needed: 2 }]);
    assert.deepEqual(parseDisable(""), []);
    assert.equal(routineActions("<p>(3 actions) The trap uses its first action…</p>"), 3);
    assert.equal(routineActions(""), 1);
    assert.ok(noMultipleAttackPenalty("<p>No multiple attack penalty</p>") && noMultipleAttackPenalty("This trap doesn't take a multiple attack penalty."));
    assert.ok(mentionsStrike("The trap makes a poisoned dart Strike against the triggering creature") && !mentionsStrike("Each creature must attempt a DC 20 Reflex save"));
});
