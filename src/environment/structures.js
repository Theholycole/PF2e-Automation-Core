// Structures: GM Core's doors, walls and portcullises (Doors, Gates, and Walls; Forcing Open) as objects in play (the user, 2026-10-26:
// "post checks or track damage done to structures … a simple actor to represent the object for players to target"). Its condition from
// its Hit Points, the DC to Force it Open, and the cards for climbing it, forcing it open and picking its lock (the environment module's
// card shape: { key, title, check, damage, degrees, notes, rollOptions }; a degree's `structure` is what it does to the structure).

import { FORCE_OPEN, LOCKS, MATERIALS, PRECIOUS_STRUCTURES, STRUCTURES } from "./catalog.js";

// (No rule gives an unattended object an AC: 10 for one that doesn't move, the GM's to change.)
export const STRUCTURE_AC = 10;

// GM Core's structures, and a window (the user, 2026-10-26: "for windows use Glass material stats"; GM Core's own example of a window
// pane is thin glass, a choice in the material menu).
export const STRUCTURE_KINDS = { ...STRUCTURES, window: { label: "Window", material: "glass" } };

// "door" | "wall" | "portcullis" | "window".
export const structureType = (kind) => String(kind ?? "").split("-")[0];

const GRADES = { low: "low-grade", standard: "standard-grade", high: "high-grade" };
// A material's numbers: a GM Core material ("glass", "stone-structure") or a precious one at a grade ("adamantine-high").
// { label, hardness, hp, bt } or null.
export function materialStats(key) {
    if (MATERIALS[key]) return { ...MATERIALS[key] };
    for (const [material, entry] of Object.entries(PRECIOUS_STRUCTURES)) {
        for (const [grade, [hardness, hp, bt]] of Object.entries(entry.grades)) {
            if (key === `${material}-${grade}`) return { label: `${entry.label}, ${GRADES[grade]}`, hardness, hp, bt, precious: true };
        }
    }
    return null;
}

// Every material for a menu: [{ group, key, label, hardness, hp, bt }], GM Core's first, then the precious ones by grade.
export function materialChoices() {
    return [
        ...Object.entries(MATERIALS).map(([key, entry]) => ({ group: "Materials (GM Core)", key, ...entry })),
        ...Object.entries(PRECIOUS_STRUCTURES).flatMap(([material, entry]) => Object.keys(entry.grades).map((grade) => ({ group: "Precious materials (structures)", key: `${material}-${grade}`, ...materialStats(`${material}-${grade}`), source: entry.source })))
    ];
}

// A structure's numbers: its kind's (GM Core's table), or its material's when the GM picks one (an adamantine door). { label, hardness,
// hp, bt, climb, lift, type, material }. (2026-10-27, for the item module's Instant Fortress: stats { hardness?, hp?, bt? } — an item's
// own numbers over them.)
export function structureStats({ kind, material = null, stats = null } = {}) {
    const entry = STRUCTURE_KINDS[kind] ?? null;
    const made = materialStats(material ?? entry?.material ?? null);
    const base = made ?? entry ?? { hardness: 0, hp: 1, bt: 0 };
    const own = (key) => (Number.isFinite(Number(stats?.[key])) && stats[key] !== null && stats[key] !== "" ? Number(stats[key]) : null);
    const numbers = { hardness: own("hardness") ?? base.hardness, hp: own("hp") ?? base.hp, bt: own("bt") ?? (own("hp") !== null ? Math.floor(own("hp") / 2) : base.bt) };
    const label = entry ? (material && made ? `${entry.label} (${made.label.toLowerCase()})` : entry.label) : made?.label ?? "Structure";
    return { label, hardness: numbers.hardness, hp: numbers.hp, bt: numbers.bt, climb: entry?.climb ?? null, lift: entry?.force ?? null, type: structureType(kind), material: material ?? entry?.material ?? null };
}

// The kind a Foundry wall most likely is: a door, a window (sight or light through it only up close: Foundry's window walls), or a wall.
export function defaultKind({ door = 0, sight = 20, light = 20 } = {}) {
    if (Number(door) > 0) return "door-wood";
    if ([30, 40].includes(Number(sight)) || [30, 40].includes(Number(light))) return "window";
    return "wall-masonry";
}

// Its condition from its Hit Points: destroyed at 0, broken at or below its Broken Threshold, else intact.
export function structureCondition(hp, bt) {
    const value = Number(hp) || 0;
    if (value <= 0) return "destroyed";
    return value <= (Number(bt) || 0) ? "broken" : "intact";
}

// A lock's numbers: GM Core's for its quality, with a structure's own DC or successes over them (2026-10-27: an item's door — any key
// with a DC of its own is a lock). { label, dc, successes } or null.
export function lockStats(lock, { dc = null, successes = null } = {}) {
    const entry = LOCKS[lock] ?? null;
    const ownDC = Number(dc) > 0 ? Number(dc) : null;
    if (!entry && (!lock || ownDC === null)) return null;
    return { label: entry?.label ?? "Lock", dc: ownDC ?? entry.dc, successes: Number(successes) > 0 ? Math.floor(Number(successes)) : entry?.successes ?? 1 };
}

