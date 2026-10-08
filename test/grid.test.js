import test from "node:test";
import assert from "node:assert/strict";

import { distanceFeet, gridDirection, pathPositions, planForcedMove, stepsWithin, withinEmanation } from "../src/model/grid.js";

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

test("distance between spaces: adjacent 5 feet, diagonals 5 then 10, big creatures from their edge, elevation too", () => {
    const grid = { size: 100, gridFeet: 5 };
    const square = (col, row, w = 1, h = 1, elevation = 0) => ({ x: col * 100, y: row * 100, w: w * 100, h: h * 100, elevation });
    assert.equal(distanceFeet(square(0, 0), square(1, 0), grid), 5);
    assert.equal(distanceFeet(square(0, 0), square(1, 1), grid), 5);
    assert.equal(distanceFeet(square(0, 0), square(2, 2), grid), 15);
    assert.equal(distanceFeet(square(0, 0), square(3, 0), grid), 15);
    assert.equal(distanceFeet(square(0, 0, 2, 2), square(3, 0), grid), 10, "a large creature's far edge");
    assert.equal(distanceFeet(square(0, 0), square(0, 0, 1, 1, 10), grid), 10, "10 feet up");
    assert.equal(distanceFeet(square(0, 0), square(0, 0), grid), 0);
    assert.ok(withinEmanation(square(0, 0, 2, 2), square(3, 1), 10, grid));
    assert.ok(!withinEmanation(square(0, 0, 2, 2), square(4, 1), 10, grid));
});

test("the squares a move passes; a teleport only lands", () => {
    const path = pathPositions([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }], { size: 100 });
    assert.deepEqual(path.map((point) => `${point.x},${point.y}`), ["0,0", "100,0", "200,0", "300,0", "300,100", "300,200"]);
    assert.equal(pathPositions([{ x: 0, y: 0 }, { x: 500, y: 0, action: "displace" }], { size: 100, teleport: (point) => point.action === "displace" }).length, 2);
});
