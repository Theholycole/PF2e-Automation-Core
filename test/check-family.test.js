import test from "node:test";
import assert from "node:assert/strict";

import { CORE_FAMILIES, createRegistry, validateChanges } from "../src/index.js";

const none = { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [] };
const prone = (recipient) => ({ kind: "condition", slug: "prone", value: null, duration: null, ...(recipient ? { recipient } : {}) });
// Trip as the ability compiler writes it from PF2e's actions pack.
const TRIP = {
    modelVersion: 13, source: { name: "Trip" }, rank: 1, traits: ["attack"],
    resolution: {
        kind: "check",
        check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } },
        sharedDamage: null,
        outcomes: {
            criticalSuccess: { damage: { mode: "formulas", formulas: [{ formula: "1d6[bludgeoning]" }] }, effects: [prone()] },
            success: { ...none, effects: [prone()] },
            failure: none,
            criticalFailure: { ...none, effects: [prone("self")] }
        }
    }
};
const ESCAPE = {
    modelVersion: 13, source: { name: "Escape" }, rank: 1, traits: ["attack"],
    resolution: {
        kind: "check",
        check: { roll: "skill", statistic: ["unarmed", "acrobatics", "athletics"], against: { dc: "target", statistic: "athletics" } },
        outcomes: {
            criticalSuccess: { ...none, effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"], recipient: "self" }] },
            success: { ...none, effects: [{ kind: "end-condition", slugs: ["grabbed", "restrained"], recipient: "self" }] },
            failure: none,
            criticalFailure: none
        }
    }
};

const creatures = {
    fighter: { id: "fighter", athletics: { modifier: 12 }, acrobatics: { modifier: 6 }, unarmed: { modifier: 10 } },
    ogre: { id: "ogre", reflex: { modifier: 5 }, athletics: { modifier: 14 } }
};
const registry = createRegistry();
for (const family of CORE_FAMILIES) registry.registerFamily(family);
const context = (caster, targets) => ({ caster: creatures[caster], targets: targets.map((id) => creatures[id]), statistic: (actor, slug) => actor[slug] ?? null });

test("Trip: Athletics against the target's Reflex DC; prone, damage on a critical success, the actor prone on a critical failure", () => {
    const calls = [];
    const roll = (degree) => ({ roll: (statistic, options) => { calls.push([statistic, options.actor.id, options.modifier, options.dc]); return { degree }; } });
    const success = registry.resolveSync(TRIP, context("fighter", ["ogre"]), roll("criticalSuccess"));
    assert.deepEqual(calls[0], ["athletics", "fighter", 12, 15], "Reflex DC: 10 + 5");
    assert.deepEqual(success.changes, [
        { op: "damage", target: "ogre", instances: [{ type: "bludgeoning", category: null, amount: 3 }] },
        { op: "condition", target: "ogre", slug: "prone", value: null, duration: null }
    ]);
    const fumble = registry.resolveSync(TRIP, context("fighter", ["ogre"]), roll("criticalFailure"));
    assert.deepEqual(fumble.changes, [{ op: "condition", target: "fighter", slug: "prone", value: null, duration: null }]);
    assert.deepEqual(validateChanges(fumble.changes), []);
});

test("Escape: the best of the actor's statistics against the grabber's Athletics DC; success ends its own grabbed", () => {
    const calls = [];
    const result = registry.resolveSync(ESCAPE, context("fighter", ["ogre"]), { roll: (statistic, options) => { calls.push([statistic, options.modifier, options.dc]); return { degree: "success" }; } });
    assert.deepEqual(calls[0], ["athletics", 12, 24], "athletics is the fighter's best");
    assert.deepEqual(result.changes, [{ op: "end", target: "fighter", what: { conditions: ["grabbed", "restrained"], from: "ogre" } }]);
    assert.deepEqual(registry.familyFor("check").gaps(ESCAPE), []);
});
