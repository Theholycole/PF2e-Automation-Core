// The pure logic behind the core's PF2e patches (scripts/patches.js), moved
// from the spell module and generalised so any content module can plug in.
// No Foundry here: everything takes plain data.

// ---- d20 limits (from the spell module's scripts/d20-clamp.js) ----

/** The tightest {min, max} of several limits, or null when none limit anything. */
export function combineD20Limits(limits) {
    let min = null;
    let max = null;
    for (const limit of limits) {
        if (!limit) continue;
        if (Number.isInteger(limit.min)) min = Math.max(min ?? 1, limit.min);
        if (Number.isInteger(limit.max)) max = Math.min(max ?? 20, limit.max);
    }
    return min == null && max == null ? null : { min, max };
}

/** A d20 result within the limits. */
export function clampD20(result, { min = null, max = null }) {
    let value = result;
    if (min != null) value = Math.max(value, min);
    if (max != null) value = Math.min(value, max);
    return value;
}

export const D20_MARK = "pf2e-resolution-core-d20:";

export function d20Mark({ min, max }) {
    return `${D20_MARK}${min ?? ""}:${max ?? ""}`;
}

export function readD20Mark(domains) {
    const mark = (domains ?? []).find((domain) => typeof domain === "string" && domain.startsWith(D20_MARK));
    if (!mark) return null;
    const [min, max] = mark.slice(D20_MARK.length).split(":").map((value) => (value === "" ? null : Number(value)));
    return { min, max };
}

// ---- Selective difficult terrain (from the spell module's patchSelectiveTerrain) ----

const SIZE_ORDER = ["tiny", "sm", "med", "lg", "huge", "grg"];

/**
 * The movement-cost difficulty a selective-terrain spec gives a creature, or
 * null when the spec doesn't apply to this movement (the region's own terrain
 * is then left out). spec: { actions?, creatures?: [{ actorUuid, difficulty }],
 * bySize?: { min, difficulty }, living?: { difficulty }, default? }.
 * creature: { uuid, isCreature, size, modeOfBeing }.
 */
export function selectiveDifficulty(spec, creature, action) {
    if (!(spec.actions ?? ["walk"]).includes(action)) return null;
    const bySize = spec.bySize && creature?.isCreature && SIZE_ORDER.indexOf(creature.size) >= SIZE_ORDER.indexOf(spec.bySize.min) ? Number(spec.bySize.difficulty) : null;
    const byLiving = spec.living && creature?.isCreature && (creature.modeOfBeing ?? "living") === "living" ? Number(spec.living.difficulty) : null;
    const listed = (spec.creatures ?? []).find((entry) => entry.actorUuid === creature?.uuid)?.difficulty;
    return Number(listed ?? bySize ?? byLiving ?? spec.default ?? 1);
}

/** PF2e's terrain-effect list for a difficulty. */
export function terrainEffects(difficulty) {
    return difficulty > 1 ? [{ name: "difficulty", difficulty }] : [];
}

// ---- Damage memory (from the spell module's installDamageTypeMemory) ----

export const DAMAGE_SOURCE_WINDOW_MS = 10000;

/** What to remember from applyDamage's parameters. */
export function damageMemoryFrom(params, now) {
    const instances = params?.damage?.instances ?? [];
    const types = instances.map((instance) => instance.type).filter(Boolean);
    const item = params?.item ?? null;
    const options = [...(params?.rollOptions ?? [])];
    return {
        types: types.length ? { types, at: now } : null,
        source: { uuid: item?.uuid ?? null, actor: item?.actor?.uuid ?? null, type: item?.type ?? null, ranged: Boolean(item?.isRanged ?? options.includes("item:ranged")), at: now }
    };
}

/** The remembered source if it's recent enough to belong to this damage message. */
export function recentSource(source, now) {
    if (!source || now - source.at > DAMAGE_SOURCE_WINDOW_MS) return null;
    return { uuid: source.uuid, actor: source.actor, type: source.type, ranged: source.ranged };
}

// ---- Pipelines content modules plug into ----

/** Applies registered rule rewriters in order; each gets the rules the last returned. */
export function rewriteRules(rewriters, item, rules) {
    let current = rules;
    for (const rewriter of rewriters) {
        try {
            const next = rewriter.rewrite(item, current);
            if (Array.isArray(next)) current = next;
        } catch (error) {
            console.warn(`pf2e-resolution-core | ${rewriter.module}'s rule rewriter failed for ${item?.name}.`, error);
        }
    }
    return current;
}

/** Applies registered item-creation transformers to each entry in order. */
export function transformCreated(transformers, entries, parent) {
    return entries.map((entry) => transformers.reduce((current, transformer) => {
        try {
            return transformer.transform(current, parent) ?? current;
        } catch (error) {
            console.warn(`pf2e-resolution-core | ${transformer.module}'s item transformer failed.`, error);
            return current;
        }
    }, entry));
}

// ---- Conventions ----

/** PF2e's own damage-taken and roll messages: chat-card handlers skip these, or they re-trigger. */
export function isSystemContextMessage(message) {
    return Boolean(message?.flags?.pf2e?.context?.type);
}

/** Hooks on every Combat update act only on turn or round changes. */
export function isTurnChange(changed) {
    return Boolean(changed) && ("turn" in changed || "round" in changed);
}
