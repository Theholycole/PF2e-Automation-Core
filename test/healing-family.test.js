import test from "node:test";
import assert from "node:assert/strict";

import { CORE_FAMILIES, createRegistry, driveSync, healingGaps, missileCount, planWithActions, resolveSaveSync, validateChanges } from "../src/index.js";
import { healingSteps } from "../src/families/healing.js";
import { directDamageSteps } from "../src/families/direct-damage.js";

const rows = (byDegree) => Object.fromEntries(["criticalSuccess", "success", "failure", "criticalFailure"].map((degree) => [degree, { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [], ...byDegree[degree] }]));
const basic = rows({
    success: { damage: { mode: "shared", multiplier: 0.5, sourceComponentIds: ["0"] } },
    failure: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["0"] } },
    criticalFailure: { damage: { mode: "shared", multiplier: 2, sourceComponentIds: ["0"] } }
});

// Heal as the compiler will write it (2026-10-08 agreement): the save half for
// undead, the healing half for the living, and PF2e's 1/2/3-action overlays.
const HEAL = {
    modelVersion: 12,
    source: { name: "Heal" },
    rank: 1,
    activation: { time: "1 to 3" },
    targeting: { target: "1 willing living creature or 1 undead", range: "touch" },
    resolution: {
        kind: "save",
        check: { statistic: "fortitude", basic: true },
        sharedDamage: { rollOnce: true, components: [{ id: "0", formula: "1d8", type: "vitality" }], heightening: { type: "interval", interval: 1, damage: { 0: "1d8" } } },
        native: {
            healing: { components: [{ id: "h", formula: "1d8", kinds: ["healing"] }], heightening: { type: "interval", interval: 1, damage: { h: "1d8" } }, recipients: "living" },
            byActions: {
                1: { targeting: { range: "touch" } },
                2: { targeting: { range: "30 feet" }, healing: { components: [{ id: "h", formula: "1d8+8", kinds: ["healing"] }], heightening: { type: "interval", interval: 1, damage: { h: "1d8+8" } } } },
                3: { targeting: { range: null, area: { type: "emanation", value: 30 }, target: null } }
            }
        },
        outcomes: basic
    }
};

const SOOTHE = {
    modelVersion: 12,
    source: { name: "Soothe" },
    rank: 1,
    activation: { time: "2" },
    targeting: { target: "1 willing creature", range: "30 feet" },
    resolution: { kind: "healing", native: { healing: { components: [{ id: "0", formula: "1d10+4", kinds: ["healing"] }], heightening: { type: "interval", interval: 1, damage: { 0: "1d10+4" } }, recipients: "willing" } } }
};

const BARRAGE = {
    modelVersion: 12,
    source: { name: "Force Barrage" },
    rank: 1,
    activation: { time: "1 to 3" },
    targeting: { target: "1 creature", range: "120 feet" },
    resolution: {
        kind: "direct-damage",
        sharedDamage: null,
        native: { sharedDamage: { components: [{ id: "0", formula: "1d4+1", type: "force" }] }, missiles: { perActions: { 1: 1, 2: 2, 3: 3 }, perRanks: { interval: 2, extra: 1 } } }
    }
};

const creatures = {
    cleric: { id: "cleric", side: "party", traits: ["human"] },
    fighter: { id: "fighter", side: "party", traits: ["human"] },
    zombie: { id: "zombie", side: "foes", traits: ["undead", "zombie"] },
    ogre: { id: "ogre", side: "foes", traits: ["giant"] }
};
const context = (targets, extra = {}) => ({
    caster: creatures.cleric,
    targets: targets.map((id) => creatures[id]),
    statistic: (actor, slug) => (slug === "spell" ? { modifier: 10, dc: 20 } : { modifier: 5, dc: 15 }),
    allied: (a, b) => a.side === b.side,
    ...extra
});
const average = { roll: () => ({ degree: "failure" }) };

