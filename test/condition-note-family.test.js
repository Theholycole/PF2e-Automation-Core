import test from "node:test";
import assert from "node:assert/strict";

import { createRegistry, CORE_FAMILIES, validateChanges } from "../src/index.js";

const registry = createRegistry();
for (const family of CORE_FAMILIES) registry.registerFamily(family);
const plan = (resolution, extra = {}) => ({ modelVersion: 12, source: { name: "X" }, rank: 2, targeting: {}, lifecycle: { durationSpec: { mode: "fixed", value: 10, unit: "minutes", expiry: null } }, resolution, ...extra });
const context = (targets, caster = { id: "caster" }, allied = (actor) => actor.side === "party") => ({ caster, targets, allied, castRank: 2 });

test("condition-note: the condition on its recipients for the spell's time; Invisibility ends on a hostile action unless heightened past it", () => {
    const invisibility = plan({ kind: "condition-note", conditionNote: { recipient: "target", condition: { slug: "invisible", value: null }, text: "The target is Invisible. If the target uses a hostile action, the spell ends after that hostile action is completed.", heightened: [{ rank: 4, text: "The spell doesn't end if the target uses a hostile action." }] } });
    const ally = { id: "ally", side: "party" };
    const result = registry.resolveSync(invisibility, context([ally]), {});
    assert.deepEqual(result.changes, [{ op: "condition", target: "ally", slug: "invisible", value: null, duration: { mode: "fixed", value: 10, unit: "minutes", expiry: null }, endsOnHostile: true }]);
    assert.equal(validateChanges(result.changes).length, 0);
    assert.deepEqual(registry.gapsFor?.(invisibility) ?? [], []);
    const heightened = registry.resolveSync(invisibility, { ...context([ally]), castRank: 4 }, {});
    assert.equal(heightened.changes[0].endsOnHostile, undefined);
});

test("condition-note: enemies in the area only, and the floor its text names (Dirge of Doom)", () => {
    const dirge = plan({ kind: "condition-note", conditionNote: { recipient: "area-enemies", condition: { slug: "frightened", value: 1 }, text: "Enemies within the area are Frightened 1. They can't reduce their frightened value below 1 while they remain in the area." } }, { lifecycle: { durationSpec: { mode: "fixed", value: 1, unit: "rounds", expiry: "turn-start" } } });
    const result = registry.resolveSync(dirge, context([{ id: "foe", side: "foes" }, { id: "pc", side: "party" }], { id: "bard", side: "party" }), {});
    assert.deepEqual(result.changes.map((change) => [change.op, change.target, change.slug ?? change.effect?.kind]), [["condition", "foe", "frightened"], ["effect", "foe", "floor"]]);
    assert.deepEqual(result.changes[1].effect.floor, { slug: "frightened", value: 1, lifetime: "spell" });
});

test("stabilize: the dying target loses dying", () => {
    const result = registry.resolveSync(plan({ kind: "stabilize", stabilize: { sourceText: "The target loses the Dying condition" } }), context([{ id: "pc", side: "party" }]), {});
    assert.deepEqual(result.changes, [{ op: "end", target: "pc", what: { conditions: ["dying"], stabilize: true } }]);
});

test("affliction-care: a counteract (Dispel Magic, Clear Mind) and an affliction's stage (Cleanse Affliction) passed to the caller; a ward is a gap", () => {
    const care = (resolution) => plan({ kind: "affliction-care", ...resolution });
    const dispel = care({ recipient: "counteract-target", modes: [], operations: [{ op: "counteract", pick: 1, source: "spell-effect", traits: [], grantsConditions: [], otherTargets: true }] });
    assert.deepEqual(registry.resolveSync(dispel, context([{ id: "foe", side: "foes" }]), {}).changes, [{ op: "effect", target: "foe", effect: { kind: "counteract", source: "spell-effect", grantsConditions: [], traits: [], pick: 1 } }]);
    const clear = care({ recipient: "target", modes: [], operations: [{ op: "counteract", pick: 1, source: "effect", traits: [], grantsConditions: ["fleeing", "frightened", "stupefied"] }] });
    assert.deepEqual(registry.resolveSync(clear, context([{ id: "pc", side: "party" }]), {}).changes[0].effect.grantsConditions, ["fleeing", "frightened", "stupefied"]);
    const cleanse = care({ recipient: "target", modes: [], operations: [{ op: "reduce-affliction-stage", traits: ["curse", "disease", "poison"], pick: 1, by: 1, floor: 1 }] });
    assert.deepEqual(registry.resolveSync(cleanse, context([{ id: "pc", side: "party" }]), {}).changes[0].effect, { kind: "affliction-stage", by: 1, floor: 1, traits: ["curse", "disease", "poison"], pick: 1 });
    const { afflictionCareGaps } = { afflictionCareGaps: registry.familyFor("affliction-care").gaps };
    assert.deepEqual(afflictionCareGaps(dispel), []);
    assert.deepEqual(afflictionCareGaps(care({ recipient: "self", modes: [], operations: [{ op: "ward" }] })).map((gap) => gap.what), ["operation:ward"]);
});

test("attack-ward (Sanctuary): the ward passed on to the target", () => {
    const sanctuary = plan({ kind: "attack-ward", attackWard: { save: "will", durationSeconds: 60, endsOnHostile: true, rows: { criticalSuccess: "ends", success: "may-attack-this-turn", failure: "wasted-this-turn", criticalFailure: "barred" } } });
    const result = registry.resolveSync(sanctuary, context([{ id: "pc", side: "party" }]), {});
    assert.deepEqual(result.changes, [{ op: "effect", target: "pc", effect: { kind: "attack-ward", ward: { save: "will", durationSeconds: 60, endsOnHostile: true, rows: { criticalSuccess: "ends", success: "may-attack-this-turn", failure: "wasted-this-turn", criticalFailure: "barred" } } } }]);
    assert.deepEqual(registry.familyFor("attack-ward").gaps(sanctuary), []);
});

test("affliction-care: Truesight's ward that sees through illusions, passed on as true-sight on the caster", () => {
    const truesight = plan({ kind: "affliction-care", recipient: "self", modes: [], operations: [{ op: "ward" }], ward: { trigger: "Any illusion", secret: true, seeThrough: true, duration: { value: 10, unit: "minutes" } } });
    const caster = { id: "caster", side: "party" };
    assert.deepEqual(registry.resolveSync(truesight, { ...context([], caster) }, {}).changes, [{ op: "effect", target: "caster", effect: { kind: "true-sight", duration: { value: 10, unit: "minutes" } } }]);
    assert.deepEqual(registry.familyFor("affliction-care").gaps(truesight), []);
});
