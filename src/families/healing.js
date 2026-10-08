// The "healing" family: spells and abilities that restore HP with no check
// (Rebuke Death, Healing Well's first tap). The numbers are the compiler's
// resolution.native.healing = { components, heightening, recipients }, with
// native.byActions for PF2e's action variants. A plan with only live play's
// own resolution.healing payload is a gap.
//
// healingChanges() is shared with the effect family (Soothe compiles as an
// effect that also heals).

import { drive, driveSync } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { sharedComponentsAt } from "./save.js";
import { healingOf, healsTarget, idOf, payloadGaps, planWithActions, rollEach } from "./shared.js";

export const HEALING_KIND = "healing";

const RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "healing", "native"]);

export function healingGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, RESOLVED);
    if (!healingOf(plan)) gaps.push({ path: "resolution.native.healing", what: "healing without native numbers" });
    return gaps;
}

// Heal changes for the targets the healing reaches (rolled once for all).
export function* healingChanges(plan, context, baseRank, castRank) {
    const healing = healingOf(plan);
    if (!healing) return [];
    const instances = sharedComponentsAt(healing, baseRank, castRank).flatMap((component) => component.instances);
    const amount = (yield* rollEach(instances)).reduce((sum, rolled) => sum + rolled.amount, 0);
    const changes = [];
    for (const [index, actor] of (context.targets ?? []).entries()) {
        if (healsTarget(healing.recipients ?? "any", actor, context)) changes.push({ op: "heal", target: idOf(context, actor, index), amount });
    }
    return changes;
}

export function* healingSteps(plan, context = {}) {
    plan = readPlan(plan);
    const baseRank = Number(plan.rank ?? 1) || 1;
    const castRank = Number(context.castRank ?? baseRank) || baseRank;
    plan = planWithActions(plan, context.actions);
    const changes = yield* healingChanges(plan, context, baseRank, castRank);
    return { degrees: {}, changes, decisions: [], records: [], gaps: healingGaps(plan) };
}

export const healingFamily = Object.freeze({
    kind: HEALING_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: healingSteps,
    resolve: (plan, context, io) => drive(healingSteps(plan, context), io),
    gaps: healingGaps
});
