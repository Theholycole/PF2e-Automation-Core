// The "affliction-care" family (2026-10-14, for the Combat Simulator): spells that undo magic or harm on a creature. The compiler's
// resolution.operations, on resolution.recipient ("counteract-target" and "target": the targets; "self": the caster):
//   counteract (Dispel Magic: one spell effect; Clear Mind, Sound Body, Sure Footing: an effect that grants the listed conditions)
//     → { op: "effect", effect: { kind: "counteract", source, grantsConditions, traits, pick } } — the caller picks what to
//     counteract on the creature and rolls the counteract check, since only it knows what the creature has;
//   reduce-affliction-stage (Cleanse Affliction) → { op: "effect", effect: { kind: "affliction-stage", by, floor, traits, pick } }.
// A ward that sees through illusions (Truesight) → { op: "effect", effect: { kind: "true-sight", duration } } on the caster. Another ward
// (Spell Turning), a triggering spell or a choice of modes isn't resolved here: a gap.

import { drive } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { idOf, payloadGaps } from "./shared.js";

export const AFFLICTION_CARE_KIND = "affliction-care";

const RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "recipient", "modes", "operations", "native", "applications", "ward"]);
const RECIPIENTS = new Set(["counteract-target", "target", "self"]);

export function afflictionCareGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, RESOLVED);
    if (!RECIPIENTS.has(resolution.recipient)) gaps.push({ path: "resolution.recipient", what: `recipient:${resolution.recipient}` });
    if ((resolution.modes ?? []).length) gaps.push({ path: "resolution.modes", what: "modes" });
    const operations = resolution.operations ?? [];
    if (!operations.length && !(resolution.modes ?? []).length) gaps.push({ path: "resolution.operations", what: "no operation" });
    for (const [index, operation] of operations.entries()) {
        // (Truesight: a ward that sees through illusions — passed on as true-sight.)
        if (operation?.op === "ward" && resolution.ward?.seeThrough) continue;
        if (!["counteract", "reduce-affliction-stage"].includes(operation?.op)) gaps.push({ path: `resolution.operations.${index}`, what: `operation:${operation?.op}` });
        else if (operation.op === "counteract" && !["spell-effect", "effect"].includes(operation.source)) gaps.push({ path: `resolution.operations.${index}.source`, what: `counteract:${operation.source}` });
    }
    return gaps;
}

export function* afflictionCareSteps(plan, context = {}) {
    plan = readPlan(plan);
    const resolution = plan.resolution;
    const recipients = resolution.recipient === "self" ? (context.caster ? [[context.caster, -1]] : []) : (context.targets ?? []).map((actor, index) => [actor, index]);
    const changes = [];
    for (const [actor, index] of recipients) {
        const target = idOf(context, actor, index);
        for (const operation of resolution.operations ?? []) {
            if (operation?.op === "counteract" && ["spell-effect", "effect"].includes(operation.source)) {
                changes.push({ op: "effect", target, effect: { kind: "counteract", source: operation.source, grantsConditions: operation.grantsConditions ?? [], traits: operation.traits ?? [], pick: operation.pick ?? 1 } });
            } else if (operation?.op === "ward" && resolution.ward?.seeThrough) {
                changes.push({ op: "effect", target, effect: { kind: "true-sight", duration: resolution.ward.duration ?? null } });
            } else if (operation?.op === "reduce-affliction-stage") {
                changes.push({ op: "effect", target, effect: { kind: "affliction-stage", by: Number(operation.by) || 1, floor: Number(operation.floor) || 1, traits: operation.traits ?? [], pick: operation.pick ?? 1 } });
            }
        }
    }
    return { degrees: {}, changes, decisions: [], records: [], gaps: afflictionCareGaps(plan) };
}

export const afflictionCareFamily = Object.freeze({
    kind: AFFLICTION_CARE_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: afflictionCareSteps,
    resolve: (plan, context, io) => drive(afflictionCareSteps(plan, context), io),
    gaps: afflictionCareGaps
});
