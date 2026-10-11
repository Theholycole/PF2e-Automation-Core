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

test("Feint, Disarm and First Aid: off-guard to one creature's attacks, a disarm effect, and stabilizing", () => {
    const offGuard = (scope, recipient) => ({ kind: "condition", slug: "off-guard", value: null, duration: null, scope, ...(recipient ? { recipient } : {}) });
    const plan = (outcomes) => ({ modelVersion: 13, source: { name: "x" }, rank: 1, resolution: { kind: "check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } }, outcomes: { criticalSuccess: none, success: none, failure: none, criticalFailure: none, ...outcomes } } });
    const at = (degree) => ({ roll: () => ({ degree }) });
    const feint = plan({ success: { ...none, effects: [offGuard({ against: "actor", attacks: "melee", uses: 1 })] }, criticalFailure: { ...none, effects: [offGuard({ against: "target", attacks: "melee" }, "self")] } });
    assert.deepEqual(registry.resolveSync(feint, context("fighter", ["ogre"]), at("success")).changes, [
        { op: "condition", target: "ogre", slug: "off-guard", value: null, duration: null, scope: { attacker: "fighter", attacks: "melee", uses: 1 } }
    ]);
    assert.deepEqual(registry.resolveSync(feint, context("fighter", ["ogre"]), at("criticalFailure")).changes[0], { op: "condition", target: "fighter", slug: "off-guard", value: null, duration: null, scope: { attacker: "ogre", attacks: "melee", uses: null } });
    const disarm = plan({ criticalSuccess: { ...none, effects: [{ kind: "disarm", what: "drop" }] }, success: { ...none, effects: [{ kind: "disarm", what: "weaken", penalty: 2 }] } });
    assert.deepEqual(registry.resolveSync(disarm, context("fighter", ["ogre"]), at("success")).changes, [{ op: "effect", target: "ogre", effect: { kind: "disarm", what: "weaken", penalty: 2 } }]);
    assert.deepEqual(registry.familyFor("check").gaps(disarm), []);
    const aid = plan({ success: { ...none, effects: [{ kind: "end-condition", slugs: ["dying"], stabilize: true }] } });
    const stabilized = registry.resolveSync(aid, context("fighter", ["ogre"]), at("success")).changes;
    assert.deepEqual(stabilized, [{ op: "end", target: "ogre", what: { conditions: ["dying"], from: null, stabilize: true } }]);
    assert.deepEqual(validateChanges(stabilized), []);
});

test("an automatic check rolls nothing: every target gets the success row (2026-10-10)", () => {
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    const burn = {
        modelVersion: 13, source: { name: "Burn Alive" }, rank: 1, traits: [],
        resolution: {
            kind: "check",
            check: { roll: "automatic", statistic: "automatic" },
            sharedDamage: { rollOnce: true, components: [{ id: "0", formula: "3d8[fire],1d8[persistent,fire]" }] },
            outcomes: { criticalSuccess: none, success: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["0"] }, effects: [prone()] }, failure: none, criticalFailure: none }
        }
    };
    let rolled = 0;
    const result = registry.resolveSync(burn, { caster: { id: "m" }, targets: [{ id: "a" }, { id: "b" }], statistic: () => ({ modifier: 0, dc: 10 }) }, { roll: () => { rolled++; return { degree: "failure" }; }, damage: () => 9 });
    assert.equal(rolled, 0, "no roll asked for");
    assert.deepEqual(result.changes.filter((change) => change.op === "condition").map((change) => [change.target, change.slug]), [["a", "persistent-damage"], ["a", "prone"], ["b", "persistent-damage"], ["b", "prone"]]);
    assert.ok(result.changes.some((change) => change.op === "damage" && change.target === "b"));
    assert.deepEqual(validateChanges(result.changes), []);
});

test("temporary Hit Points: a fixed amount, or the formula rolled (2026-10-10)", () => {
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    const plan = (effect) => ({
        modelVersion: 13, source: { name: "Fed by Water" }, rank: 1, traits: [],
        resolution: { kind: "check", check: { roll: "automatic", statistic: "automatic" }, sharedDamage: null, outcomes: { criticalSuccess: none, success: { ...none, effects: [effect] }, failure: none, criticalFailure: none } }
    });
    const minute = { mode: "fixed", value: 1, unit: "minutes", expiry: null, anchor: "effect-start" };
    const context = { caster: { id: "dragon" }, targets: [{ id: "dragon" }], statistic: () => ({ modifier: 0, dc: 10 }) };
    const fixed = registry.resolveSync(plan({ kind: "temp-hp", amount: 40, duration: minute }), context, { roll: () => ({ degree: "success" }), damage: () => 0 }).changes;
    assert.deepEqual(fixed.filter((change) => change.op === "tempHp"), [{ op: "tempHp", target: "dragon", amount: 40, duration: minute }]);
    assert.deepEqual(validateChanges(fixed), []);
    const rolled = registry.resolveSync(plan({ kind: "temp-hp", formula: "6d8", duration: minute }), context, { roll: () => ({ degree: "success" }), damage: () => 27 }).changes;
    assert.equal(rolled.find((change) => change.op === "tempHp").amount, 27);
});
