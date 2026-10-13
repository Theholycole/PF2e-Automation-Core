import test from "node:test";
import assert from "node:assert/strict";

import { parseDamage, expectedDamage, formatDamage, rollDamage } from "../src/model/dice.js";
import { resolveSave, resolveSaveSync, saveGaps, saveFamily, sharedComponentsAt } from "../src/families/save.js";
import { createRegistry, createSeededRoller, validateChanges, CORE_FAMILIES } from "../src/index.js";

const summary = (formula, options) => parseDamage(formula, options).map((instance) => `${formatDamage(instance)} ${instance.category ? `${instance.category} ` : ""}${instance.type}`);

test("damage formulas: dice, flavor, rank variables and functions", () => {
    assert.deepEqual(summary("6d6", { type: "fire" }), ["6d6 fire"]);
    assert.deepEqual(summary("1d6-2"), ["1d6-2 untyped"]);
    assert.deepEqual(summary("1d4[persistent,fire]"), ["1d4 persistent fire"]);
    assert.deepEqual(summary("(@item.level)d4[bleed]", { rank: 3 }), ["3d4 persistent bleed"]);
    assert.deepEqual(summary("(ternary(gte(@item.rank,10),115,100))[void]", { rank: 9 }), ["100 void"]);
    assert.deepEqual(summary("(ternary(gte(@item.rank,10),115,100))[void]", { rank: 10 }), ["115 void"]);
    assert.deepEqual(summary("(2d6+4)[fire] + 1d6[persistent,fire]"), ["2d6+4 fire", "1d6 persistent fire"]);
    assert.equal(expectedDamage(parseDamage("2*(1d8+3)")[0]), 15);
    assert.equal(rollDamage(parseDamage("3d6")[0], () => 0.999), 18);
    assert.equal(rollDamage(parseDamage("3d6")[0], () => 0), 3);
    assert.throws(() => parseDamage("2d6 +"), /ends early/);
});

// Minimal version-12 plans in the spell compiler's shape.
const degreeRows = (rows) => Object.fromEntries(["criticalSuccess", "success", "failure", "criticalFailure"].map((degree) => [degree, { damage: { mode: "none", multiplier: 0, sourceComponentIds: [] }, effects: [], ...rows[degree] }]));
const basicRows = (id = "0") => degreeRows({
    success: { damage: { mode: "shared", multiplier: 0.5, sourceComponentIds: [id] } },
    failure: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: [id] } },
    criticalFailure: { damage: { mode: "shared", multiplier: 2, sourceComponentIds: [id] } }
});
const plan = (name, rank, resolution) => ({ modelVersion: 12, source: { name }, rank, resolution: { kind: "save", ...resolution } });

const FIREBALL = plan("Fireball", 3, {
    check: { statistic: "reflex", basic: true, dcSource: "source-actor" },
    sharedDamage: { mode: "pf2e-item-damage", rollOnce: true, components: [{ id: "0", formula: "6d6", type: "fire", category: null }], heightening: { type: "interval", interval: 1, damage: { 0: "2d6" } } },
    outcomes: basicRows()
});

const IGNITION = plan("Ignition", 1, {
    check: { statistic: "spell-attack", basic: false, dcSource: "source-actor" },
    sharedDamage: { rollOnce: true, components: [{ id: "c", formula: "2d4", type: "fire", category: null }], heightening: { type: "interval", interval: 1, damage: { c: "1d4" } } },
    outcomes: degreeRows({
        criticalSuccess: { damage: { mode: "mixed", shared: { multiplier: 2, sourceComponentIds: ["c"] }, formulas: [{ formula: "1d4[persistent,fire]", heightening: { type: "interval", interval: 1, formula: "1d4" } }], rollScope: "outcome" } },
        success: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["c"] } }
    })
});