test("action variants: the overlay for the chosen count, the lowest without one", () => {
    assert.equal(planWithActions(HEAL, 2).targeting.range, "30 feet");
    assert.equal(planWithActions(HEAL, 2).resolution.native.healing.components[0].formula, "1d8+8");
    assert.equal(planWithActions(HEAL, 2).resolution.native.healing.recipients, "living", "unchanged keys stay");
    assert.deepEqual(planWithActions(HEAL, 3).targeting.area, { type: "emanation", value: 30 });
    assert.equal(planWithActions(HEAL, undefined).targeting.range, "touch");
    assert.equal(planWithActions(SOOTHE, 2), SOOTHE, "no variants: the plan as it is");
});

test("Heal: living targets are healed and don't save; undead save against the vitality damage", () => {
    const result = resolveSaveSync(HEAL, context(["fighter", "zombie"], { actions: 2, castRank: 3 }), average);
    // 3d8+24 healing at rank 3 with two actions (13.5 + 24, rounded down); 3d8 vitality on a failed save.
    assert.deepEqual(result.changes, [
        { op: "heal", target: "fighter", amount: 37 },
        { op: "damage", target: "zombie", instances: [{ type: "vitality", category: null, amount: 13 }] }
    ]);
    assert.deepEqual(Object.keys(result.degrees), ["zombie"]);
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(validateChanges(result.changes), []);
});

test("Soothe heals willing creatures (the caster's allies), not foes", () => {
    const result = driveSync(healingSteps(SOOTHE, context(["fighter", "ogre"], { castRank: 2 })), average);
    assert.deepEqual(result.changes, [{ op: "heal", target: "fighter", amount: 19 }]);
    assert.deepEqual(healingGaps(SOOTHE), []);
    // Only live play's own healing payload (no native numbers): a gap.
    assert.deepEqual(healingGaps({ resolution: { kind: "healing", healing: { formula: "4d8", recipient: "consumer" } } }).map((gap) => gap.what), ["healing without native numbers"]);
});

test("Force Barrage: missiles by actions and rank, spread over the targets and combined per target", () => {
    assert.equal(missileCount(BARRAGE, 1, 1), 1);
    assert.equal(missileCount(BARRAGE, 3, 1), 3);
    assert.equal(missileCount(BARRAGE, 3, 3), 6);
    assert.equal(missileCount(BARRAGE, 2, 5), 6);
    // Six missiles of 1d4+1 (3.5 each, rounded down to 3) over two targets.
    const result = driveSync(directDamageSteps(BARRAGE, context(["zombie", "ogre"], { actions: 3, castRank: 3 })), average);
    assert.deepEqual(result.changes, [
        { op: "damage", target: "zombie", instances: [{ type: "force", category: null, amount: 9 }] },
        { op: "damage", target: "ogre", instances: [{ type: "force", category: null, amount: 9 }] }
    ]);
    // All on one target: one change, six missiles.
    const focused = driveSync(directDamageSteps(BARRAGE, context(["ogre"], { actions: 3, castRank: 3 })), average);
    assert.equal(focused.changes[0].instances[0].amount, 18);
});

test("the core registers its families", async () => {
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    assert.deepEqual(registry.families().map((family) => family.kind).sort(), ["check", "direct-damage", "effect", "healing", "save", "unsupported"]);
    const live = await registry.resolve(SOOTHE, context(["fighter"]), { roll: () => ({ degree: "success" }), damage: () => 5 });
    assert.deepEqual(live.changes, [{ op: "heal", target: "fighter", amount: 5 }]);
});

