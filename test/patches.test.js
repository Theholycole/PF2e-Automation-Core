import test from "node:test";
import assert from "node:assert/strict";

import { clampD20, combineD20Limits, d20Mark, readD20Mark, selectiveDifficulty, terrainEffects, damageMemoryFrom, recentSource, rewriteRules, transformCreated, isSystemContextMessage, isTurnChange } from "../src/patch-logic.js";

test("d20 limits: the tightest wins, and the clamp applies them", () => {
    assert.deepEqual(combineD20Limits([{ min: 5 }, { min: 10, max: 18 }, null, { max: 15 }]), { min: 10, max: 15 });
    assert.equal(combineD20Limits([null, {}]), null);
    assert.equal(clampD20(3, { min: 10 }), 10);
    assert.equal(clampD20(19, { max: 10 }), 10);
    assert.deepEqual(readD20Mark(["other", d20Mark({ min: 10, max: null })]), { min: 10, max: null });
    assert.equal(readD20Mark(["other"]), null);
});

test("selective terrain: listed creatures, by size, the living, the default", () => {
    const creature = (overrides = {}) => ({ uuid: "Actor.a", isCreature: true, size: "med", modeOfBeing: "living", ...overrides });
    // Steel Fortifications: Medium and larger.
    const bySize = { bySize: { min: "med", difficulty: 2 }, default: 1 };
    assert.equal(selectiveDifficulty(bySize, creature(), "walk"), 2);
    assert.equal(selectiveDifficulty(bySize, creature({ size: "sm" }), "walk"), 1);
    // Tear the Veil: living creatures only.
    const living = { living: { difficulty: 2 } };
    assert.equal(selectiveDifficulty(living, creature(), "walk"), 2);
    assert.equal(selectiveDifficulty(living, creature({ modeOfBeing: "undead" }), "walk"), 1);
    // Per creature, and only for the listed movement.
    const listed = { creatures: [{ actorUuid: "Actor.a", difficulty: 3 }], actions: ["walk", "fly"] };
    assert.equal(selectiveDifficulty(listed, creature(), "fly"), 3);
    assert.equal(selectiveDifficulty(listed, creature(), "swim"), null);
    assert.deepEqual(terrainEffects(2), [{ name: "difficulty", difficulty: 2 }]);
    assert.deepEqual(terrainEffects(1), []);
});

test("damage memory: types, source, and the ten-second window", () => {
    const memory = damageMemoryFrom({ damage: { instances: [{ type: "fire" }, { type: "slashing" }] }, item: { uuid: "Item.x", type: "weapon", isRanged: true, actor: { uuid: "Actor.y" } } }, 1000);
    assert.deepEqual(memory.types, { types: ["fire", "slashing"], at: 1000 });
    assert.deepEqual(recentSource(memory.source, 5000), { uuid: "Item.x", actor: "Actor.y", type: "weapon", ranged: true });
    assert.equal(recentSource(memory.source, 20000), null);
    assert.equal(damageMemoryFrom({}, 1).types, null);
});

test("pipelines apply every module's rewriter in order and survive a broken one", () => {
    const rewriters = [
        { module: "a", rewrite: (item, rules) => [...rules, { key: "A" }] },
        { module: "broken", rewrite: () => { throw new Error("oops"); } },
        { module: "b", rewrite: (item, rules) => rules.filter((rule) => rule.key !== "Old") }
    ];
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.deepEqual(rewriteRules(rewriters, { name: "x" }, [{ key: "Old" }, { key: "Keep" }]), [{ key: "Keep" }, { key: "A" }]);
        assert.deepEqual(transformCreated([{ module: "a", transform: (entry) => ({ ...entry, tagged: true }) }], [{ name: "e" }], {}), [{ name: "e", tagged: true }]);
    } finally {
        console.warn = warn;
    }
});

test("conventions", () => {
    assert.equal(isSystemContextMessage({ flags: { pf2e: { context: { type: "damage-taken" } } } }), true);
    assert.equal(isSystemContextMessage({ flags: {} }), false);
    assert.equal(isTurnChange({ turn: 2 }), true);
    assert.equal(isTurnChange({ flags: {} }), false);
});