const condition = (slug, value, duration = null) => ({ kind: "condition", slug, value, duration });
const FEAR = plan("Fear", 1, {
    check: { statistic: "will", basic: false, dcSource: "source-actor" },
    sharedDamage: null,
    outcomes: degreeRows({
        success: { effects: [condition("frightened", 1)] },
        failure: { effects: [condition("frightened", 2)] },
        criticalFailure: { effects: [condition("frightened", 3), condition("fleeing", null, { mode: "fixed", value: 1, unit: "rounds" })] }
    })
});

// Statistics and a roller that returns the degree each target is set to roll.
function scene({ degrees, damage = (instance) => Math.floor(expectedDamage(instance)), choose } = {}) {
    const calls = [];
    const creatures = {
        caster: { id: "caster", spell: { modifier: 12, dc: 22 } },
        a: { id: "a", reflex: { modifier: 8 }, will: { modifier: 6 }, fortitude: { modifier: 9 }, ac: { dc: 18 }, traits: [] },
        b: { id: "b", reflex: { modifier: 4 }, will: { modifier: 10 }, fortitude: { modifier: 3 }, ac: { dc: 20 }, traits: ["water"] }
    };
    const context = {
        caster: creatures.caster,
        targets: [creatures.a, creatures.b],
        statistic: (actor, slug) => actor[slug] ?? null
    };
    const io = {
        roll: (statistic, options) => {
            calls.push({ statistic, actor: options.actor.id, modifier: options.modifier, dc: options.dc });
            const target = statistic === "spell-attack" || statistic === "strike" ? options.target.id : options.actor.id;
            return { degree: degrees[target] };
        },
        damage,
        choose
    };
    return { context, io, calls, creatures };
}

test("a basic save: shared damage rolled once, halved and doubled by degree, heightened by rank", async () => {
    const { context, io, calls } = scene({ degrees: { a: "success", b: "criticalFailure" } });
    const result = await resolveSave(FIREBALL, { ...context, castRank: 5 }, io);
    // 10d6 at rank 5: 35 on average.
    assert.deepEqual(result.changes, [
        { op: "damage", target: "a", instances: [{ type: "fire", category: null, amount: 17 }] },
        { op: "damage", target: "b", instances: [{ type: "fire", category: null, amount: 70 }] }
    ]);
    assert.deepEqual(calls.map((call) => [call.statistic, call.actor, call.modifier, call.dc]), [["reflex", "a", 8, 22], ["reflex", "b", 4, 22]]);
    assert.deepEqual(result.degrees, { a: "success", b: "criticalFailure" });
    assert.deepEqual(result.gaps, []);
    assert.deepEqual(validateChanges(result.changes), []);
});

test("a spell attack: the caster rolls against each AC; a critical hit doubles and adds persistent damage", async () => {
    const { context, io, calls } = scene({ degrees: { a: "criticalSuccess", b: "failure" } });
    const result = await resolveSave(IGNITION, { ...context, castRank: 3 }, io);
    assert.deepEqual(calls.map((call) => [call.statistic, call.actor, call.modifier, call.dc]), [["spell-attack", "caster", 12, 18], ["spell-attack", "caster", 12, 20]]);
    // 4d4 at rank 3 (10 on average), doubled; 3d4 persistent fire.
    assert.deepEqual(result.changes, [
        { op: "damage", target: "a", instances: [{ type: "fire", category: null, amount: 20 }] },
        { op: "condition", target: "a", slug: "persistent-damage", value: null, damage: { type: "fire", dice: [{ count: 1, die: 4, factor: 1 }, { count: 1, die: 4, factor: 2 }], constant: 0, amount: 7 } }
    ]);
});

test("conditions by degree, with their durations", async () => {
    const { context, io } = scene({ degrees: { a: "failure", b: "criticalFailure" } });
    const result = await resolveSave(FEAR, context, io);
    assert.deepEqual(result.changes, [
        { op: "condition", target: "a", slug: "frightened", value: 2, duration: null },
        { op: "condition", target: "b", slug: "frightened", value: 3, duration: null },
        { op: "condition", target: "b", slug: "fleeing", value: null, duration: { mode: "fixed", value: 1, unit: "rounds" } }
    ]);
});

