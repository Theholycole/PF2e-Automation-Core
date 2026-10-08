// PF2e damage formulas, read without Foundry: "6d6", "2d4+3",
// "1d4[persistent,fire]", "(2d6+4)[fire]", "(@item.level)d4[bleed]",
// "(ternary(gte(@item.rank,10),115,100))[void]".
//
// parseDamage(formula, { rank }) → instances [{ type, category, dice: [{ count, die, factor }], constant }]
// An instance is worth Σ factor × (count d die) + constant. Its type and
// category come from the formula's flavor ("[persistent,fire]") or from the
// defaults the caller gives (a spell component's own type).

const CATEGORIES = new Set(["persistent", "precision", "splash"]);
// Bleed is always persistent damage.
const ALWAYS_PERSISTENT = new Set(["bleed"]);
// Flavor words that are neither a type nor a category (materials, traits).
const IGNORED_FLAVOR = new Set(["adamantine", "cold-iron", "silver", "orichalcum", "mithral", "dawnsilver", "duskwood", "sisterstone", "abysium", "djezet", "inubrix", "noqual", "peachwood", "siccatite", "magical", "nonlethal", "area-damage"]);

const FUNCTIONS = {
    ternary: (condition, a, b) => (condition ? a : b),
    gte: (a, b) => (a >= b ? 1 : 0),
    gt: (a, b) => (a > b ? 1 : 0),
    lte: (a, b) => (a <= b ? 1 : 0),
    lt: (a, b) => (a < b ? 1 : 0),
    eq: (a, b) => (a === b ? 1 : 0),
    max: Math.max,
    min: Math.min,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    abs: Math.abs
};

function tokenize(text) {
    const tokens = [];
    const pattern = /\s*(\d+(?:\.\d+)?|@[\w.]+|[a-zA-Z_]\w*|\[[^\]]*\]|[-+*/(),])/y;
    let index = 0;
    while (index < text.length) {
        if (/\s/.test(text[index])) {
            index++;
            continue;
        }
        pattern.lastIndex = index;
        const match = pattern.exec(text);
        if (!match) throw new Error(`Can't read the damage formula "${text}" at "${text.slice(index)}".`);
        tokens.push(match[1]);
        index = pattern.lastIndex;
    }
    return tokens;
}

// A value is a list of groups, each with its own flavor: a plain number is
// one group with only a constant.
const scalar = (number) => ({ groups: [{ flavor: null, dice: [], constant: number }] });
const isScalar = (value) => value.groups.every((group) => !group.dice.length);
const scalarOf = (value) => value.groups.reduce((sum, group) => sum + group.constant, 0);
const flavorKey = (flavor) => (flavor ? flavor.join(",") : "");

function merge(groups) {
    const byFlavor = new Map();
    for (const group of groups) {
        const key = flavorKey(group.flavor);
        const existing = byFlavor.get(key);
        if (existing) {
            existing.dice.push(...group.dice);
            existing.constant += group.constant;
        } else byFlavor.set(key, { flavor: group.flavor, dice: [...group.dice], constant: group.constant });
    }
    return { groups: [...byFlavor.values()] };
}

function scale(value, by) {
    return { groups: value.groups.map((group) => ({ flavor: group.flavor, dice: group.dice.map((term) => ({ ...term, factor: term.factor * by })), constant: group.constant * by })) };
}

function add(a, b, sign = 1) {
    return merge([...a.groups, ...(sign === 1 ? b : scale(b, -1)).groups]);
}

function multiply(a, b) {
    if (isScalar(a)) return scale(b, scalarOf(a));
    if (isScalar(b)) return scale(a, scalarOf(b));
    throw new Error("Dice can't be multiplied by dice.");
}

function withFlavor(value, flavor) {
    return merge(value.groups.map((group) => ({ ...group, flavor: group.flavor ?? flavor })));
}

