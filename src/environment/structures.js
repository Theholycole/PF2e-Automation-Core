// Structures: GM Core's doors, walls and portcullises (Doors, Gates, and Walls; Forcing Open) as objects in play (the user, 2026-10-26:
// "post checks or track damage done to structures … a simple actor to represent the object for players to target"). Its condition from
// its Hit Points, the DC to Force it Open, and the cards for climbing it, forcing it open and picking its lock (the environment module's
// card shape: { key, title, check, damage, degrees, notes, rollOptions }; a degree's `structure` is what it does to the structure).

import { FORCE_OPEN, LOCKS, STRUCTURES } from "./catalog.js";

// (No rule gives an unattended object an AC: 10 for one that doesn't move, the GM's to change.)
export const STRUCTURE_AC = 10;

// "door" | "wall" | "portcullis".
export const structureType = (kind) => String(kind ?? "").split("-")[0];

// Its condition from its Hit Points: destroyed at 0, broken at or below its Broken Threshold, else intact.
export function structureCondition(hp, bt) {
    const value = Number(hp) || 0;
    if (value <= 0) return "destroyed";
    return value <= (Number(bt) || 0) ? "broken" : "intact";
}

// The DC to Force it Open: its lock's Thievery DC + 5 ("very hard"); with no lock, the table's (a stuck door's 15, a portcullis's lift).
// Lifting a portcullis: the higher of its lock's and the table's.
export function forceOpenDC(kind, { lock = null, stuck = "stuck" } = {}) {
    const locked = LOCKS[lock] ? LOCKS[lock].dc + 5 : null;
    const lift = STRUCTURES[kind]?.force ?? null;
    if (lift) return Math.max(lift, locked ?? 0);
    return locked ?? FORCE_OPEN[stuck]?.dc ?? FORCE_OPEN.stuck.dc;
}

// Climb (Player Core): the move is the creature's own (from its land Speed, in the notes); a critical failure falls — from the height it
// had reached, or prone where it began on the ground.
export function climbCard({ label, dc, height = 0 }) {
    const feet = Math.max(0, Number(height) || 0);
    return {
        key: "structure-climb",
        title: `Climb: ${label}`,
        check: { statistic: "athletics", dc: Number(dc), basic: false },
        damage: [],
        rollOptions: ["action:climb"],
        degrees: { criticalSuccess: {}, success: {}, failure: {}, criticalFailure: feet > 0 ? { falls: { feet } } : { conditions: [{ slug: "prone" }] } },
        notes: [`Critical success: it moves 5 feet plus 5 feet per 20 feet of its land Speed. Success: 5 feet per 20 feet of its land Speed (at least 5). Critical failure: it falls${feet > 0 ? ` ${feet} feet` : " and lands prone"}. It's off-guard while it climbs, unless it has a climb Speed.`]
    };
}

// Force Open (Athletics): a critical success opens it undamaged, a success breaks it open (broken), a critical failure jams it (−2 to every
// later attempt). `structure`: the structure's token, or null for a card with none on the scene.
export function forceOpenCard({ label, dc, jammed = false, structure = null }) {
    return {
        key: "structure-force-open",
        title: `Force Open: ${label}`,
        check: { statistic: "athletics", dc: Number(dc), basic: false, ...(jammed ? { penalty: { value: -2, label: "Jammed" } } : {}) },
        damage: [],
        rollOptions: ["action:force-open"],
        structure,
        degrees: { criticalSuccess: { structure: { opens: true } }, success: { structure: { opens: true, breaks: true } }, failure: {}, criticalFailure: { structure: { jams: true } } },
        notes: [`Critical success: it opens without damage. Success: it breaks open and is broken. Critical failure: it jams, −2 to every later attempt to Force it Open.${jammed ? " It's jammed already (−2)." : ""}`]
    };
}

// Pick a Lock (Thievery): a success is one success toward the lock's count, a critical success two; a critical failure breaks the
// picker's tools.
export function pickLockCard({ label, lock, successes = 0, structure = null }) {
    const entry = LOCKS[lock];
    if (!entry) return null;
    return {
        key: "structure-pick-lock",
        title: `Pick a Lock: ${label}`,
        check: { statistic: "thievery", dc: entry.dc, basic: false },
        damage: [],
        rollOptions: ["action:pick-a-lock"],
        structure,
        degrees: { criticalSuccess: { structure: { lockSuccesses: 2 } }, success: { structure: { lockSuccesses: 1 } }, failure: {}, criticalFailure: {} },
        notes: [`${entry.label}: ${entry.successes} successes open it (${Number(successes) || 0} so far). Critical success: two successes. Critical failure: the picker's thieves' toolkit breaks.`]
    };
}

// A card's degree on the structure's state ({ lock, successes, unlocked, jammed }): what changes, and whether it opens or breaks.
export function structureOutcome(flag, effect = {}) {
    const next = {};
    if (effect.jams) next.jammed = true;
    if (effect.lockSuccesses && LOCKS[flag?.lock] && !flag.unlocked) {
        next.successes = (Number(flag.successes) || 0) + effect.lockSuccesses;
        if (next.successes >= LOCKS[flag.lock].successes) next.unlocked = true;
    }
    if (effect.opens && flag?.lock && !flag.unlocked) next.unlocked = true;
    return { next, opens: Boolean(effect.opens), breaks: Boolean(effect.breaks), unlocks: Boolean(next.unlocked) };
}
