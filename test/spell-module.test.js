// Cross-checks against the spell module, read-only. Skipped when its folder
// or Foundry's PF2e data isn't on this machine.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { validateSkeleton, readPlan, resolveSave, saveGaps, createSeededRoller, validateChanges, createRegistry, CORE_FAMILIES } from "../src/index.js";
import * as coreTextPatterns from "../src/text/text-patterns.js";

// The spell and ability modules' folders sit beside this one.
const SPELL_MODULE = fileURLToPath(new URL("../../PF2e AUTOMATIC SPELL RESOLUTION", import.meta.url));
const LEVELDB = fileURLToPath(new URL("../../PF2e AUTOMATIC ABILITY RESOLUTION/tools/leveldb.mjs", import.meta.url));
const SPELLS_PACK = `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs/spells`;
const RATCHET = 431;
const EFFECTS_PACK = `${process.env.HOME}/.local/share/FoundryVTT/Data/systems/pf2e/packs/spell-effects`;
const available = existsSync(SPELL_MODULE) && existsSync(LEVELDB) && existsSync(SPELLS_PACK) && existsSync(EFFECTS_PACK);

// Compile options as the spell module's official compile passes them, so the
// plans match live play: its native-effect catalog and the spells others reference.
async function compileOptions() {
    const { readDocuments } = await import(LEVELDB);
    const effects = readDocuments(EFFECTS_PACK).filter((doc) => doc.collection === "items");
    const nativeEffectCatalog = new Map(effects.map((effect) => [effect.name, {
        id: effect._id ?? null,
        name: effect.name,
        type: effect.type,
        automation: { ruleKeys: [...new Set((effect.system?.rules ?? []).map((rule) => rule.key).filter(Boolean))], requiresConfiguration: (effect.system?.rules ?? []).some((rule) => rule.key === "ChoiceSet"), removesAfterRoll: (effect.system?.rules ?? []).some((rule) => rule.removeAfterRoll != null) },
        mechanics: { rules: effect.system?.rules ?? [], duration: effect.system?.duration ?? null, start: effect.system?.start ?? null },
        ...(effect.system?.badge ? { badge: effect.system.badge } : {})
    }]));
    const spells = readDocuments(SPELLS_PACK).filter((doc) => doc.collection === "items" && doc.type === "spell");
    const referencedSpells = new Map(spells.filter((spell) => spell._id).map((spell) => [`Compendium.pf2e.spells-srd.Item.${spell._id}`, spell]));
    return { spells, options: { nativeEffectCatalog, referencedSpells } };
}

test("every compiled PF2e spell passes the core skeleton and reads as version 13", { skip: !available && "spell module or PF2e data not found" }, async () => {
    const { compileAbility } = await import(`${SPELL_MODULE}/src/compiler/index.js`);
    const { readDocuments } = await import(LEVELDB);
    const spells = readDocuments(SPELLS_PACK).filter((doc) => doc.collection === "items" && doc.type === "spell");
    assert.ok(spells.length > 1500, `found ${spells.length} spells`);
    const failures = [];
    let saves = 0;
    for (const spell of spells) {
        const plan = compileAbility(spell, {});
        const issues = validateSkeleton(plan);
        if (issues.length) failures.push(`${spell.name}: ${issues.map((issue) => issue.path).join(", ")}`);
        const read = readPlan(plan);
        if (plan.resolution?.check?.statistic) {
            saves++;
            assert.ok(read.resolution.check.roll, `${spell.name}: a check without a roll after reading`);
        }
    }
    assert.deepEqual(failures.slice(0, 10), [], `${failures.length} spells fail the skeleton`);
    assert.ok(saves > 500, `${saves} plans with checks`);
});

