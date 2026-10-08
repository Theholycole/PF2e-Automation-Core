// Forced movement in Foundry (pushes and pulls), on src/model/grid.js: the
// world the grid rules need (the scene's edge, walls, other creatures' spaces),
// and the token update. Content modules call api.forcedMovement.forcedMove.

import { footprint, overlaps, planForcedMove } from "../src/model/grid.js";

function world(token) {
    const scene = token.parent;
    const size = scene.grid?.size ?? canvas.grid.size;
    const rect = scene.dimensions?.sceneRect ?? canvas.dimensions?.sceneRect ?? null;
    return {
        size,
        gridFeet: scene.grid?.distance ?? canvas.dimensions?.distance ?? 5,
        inside(x, y) {
            if (!rect) return true;
            const box = footprint(token, x, y, size);
            return box.x >= rect.x && box.y >= rect.y && box.x + box.w <= rect.x + rect.width && box.y + box.h <= rect.y + rect.height;
        },
        wall(a, b) {
            try {
                const backend = CONFIG.Canvas?.polygonBackends?.move;
                return backend?.testCollision ? !!backend.testCollision(a, b, { type: "move", mode: "any" }) : false;
            } catch {
                return false;
            }
        },
        blockers(x, y) {
            const here = footprint(token, x, y, size);
            return scene.tokens.filter((other) => other.id !== token.id && other.actor && !other.hidden).map((other) => footprint(other, other.x, other.y, size)).filter((box) => overlaps(here, box));
        }
    };
}

// Moves a token by force, away from or toward a point, up to the feet given.
// Returns { moved, from, to, squares, stoppedBy, feetLeft }.
export async function forcedMove(tokenDoc, { point, direction = "away", feet, stopAt = null, reason = "" }) {
    const token = tokenDoc?.document ?? tokenDoc;
    if (!token?.parent || !point || !(Number(feet) > 0)) return { moved: false, reason: "nothing to move" };
    const size = token.parent.grid?.size ?? canvas.grid.size;
    const stop = stopAt ? (() => { const other = stopAt.document ?? stopAt; return footprint(other, other.x, other.y, size); })() : null;
    const from = { x: token.x, y: token.y };
    const plan = planForcedMove(token, { point, direction, feet, stopAt: stop }, world(token));
    if (plan.to.x === from.x && plan.to.y === from.y) return { moved: false, from, to: from, squares: 0, stoppedBy: plan.stoppedBy, feetLeft: plan.feetLeft };
    await token.update({ x: plan.to.x, y: plan.to.y }, { teleport: true, animate: false, "pf2e-resolution-core": { forcedMovement: true, reason } });
    return { moved: true, from, ...plan };
}
