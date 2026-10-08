// Grid geometry for forced movement (pure): the user's rule (2026-10-05) for
// pushes and pulls, which the spell module plays too. A forced move goes
// square by square in the nearest of the 8 grid directions away from (or
// toward) a point; diagonals count 5 then 10 feet, as PF2e's do; walls and the
// scene's edge stop it; a creature never ends in another's space, but in the
// free space next to that creature nearest where it was going.

export const DIRECTIONS = Object.freeze([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);

// The nearest of the 8 directions from one point to another (null when they coincide).
export function gridDirection(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
    const index = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    return DIRECTIONS[index];
}

// The squares a move of this many feet covers (diagonals alternate 5 and 10 feet).
export function stepsWithin(feet, diagonal, gridFeet = 5) {
    if (!diagonal) return Math.floor(feet / gridFeet);
    let used = 0;
    let steps = 0;
    for (;;) {
        const cost = steps % 2 === 0 ? gridFeet : 2 * gridFeet;
        if (used + cost > feet) return steps;
        used += cost;
        steps += 1;
    }
}

export const footprint = (token, x, y, size) => ({ x, y, w: Number(token.width ?? 1) * size, h: Number(token.height ?? 1) * size });
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const centre = (token, x, y, size) => ({ x: x + Number(token.width ?? 1) * size / 2, y: y + Number(token.height ?? 1) * size / 2 });

// A forced move on a grid. world: { size, gridFeet, inside(x, y), wall(a, b),
// blockers(x, y) → other footprints there } (the Foundry side supplies them).
// Returns { to: {x, y}, squares, stoppedBy, feetLeft }.
export function planForcedMove(token, { point, direction = "away", feet, stopAt = null }, world) {
    const { size, gridFeet = 5 } = world;
    const start = { x: token.x, y: token.y };
    const away = gridDirection(point, centre(token, start.x, start.y, size));
    const step = direction === "away" ? away : away && [-away[0], -away[1]];
    if (!step || !(Number(feet) > 0)) return { to: start, squares: 0, stoppedBy: "no direction", feetLeft: 0 };
    const squares = stepsWithin(Number(feet), step[0] !== 0 && step[1] !== 0, gridFeet);
    let at = { ...start };
    let stoppedBy = null;
    let taken = 0;
    let moved = 0;
    for (let index = 0; index < squares; index++) {
        const next = { x: at.x + step[0] * size, y: at.y + step[1] * size };
        if (!world.inside(next.x, next.y)) {
            stoppedBy = "edge";
            break;
        }
        if (stopAt && overlaps(footprint(token, next.x, next.y, size), stopAt)) {
            stoppedBy = "creature";
            break;
        }
        if (world.wall(centre(token, at.x, at.y, size), centre(token, next.x, next.y, size))) {
            stoppedBy = "wall";
            break;
        }
        at = next;
        moved += step[0] !== 0 && step[1] !== 0 && taken % 2 === 1 ? 2 * gridFeet : gridFeet;
        taken += 1;
    }
    const settled = freeSpaceNear(token, at, start, world) ?? start;
    if (settled.x !== at.x || settled.y !== at.y) stoppedBy ??= "occupied";
    const feetLeft = stoppedBy === "wall" || stoppedBy === "edge" ? Math.max(0, Number(feet) - moved) : 0;
    return { to: settled, squares: taken, stoppedBy, feetLeft };
}

// Where a creature that would end in another's space ends instead: the free
// space touching that creature nearest the intended spot (then nearest where it came from).
export function freeSpaceNear(token, at, from, world) {
    const { size } = world;
    const blockers = world.blockers(at.x, at.y);
    if (!blockers.length) return at;
    const intended = centre(token, at.x, at.y, size);
    const origin = centre(token, from.x, from.y, size);
    const width = Number(token.width ?? 1) * size;
    const height = Number(token.height ?? 1) * size;
    const candidates = [];
    for (const blocker of blockers) {
        for (let x = blocker.x - width; x <= blocker.x + blocker.w; x += size) {
            for (let y = blocker.y - height; y <= blocker.y + blocker.h; y += size) {
                if (overlaps({ x, y, w: width, h: height }, blocker)) continue;
                if (!world.inside(x, y) || world.blockers(x, y).length) continue;
                const spot = centre(token, x, y, size);
                if (world.wall(intended, spot) && world.wall(origin, spot)) continue;
                candidates.push({ x, y, near: Math.hypot(spot.x - intended.x, spot.y - intended.y), back: Math.hypot(spot.x - origin.x, spot.y - origin.y) });
            }
        }
    }
    candidates.sort((a, b) => a.near - b.near || a.back - b.back);
    return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
}
