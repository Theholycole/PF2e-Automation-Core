// Two small families (2026-10-14, for the Combat Simulator's spell coverage):
//
// "condition-note": a spell whose result is a condition on its recipients for the spell's duration, no check (Invisibility, Blur,
// Dirge of Doom, Loose Time's Arrow). The compiler's resolution.conditionNote = { recipient, condition: { slug, value }, text,
// heightened }. Recipients: "target" (the targets, or the caster with none), "source" (the caster), "area-enemies",
// "area-allies", "self-and-targets". Its text adds what the condition change carries: Invisibility's "If the target uses a hostile
// action, the spell ends" (endsOnHostile, unless a heightened entry the cast reaches says it doesn't), and a floor ("can't reduce
// their frightened value below 1", Dirge of Doom).
//
// "stabilize": the dying target loses dying (Stabilize), as First Aid's success does.

import { drive } from "../drive.js";
import { readPlan } from "../model/plan.js";
import { idOf, payloadGaps } from "./shared.js";

export const CONDITION_NOTE_KIND = "condition-note";
export const STABILIZE_KIND = "stabilize";

const NOTE_RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "applications", "conditionNote", "native"]);
const STABILIZE_RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "applications", "stabilize", "native"]);

export function conditionNoteGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, NOTE_RESOLVED);
    if (!resolution.conditionNote?.condition?.slug) gaps.push({ path: "resolution.conditionNote", what: "no condition" });
    return gaps;
}

// The plan's duration as a condition's: { mode, value, unit, expiry }, or null (instantaneous, unlimited). A sustained spell: its most.
export function durationOf(spec) {
    if (!spec) return null;
    const fixed = spec.mode === "sustained" ? spec.maximum : spec;
    if (fixed?.mode !== "fixed" || !Number.isFinite(Number(fixed.value))) return null;
    return { mode: "fixed", value: Number(fixed.value), unit: fixed.unit ?? "rounds", expiry: fixed.expiry ?? null };
}

function recipientsOf(note, context) {
    const targets = context.targets ?? [];
    const caster = context.caster ?? null;
    const allied = (actor) => actor === caster || (context.allied ? Boolean(context.allied(actor, caster)) : true);
    switch (note.recipient) {
        case "source":
            return caster ? [caster] : [];
        case "area-enemies":
            return targets.filter((actor) => !allied(actor));
        case "area-allies":
            return targets.filter(allied);
        case "self-and-targets":
            return [...(caster ? [caster] : []), ...targets.filter((actor) => actor !== caster)];
        default:
            return targets.length ? targets : caster ? [caster] : [];
    }
}

export function* conditionNoteSteps(plan, context = {}) {
    plan = readPlan(plan);
    const note = plan.resolution.conditionNote ?? {};
    const slug = note.condition?.slug;
    const castRank = Number(context.castRank ?? plan.rank ?? 1) || 1;
    const text = String(note.text ?? "");
    const endsOnHostile = /uses a hostile action, the spell ends/i.test(text) && !(note.heightened ?? []).some((entry) => castRank >= Number(entry?.rank) && /(?:doesn't|does not) end/i.test(String(entry?.text ?? "")));
    const floor = /can't reduce (?:their|its) (\w+) (?:value|condition) below (?:\w+ )?(\d+)/i.exec(text);
    const duration = durationOf(plan.lifecycle?.durationSpec ?? note.duration ?? null);
    const ids = new Map((context.targets ?? []).map((actor, index) => [actor, idOf(context, actor, index)]));
    const changes = [];
    if (slug) {
        for (const actor of recipientsOf(note, context)) {
            const target = ids.get(actor) ?? idOf(context, actor, -1);
            changes.push({ op: "condition", target, slug, value: Number.isFinite(note.condition.value) ? note.condition.value : null, duration, ...(endsOnHostile ? { endsOnHostile: true } : {}) });
            if (floor) changes.push({ op: "effect", target, effect: { kind: "floor", floor: { slug: floor[1].toLowerCase(), value: Number(floor[2]), lifetime: "spell" } } });
        }
    }
    return { degrees: {}, changes, decisions: [], records: [], gaps: conditionNoteGaps(plan) };
}

export const conditionNoteFamily = Object.freeze({
    kind: CONDITION_NOTE_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: conditionNoteSteps,
    resolve: (plan, context, io) => drive(conditionNoteSteps(plan, context), io),
    gaps: conditionNoteGaps
});

export function stabilizeGaps(plan) {
    return payloadGaps(plan?.resolution ?? {}, STABILIZE_RESOLVED);
}

export function* stabilizeSteps(plan, context = {}) {
    plan = readPlan(plan);
    const changes = (context.targets ?? []).map((actor, index) => ({ op: "end", target: idOf(context, actor, index), what: { conditions: ["dying"], stabilize: true } }));
    return { degrees: {}, changes, decisions: [], records: [], gaps: stabilizeGaps(plan) };
}

export const stabilizeFamily = Object.freeze({
    kind: STABILIZE_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: stabilizeSteps,
    resolve: (plan, context, io) => drive(stabilizeSteps(plan, context), io),
    gaps: stabilizeGaps
});

// "attack-ward" (Sanctuary): a ward on the target that creatures must save against before they attack it. The compiler's
// resolution.attackWard = { save, durationSeconds, endsOnHostile, rows } is passed on as an effect for the caller to play, with the
// spell's duration.
export const ATTACK_WARD_KIND = "attack-ward";
const WARD_RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "applications", "attackWard", "native"]);

