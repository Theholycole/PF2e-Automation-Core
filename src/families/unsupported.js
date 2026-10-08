// The fallback for plans of kind "unsupported": spells live play leaves to
// PF2e's own spell card (Telekinetic Projectile, Force Barrage, Lay on Hands).
// It resolves only from resolution.native, the numbers the spell compiler reads
// from PF2e's item data (agreed 2026-10-08), so the result is what PF2e rolls
// at the table:
//   native.check + native.outcomes → the save family (attack or save rows)
//   native.missiles               → direct-damage
//   native.healing                → healing
//   native.applications           → PF2e spell effects on their recipients (Bless)
// native.variants (Lay on Hands: "Vs. Undead" or "Healing") are chosen per
// target (shared.js variantFor). With nothing native, no changes and a gap.

import { drive } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { saveSteps, saveGaps } from "./save.js";
import { directDamageSteps } from "./direct-damage.js";
import { healingSteps } from "./healing.js";
import { applicationChanges } from "./effect.js";
import { mechanicalVariants, nativeOf, planWithActions, planWithVariant, variantFor } from "./shared.js";

export const UNSUPPORTED_KIND = "unsupported";

// The plan in the form of the family that resolves it, or null.
function delegate(plan) {
    const native = nativeOf(plan);
    if (native.check && native.outcomes) {
        return { steps: saveSteps, plan: { ...plan, resolution: { ...plan.resolution, kind: "save", check: native.check, outcomes: native.outcomes } } };
    }
    if (native.missiles) return { steps: directDamageSteps, plan };
    if (native.healing?.components?.length) return { steps: healingSteps, plan };
    if ((native.applications ?? []).length) return { steps: applicationSteps, plan };
    return null;
}

// Bless and the like: only PF2e spell effects, on the recipients each names.
function* applicationSteps(plan, context) {
    return { degrees: {}, changes: applicationChanges(nativeOf(plan).applications ?? [], context), decisions: [], records: [] };
}

export function unsupportedGaps(plan) {
    // An action variant may bring the rows (Blazing Bolt): read the lowest one.
    plan = planWithActions(plan);
    const variants = mechanicalVariants(plan);
    const forms = variants.length ? variants.map((variant) => planWithVariant(plan, variant)) : [plan];
    const gaps = [];
    for (const form of forms) {
        const target = delegate(form);
        if (!target) gaps.push({ path: "resolution.native", what: form.variantName ? `nothing native (${form.variantName})` : "nothing native" });
        else if (target.steps === saveSteps) gaps.push(...saveGaps(target.plan));
    }
    return gaps;
}

export function* unsupportedSteps(plan, context = {}) {
    plan = planWithActions(readPlan(plan), context.actions);
    const targets = context.targets ?? [];
    // Targets grouped by the variant each one gets.
    const groups = new Map();
    for (const actor of targets) {
        const variant = variantFor(plan, actor, context);
        const key = variant?.name ?? "";
        if (!groups.has(key)) groups.set(key, { variant, actors: [] });
        groups.get(key).actors.push(actor);
    }
    if (!groups.size) groups.set("", { variant: variantFor(plan, null, context), actors: [] });
    const result = { degrees: {}, changes: [], decisions: [], records: [], gaps: unsupportedGaps(plan) };
    for (const { variant, actors } of groups.values()) {
        const target = delegate(planWithVariant(plan, variant));
        if (!target) continue;
        const part = yield* target.steps(target.plan, { ...context, targets: actors });
        Object.assign(result.degrees, part.degrees);
        result.changes.push(...part.changes);
        result.decisions.push(...part.decisions);
    }
    return result;
}

export const unsupportedFamily = Object.freeze({
    kind: UNSUPPORTED_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: unsupportedSteps,
    resolve: (plan, context, io) => drive(unsupportedSteps(plan, context), io),
    gaps: unsupportedGaps
});
