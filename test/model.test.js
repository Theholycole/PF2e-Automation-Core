import test from "node:test";
import assert from "node:assert/strict";

import { MODEL_VERSION, readPlan, validateSkeleton, makeDecision, validateDecision, byPhase, answer, validateChange, CHANGE_OPS } from "../src/index.js";

const plan = (overrides = {}) => ({
    modelVersion: 12,
    source: { name: "Fireball" },
    activation: { time: "2" },
    targeting: { area: { type: "burst", value: 20 } },
    lifecycle: {},
    trigger: { event: "use", frequency: null },
    resolution: { kind: "save", check: { statistic: "reflex", basic: true, dcSource: "source-actor" }, outcomes: {} },
    automation: { level: "automatic" },
    ...overrides
});

test("a version-12 plan passes the version-13 skeleton", () => {
    assert.deepEqual(validateSkeleton(plan()), []);
    assert.deepEqual(validateSkeleton({ ...plan(), modelVersion: 13 }), []);
});

test("the skeleton catches what every plan needs", () => {
    const paths = (p) => validateSkeleton(p).map((issue) => issue.path);
    assert.ok(paths({ ...plan(), modelVersion: 9 }).includes("modelVersion"));
    assert.ok(paths({ ...plan(), source: {} }).includes("source.name"));
    assert.ok(paths({ ...plan(), resolution: { outcomes: {} } }).includes("resolution.kind"));
    assert.ok(paths({ ...plan(), automation: { level: "magic" } }).includes("automation.level"));
    assert.ok(paths(plan({ resolution: { kind: "rider", check: { roll: "juggle" } } })).includes("resolution.check.roll"));
    assert.ok(paths(plan({ resolution: { kind: "x", check: { roll: "skill", against: { dc: "fixed" } } } })).includes("resolution.check.against.value"));
});

test("the reader fills in check.roll and check.against without touching the stored plan", () => {
    const stored = plan();
    const read = readPlan(stored);
    assert.equal(read.modelVersion, MODEL_VERSION);
    assert.equal(read.storedModelVersion, 12);
    assert.deepEqual(read.resolution.check.against, { dc: "source", statistic: "spell" });
    assert.equal(read.resolution.check.roll, "save");
    assert.equal(stored.resolution.check.roll, undefined, "stored plan unchanged");
    const attack = readPlan(plan({ resolution: { kind: "save", check: { statistic: "spell-attack" }, outcomes: {} } }));
    assert.deepEqual([attack.resolution.check.roll, attack.resolution.check.against], ["attack", { dc: "target", statistic: "ac" }]);
    const strike = readPlan(plan({ resolution: { kind: "save", check: { statistic: "strike", sharedMultipleAttackPenalty: true }, outcomes: {} } }));
    assert.deepEqual([strike.resolution.check.roll, strike.resolution.check.statistic], ["attack", "strike"]);
    const trip = readPlan(plan({ resolution: { kind: "skill-check", check: { roll: "skill", statistic: "athletics", against: { dc: "target", statistic: "reflex" } }, outcomes: {} } }));
    assert.equal(trip.resolution.check.statistic, "athletics", "version-13 checks pass through");
});

test("simple frequencies become structured, keeping the text", () => {
    const read = readPlan(plan({ trigger: { event: "use", frequency: "once per round" } }));
    assert.deepEqual(read.trigger.frequency, { max: 1, per: "round", raw: "once per round" });
    assert.deepEqual(readPlan(plan({ trigger: { frequency: "once per 10 minutes" } })).trigger.frequency.per, "10-minutes");
    assert.deepEqual(readPlan(plan({ trigger: { frequency: "twice a day, odd moons" } })).trigger.frequency, { raw: "twice a day, odd moons" });
});

test("decisions are typed and phased", () => {
    const flying = makeDecision({ id: "flying", phase: "post-roll", question: "Was the creature flying?", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }], default: false });
    const type = makeDecision({ id: "type", phase: "pre-cast", question: "Damage type?", options: [{ value: "fire", label: "Fire" }, { value: "cold", label: "Cold" }] });
    assert.equal(flying.audience, "gm");
    assert.deepEqual(byPhase([flying, type]).map((d) => d.id), ["type", "flying"]);
    assert.throws(() => makeDecision({ id: "x", phase: "whenever", question: "?", options: [{ value: 1, label: "a" }] }));
    assert.ok(validateDecision({ id: "x", phase: "apply", question: "?", options: [{ value: 1, label: "a" }], default: 2 }).some((i) => i.path === "default"));
});

test("answers fall back to the default, then the first option", async () => {
    const decision = makeDecision({ id: "d", phase: "apply", question: "?", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "b" });
    assert.equal(await answer(decision, () => "a"), "a");
    assert.equal(await answer(decision, () => "not an option"), "b");
    assert.equal(await answer(decision, null), "b");
});

test("change ops validate their fields", () => {
    assert.ok(CHANGE_OPS.includes("damage") && CHANGE_OPS.includes("scene") && CHANGE_OPS.includes("followUp"));
    assert.deepEqual(validateChange({ op: "damage", target: "t", instances: [{ type: "fire", amount: 7 }] }), []);
    assert.deepEqual(validateChange({ op: "condition", target: "t", slug: "frightened", value: 2 }), []);
    assert.equal(validateChange({ op: "damage", target: "t", instances: [{ type: "fire" }] }).length, 1);
    assert.equal(validateChange({ op: "teleport" }).length, 1);
    assert.equal(validateChange({ op: "summon-a-dragon" }).length, 1);
});
