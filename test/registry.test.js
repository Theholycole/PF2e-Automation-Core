import test from "node:test";
import assert from "node:assert/strict";

import { createRegistry, createSeededRoller, makeDecision, missingServices } from "../src/index.js";

// A tiny save family, as a content module would register it.
const saveFamily = {
    kind: "save",
    module: "test-spells",
    validate: (resolution) => (resolution.check ? [] : ["A save needs a check."]),
    async resolve(plan, context, io) {
        const target = context.targets[0];
        const roll = io.roll("save", { modifier: 5, dc: 20 });
        const multiplier = { criticalSuccess: 0, success: 0.5, failure: 1, criticalFailure: 2 }[roll.degree];
        return {
            degrees: { [target]: roll.degree },
            changes: multiplier ? [{ op: "damage", target, instances: [{ type: "fire", amount: Math.floor(20 * multiplier) }] }] : [],
            decisions: [makeDecision({ id: "confirm", phase: "apply", question: "Apply?", options: [{ value: true, label: "Yes" }], default: true })]
        };
    }
};

test("one family per kind: another module can't take a kind over", () => {
    const registry = createRegistry();
    registry.registerFamily(saveFamily);
    assert.throws(() => registry.registerFamily({ ...saveFamily, module: "other-module" }), /already registered by test-spells/);
    registry.registerFamily({ ...saveFamily, validate: undefined });
    assert.equal(registry.familyFor("save").validate, undefined, "same module re-registers (a reload)");
    assert.throws(() => registry.registerFamily({ kind: "x", module: "m" }), /resolve/);
});

test("plans come from the first compiler that handles the item, cached", () => {
    const registry = createRegistry();
    let compiled = 0;
    registry.registerCompiler({ module: "test-spells", name: "spells", handles: (item) => item.type === "spell", compile: (item) => { compiled++; return { modelVersion: 12, source: { name: item.name }, resolution: { kind: "save", check: { statistic: "reflex" }, outcomes: {} } }; } });
    const spell = { _id: "a1", name: "Fireball", type: "spell" };
    const first = registry.planFor(spell);
    registry.planFor(spell);
    assert.equal(compiled, 1);
    assert.equal(first.module, "test-spells");
    assert.equal(first.plan.resolution.check.roll, "save", "read in version-13 form");
    assert.equal(registry.planFor({ _id: "f1", name: "Power Attack", type: "feat" }), null);
});

test("an async compiler: planFor asks for preparePlan; after it, planFor answers from the cache", async () => {
    const registry = createRegistry();
    let compiled = 0;
    const plan = (name) => ({ modelVersion: 12, source: { name }, resolution: { kind: "save", check: { statistic: "spell-attack" }, outcomes: {} } });
    registry.registerCompiler({ module: "spells", handles: (item) => item.type === "spell", compile: async (item) => { compiled++; if (item.name === "Broken") throw new Error("no text"); return plan(item.name); } });
    const ignition = { _id: "i1", name: "Ignition", type: "spell" };
    assert.throws(() => registry.planFor(ignition), /preparePlan/);
    const prepared = await registry.preparePlans([ignition, { _id: "b1", name: "Broken", type: "spell" }, { _id: "f1", name: "Feat", type: "feat" }]);
    assert.equal(prepared[0].result.plan.resolution.check.roll, "attack");
    assert.match(prepared[1].error.message, /no text/);
    assert.equal(prepared[2].result, null, "no compiler handles a feat");
    const before = compiled;
    assert.equal(registry.planFor(ignition).plan.source.name, "Ignition");
    assert.equal(await registry.preparePlan(ignition).then((result) => result.module), "spells");
    assert.equal(compiled, before, "both answered from the cache");
});

test("validatePlan adds the family's own checks", () => {
    const registry = createRegistry();
    registry.registerFamily(saveFamily);
    const good = registry.validatePlan({ modelVersion: 12, source: { name: "x" }, resolution: { kind: "save", check: {}, outcomes: {} } });
    assert.deepEqual([good.ok, good.registered], [true, true]);
    const bad = registry.validatePlan({ modelVersion: 12, source: { name: "x" }, resolution: { kind: "save", outcomes: {} } });
    assert.equal(bad.ok, false);
    assert.equal(registry.validatePlan({ modelVersion: 12, source: { name: "x" }, resolution: { kind: "unknown" } }).registered, false);
});

test("resolve runs the family with a seeded roller and checks what it returns", async () => {
    const registry = createRegistry();
    registry.registerFamily(saveFamily);
    let seed = 0.6;
    const io = { roll: createSeededRoller(() => seed).roll };
    const plan = { modelVersion: 12, source: { name: "Fireball" }, resolution: { kind: "save", check: { statistic: "reflex" }, outcomes: {} } };
    const result = await registry.resolve(plan, { targets: ["goblin"] }, io);
    // d20 = 13, +5 = 18 vs DC 20: failure, full damage.
    assert.equal(result.degrees.goblin, "failure");
    assert.deepEqual(result.changes, [{ op: "damage", target: "goblin", instances: [{ type: "fire", amount: 20 }] }]);
    assert.equal(result.decisions[0].phase, "apply");
    seed = 0.99;
    assert.deepEqual((await registry.resolve(plan, { targets: ["goblin"] }, io)).changes, [], "a critical success takes nothing");
});

test("a family returning a malformed change is caught, naming the module", async () => {
    const registry = createRegistry();
    registry.registerFamily({ kind: "broken", module: "sloppy-module", resolve: async () => ({ changes: [{ op: "heal", target: "x" }] }) });
    await assert.rejects(registry.resolve({ modelVersion: 13, source: { name: "x" }, resolution: { kind: "broken" } }, {}, {}), /sloppy-module \(broken\)/);
    await assert.rejects(registry.resolve({ modelVersion: 13, source: { name: "x" }, resolution: { kind: "nobody" } }, {}, {}), /No family/);
});

test("ongoing records resolve events through their family", async () => {
    const registry = createRegistry();
    registry.registerFamily({ kind: "aura", module: "abilities", resolve: async () => ({}), resolveEvent: async (record, event) => ({ changes: [{ op: "condition", target: event.actor, slug: "frightened", value: 1 }], record }) });
    const result = await registry.resolveEvent({ kind: "aura" }, { type: "start-turn", actor: "pc" }, {}, {});
    assert.equal(result.changes[0].slug, "frightened");
});

test("the roller handles fortune, misfortune, the d20 clamp and degree maps", () => {
    const rolls = [0.1, 0.9];
    let i = 0;
    const next = () => rolls[i++ % rolls.length];
    const roller = createSeededRoller(next);
    assert.equal(roller.roll("x", { fortune: true }).natural, 19);
    i = 0;
    assert.equal(roller.roll("x", { misfortune: true }).natural, 3);
    i = 0;
    assert.equal(roller.roll("x", { fortune: true, misfortune: true }).natural, 3, "they cancel: one roll");
    i = 0;
    assert.equal(roller.roll("x", { minimumNatural: 10 }).natural, 10);
    i = 0;
    assert.equal(roller.roll("x", { modifier: 20, dc: 20, degreeMap: { success: "criticalSuccess" } }).degree, "criticalSuccess");
});

test("missing context services are named", () => {
    assert.deepEqual(missingServices({ distance: () => 5 }, ["distance", "iwr"]), ["iwr"]);
});
