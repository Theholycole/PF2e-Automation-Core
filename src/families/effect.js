// The "effect" family: spells whose whole result is a PF2e spell effect on
// their targets (Haste, Mystic Armor, the battle forms). Each application of
// kind "native-spell-effect" becomes an effect change { kind: "native", uuid,
// label } on every target; the live layer creates the item, and the Combat
// Simulator models what it can of the item's rules.

import { drive } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { idOf, payloadGaps, planWithActions } from "./shared.js";
import { healingChanges } from "./healing.js";

export const EFFECT_KIND = "effect";

const RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "applications", "native", "dataNotes", "healing"]);

export function effectGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, RESOLVED);
    for (const [index, application] of (resolution.applications ?? []).entries()) {
        if (application?.kind !== "native-spell-effect" || !application.uuid) gaps.push({ path: `resolution.applications.${index}`, what: `application:${application?.kind}` });
    }
    if (!(resolution.applications ?? []).length && !resolution.native?.healing) gaps.push({ path: "resolution.applications", what: "no effect to apply" });
    if (resolution.healing && !resolution.native?.healing?.components?.length) gaps.push({ path: "resolution.healing", what: "healing" });
    return gaps;
}

// Who an application reaches among the targets: recipients "self" (the
// caster), "allies-in-area" (the caster's allies, the caster included),
// "enemies-in-area", or "target"/none (every target). With no targets, the
// caster (self-only spells such as the battle forms).
function recipientsOf(application, context) {
    const targets = context.targets ?? [];
    const allied = (actor) => actor === context.caster || (context.allied ? Boolean(context.allied(actor, context.caster)) : true);
    switch (application.recipients) {
        case "self":
            return context.caster ? [context.caster] : [];
        case "allies-in-area":
            return targets.filter(allied);
        case "enemies-in-area":
            return targets.filter((actor) => !allied(actor));
        default:
            return targets.length ? targets : context.caster ? [context.caster] : [];
    }
}

// Effect changes for each application on the creatures it reaches.
export function applicationChanges(applications, context) {
    const changes = [];
    const ids = new Map((context.targets ?? []).map((actor, index) => [actor, idOf(context, actor, index)]));
    for (const application of applications) {
        if (application?.kind !== "native-spell-effect" || !application.uuid) continue;
        for (const actor of recipientsOf(application, context)) {
            changes.push({ op: "effect", target: ids.get(actor) ?? idOf(context, actor, -1), effect: { kind: "native", uuid: application.uuid, label: application.label ?? null } });
        }
    }
    return changes;
}

// A generator like the other families' steps, though it asks io for nothing.
export function* effectSteps(plan, context = {}) {
    plan = planWithActions(readPlan(plan), context.actions);
    const baseRank = Number(plan.rank ?? 1) || 1;
    const castRank = Number(context.castRank ?? baseRank) || baseRank;
    // Soothe and the like: an effect that also heals.
    const changes = yield* healingChanges(plan, { ...context, targets: context.targets?.length ? context.targets : context.caster ? [context.caster] : [] }, baseRank, castRank);
    changes.push(...applicationChanges(plan.resolution.applications ?? [], context));
    for (const note of plan.resolution.dataNotes ?? []) if (typeof note === "string") changes.push({ op: "note", audience: "gm", text: note });
    return { degrees: {}, changes, decisions: [], records: [], gaps: effectGaps(plan) };
}

export const effectFamily = Object.freeze({
    kind: EFFECT_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: effectSteps,
    resolve: (plan, context, io) => drive(effectSteps(plan, context), io),
    gaps: effectGaps
});
