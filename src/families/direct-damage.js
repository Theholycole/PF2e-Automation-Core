// The "direct-damage" family: damage with no check (Force Barrage, Force
// Bolt). The damage of one missile is native.sharedDamage (else the plan's
// own sharedDamage); resolution.native.missiles = { perActions: { "1": 1, … }, perRanks: { interval, extra } }
// gives the count: perActions[n] × (1 + ⌊(castRank − rank) / interval⌋ × extra).
// Missiles are spread over context.targets in order (a target listed twice
// takes two), each rolled on its own; a target's missiles are combined before
// resistances, so they make one damage change.

import { drive, driveSync } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { sharedComponentsAt } from "./save.js";
import { idOf, nativeOf, payloadGaps, planWithActions, rollEach, sharedDamageOf } from "./shared.js";

export const DIRECT_DAMAGE_KIND = "direct-damage";

const RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "native", "damage"]);

export function directDamageGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, RESOLVED);
    if (!sharedDamageOf(plan)?.components?.length) gaps.push({ path: "resolution.sharedDamage", what: "no damage formula" });
    return gaps;
}

export function missileCount(plan, actions, castRank) {
    const missiles = nativeOf(plan).missiles;
    if (!missiles) return null;
    const counts = Object.keys(missiles.perActions ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const chosen = Number.isFinite(actions) && missiles.perActions?.[actions] !== undefined ? actions : counts[0];
    const base = Number(missiles.perActions?.[chosen] ?? 1);
    const interval = Number(missiles.perRanks?.interval) || 0;
    const steps = interval > 0 ? Math.max(0, Math.floor((castRank - (Number(plan.rank) || 1)) / interval)) : 0;
    return base * (1 + steps * (Number(missiles.perRanks?.extra) || 0));
}

export function* directDamageSteps(plan, context = {}) {
    plan = readPlan(plan);
    const baseRank = Number(plan.rank ?? 1) || 1;
    const castRank = Number(context.castRank ?? baseRank) || baseRank;
    plan = planWithActions(plan, context.actions);
    const instances = sharedComponentsAt(sharedDamageOf(plan), baseRank, castRank).flatMap((component) => component.instances);
    const targets = context.targets ?? [];
    const changes = [];
    if (instances.length && targets.length) {
        const count = missileCount(plan, context.actions, castRank) ?? targets.length;
        const byTarget = new Map();
        for (let missile = 0; missile < count; missile++) {
            const index = missile % targets.length;
            const target = idOf(context, targets[index], index);
            const rolled = yield* rollEach(instances);
            const entry = byTarget.get(target) ?? new Map();
            for (const { instance, amount } of rolled) {
                const key = `${instance.type}|${instance.category ?? ""}`;
                entry.set(key, { type: instance.type, category: instance.category ?? null, amount: (entry.get(key)?.amount ?? 0) + amount });
            }
            byTarget.set(target, entry);
        }
        for (const [target, entry] of byTarget) {
            const instances = [...entry.values()].filter((instance) => instance.amount > 0);
            if (instances.length) changes.push({ op: "damage", target, instances });
        }
    }
    return { degrees: {}, changes, decisions: [], records: [], gaps: directDamageGaps(plan) };
}

export const directDamageFamily = Object.freeze({
    kind: DIRECT_DAMAGE_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: directDamageSteps,
    resolve: (plan, context, io) => drive(directDamageSteps(plan, context), io),
    gaps: directDamageGaps
});