// The DC to Force it Open: its lock's Thievery DC + 5 ("very hard"); with no lock, the table's (a stuck door's 15, a portcullis's lift).
// Lifting a portcullis: the higher of its lock's and the table's. (2026-10-27: dc — its own, an Instant Fortress's DC 40 —, over all of
// them; lockDC, lockSuccesses — its lock's own numbers.)
export function forceOpenDC(kind, { lock = null, stuck = "stuck", dc = null, lockDC = null } = {}) {
    if (Number(dc) > 0) return Number(dc);
    const held = lockStats(lock, { dc: lockDC });
    const locked = held ? held.dc + 5 : null;
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
export function pickLockCard({ label, lock, successes = 0, structure = null, lockDC = null, lockSuccesses = null }) {
    const entry = lockStats(lock, { dc: lockDC, successes: lockSuccesses });
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

// A card's degree on the structure's state ({ lock, lockDC?, lockSuccesses?, successes, unlocked, jammed }): what changes, and whether it
// opens or breaks.
export function structureOutcome(flag, effect = {}) {
    const next = {};
    if (effect.jams) next.jammed = true;
    const held = lockStats(flag?.lock, { dc: flag?.lockDC, successes: flag?.lockSuccesses });
    if (effect.lockSuccesses && held && !flag.unlocked) {
        next.successes = (Number(flag.successes) || 0) + effect.lockSuccesses;
        if (next.successes >= held.successes) next.unlocked = true;
    }
    if (effect.opens && flag?.lock && !flag.unlocked) next.unlocked = true;
    return { next, opens: Boolean(effect.opens), breaks: Boolean(effect.breaks), unlocks: Boolean(next.unlocked) };
}

// --- A structure from a template (2026-10-27, for the item module's Warding Escutcheon and Instant Fortress) ---

const SIDES = ["north", "east", "south", "west"];

// Its walls on the grid: { walls: [{ c: [x0, y0, x1, y1], side, door }], inside: { x, y, width, height } | null }. template: { at: { x, y }
// (pixels, its middle), shape: "square" (a square room, feet on a side) | "line" (a wall feet long; rotation 0 runs east–west, 90
// north–south), feet, door?: { side (a square's: north, east, south or west; south when none), feet (5 when none) } } — the door in the
// middle of its side (a line's middle). grid: { size, distance }. Corners on the grid's lines; at least one square.
export function structureLayout(template, grid) {
    const size = Number(grid?.size) || 100;
    const squares = Math.max(1, Math.round((Number(template?.feet) || 0) / (Number(grid?.distance) || 5)));
    const at = { x: Number(template?.at?.x) || 0, y: Number(template?.at?.y) || 0 };
    const door = template?.door ? { side: SIDES.includes(template.door.side) ? template.door.side : "south", squares: Math.min(squares, Math.max(1, Math.round((Number(template.door.feet) || 5) / (Number(grid?.distance) || 5)))) } : null;
    // One side from a to b (pixels), the door cut into it when it's on that side.
    const side = (name, a, b) => {
        if (!door || (template.shape === "line" ? false : door.side !== name)) return [{ c: [a.x, a.y, b.x, b.y], side: name, door: false }];
        const length = squares * size;
        const start = Math.floor((squares - door.squares) / 2) * size;
        const point = (offset) => ({ x: a.x + ((b.x - a.x) * offset) / length, y: a.y + ((b.y - a.y) * offset) / length });
        const [p0, p1] = [point(start), point(start + door.squares * size)];
        return [
            ...(start > 0 ? [{ c: [a.x, a.y, p0.x, p0.y], side: name, door: false }] : []),
            { c: [p0.x, p0.y, p1.x, p1.y], side: name, door: true },
            ...(start + door.squares * size < length ? [{ c: [p1.x, p1.y, b.x, b.y], side: name, door: false }] : [])
        ];
    };
    if (template?.shape === "line") {
        const across = Math.abs(((Number(template.rotation) || 0) % 180 + 180) % 180 - 90) < 45;
        if (across) {
            const x = Math.round(at.x / size) * size;
            const top = Math.round(at.y / size - squares / 2) * size;
            return { walls: side("line", { x, y: top }, { x, y: top + squares * size }).map((wall) => ({ ...wall, door: wall.door && Boolean(door) })), inside: null };
        }
        const y = Math.round(at.y / size) * size;
        const left = Math.round(at.x / size - squares / 2) * size;
        return { walls: side("line", { x: left, y }, { x: left + squares * size, y }).map((wall) => ({ ...wall, door: wall.door && Boolean(door) })), inside: null };
    }
    const left = Math.round(at.x / size - squares / 2) * size;
    const top = Math.round(at.y / size - squares / 2) * size;
    const length = squares * size;
    const [nw, ne, se, sw] = [{ x: left, y: top }, { x: left + length, y: top }, { x: left + length, y: top + length }, { x: left, y: top + length }];
    return {
        walls: [...side("north", nw, ne), ...side("east", ne, se), ...side("south", sw, se), ...side("west", nw, sw)],
        inside: { x: left, y: top, width: length, height: length }
    };
}

// The creatures in its space, moved just outside the nearest wall: tokens [{ id, x, y, width, height }] (pixels; width and height in
// squares) → [{ id, x, y }] for those that were inside, the others left.
export function pushedOut(tokens, inside, grid) {
    if (!inside) return [];
    const size = Number(grid?.size) || 100;
    const moved = [];
    for (const token of tokens ?? []) {
        const [w, h] = [(Number(token.width) || 1) * size, (Number(token.height) || 1) * size];
        const overlaps = token.x < inside.x + inside.width && token.x + w > inside.x && token.y < inside.y + inside.height && token.y + h > inside.y;
        if (!overlaps) continue;
        const ways = [
            { x: token.x, y: inside.y - h },
            { x: token.x, y: inside.y + inside.height },
            { x: inside.x - w, y: token.y },
            { x: inside.x + inside.width, y: token.y }
        ];
        const best = ways.reduce((near, way) => (Math.hypot(way.x - token.x, way.y - token.y) < Math.hypot(near.x - token.x, near.y - token.y) ? way : near));
        moved.push({ id: token.id, x: best.x, y: best.y });
    }
    return moved;
}
