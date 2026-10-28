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

// ---- Resistance ignored in part (2026-10-27, for the item module's Awakened Adamantine Shot: "ignores up to 20 of the target's resistance
// to physical damage") ----
// PF2e ignores a resistance only wholly, and only a property rune's. An entry { value, types }: each resistance of a listed type counts as
// that much lower (never below 0); value null or Infinity: none of it. Carried by applyDamage's own ignoreResistance, or by its damage roll's
// options.ignoreResistance (stamped when the roll is made, rollIgnores).

/** Entries as a list of { value, types }, the empty and malformed left out. */
export function ignoreEntries(list) {
    return [list ?? []].flat().filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({ value: entry.value == null || entry.value === Infinity ? Infinity : Number(entry.value), types: [entry.types ?? entry.type ?? []].flat().filter((type) => typeof type === "string" && type) }))
        .filter((entry) => (entry.value === Infinity || entry.value > 0) && entry.types.length);
}

/** The entries an applyDamage call carries: its own and its damage roll's. */
export function ignoredResistanceOf(params) {
    return ignoreEntries([...[params?.ignoreResistance ?? []].flat(), ...[params?.damage?.options?.ignoreResistance ?? []].flat()]);
}

/** The resistances to lower: [{ resistance, value }] — each of a listed type (or every one, types ["*"]: Penetrating Ammunition), by the largest entry naming it. */
export function lowerResistances(resistances, entries) {
    const lowered = [];
    for (const resistance of resistances ?? []) {
        const by = Math.max(0, ...entries.filter((entry) => entry.types.includes(resistance?.type) || entry.types.includes("*")).map((entry) => entry.value));
        const value = Number(resistance?.value) || 0;
        if (by > 0 && value > 0) lowered.push({ resistance, value: Math.max(0, value - by) });
    }
    return lowered;
}

/** The words for PF2e's damage breakdown: "Ignores 20 of its physical resistance". */
export const loweredWords = (lowered) => lowered.map(({ resistance, value }) => `Ignores ${(Number(resistance.value) || 0) - value} of its ${resistance.type} resistance`);

// (2026-10-27, the item module's Soulspark Candle: "ignore fire resistance or immunity".) An immunity ignored: applyDamage({ …, ignoreImmunity:
// ["fire"] }) or its damage roll's options.ignoreImmunity — the creature's immunities of a listed type left out while PF2e reads them.

/** The immunity types an applyDamage call ignores: its own and its damage roll's. */
export function ignoredImmunitiesOf(params) {
    return [...new Set([...[params?.ignoreImmunity ?? []].flat(), ...[params?.damage?.options?.ignoreImmunity ?? []].flat()].filter((type) => typeof type === "string" && type && type !== "*"))];
}

/** The immunities kept and those left out: { kept, ignored }. */
export function keptImmunities(immunities, types) {
    const kept = [];
    const ignored = [];
    for (const immunity of immunities ?? []) (types.includes(immunity?.type) ? ignored : kept).push(immunity);
    return { kept, ignored };
}

/** The words for PF2e's damage breakdown: "Ignores its fire immunity". */
export const ignoredImmunityWords = (ignored) => ignored.map((immunity) => `Ignores its ${immunity.type} immunity`);

/**
 * The entries a damage roll carries from the roller's items' flags (flags[core].ignoreResistance: an entry or a list, each with an optional
 * PF2e predicate): an ammunition's only for a Strike with it loaded, a weapon's only for its own Strikes (or as the ammunition loaded),
 * any other item's (an Effect) for Strike damage or what its predicate names. A weapon's loaded rounds are its subitems (PF2e 8.6: a
 * firearm's, a crossbow's or a sling's, the last of a stack moved there), read with the rest. test(predicate, options) → boolean.
 */
export function rollIgnores(items, { options = [], domains = [] } = {}, test = () => true, coreId = "pf2e-resolution-core") {
    const found = [];
    const loaded = (item) => (item?.type === "weapon" ? [...(item.subitems ?? [])].filter((sub) => sub?.type === "ammo" || sub?.type === "weapon") : []);
    const seen = new Set();
    for (const item of [...(items ?? [])].flatMap((item) => [item, ...loaded(item)])) {
        // (A stack's rest and its loaded round share an id: once.)
        const key = `${item?.type}:${item?.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const listed = [item?.flags?.[coreId]?.ignoreResistance ?? []].flat();
        if (!listed.length) continue;
        for (const entry of listed) {
            if (!entry || typeof entry !== "object") continue;
            const asAmmo = options.some((option) => option.endsWith(`ammo:id:${item.id}`));
            const fits = item.type === "ammo" ? asAmmo
                : item.type === "weapon" ? asAmmo || options.includes(`item:id:${item.id}`)
                : entry.predicate ? true : domains.includes("strike-damage");
            if (fits && (!entry.predicate || test(entry.predicate, options))) found.push(entry);
        }
    }
    return ignoreEntries(found);
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
