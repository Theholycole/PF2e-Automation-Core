// Degrees of success, as indices (0 critical failure … 3 critical success)
// and names.

export const DEGREE_NAMES = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);

export function degreeIndex(total, dc, natural) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (natural === 20) degree = Math.min(3, degree + 1);
    if (natural === 1) degree = Math.max(0, degree - 1);
    return degree;
}

export function degreeName(total, dc, natural) {
    return DEGREE_NAMES[degreeIndex(total, dc, natural)];
}
