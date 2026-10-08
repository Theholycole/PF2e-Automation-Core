// The family registry (docs/plan-model.md section 5). Content modules register
// the resolution kinds they handle and the compilers for their items; the
// Combat Simulator and the live layer ask the registry, never each module.
//
// One family per kind: registering a kind another module already owns throws,
// so a rule can never be resolved twice. Re-registering from the same module
// (a reload) replaces it.

import { validateSkeleton, readPlan } from "./model/plan.js";
import { validateChanges } from "./model/changes.js";
import { validateDecision } from "./model/decisions.js";
import { driveSync } from "./drive.js";

function itemKey(item) {
    const id = item?.uuid ?? item?._id ?? item?.id ?? item?.name;
    const modified = item?._stats?.modifiedTime ?? item?._source?._stats?.modifiedTime ?? "";
    return `${id}|${modified}`;
}

export function createRegistry() {
    const families = new Map();
    const compilers = [];
    const planCache = new Map();

    function registerFamily(family) {
        if (!family || typeof family.kind !== "string" || !family.kind) throw new Error("A family needs a kind.");
        if (typeof family.module !== "string" || !family.module) throw new Error(`Family ${family.kind} needs the id of the module registering it.`);
        if (typeof family.resolve !== "function") throw new Error(`Family ${family.kind} needs a resolve function.`);
        if (family.steps !== undefined && typeof family.steps !== "function") throw new Error(`Family ${family.kind}'s steps must be a generator function.`);
        const existing = families.get(family.kind);
        if (existing && existing.module !== family.module) {
            throw new Error(`Resolution kind "${family.kind}" is already registered by ${existing.module}; ${family.module} can't register it too.`);
        }
        families.set(family.kind, Object.freeze({ ...family }));
    }

    function registerCompiler(compiler) {
        if (typeof compiler?.module !== "string" || typeof compiler.handles !== "function" || typeof compiler.compile !== "function") {
            throw new Error("A compiler needs module, handles(item) and compile(item, options) (which may return a Promise).");
        }
        const index = compilers.findIndex((entry) => entry.module === compiler.module && entry.name === compiler.name);
        if (index >= 0) compilers[index] = compiler;
        else compilers.push(compiler);
        planCache.clear();
    }

    const isPromise = (value) => typeof value?.then === "function";

    // The plan for an item from the first compiler that handles it, read in
    // version-13 form. null when no compiler handles it. A compiler whose
    // compile returns a Promise (the spell module's looks up referenced spells
    // first) needs preparePlan or preparePlans before planFor can answer.
    function planFor(item, options = {}) {
        const key = itemKey(item);
        if (!options.noCache && planCache.has(key)) return planCache.get(key);
        const compiler = compilers.find((entry) => entry.handles(item));
        if (!compiler) {
            planCache.set(key, null);
            return null;
        }
        const compiled = compiler.compile(item, options);
        if (isPromise(compiled)) {
            compiled.catch(() => {});
            throw new Error(`${compiler.module} compiles ${item?.name ?? "this item"} asynchronously: call registry.preparePlan(item) or preparePlans(items) first.`);
        }
        const result = { module: compiler.module, plan: readPlan(compiled) };
        planCache.set(key, result);
        return result;
    }

    // Compiles (awaiting async compilers) and caches, so planFor answers
    // synchronously afterwards. Rejects if the compiler fails.
    async function preparePlan(item, options = {}) {
        const key = itemKey(item);
        if (!options.noCache && planCache.has(key)) return planCache.get(key);
        const compiler = compilers.find((entry) => entry.handles(item));
        const result = compiler ? { module: compiler.module, plan: readPlan(await compiler.compile(item, options)) } : null;
        planCache.set(key, result);
        return result;
    }

    // Several at once: [{ item, result } | { item, error }], one per item, in order.
    async function preparePlans(items, options = {}) {
        const settled = await Promise.allSettled(items.map((item) => preparePlan(item, options)));
        return settled.map((outcome, index) => (outcome.status === "fulfilled" ? { item: items[index], result: outcome.value } : { item: items[index], error: outcome.reason }));
    }

    // The skeleton plus the family's own payload checks.
    function validatePlan(plan) {
        const issues = validateSkeleton(plan);
        const family = families.get(plan?.resolution?.kind);
        if (family?.validate) {
            for (const issue of family.validate(plan.resolution) ?? []) issues.push(typeof issue === "string" ? { path: "resolution", message: issue } : issue);
        }
        return { ok: issues.length === 0, issues, registered: Boolean(family) };
    }

    function checkResult(family, result) {
        const issues = [...validateChanges(result?.changes)];
        (result?.decisions ?? []).forEach((decision, index) => {
            for (const issue of validateDecision(decision)) issues.push({ path: `decisions.${index}.${issue.path}`, message: issue.message });
        });
        if (issues.length) throw new Error(`${family.module} (${family.kind}) returned an invalid result: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
        return { degrees: {}, changes: [], decisions: [], records: [], ...result };
    }

    async function resolve(plan, context, io) {
        const read = readPlan(plan);
        const family = families.get(read?.resolution?.kind);
        if (!family) throw new Error(`No family is registered for resolution kind "${read?.resolution?.kind}".`);
        return checkResult(family, await family.resolve(read, context, io));
    }

    // The same resolution without awaiting io: for families with steps (the
    // Combat Simulator's engine is synchronous).
    function resolveSync(plan, context, io) {
        const read = readPlan(plan);
        const family = families.get(read?.resolution?.kind);
        if (!family) throw new Error(`No family is registered for resolution kind "${read?.resolution?.kind}".`);
        if (typeof family.steps !== "function") throw new Error(`${family.module} (${family.kind}) has no steps, so it can only resolve with resolve().`);
        return checkResult(family, driveSync(family.steps(read, context), io));
    }

    async function resolveEvent(record, event, context, io) {
        const family = families.get(record?.kind);
        if (!family?.resolveEvent) throw new Error(`No family resolves events for ongoing records of kind "${record?.kind}".`);
        return checkResult(family, await family.resolveEvent(record, event, context, io));
    }

    return {
        registerFamily,
        registerCompiler,
        planFor,
        preparePlan,
        preparePlans,
        validatePlan,
        resolve,
        resolveSync,
        resolveEvent,
        familyFor: (kind) => families.get(kind) ?? null,
        families: () => [...families.values()],
        clearCache: () => planCache.clear()
    };
}