function parser(tokens, variables) {
    let position = 0;
    const peek = () => tokens[position];
    const next = () => tokens[position++];
    const expect = (token) => {
        if (next() !== token) throw new Error(`Expected "${token}" in the damage formula.`);
    };

    function expression() {
        let value = term();
        while (peek() === "+" || peek() === "-") {
            const sign = next() === "+" ? 1 : -1;
            value = add(value, term(), sign);
        }
        return value;
    }

    function term() {
        let value = factor();
        while (peek() === "*" || peek() === "/") {
            const operator = next();
            const right = factor();
            if (operator === "*") value = multiply(value, right);
            else {
                if (!isScalar(right)) throw new Error("Can't divide by dice.");
                value = scale(value, 1 / scalarOf(right));
            }
        }
        return value;
    }

    // A primary, then any dice ("(…)d4") and flavor ("[fire]") after it.
    function factor() {
        if (peek() === "-") {
            next();
            return scale(factor(), -1);
        }
        let value = primary();
        for (;;) {
            const token = peek();
            if (token && /^d\d+$/i.test(token)) {
                // "6d6" tokenizes as 6 then d6.
                next();
                value = dice(value, scalar(Number(token.slice(1))));
            } else if (token === "d") {
                next();
                value = dice(value, primary());
            } else if (token?.startsWith("[")) {
                next();
                const words = token.slice(1, -1).split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);
                value = withFlavor(value, words);
            } else return value;
        }
    }

    function dice(count, die) {
        if (!isScalar(count) || !isScalar(die)) throw new Error("Dice counts and sizes must be numbers.");
        const n = Math.trunc(scalarOf(count));
        const size = Math.trunc(scalarOf(die));
        return { groups: [{ flavor: null, dice: n > 0 && size > 0 ? [{ count: n, die: size, factor: 1 }] : [], constant: 0 }] };
    }

    function primary() {
        const token = next();
        if (token === undefined) throw new Error("The damage formula ends early.");
        if (token === "(") {
            const value = expression();
            expect(")");
            return value;
        }
        if (/^\d/.test(token)) return scalar(Number(token));
        if (token.startsWith("@")) {
            const name = token.slice(1);
            if (!(name in variables)) throw new Error(`Unknown formula variable ${token}.`);
            return scalar(Number(variables[name]));
        }
        if (/^d\d+$/i.test(token)) return dice(scalar(1), scalar(Number(token.slice(1))));
        if (token in FUNCTIONS && peek() === "(") {
            next();
            const args = [];
            if (peek() !== ")") {
                for (;;) {
                    const value = expression();
                    if (!isScalar(value)) throw new Error(`${token}() takes numbers.`);
                    args.push(scalarOf(value));
                    if (peek() === ",") next();
                    else break;
                }
            }
            expect(")");
            return scalar(FUNCTIONS[token](...args));
        }
        throw new Error(`Can't read "${token}" in a damage formula.`);
    }

    return { expression, done: () => position >= tokens.length };
}

function readFlavor(flavor, defaults) {
    let type = defaults.type ?? "untyped";
    let category = defaults.category ?? null;
    for (const word of flavor ?? []) {
        if (CATEGORIES.has(word)) category = word;
        else if (!IGNORED_FLAVOR.has(word)) type = word;
    }
    if (ALWAYS_PERSISTENT.has(type)) category = "persistent";
    return { type, category };
}

// The variables a spell's formulas use, at the rank it's cast.
export function formulaVariables(rank) {
    return { "item.rank": rank, "item.level": rank, "spell.rank": rank, "spell.level": rank, "item.system.level.value": rank };
}

// "{A[fire],B[persistent,fire]}" or "A[sonic],B[piercing]" (PF2e's inline
// @Damage): several pools, all dealt. Top-level commas split them.
function splitPools(formula) {
    const text = String(formula).trim();
    const inner = /^\{(.*)\}$/s.exec(text)?.[1] ?? text;
    const pools = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < inner.length; index++) {
        const character = inner[index];
        if (character === "(" || character === "[" || character === "{") depth++;
        else if (character === ")" || character === "]" || character === "}") depth--;
        else if (character === "," && depth === 0) {
            pools.push(inner.slice(start, index));
            start = index + 1;
        }
    }
    pools.push(inner.slice(start));
    return pools.map((pool) => pool.trim()).filter(Boolean);
}

function parsePool(formula, variables, defaults) {
    const read = parser(tokenize(formula), variables);
    const value = read.expression();
    if (!read.done()) throw new Error(`Can't read all of the damage formula "${formula}".`);
    return value.groups
        .filter((group) => group.dice.length || group.constant)
        .map((group) => ({ ...readFlavor(group.flavor, defaults), dice: group.dice, constant: group.constant }));
}

// Each pool's instances, in order: [[instance…], …].
export function parseDamagePools(formula, { rank = 1, variables = null, type = null, category = null } = {}) {
    return splitPools(formula).map((pool) => parsePool(pool, variables ?? formulaVariables(rank), { type, category }));
}

export function parseDamage(formula, options = {}) {
    return parseDamagePools(formula, options).flat();
}

// Adds a heightening increase ("2d6", per step) to a formula's instances.
export function addSteps(instances, increase, steps) {
    if (!steps) return instances;
    const [first, ...rest] = instances;
    const extra = increase.flatMap((instance) => instance.dice.map((term) => ({ ...term, factor: term.factor * steps })));
    const extraConstant = increase.reduce((sum, instance) => sum + instance.constant, 0) * steps;
    if (!first) return increase.map((instance) => ({ ...instance, dice: instance.dice.map((term) => ({ ...term, factor: term.factor * steps })), constant: instance.constant * steps }));
    return [{ ...first, dice: [...first.dice, ...extra], constant: first.constant + extraConstant }, ...rest];
}

export function expectedDamage(instance) {
    return instance.dice.reduce((sum, term) => sum + term.factor * term.count * (term.die + 1) / 2, 0) + instance.constant;
}

// Rolls an instance with a random source in [0, 1). At least 0.
export function rollDamage(instance, random) {
    let total = instance.constant;
    for (const term of instance.dice) {
        let rolled = 0;
        for (let i = 0; i < term.count; i++) rolled += 1 + Math.floor(random() * term.die);
        total += term.factor * rolled;
    }
    return Math.max(0, Math.floor(total));
}

// "2d6+4", for cards and logs.
export function formatDamage(instance) {
    const parts = instance.dice.map((term) => `${term.factor === 1 ? "" : `${term.factor}×`}${term.count}d${term.die}`);
    if (instance.constant) parts.push(String(instance.constant));
    return parts.join("+").replace(/\+-/g, "-") || "0";
}