test("decisions: a trait adjusts the degree by itself, otherwise the GM is asked; a pre-roll answer sets a modifier", async () => {
    const parch = plan("Parch", 1, {
        ...FEAR.resolution,
        check: { statistic: "fortitude", basic: false },
        degreeAdjustment: { predicate: { kind: "trait-or-gm-confirmed", traits: ["water"], question: "Made of liquid?" }, map: { criticalSuccess: "success", success: "failure", failure: "criticalFailure", criticalFailure: "criticalFailure" } },
        attackAdjustment: { question: "Gnome?", appliesTo: "save", choices: [{ label: "Yes (−2)", value: -2 }, { label: "No", value: 0 }] }
    });
    const asked = [];
    const { context, io, calls } = scene({ degrees: { a: "success", b: "success" }, choose: (decision) => { asked.push(decision.id); return decision.id === "attack-adjustment:a" ? -2 : decision.id === "degree-adjustment:a"; } });
    const result = await resolveSave(parch, context, io);
    // b has the water trait: one degree worse without a question. a: the GM said yes.
    assert.deepEqual(result.degrees, { a: "failure", b: "failure" });
    assert.deepEqual(asked, ["attack-adjustment:a", "degree-adjustment:a", "attack-adjustment:b"]);
    assert.deepEqual(calls.map((call) => call.modifier), [9 - 2, 3]);
    assert.deepEqual(result.decisions.map((decision) => decision.phase), ["pre-roll", "post-roll", "pre-roll"]);
    // With no answers, each decision takes its default: no adjustment for a.
    const quiet = scene({ degrees: { a: "success", b: "success" } });
    assert.deepEqual((await resolveSave(parch, quiet.context, quiet.io)).degrees, { a: "success", b: "failure" });
});

test("forced movement, a shared multiple attack penalty, bleed and fixed heightening", async () => {
    const pull = plan("Gravity Well", 1, { ...FEAR.resolution, outcomes: degreeRows({ failure: { forcedMovement: { kind: "pull", distance: 10, upTo: false, optional: false, direction: "center" } } }) });
    const one = scene({ degrees: { a: "failure", b: "success" } });
    assert.deepEqual((await resolveSave(pull, one.context, one.io)).changes, [{ op: "move", target: "a", kind: "pull", distance: 10, direction: "center", upTo: false, optional: false }]);

    const gust = plan("Slashing Gust", 1, {
        check: { statistic: "spell-attack", sharedMultipleAttackPenalty: true },
        sharedDamage: { components: [{ id: "g", formula: "2d4", type: "slashing" }] },
        outcomes: degreeRows({ success: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["g"] } }, criticalSuccess: { damage: { mode: "mixed", shared: { multiplier: 2, sourceComponentIds: ["g"] }, formulas: [{ formula: "(@item.level)d4[bleed]" }], rollScope: "outcome" } } })
    });
    const two = scene({ degrees: { a: "criticalSuccess", b: "success" } });
    const result = await resolveSave(gust, { ...two.context, castRank: 2 }, two.io);
    assert.deepEqual(two.calls.map((call) => call.modifier), [12, 7]);
    assert.deepEqual(result.changes.find((change) => change.slug === "persistent-damage").damage.type, "bleed");

    const fixed = { components: [{ id: "x", formula: "4d8", type: "piercing" }], heightening: { type: "fixed", levels: { 9: { damage: { x: { formula: "5d8", type: "piercing" } } } } } };
    assert.equal(formatDamage(sharedComponentsAt(fixed, 7, 8)[0].instances[0]), "4d8");
    assert.equal(formatDamage(sharedComponentsAt(fixed, 7, 9)[0].instances[0]), "5d8");
});