// A minimal stand-in for Foundry and PF2e, to check the install rules.
function fakeFoundry({ spellModulePatches }) {
    const hooks = {};
    class Actor { applyDamage(params) { return `applied ${params?.damage?.instances?.length ?? 0}`; } get uuid() { return "Actor.t"; } }
    class ItemPF2e { prepareRuleElements() { return this.system.rules; } static async createDocuments(data) { return data; } }
    class FeatPF2e extends ItemPF2e {}
    class CheckRoll { async evaluate() { return this; } }
    const Check = { roll: async () => "rolled" };
    class ModifyMovementCost { _getTerrainEffects() { return ["original"]; } }
    if (spellModulePatches) {
        Actor.prototype.__pf2eAutoDamageTypes = true;
        ItemPF2e.prototype.prepareRuleElements["pf2e-automatic-resolution"] = true;
        Check.roll["pf2e-automatic-resolution"] = true;
        ModifyMovementCost.prototype._pf2eAutoSelective = true;
    }
    globalThis.CONFIG = {
        Actor: { documentClass: Actor },
        PF2E: { Item: { documentClasses: { feat: FeatPF2e } } },
        Dice: { rolls: [CheckRoll] },
        RegionBehavior: { dataModels: { modifyMovementCost: ModifyMovementCost } }
    };
    globalThis.game = { pf2e: { Check }, actors: [], user: { isGM: true, id: "gm" }, users: { activeGM: { id: "gm" }, filter: () => [] } };
    globalThis.Hooks = { on: (name, fn) => (hooks[name] ??= []).push(fn), once: (name, fn) => (hooks[name] ??= []).push(fn) };
    return { Actor, ItemPF2e, Check, CheckRoll, ModifyMovementCost, hooks };
}

async function install(fake, { beforeSetup = null } = {}) {
    const { installEarlyPatches, installPatches, patchesApi } = await import(`../scripts/patches.js?fresh=${Math.random()}`);
    beforeSetup?.(patchesApi);
    installEarlyPatches();
    const afterSetup = patchesApi.status();
    installPatches();
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { patchesApi, fake, afterSetup };
}

test("the core stands aside while the spell module still patches", async () => {
    const fake = fakeFoundry({ spellModulePatches: true });
    const originals = { damage: fake.Actor.prototype.applyDamage, rules: fake.ItemPF2e.prototype.prepareRuleElements, roll: fake.Check.roll, terrain: fake.ModifyMovementCost.prototype._getTerrainEffects };
    const { patchesApi } = await install(fake);
    assert.deepEqual(patchesApi.status(), { damage: "spell-module", rules: "spell-module", d20: "spell-module", terrain: "spell-module" });
    assert.equal(fake.Actor.prototype.applyDamage, originals.damage);
    assert.equal(fake.ItemPF2e.prototype.prepareRuleElements, originals.rules);
    assert.equal(fake.Check.roll, originals.roll);
    assert.equal(fake.ModifyMovementCost.prototype._getTerrainEffects, originals.terrain);
    assert.equal(fake.hooks.preCreateChatMessage, undefined, "no second damage stamp");
});

test("once the spell module stops, the core patches each function once and providers plug in", async () => {
    const fake = fakeFoundry({ spellModulePatches: false });
    const { patchesApi } = await install(fake);
    assert.deepEqual(patchesApi.status(), { damage: "core", rules: "core", d20: "core", terrain: "core" });
    const wrapped = fake.Actor.prototype.applyDamage;
    // Installing again doesn't wrap again.
    const again = await install(fake);
    assert.equal(fake.Actor.prototype.applyDamage, wrapped);
    assert.equal(again.patchesApi.status().damage, "core");

    let seen = null;
    patchesApi.damage.onApply({ module: "spells", before: (actor, params) => { seen = params.damage.instances.length; return null; } });
    const actor = new fake.Actor();
    assert.equal(actor.applyDamage({ damage: { instances: [{ type: "fire" }] } }), "applied 1");
    assert.equal(seen, 1);
    assert.deepEqual(patchesApi.damage.lastTypes("Actor.t"), ["fire"]);

    patchesApi.rules.registerRewriter({ module: "spells", rewrite: (item, rules) => [...rules, { key: "Added" }] });
    const item = new fake.ItemPF2e();
    item.system = { rules: [] };
    assert.deepEqual(item.prepareRuleElements(), [{ key: "Added" }]);

    patchesApi.terrain.registerProvider({ module: "spells", selective: () => ({ default: 2 }) });
    const behavior = new fake.ModifyMovementCost();
    assert.deepEqual(behavior._getTerrainEffects({ actor: { uuid: "Actor.t", isOfType: () => true } }, { action: "walk" }), [{ name: "difficulty", difficulty: 2 }]);

    assert.equal(patchesApi.damage.sourceOf({ flags: { "pf2e-automatic-resolution": { damageSource: { uuid: "old" } } } }).uuid, "old", "older stamps still read");
});

