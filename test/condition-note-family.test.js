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