test("the save family resolves every compiled save and spell attack, at its own rank and at rank 10", { skip: !available && "spell module or PF2e data not found" }, async () => {
    const { compileAbility } = await import(`${SPELL_MODULE}/src/compiler/index.js`);
    const { spells, options } = await compileOptions();
    const statistic = { modifier: 10, dc: 25 };
    const creature = (id, traits = []) => ({ id, name: id, traits });
    const context = { caster: creature("caster"), targets: [creature("a"), creature("b", ["water", "plant"])], statistic: () => statistic, iwr: () => ({ immunities: ["fire"] }) };
    let seed = 7;
    const io = createSeededRoller(() => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    const failures = [];
    let plans = 0;
    let complete = 0;
    for (const spell of spells) {
        const plan = compileAbility(spell, options);
        if (plan.resolution?.kind !== "save") continue;
        plans++;
        if (!saveGaps(readPlan(plan)).length) complete++;
        for (const castRank of [plan.rank, 10]) {
            try {
                const issues = validateChanges((await resolveSave(plan, { ...context, castRank }, io)).changes);
                if (issues.length) failures.push(`${spell.name} at ${castRank}: ${issues[0].message}`);
            } catch (error) {
                failures.push(`${spell.name} at ${castRank}: ${error.message}`);
            }
        }
    }
    assert.ok(plans > 700, `${plans} save plans`);
    assert.deepEqual(failures.slice(0, 10), [], `${failures.length} resolutions fail`);
    // A ratchet, so the count only goes up (with the catalog, 2026-10-08).
    assert.ok(complete >= RATCHET, `${complete} save plans resolve with no gaps`);
    console.log(`save family: ${complete} of ${plans} save plans with no gaps`);
});

test("every family resolves its compiled plans, with every action count, at the plan's rank and at rank 10", { skip: !available && "spell module or PF2e data not found" }, async () => {
    const { compileAbility } = await import(`${SPELL_MODULE}/src/compiler/index.js`);
    const { spells, options } = await compileOptions();
    const registry = createRegistry();
    for (const family of CORE_FAMILIES) registry.registerFamily(family);
    const creature = (id, side, traits = []) => ({ id, name: id, side, traits });
    const context = { caster: creature("caster", "party"), targets: [creature("ally", "party"), creature("foe", "foes"), creature("undead", "foes", ["undead"])], statistic: () => ({ modifier: 10, dc: 25 }), allied: (a, b) => a.side === b.side };
    let seed = 11;
    const io = createSeededRoller(() => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646);
    const failures = [];
    const resolved = {};
    for (const spell of spells) {
        const plan = compileAbility(spell, options);
        const kind = plan.resolution?.kind;
        if (kind === "save" || !registry.familyFor(kind)) continue;
        resolved[kind] = (resolved[kind] ?? 0) + 1;
        for (const actions of [undefined, 1, 2, 3]) {
            for (const castRank of [plan.rank, 10]) {
                try {
                    const issues = validateChanges(registry.resolveSync(plan, { ...context, castRank, actions }, io).changes);
                    if (issues.length) failures.push(`${spell.name}: ${issues[0].message}`);
                } catch (error) {
                    failures.push(`${spell.name} (${actions ?? "-"} actions, rank ${castRank}): ${error.message}`);
                }
            }
        }
    }
    assert.deepEqual(failures.slice(0, 10), [], `${failures.length} resolutions fail`);
    assert.ok((resolved.unsupported ?? 0) > 200 && (resolved.effect ?? 0) > 100, JSON.stringify(resolved));
});

test("the core's text patterns and runtime helpers match the spell module's", { skip: !available && "spell module not found" }, async () => {
    const spellTextPatterns = await import(`${SPELL_MODULE}/src/compiler/text-patterns.js`);
    const describe = (value) => (value instanceof RegExp ? `re:${value.source}/${value.flags}` : typeof value === "function" ? `fn:${value.toString()}` : JSON.stringify(value instanceof Set ? [...value] : value));
    for (const [name, value] of Object.entries(spellTextPatterns)) {
        assert.ok(name in coreTextPatterns, `text-patterns: ${name} missing from the core`);
        assert.equal(describe(coreTextPatterns[name]), describe(value), `text-patterns: ${name} differs`);
    }
    const spell = readFileSync(`${SPELL_MODULE}/scripts/runtime-utils.js`, "utf8");
    if (/export \* from ["'][./]*pf2e-resolution-core\/scripts\/runtime-utils\.js["']/.test(spell)) {
        // After the switch-over the spell file forwards to the core: the same functions, plus its own MODULE_ID.
        const coreUtils = await import("../scripts/runtime-utils.js");
        const spellUtils = await import(`${SPELL_MODULE}/scripts/runtime-utils.js`);
        for (const [name, value] of Object.entries(coreUtils)) assert.equal(spellUtils[name], value, `runtime-utils: ${name} isn't forwarded`);
        assert.equal(spellUtils.MODULE_ID, "pf2e-automatic-resolution");
        return;
    }
    // Before it, the copies are compared by source (they touch Foundry globals only when called).
    const strip = (source) => source.split("\n").filter((line) => !/^\/\/ (Runtime helpers|except MODULE_ID|The module and its neighbours|Neighbouring modules)/.test(line) && !/MODULE_ID = /.test(line)).join("\n");
    const core = readFileSync(new URL("../scripts/runtime-utils.js", import.meta.url), "utf8");
    assert.equal(strip(core), strip(spell), "runtime-utils differs beyond MODULE_ID");
});