test("gaps name what the family doesn't model yet; note effects, PF2e spell effects and manual steps become changes", async () => {
    assert.deepEqual(saveGaps(FIREBALL), []);
    const wall = plan("Wall", 1, {
        ...FIREBALL.resolution,
        lingering: { kind: "area" },
        reminders: [{ text: "Objects take it too." }],
        outcomes: degreeRows({ failure: { noteEffects: [{ label: "Hourly damage" }], nativeEffects: [{ kind: "native-spell-effect", uuid: "Compendium.pf2e.spell-effects.Item.x", label: "Spell Effect: X", recipient: { actor: "target" } }], manualInstructions: ["Move it 5 feet."] } })
    });
    assert.deepEqual(saveGaps(wall).map((gap) => gap.what), ["lingering"]);
    const { context, io } = scene({ degrees: { a: "failure", b: "success" } });
    const changes = (await resolveSave(wall, context, io)).changes.filter((change) => change.op !== "damage");
    assert.deepEqual(changes, [
        { op: "effect", target: "a", effect: { kind: "note", note: { label: "Hourly damage" } } },
        { op: "effect", target: "a", effect: { kind: "native", uuid: "Compendium.pf2e.spell-effects.Item.x", label: "Spell Effect: X" } },
        { op: "note", audience: "gm", target: "a", text: "Move it 5 feet.", manual: true },
        { op: "note", audience: "gm", text: "Objects take it too." }
    ]);
    assert.deepEqual(validateChanges(changes), []);
});

test("choices, damage pools, death and follow-up saves", async () => {
    // Invoke the Harrow: the caster's option picks which note effect applies.
    const harrow = plan("Harrow", 1, {
        check: { statistic: "will" },
        casterChoice: { kind: "option", values: ["keys", "books"], labels: { keys: "Keys", books: "Books" }, label: "Suit" },
        outcomes: degreeRows({ failure: { noteEffects: [{ label: "Keys", choiceGroup: "caster-option", option: "keys" }, { label: "Books", choiceGroup: "caster-option", option: "books" }] } })
    });
    const one = scene({ degrees: { a: "failure", b: "success" }, choose: (decision) => (decision.id === "caster-choice:option" ? "books" : undefined) });
    const result = await resolveSave(harrow, one.context, one.io);
    assert.deepEqual(result.changes.map((change) => change.effect.note.label), ["Books"]);
    assert.equal(result.decisions[0].phase, "pre-cast");

    // Damage read from the text: its formula scales with rank; the chosen type replaces "untyped".
    const murmuration = plan("Murmuration", 1, {
        check: { statistic: "fortitude", basic: true },
        casterChoice: { kind: "damage-type", values: ["piercing", "sonic"], label: "Damage type" },
        sharedDamage: { mode: "formula", formula: "(@item.rank)d4[untyped]", components: [{ id: "t", formula: "1d4", type: "untyped" }] },
        outcomes: degreeRows({
            failure: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["t"] } },
            criticalFailure: { damage: { mode: "formulas", formulas: [{ formula: "(@item.rank)d4[sonic],(@item.rank)d4[piercing]" }], rollScope: "outcome" }, terminal: { kind: "death", label: "Dies", automatic: true } }
        })
    });
    const two = scene({ degrees: { a: "failure", b: "criticalFailure" }, choose: (decision) => (decision.id === "caster-choice:damage-type" ? "sonic" : undefined) });
    const damage = await resolveSave(murmuration, { ...two.context, castRank: 4 }, two.io);
    assert.deepEqual(damage.changes, [
        { op: "damage", target: "a", instances: [{ type: "sonic", category: null, amount: 10 }] },
        { op: "damage", target: "b", instances: [{ type: "sonic", category: null, amount: 10 }, { type: "piercing", category: null, amount: 10 }] },
        { op: "death", target: "b" }
    ]);

    // Phantasmal Calamity: a second save is a plan of its own.
    const calamity = plan("Calamity", 6, { ...FEAR.resolution, outcomes: degreeRows({ criticalFailure: { followUps: [{ kind: "save", check: { statistic: "reflex" }, outcomes: degreeRows({ failure: { effects: [condition("immobilized", null)] } }) }] } }) });
    const three = scene({ degrees: { a: "criticalFailure", b: "failure" } });
    const followUp = (await resolveSave(calamity, three.context, three.io)).changes[0];
    assert.equal(followUp.op, "followUp");
    assert.equal(followUp.target, "a");
    const four = scene({ degrees: { a: "failure" } });
    assert.deepEqual((await resolveSave(followUp.plan, { ...four.context, targets: [four.creatures.a] }, four.io)).changes, [{ op: "condition", target: "a", slug: "immobilized", value: null, duration: null }]);
    // (2026-10-12: a follow-up with its own affliction — the poison's save after a failed first one, its stages handed on.)
    const handoff = { handler: "pseudo-afflictions", name: "Test Venom", stages: [{ stage: 1 }] };
    const venom = plan("Venom", 1, { ...FEAR.resolution, outcomes: degreeRows({ failure: { followUps: [{ kind: "save", check: { statistic: "fortitude" }, outcomes: degreeRows({ failure: { affliction: { stage: 1 } } }), afflictionHandoff: handoff }] } }) });
    const five = scene({ degrees: { a: "failure" } });
    const poison = (await resolveSave(venom, five.context, five.io)).changes[0];
    assert.deepEqual([poison.op, poison.plan.resolution.afflictionHandoff, poison.plan.targeting.target], ["followUp", handoff, "1 creature"]);
    const six = scene({ degrees: { a: "failure" } });
    assert.deepEqual((await resolveSave(poison.plan, { ...six.context, targets: [six.creatures.a] }, six.io)).changes, [{ op: "affliction", target: "a", data: { ...handoff, stage: 1 } }]);
});