test("effect: each PF2e spell effect on each target, the caster when there are none", async () => {
    const { effectSteps, effectGaps } = await import("../src/families/effect.js");
    const HASTE = { modelVersion: 12, source: { name: "Haste" }, rank: 3, targeting: { target: "1 creature", range: "30 feet" }, resolution: { kind: "effect", applications: [{ kind: "native-spell-effect", uuid: "Compendium.pf2e.spell-effects.Item.ElkXovNrHB0Doi6O" }] } };
    const result = driveSync(effectSteps(HASTE, context(["fighter"])), {});
    assert.deepEqual(result.changes, [{ op: "effect", target: "fighter", effect: { kind: "native", uuid: "Compendium.pf2e.spell-effects.Item.ElkXovNrHB0Doi6O", label: null } }]);
    assert.equal(driveSync(effectSteps(HASTE, context([])), {}).changes[0].target, "cleric", "self-only");
    assert.deepEqual(effectGaps(HASTE), []);
    assert.deepEqual(validateChanges(result.changes), []);
});

test("Soothe as compiled live: kind effect, with native healing for willing targets", async () => {
    const { effectSteps } = await import("../src/families/effect.js");
    const soothe = { ...SOOTHE, resolution: { kind: "effect", healing: { formula: "1d10+4", recipient: "target" }, native: SOOTHE.resolution.native, applications: [] } };
    const result = driveSync(effectSteps(soothe, context(["fighter", "ogre"], { castRank: 2 })), average);
    assert.deepEqual(result.changes, [{ op: "heal", target: "fighter", amount: 19 }]);
    assert.deepEqual(result.gaps, []);
});

test("unsupported: resolved from the native numbers alone, as PF2e's own card rolls them", async () => {
    const { unsupportedSteps, unsupportedGaps } = await import("../src/families/unsupported.js");
    const row = (multiplier) => ({ damage: multiplier ? { mode: "shared", multiplier, sourceComponentIds: ["0"] } : { mode: "none", multiplier: 0, sourceComponentIds: [] } });
    // Telekinetic Projectile: a spell attack with PF2e's own damage.
    const projectile = { modelVersion: 12, source: { name: "Telekinetic Projectile" }, rank: 1, targeting: { target: "1 creature", range: "30 feet" }, resolution: {
        kind: "unsupported", check: null, sharedDamage: null,
        native: { check: { statistic: "spell-attack" }, sharedDamage: { rollOnce: true, components: [{ id: "0", formula: "2d6", type: "bludgeoning" }], heightening: { type: "interval", interval: 1, damage: { 0: "1d6" } } }, outcomes: { criticalSuccess: row(2), success: row(1), failure: row(0), criticalFailure: row(0) } }
    } };
    const hit = driveSync(unsupportedSteps(projectile, context(["ogre"], { castRank: 3 })), { roll: () => ({ degree: "criticalSuccess" }) });
    // 4d6 at rank 3 (14), doubled.
    assert.deepEqual(hit.changes, [{ op: "damage", target: "ogre", instances: [{ type: "bludgeoning", category: null, amount: 28 }] }]);
    assert.deepEqual(hit.gaps, []);
    // Force Barrage through missiles; nothing native is a gap.
    const barrage = { ...BARRAGE, resolution: { ...BARRAGE.resolution, kind: "unsupported" } };
    assert.equal(driveSync(unsupportedSteps(barrage, context(["ogre"], { actions: 2 })), average).changes[0].instances[0].amount, 6);
    assert.deepEqual(unsupportedGaps({ resolution: { kind: "unsupported" } }).map((gap) => gap.what), ["nothing native"]);
    // PF2e lets the caster pick the damage type; the decision says which.
    const choosing = { ...projectile, resolution: { ...projectile.resolution, native: { ...projectile.resolution.native, damageTypeChoices: { 0: ["bludgeoning", "piercing", "slashing"] } } } };
    const typed = driveSync(unsupportedSteps(choosing, context(["ogre"])), { roll: () => ({ degree: "success" }), choose: (decision) => (decision.id === "damage-type:0" ? "slashing" : undefined) });
    assert.equal(typed.changes[0].instances[0].type, "slashing");
    assert.equal(typed.decisions[0].phase, "pre-cast");
});

