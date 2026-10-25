// A natural disaster the GM sets off (the user: a button posting a save card to the creatures picked, the damage category the GM's,
// 2026-10-25): the card's check, its damage and what each degree of success does. Pure.

import { DAMAGE_CATEGORIES, DISASTERS, SIMPLE_DCS, categoryDice } from "./catalog.js";

const BASIC = { criticalSuccess: { damage: 0 }, success: { damage: 0.5 }, failure: { damage: 1 }, criticalFailure: { damage: 2 } };
const MULTIPLIER = { half: 0.5, full: 1, double: 2 };

// The DC a band's middle gives (the GM changes it on the card).
export function bandDC(band = ["trained", "expert"]) {
    const dcs = band.map((key) => SIMPLE_DCS[key]).filter(Number.isFinite);
    if (!dcs.length) return 20;
    const all = Object.values(SIMPLE_DCS).filter((dc) => dc >= Math.min(...dcs) && dc <= Math.max(...dcs));
    return all[Math.floor((all.length - 1) / 2)];
}

// The card for a disaster with the GM's options: { category, dice, dc, save (false: none), falling, carry, direction, snow, persistentDice }.
export function disasterCard(key, options = {}) {
    const entry = DISASTERS[key];
    if (!entry) return null;
    const category = entry.categories?.includes(options.category) ? options.category : entry.category ?? null;
    const dice = category ? categoryDice(category, options.dice) : null;
    const notes = [];
    let damage = [];
    if (dice && entry.halfFire) {
        // (Pyroclastic flows "work like avalanches but deal half of their damage as fire damage".)
        const count = Number(dice.split("d")[0]);
        damage = [{ formula: `${Math.ceil(count / 2)}d6`, type: entry.type }, { formula: `${Math.floor(count / 2)}d6`, type: "fire" }].filter((part) => !part.formula.startsWith("0d"));
    } else if (dice) damage = [{ formula: dice, type: entry.type }, ...(entry.also ? [{ formula: dice, type: entry.also }] : [])];

    // (A save the text doesn't name — heat, lightning — only when the GM gives one: a basic save.)
    const statistic = options.save === false ? null : entry.save ?? (options.save ? entry.optionalSave ?? null : null);
    const basic = Boolean(entry.basic) || (!entry.save && Boolean(statistic));
    const check = statistic ? { statistic, dc: Number(options.dc) || bandDC(entry.band), basic } : null;
    const degrees = {};
    const source = check ? (basic ? BASIC : entry.degrees ?? BASIC) : null;
    for (const [degree, what] of Object.entries(source ?? {})) {
        const row = { damage: typeof what.damage === "number" ? what.damage : MULTIPLIER[what.damage] ?? 0 };
        if (what.buried) row.buried = { snow: options.snow ?? key === "avalanche" };
        if (what.prone) row.conditions = [...(row.conditions ?? []), { slug: "prone" }];
        if (what.restrained) row.conditions = [...(row.conditions ?? []), { slug: what.sinking ? "restrained" : "immobilized" }];
        if (what.carried) row.carried = { feet: Number(options.carry) || entry.carry || 60, direction: options.direction ?? "S" };
        if (what.pushed) row.pushed = { feet: what.pushed, direction: options.direction ?? "E" };
        if (what.falls) row.falls = { feet: Number(options.falling) || entry.falling || 20 };
        if (what.pickedUp) row.pickedUp = { falling: Number(options.falling) || entry.falling || 60 };
        if (entry.persistent && ["failure", "criticalFailure"].includes(degree)) row.persistent = { formula: categoryDice(entry.persistent.category, options.persistentDice), type: entry.persistent.type };
        degrees[degree] = row;
    }
    // (No check: everyone in it takes the damage — the GM picked them.)
    const automatic = check ? null : { damage: 1, ...(entry.persistent ? { persistent: { formula: categoryDice(entry.persistent.category, options.persistentDice), type: entry.persistent.type } } : {}) };
    if (entry.degrees && Object.values(entry.degrees).some((what) => what.buried)) notes.push("Buried creatures are restrained, take minor bludgeoning damage each minute (and minor cold under snow), and are dug out by others: a 5-foot square every 4 minutes on a successful Athletics check, 2 on a critical success, half that with tools.");
    if (Object.values(entry.degrees ?? {}).some((what) => what.carried)) notes.push("Carried creatures are swept along and must Swim, and hold their breath under the water.");
    if (Object.values(entry.degrees ?? {}).some((what) => what.pickedUp)) notes.push("Picked up by the funnel: massive bludgeoning damage from flying debris, then expelled, taking falling damage.");
    if (key === "liquefaction") notes.push("Sunken creatures Escape at the disaster's DC.");
    return { key, title: entry.label, category, dice, check, damage, degrees, automatic, notes };
}

// The categories a disaster offers, for the GM's select: [{ key, label, min, max, dice }].
export const disasterCategories = (key) => (DISASTERS[key]?.categories ?? []).map((category) => ({ key: category, ...DAMAGE_CATEGORIES[category] }));

// Falling damage: half the distance fallen, bludgeoning (Player Core).
export const fallingDamage = (feet) => Math.floor(Math.max(0, Number(feet) || 0) / 2);
