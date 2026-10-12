// Pieces the core's families share: action variants, healing recipients and
// rolling a list of damage or healing instances.

// Numbers the spell compiler reads from PF2e's own item data, under
// resolution.native (agreed 2026-10-08): live play never reads that key, so
// it can't change what live play does. { healing, byActions, missiles, sharedDamage }
export function nativeOf(plan) {
    return plan?.resolution?.native ?? {};
}

// The healing a plan grants: native.healing = { components, heightening, recipients }.
export function healingOf(plan) {
    const healing = nativeOf(plan).healing;
    return healing?.components?.length ? healing : null;
}

// The damage a plan deals: native.sharedDamage (set beside missiles when the
// plan has none), else the plan's own.
export function sharedDamageOf(plan) {
    return nativeOf(plan).sharedDamage ?? plan?.resolution?.sharedDamage ?? null;
}

// The plan as cast with that many actions: native.byActions[n] is a partial
// overlay of targeting, healing, sharedDamage, check, outcomes and rows (PF2e's
// action overlays: Heal's 1, 2 and 3-action versions, Blazing Bolt's rays);
// healing, check and outcomes overlay the native ones, sharedDamage the native
// one or else the plan's own, rows the plan's own outcomes. Without a count,
// the lowest variant.
export function planWithActions(plan, actions) {
    const variants = nativeOf(plan).byActions;
    if (!variants || typeof variants !== "object") return plan;
    const counts = Object.keys(variants).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!counts.length) return plan;
    const count = Number.isFinite(actions) && variants[actions] ? actions : counts[0];
    const overlay = variants[count] ?? {};
    const native = { ...nativeOf(plan) };
    const resolution = { ...plan.resolution, native };
    if (overlay.healing !== undefined) native.healing = { ...(native.healing ?? {}), ...overlay.healing };
    if (overlay.sharedDamage !== undefined) {
        if (native.sharedDamage || !plan.resolution.sharedDamage) native.sharedDamage = { ...(native.sharedDamage ?? {}), ...overlay.sharedDamage };
        else resolution.sharedDamage = { ...plan.resolution.sharedDamage, ...overlay.sharedDamage };
    }
    // New component ids bring their own rows (Blazing Bolt has no base damage).
    if (overlay.outcomes !== undefined) native.outcomes = overlay.outcomes;
    // The plan's own rows for that count (a troop's attack that also grabs with 2 actions).
    if (overlay.rows !== undefined) resolution.outcomes = overlay.rows;
    if (overlay.check !== undefined) native.check = overlay.check;
    return {
        ...plan,
        targeting: overlay.targeting ? { ...(plan.targeting ?? {}), ...overlay.targeting } : plan.targeting,
        resolution,
        castActions: count
    };
}

// PF2e overlays that aren't per action count (Lay on Hands: "Vs. Undead" and
// "Healing"; older copies of Telekinetic Projectile: one per damage type):
// native.variants = [{ name, targeting?, check?, healing?, sharedDamage?,
// outcomes? }]. A variant replaces the keys it sets and keeps the plan's others.
const VARIANT_KEYS = ["check", "healing", "sharedDamage", "outcomes"];

export function planWithVariant(plan, variant) {
    if (!variant) return plan;
    const native = { ...nativeOf(plan) };
    for (const key of VARIANT_KEYS) if (variant[key] !== undefined) native[key] = variant[key];
    delete native.variants;
    return {
        ...plan,
        targeting: variant.targeting ? { ...(plan.targeting ?? {}), ...variant.targeting } : plan.targeting,
        resolution: { ...plan.resolution, native },
        variantName: variant.name ?? null
    };
}

// Variants that change nothing mechanical (a name per damage type, when
// damageTypeChoices already covers it) are left out: the base plan applies.
export function mechanicalVariants(plan) {
    const variants = nativeOf(plan).variants;
    return Array.isArray(variants) ? variants.filter((variant) => VARIANT_KEYS.some((key) => variant?.[key] !== undefined)) : [];
}

// The variant for one target: the one named in context.variant; else a healing
// variant if the target receives its healing; else the first with a check; else the first.
export function variantFor(plan, actor, context = {}) {
    const variants = mechanicalVariants(plan);
    if (!variants.length) return null;
    if (context.variant) {
        const named = variants.find((variant) => variant.name === context.variant);
        if (named) return named;
    }
    const healing = variants.find((variant) => variant.healing?.components?.length && healsTarget(variant.healing.recipients ?? "any", actor, context));
    return healing ?? variants.find((variant) => variant.check) ?? variants[0];
}

export function hasVoidHealing(context, actor) {
    return context.voidHealing?.(actor) ?? actor?.voidHealing ?? (context.traits?.(actor) ?? actor?.traits ?? []).includes("undead");
}

// Whether a creature receives a spell's healing: "living" (no void healing),
// "undead" (void healing), "willing" (the caster's allies) or "any".
export function healsTarget(recipients, actor, context) {
    switch (recipients) {
        case "living":
            return !hasVoidHealing(context, actor);
        case "undead":
            return hasVoidHealing(context, actor);
        case "willing":
            return context.allied ? Boolean(context.allied(actor, context.caster)) || actor === context.caster : true;
        default:
            return true;
    }
}

// Rolls each instance through io (yielding damage requests).
export function* rollEach(instances) {
    const rolled = [];
    for (const instance of instances) rolled.push({ instance, amount: yield { type: "damage", instance } });
    return rolled;
}

export const idOf = (context, actor, index) => context.id?.(actor) ?? actor?.id ?? actor?.uuid ?? `target-${index}`;

const isEmpty = (value) => value === null || value === undefined || value === false || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length);

// Payload keys a family doesn't resolve: [{ path, what }].
export function payloadGaps(resolution, resolved) {
    const gaps = [];
    for (const [key, value] of Object.entries(resolution ?? {})) {
        if (resolved.has(key) || isEmpty(value)) continue;
        gaps.push({ path: `resolution.${key}`, what: key });
    }
    return gaps;
}
