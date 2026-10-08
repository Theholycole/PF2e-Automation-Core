import test from "node:test";
import assert from "node:assert/strict";

import { gridDirection, planForcedMove, stepsWithin } from "../src/model/grid.js";

const open = { size: 100, gridFeet: 5, inside: () => true, wall: () => false, blockers: () => [] };

test("forced movement: the nearest of 8 directions, diagonals 5 then 10 feet", () => {
    assert.deepEqual(gridDirection({ x: 0, y: 0 }, { x: 100, y: 10 }), [1, 0]);
    assert.deepEqual(gridDirection({ x: 0, y: 0 }, { x: 100, y: 100 }), [1, 1]);
    assert.equal(stepsWithin(10, false), 2);
    assert.equal(stepsWithin(15, true), 2, "5 + 10");
    assert.equal(stepsWithin(20, true), 3);
});

test("a push away from a point, stopped by walls and the scene's edge; never ending in another creature's space", () => {
    const token = { x: 300, y: 300, width: 1, height: 1 };
    assert.deepEqual(planForcedMove(token, { point: { x: 150, y: 350 }, feet: 10 }, open).to, { x: 500, y: 300 }, "two squares east");
    const walled = { ...open, wall: (a, b) => b.x > 450 };
    const stopped = planForcedMove(token, { point: { x: 150, y: 350 }, feet: 10 }, walled);
    assert.deepEqual([stopped.to, stopped.stoppedBy, stopped.feetLeft], [{ x: 400, y: 300 }, "wall", 5]);
    const edge = { ...open, inside: (x) => x < 500 };
    assert.equal(planForcedMove(token, { point: { x: 150, y: 350 }, feet: 15 }, edge).stoppedBy, "edge");
    // Another creature where it would land: the free space beside it nearest the landing spot.
    const occupied = { ...open, blockers: (x, y) => (x === 500 && y === 300 ? [{ x: 500, y: 300, w: 100, h: 100 }] : []) };
    const beside = planForcedMove(token, { point: { x: 150, y: 350 }, feet: 10 }, occupied);
    assert.notDeepEqual(beside.to, { x: 500, y: 300 });
    assert.equal(beside.stoppedBy, "occupied");
});