test("the core registers the save family; registry.resolve runs it with the seeded roller", async () => {
    assert.ok(CORE_FAMILIES.includes(saveFamily));
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    assert.throws(() => registry.registerFamily({ ...saveFamily, module: "pf2e-automatic-resolution" }), /already registered/);
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const { context } = scene({ degrees: {} });
    const result = await registry.resolve(FIREBALL, context, createSeededRoller(random));
    assert.equal(Object.keys(result.degrees).length, 2);
    for (const change of result.changes) assert.ok(change.instances[0].amount >= 0);
    // The same seed gives the same result, awaited or not.
    seed = 1;
    const first = await registry.resolve(FIREBALL, context, createSeededRoller(random));
    seed = 1;
    assert.deepEqual(registry.resolveSync(FIREBALL, context, createSeededRoller(random)), first);
});

test("the sync driver: the planner can force a degree and use average damage; a promise is refused", () => {
    const { context } = scene({ degrees: {} });
    const forced = (degree) => resolveSaveSync(FIREBALL, context, { roll: () => ({ degree }) });
    assert.deepEqual(forced("failure").changes.map((change) => change.instances[0].amount), [21, 21]);
    assert.deepEqual(forced("success").changes.map((change) => change.instances[0].amount), [10, 10]);
    assert.throws(() => resolveSaveSync(FIREBALL, context, { roll: async () => ({ degree: "failure" }) }), /use drive/);
});