test("variants: Lay on Hands heals the living and makes undead save; Blazing Bolt's damage comes with its action count", async () => {
    const { unsupportedSteps, unsupportedGaps } = await import("../src/families/unsupported.js");
    const row = (multiplier, id = "v") => ({ damage: multiplier ? { mode: "shared", multiplier, sourceComponentIds: [id] } : { mode: "none", multiplier: 0, sourceComponentIds: [] } });
    const basicRows = (id) => ({ criticalSuccess: row(0, id), success: row(0.5, id), failure: row(1, id), criticalFailure: row(2, id) });
    const layOnHands = { modelVersion: 12, source: { name: "Lay on Hands" }, rank: 1, targeting: { target: "1 willing living creature or 1 undead", range: "touch" }, resolution: {
        kind: "unsupported",
        native: { variants: [
            { name: "Vs. Undead", check: { statistic: "fortitude", basic: true }, sharedDamage: { components: [{ id: "v", formula: "1d6", type: "vitality" }] }, outcomes: basicRows("v") },
            { name: "Healing", healing: { components: [{ id: "h", formula: "6", kinds: ["healing"] }], heightening: { type: "interval", interval: 1, damage: { h: "6" } }, recipients: "living" } }
        ] }
    } };
    const result = driveSync(unsupportedSteps(layOnHands, context(["fighter", "zombie"], { castRank: 2 })), { roll: () => ({ degree: "failure" }) });
    assert.deepEqual(result.changes, [
        { op: "heal", target: "fighter", amount: 12 },
        { op: "damage", target: "zombie", instances: [{ type: "vitality", category: null, amount: 3 }] }
    ]);
    assert.deepEqual(Object.keys(result.degrees), ["zombie"]);
    assert.deepEqual(unsupportedGaps(layOnHands), []);

    const bolt = { modelVersion: 12, source: { name: "Blazing Bolt" }, rank: 2, targeting: { target: "1 creature", range: "60 feet" }, resolution: {
        kind: "unsupported", sharedDamage: null,
        native: { check: { statistic: "spell-attack" }, byActions: {
            1: { sharedDamage: { components: [{ id: "a", formula: "2d6", type: "fire" }] }, outcomes: { criticalSuccess: row(2, "a"), success: row(1, "a"), failure: row(0), criticalFailure: row(0) } },
            2: { sharedDamage: { components: [{ id: "b", formula: "4d6", type: "fire" }] }, outcomes: { criticalSuccess: row(2, "b"), success: row(1, "b"), failure: row(0), criticalFailure: row(0) } }
        } }
    } };
    const hit = (actions) => driveSync(unsupportedSteps(bolt, context(["ogre"], { actions })), { roll: () => ({ degree: "success" }) }).changes[0].instances[0].amount;
    assert.equal(hit(1), 7);
    assert.equal(hit(2), 14);
});

test("native applications: Bless reaches the caster and its allies in the area, not foes", async () => {
    const { unsupportedSteps, unsupportedGaps } = await import("../src/families/unsupported.js");
    const bless = { modelVersion: 12, source: { name: "Bless" }, rank: 1, targeting: { target: "you and allies in the area", area: { type: "emanation", value: 15 } }, resolution: {
        kind: "unsupported",
        native: { applications: [{ kind: "native-spell-effect", uuid: "Compendium.pf2e.spell-effects.Item.Gqy7K6FnbLtwGpud", label: "Spell Effect: Bless", recipients: "allies-in-area", area: { type: "emanation", value: 15 } }] }
    } };
    const result = driveSync(unsupportedSteps(bless, context(["cleric", "fighter", "ogre"])), {});
    assert.deepEqual(result.changes.map((change) => change.target), ["cleric", "fighter"]);
    assert.deepEqual(unsupportedGaps(bless), []);
    const self = { ...bless, resolution: { kind: "unsupported", native: { applications: [{ kind: "native-spell-effect", uuid: "x", recipients: "self" }] } } };
    assert.deepEqual(driveSync(unsupportedSteps(self, context(["ogre"])), {}).changes.map((change) => change.target), ["cleric"]);
});