export function attackWardGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, WARD_RESOLVED);
    if (!resolution.attackWard?.save) gaps.push({ path: "resolution.attackWard", what: "no save" });
    return gaps;
}

export function* attackWardSteps(plan, context = {}) {
    plan = readPlan(plan);
    const ward = plan.resolution.attackWard ?? {};
    const changes = (context.targets ?? []).map((actor, index) => ({ op: "effect", target: idOf(context, actor, index), effect: { kind: "attack-ward", ward: { save: ward.save ?? "will", durationSeconds: ward.durationSeconds ?? null, endsOnHostile: Boolean(ward.endsOnHostile), rows: ward.rows ?? {} } } }));
    return { degrees: {}, changes, decisions: [], records: [], gaps: attackWardGaps(plan) };
}

export const attackWardFamily = Object.freeze({
    kind: ATTACK_WARD_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: attackWardSteps,
    resolve: (plan, context, io) => drive(attackWardSteps(plan, context), io),
    gaps: attackWardGaps
});

// "image-decoys" (Mirror Image; Chromatic Image's colors, 2026-10-21 for the Combat Simulator): illusory images in the caster's space that
// take attacks meant for it. The compiler's resolution.imageDecoys = { images, chances: { <images left>: { die, max } }, durationSeconds,
// effect, colors? } is passed on as an effect on the caster for the caller to play (live play keeps the spell module's own controls).
export const IMAGE_DECOYS_KIND = "image-decoys";
const DECOYS_RESOLVED = new Set(["kind", "check", "sharedDamage", "outcomes", "postDamageTerminal", "applications", "imageDecoys", "native"]);

export function imageDecoysGaps(plan) {
    const resolution = plan?.resolution ?? {};
    const gaps = payloadGaps(resolution, DECOYS_RESOLVED);
    const decoys = resolution.imageDecoys;
    if (!(Number(decoys?.images) > 0) || !Array.from({ length: Number(decoys?.images) || 0 }, (_, index) => decoys.chances?.[index + 1]).every((chance) => chance?.die > 0 && chance.max > 0)) gaps.push({ path: "resolution.imageDecoys", what: "no images" });
    return gaps;
}

export function* imageDecoysSteps(plan, context = {}) {
    plan = readPlan(plan);
    const decoys = plan.resolution.imageDecoys ?? {};
    const chances = Object.fromEntries(Object.entries(decoys.chances ?? {}).map(([count, chance]) => [count, { die: chance.die, max: chance.max }]));
    const changes = context.caster ? [{ op: "effect", target: idOf(context, context.caster, -1), effect: { kind: "image-decoys", decoys: { images: decoys.images, chances, durationSeconds: decoys.durationSeconds ?? null, ...(decoys.colors ? { colors: structuredClone(decoys.colors) } : {}) } } }] : [];
    return { degrees: {}, changes, decisions: [], records: [], gaps: imageDecoysGaps(plan) };
}

export const imageDecoysFamily = Object.freeze({
    kind: IMAGE_DECOYS_KIND,
    module: "pf2e-resolution-core",
    validate: () => [],
    steps: imageDecoysSteps,
    resolve: (plan, context, io) => drive(imageDecoysSteps(plan, context), io),
    gaps: imageDecoysGaps
});