test("persistent damage in a basic save's shared damage says when the save halved or doubled it", () => {
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    const plan = {
        modelVersion: 13,
        source: { name: "Searing Spray", type: "action" },
        rank: 1,
        traits: [],
        activation: { time: "2", traits: [] },
        automation: { level: "automatic" },
        targeting: { target: "1 creature", range: "touch", area: null },
        trigger: { event: "use" },
        resolution: {
            kind: "save",
            check: { roll: "save", statistic: "reflex", basic: true, against: { dc: "fixed", value: 20 } },
            sharedDamage: { rollOnce: true, components: [{ id: "0", formula: "2d6[fire],1d4[persistent,fire]", type: null, category: null }] },
            outcomes: { criticalSuccess: { damage: { mode: "shared", multiplier: 0, sourceComponentIds: [] }, effects: [] }, success: { damage: { mode: "shared", multiplier: 0.5, sourceComponentIds: ["0"] }, effects: [] }, failure: { damage: { mode: "shared", multiplier: 1, sourceComponentIds: ["0"] }, effects: [] }, criticalFailure: { damage: { mode: "shared", multiplier: 2, sourceComponentIds: ["0"] }, effects: [] } }
        }
    };
    const context = { caster: { id: "m", side: "foes" }, targets: [{ id: "t", side: "party" }], statistic: () => ({ modifier: 10 }), allied: () => false };
    const persistent = (degree) => registry.resolveSync(plan, context, { roll: () => ({ degree }) }).changes.find((change) => change.slug === "persistent-damage").damage;
    assert.equal(persistent("failure").multiplier, undefined);
    assert.equal(persistent("criticalFailure").multiplier, 2);
    assert.deepEqual(persistent("failure").dice.map((term) => `${term.count}d${term.die}`), ["1d4"]);
});

test("a condition that grows with each later failure carries its stack to the runtime (2026-10-11)", async () => {
    const caress = plan("Test Caress", 1, {
        check: { statistic: "will", basic: false, dcSource: "source-actor" },
        sharedDamage: null,
        outcomes: degreeRows({
            failure: { effects: [{ ...condition("stupefied", 1), stack: { by: 1, max: 4 } }] },
            criticalFailure: { effects: [{ ...condition("stupefied", 2), stack: { by: 2, max: 4 } }] }
        })
    });
    const { context, io } = scene({ degrees: { a: "failure", b: "criticalFailure" } });
    const result = await resolveSave(caress, context, io);
    assert.deepEqual(result.changes, [
        { op: "condition", target: "a", slug: "stupefied", value: 1, duration: null, stack: { by: 1, max: 4 } },
        { op: "condition", target: "b", slug: "stupefied", value: 2, duration: null, stack: { by: 2, max: 4 } }
    ]);
    assert.deepEqual(validateChanges(result.changes), []);
});

test("a worse condition for a creature that already has the first carries to the runtime (2026-10-11)", async () => {
    const gaze = plan("Test Gaze", 1, {
        check: { statistic: "fortitude", basic: false, dcSource: "source-actor" },
        sharedDamage: null,
        outcomes: degreeRows({ failure: { effects: [{ ...condition("slowed", 1), escalate: { if: "slowed", slug: "petrified", value: null, duration: null } }] } })
    });
    const { context, io } = scene({ degrees: { a: "failure" } });
    const result = await resolveSave(gaze, context, io);
    assert.deepEqual(result.changes, [{ op: "condition", target: "a", slug: "slowed", value: 1, duration: null, escalate: { if: "slowed", slug: "petrified", value: null, duration: null } }]);
});

test("a bonus on the actor against the target only (2026-10-13): the change names that target", async () => {
    const duration = { mode: "fixed", value: 1, unit: "minutes" };
    const gauge = plan("Test Gauge", 1, { ...FEAR.resolution, outcomes: degreeRows({ failure: { modifiers: [{ selector: "ac", value: 2, type: "circumstance", recipient: "self", against: "target", duration }] } }) });
    const { context, io } = scene({ degrees: { a: "failure", b: "success" } });
    const result = await resolveSave(gauge, context, io);
    assert.deepEqual(result.changes, [{ op: "effect", target: "caster", effect: { kind: "modifier", modifier: { selector: "ac", value: 2, type: "circumstance", recipient: "self", against: "target", duration } }, against: "a" }]);
});