test("damage listeners can replace the parameters, and after-callbacks are awaited in order, each on its own", async () => {
    const fake = fakeFoundry({ spellModulePatches: false });
    const { patchesApi } = await install(fake);
    const order = [];
    // Duplicate Foe's copies: half damage, by replacing the parameters.
    patchesApi.damage.onApply({ module: "spells", name: "halved", before: (actor, params) => ({ params: { ...params, damage: { instances: params.damage.instances.slice(0, 1) } } }) });
    patchesApi.damage.onApply({ module: "spells", name: "guardian", before: () => async (result) => { await new Promise((r) => setTimeout(r, 5)); order.push(`guardian saw "${result}"`); } });
    patchesApi.damage.onApply({ module: "spells", name: "broken", before: () => () => { throw new Error("oops"); } });
    patchesApi.damage.onApply({ module: "spells", name: "ward", before: () => ({ after: () => order.push("ward") }) });
    const warn = console.warn;
    console.warn = () => {};
    try {
        const result = await new fake.Actor().applyDamage({ damage: { instances: [{ type: "fire" }, { type: "cold" }] } });
        assert.equal(result, "applied 1", "the replaced parameters reached PF2e");
        assert.deepEqual(order, ['guardian saw "applied 1"', "ward"], "awaited in order before the caller resumes; a failing one doesn't stop the rest");
    } finally {
        console.warn = warn;
    }
});

test("the rules patch installs at setup when a module registered at init", async () => {
    const fake = fakeFoundry({ spellModulePatches: false });
    const { afterSetup } = await install(fake, { beforeSetup: (api) => api.rules.registerRewriter({ module: "spells", rewrite: (item, rules) => rules }) });
    assert.equal(afterSetup.rules, "core");
    assert.equal(afterSetup.damage, "not-installed", "only the rules patch is early");
});

test("an old-style spell module (no rewriter, its own patch) keeps the setup patch to itself", async () => {
    const fake = fakeFoundry({ spellModulePatches: true });
    const { afterSetup, patchesApi } = await install(fake);
    assert.equal(afterSetup.rules, "not-installed");
    assert.equal(patchesApi.status().rules, "spell-module");
});

// Actors whose items a "+text" rewriter changes, and some it doesn't.
function worldWithActors(reset) {
    const actor = (name, itemNames) => ({ items: itemNames.map((itemName) => ({ name: itemName, _source: { system: { rules: [] } } })), reset: () => reset.push(name) });
    globalThis.game.actors = [actor("world with text", ["Plain", "Text effect"]), actor("world plain", ["Plain"])];
    globalThis.game.scenes = [{ tokens: [
        { actorLink: false, actor: actor("unlinked with text", ["Text effect"]) },
        { actorLink: false, actor: actor("unlinked plain", []) },
        { actorLink: true, actor: actor("linked token", ["Text effect"]) },
        { actorLink: false, actor: null }
    ] }];
}
const textRewriter = { module: "spells", rewrite: (item, rules) => (item.name === "Text effect" ? [...rules, { key: "Added" }] : null) };

test("after an early or a late rules patch, only actors with rewritten items are prepared again", async () => {
    for (const early of [true, false]) {
        fakeFoundry({ spellModulePatches: false });
        const reset = [];
        worldWithActors(reset);
        const { installEarlyPatches, installPatches, patchesApi } = await import(`../scripts/patches.js?fresh=${Math.random()}`);
        if (early) {
            patchesApi.rules.registerRewriter(textRewriter);
            installEarlyPatches();
            assert.equal(patchesApi.status().rules, "core");
            assert.deepEqual(reset, [], "nothing resets at setup");
        } else {
            installEarlyPatches();
            patchesApi.rules.registerRewriter(textRewriter);
        }
        installPatches();
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.deepEqual(reset, ["world with text", "unlinked with text"], early ? "early install" : "late install");
    }
});

test("with no rewriter, or while the spell module patches, no actor is prepared again", async () => {
    for (const spellModulePatches of [false, true]) {
        fakeFoundry({ spellModulePatches });
        const reset = [];
        worldWithActors(reset);
        const { installEarlyPatches, installPatches, patchesApi } = await import(`../scripts/patches.js?fresh=${Math.random()}`);
        if (spellModulePatches) patchesApi.rules.registerRewriter(textRewriter);
        else patchesApi.rules.registerCreateTransformer({ module: "spells", transform: (entry) => entry });
        installEarlyPatches();
        installPatches();
        await new Promise((resolve) => setTimeout(resolve, 5));
        assert.deepEqual(reset, []);
    }
});
