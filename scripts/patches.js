// The core's PF2e patches: each shared PF2e function is wrapped exactly once,
// here, and content modules plug in providers instead of wrapping it again.
//
//   damage   Actor#applyDamage: remembers the damage types and source each
//            creature was last given and stamps the source on PF2e's
//            damage-taken message (it carries none); listeners run around it.
//   rules    ItemPF2e#prepareRuleElements and ItemPF2e.createDocuments: rule
//            rewriters and item-creation transformers.
//   d20      PF2e's Check.roll and CheckRoll#evaluate: d20 limits.
//   terrain  modifyMovementCost#_getTerrainEffects: per-creature terrain.
//
// Safe switch-over: a patch is skipped while the spell module still installs
// its own version (its markers are checked), so nothing is wrapped twice. The
// core installs after every module's "ready" handlers have run.

import { clampD20, combineD20Limits, d20Mark, damageMemoryFrom, readD20Mark, recentSource, rewriteRules, selectiveDifficulty, terrainEffects, transformCreated, isSystemContextMessage, isTurnChange } from "../src/patch-logic.js";
import { activeGM, isLeadGM } from "./runtime-utils.js";

const CORE_ID = "pf2e-resolution-core";
const SPELL_MODULE_ID = "pf2e-automatic-resolution";
const MARK = "__pf2eResolutionCore";

const status = { damage: "not-installed", rules: "not-installed", d20: "not-installed", terrain: "not-installed" };
const damageListeners = [];
const ruleRewriters = [];
const createTransformers = [];
const d20Providers = [];
const terrainProviders = [];
const lastDamageTypes = new Map();
const lastDamageSource = new Map();

const registeredBy = (module) => [damageListeners, ruleRewriters, createTransformers, d20Providers, terrainProviders].some((list) => list.some((entry) => entry.module === module));

function register(list, entry, required) {
    if (typeof entry?.module !== "string" || required.some((key) => typeof entry[key] !== "function")) {
        throw new Error(`A provider needs module and ${required.join(", ")}.`);
    }
    const index = list.findIndex((existing) => existing.module === entry.module && existing.name === entry.name);
    if (index >= 0) list[index] = entry;
    else list.push(entry);
}

// ---- damage ----

function installDamage() {
    const Actor = CONFIG.Actor.documentClass;
    if (Actor.prototype.__pf2eAutoDamageTypes) return "spell-module";
    if (Actor.prototype[MARK]?.damage) return "core";
    const original = Actor.prototype.applyDamage;
    Actor.prototype.applyDamage = function (params = {}, ...rest) {
        // Listeners run in registration order. before() may return an after-callback,
        // or { params, after } to replace the parameters (Duplicate Foe's halved copies).
        const after = [];
        let current = params;
        for (const listener of damageListeners) {
            try {
                const answer = listener.before(this, current);
                if (typeof answer === "function") after.push({ listener, callback: answer });
                else if (answer && typeof answer === "object") {
                    if (answer.params) current = answer.params;
                    if (typeof answer.after === "function") after.push({ listener, callback: answer.after });
                }
            } catch (error) {
                console.warn(`${CORE_ID} | ${listener.module}'s damage listener failed.`, error);
            }
        }
        try {
            const memory = damageMemoryFrom(current, Date.now());
            if (memory.types) lastDamageTypes.set(this.uuid, memory.types);
            lastDamageSource.set(this.uuid, memory.source);
        } catch {
            // Memory is best effort; the damage itself must go through.
        }
        const result = original.call(this, current, ...rest);
        if (!after.length) return result;
        // The after-callbacks are awaited in order, each on its own, before the
        // caller's await resolves: callers read HP right after applyDamage.
        return (async () => {
            const value = await result;
            for (const { listener, callback } of after) {
                try {
                    await callback(value);
                } catch (error) {
                    console.warn(`${CORE_ID} | ${listener.module}'s after-damage callback failed.`, error);
                }
            }
            return value;
        })();
    };
    Actor.prototype[MARK] = { ...(Actor.prototype[MARK] ?? {}), damage: true };
    Hooks.on("preCreateChatMessage", (document, data) => {
        try {
            if (data?.flags?.pf2e?.context?.type !== "damage-taken") return;
            const actorUuid = document.speaker?.actor ? game.actors.get(document.speaker.actor)?.uuid : null;
            const token = document.speaker?.token && document.speaker?.scene ? game.scenes.get(document.speaker.scene)?.tokens.get(document.speaker.token) : null;
            const key = token?.actor?.uuid ?? actorUuid;
            const source = recentSource(key ? lastDamageSource.get(key) : null, Date.now());
            if (source) document.updateSource({ [`flags.${CORE_ID}.damageSource`]: source });
        } catch {
            // The stamp is best effort.
        }
    });
    return "core";
}

// ---- rules ----

function itemBaseClass() {
    const featClass = CONFIG.PF2E?.Item?.documentClasses?.feat;
    return featClass ? Object.getPrototypeOf(featClass.prototype)?.constructor : null;
}

function installRules() {
    const ItemPF2e = itemBaseClass();
    if (!ItemPF2e?.prototype?.prepareRuleElements) return "not-installed";
    if (ItemPF2e.prototype.prepareRuleElements[SPELL_MODULE_ID]) return "spell-module";
    if (ItemPF2e.prototype.prepareRuleElements[MARK]) return "core";
    const prepare = ItemPF2e.prototype.prepareRuleElements;
    ItemPF2e.prototype.prepareRuleElements = function (...args) {
        if (ruleRewriters.length) this.system.rules = rewriteRules(ruleRewriters, this, this.system.rules);
        return prepare.apply(this, args);
    };
    ItemPF2e.prototype.prepareRuleElements[MARK] = true;
    const create = ItemPF2e.createDocuments;
    ItemPF2e.createDocuments = async function (data = [], options = {}) {
        if (createTransformers.length && options?.parent) data = transformCreated(createTransformers, data, options.parent);
        return create.call(this, data, options);
    };
    return "core";
}

// Foundry 14 prepares world documents before "setup", so an item already on
// an actor at world load may have been prepared without the rewriters. Live
// (2026-10-08) those actors were prepared again anyway; this is the safety
// net. It re-prepares just the actors (world actors and unlinked token
// actors) holding an item a rewriter changes, so it stays cheap in big
// worlds. Returns how many were reset.
export function reprepareAffectedActors() {
    const affected = (actor) => [...(actor?.items ?? [])].some((item) => {
        const source = item?._source?.system?.rules ?? [];
        return rewriteRules(ruleRewriters, item, source) !== source;
    });
    let count = 0;
    const reset = (actor) => {
        if (actor && affected(actor)) {
            actor.reset?.();
            count++;
        }
    };
    for (const actor of game.actors ?? []) reset(actor);
    for (const scene of game.scenes ?? []) {
        for (const token of scene.tokens ?? []) if (!token.actorLink) reset(token.actor);
    }
    return count;
}

// ---- d20 ----

function installD20() {
    const Check = game.pf2e?.Check;
    const CheckRoll = (CONFIG.Dice?.rolls ?? []).find((candidate) => candidate?.name === "CheckRoll");
    if (!Check?.roll || !CheckRoll) return "not-installed";
    if (Check.roll[SPELL_MODULE_ID]) return "spell-module";
    if (Check.roll[MARK]) return "core";
    const roll = Check.roll;
    Check.roll = async function (check, context = {}, ...rest) {
        const actor = context?.origin?.actor ?? context?.actor ?? null;
        if (actor && d20Providers.length) {
            const limits = combineD20Limits(d20Providers.map((provider) => {
                try {
                    return provider.limits(actor, context?.type);
                } catch {
                    return null;
                }
            }));
            if (limits) context.domains = [...(context.domains ?? []), d20Mark(limits)];
        }
        return roll.call(this, check, context, ...rest);
    };
    Check.roll[MARK] = true;
    const evaluate = CheckRoll.prototype.evaluate;
    CheckRoll.prototype.evaluate = async function (...args) {
        const result = await evaluate.apply(this, args);
        const limits = readD20Mark(this.options?.domains);
        if (!limits) return result;
        let changed = false;
        for (const die of this.dice.filter((term) => term.faces === 20)) for (const entry of die.results) {
            const value = clampD20(entry.result, limits);
            if (value !== entry.result) {
                entry.result = value;
                changed = true;
            }
        }
        if (changed) {
            // Keep-highest/lowest picks again from the limited results; the total follows.
            for (const die of this.dice.filter((term) => term.faces === 20 && term.results.length > 1)) {
                const keep = die.modifiers.includes("kh") ? "max" : die.modifiers.includes("kl") ? "min" : null;
                if (!keep) continue;
                const best = Math[keep](...die.results.map((entry) => entry.result));
                let kept = false;
                for (const entry of die.results) {
                    const keepThis = !kept && entry.result === best;
                    entry.active = keepThis;
                    entry.discarded = !keepThis;
                    if (keepThis) kept = true;
                }
            }
            this._total = this._evaluateTotal();
            this.options.d20Clamped = limits;
        }
        return result;
    };
    return "core";
}

// ---- terrain ----

function installTerrain() {
    const type = CONFIG.RegionBehavior?.dataModels?.modifyMovementCost;
    if (!type?.prototype?._getTerrainEffects) return "not-installed";
    if (type.prototype._pf2eAutoSelective) return "spell-module";
    if (type.prototype[MARK]) return "core";
    const original = type.prototype._getTerrainEffects;
    type.prototype._getTerrainEffects = function (token, segment, options) {
        let spec = this.behavior?.flags?.[CORE_ID]?.selectiveTerrain ?? this.parent?.flags?.[CORE_ID]?.selectiveTerrain ?? null;
        for (const provider of terrainProviders) {
            if (spec) break;
            try {
                spec = provider.selective(this) ?? null;
            } catch {
                spec = null;
            }
        }
        if (!spec) return original.call(this, token, segment, options);
        const actor = token?.actor ?? token?.document?.actor;
        const creature = { uuid: actor?.uuid, isCreature: Boolean(actor?.isOfType?.("creature")), size: actor?.size, modeOfBeing: actor?.modeOfBeing };
        const difficulty = selectiveDifficulty(spec, creature, segment?.action);
        return difficulty === null ? [] : terrainEffects(difficulty);
    };
    type.prototype[MARK] = true;
    return "core";
}

// At "setup": the rules patch, if a module has already registered a rewriter or
// transformer (a switched-over module does so at "init"; a module that still
// patches by itself registers nothing, so the core leaves the setup-time patch
// to it). Foundry 14 prepares world documents before "setup", so this covers
// what is prepared from then on; installPatches re-prepares the actors that
// were prepared earlier.
export function installEarlyPatches() {
    if (!ruleRewriters.length && !createTransformers.length) return;
    try {
        status.rules = installRules();
    } catch (error) {
        status.rules = "failed";
        console.error(`${CORE_ID} | The rules patch failed to install.`, error);
    }
}

export function installPatches() {
    // After every module's ready handlers: a module that still installs its own
    // version has done so by now, and its marker makes the core stand aside.
    setTimeout(() => {
        for (const [name, install] of [["damage", installDamage], ["rules", installRules], ["d20", installD20], ["terrain", installTerrain]]) {
            try {
                status[name] = install();
            } catch (error) {
                status[name] = "failed";
                console.error(`${CORE_ID} | The ${name} patch failed to install.`, error);
            }
        }
        // Early or late, what was prepared without the rules patch is prepared again.
        if (status.rules === "core" && ruleRewriters.length) {
            try {
                reprepareAffectedActors();
            } catch (error) {
                console.error(`${CORE_ID} | Re-preparing actors with rewritten rules failed.`, error);
            }
        }
        if (Object.values(status).includes("spell-module")) {
            console.info(`${CORE_ID} | Standing aside for patches the spell module still installs itself:`, { ...status });
        } else if (game.modules?.get?.(SPELL_MODULE_ID)?.active && !registeredBy(SPELL_MODULE_ID)) {
            // The spell module is on and patches nothing itself, yet gave the core nothing: it most likely read the api before the core's init.
            console.warn(`${CORE_ID} | ${SPELL_MODULE_ID} is active but registered no providers. Content modules register on the "pf2eResolutionCoreReady" hook, set up when their script loads.`);
        }
    }, 0);
}

export const patchesApi = Object.freeze({
    status: () => ({ ...status }),
    damage: Object.freeze({
        // listener: { module, name?, before(actor, params) → ((result) => void) | null }
        onApply: (listener) => register(damageListeners, listener, ["before"]),
        lastTypes: (actorUuid) => lastDamageTypes.get(actorUuid)?.types ?? [],
        lastSource: (actorUuid) => lastDamageSource.get(actorUuid) ?? null,
        // The source stamped on a damage-taken message (the spell module's older stamp too).
        sourceOf: (message) => message?.flags?.[CORE_ID]?.damageSource ?? message?.flags?.[SPELL_MODULE_ID]?.damageSource ?? null
    }),
    rules: Object.freeze({
        // rewriter: { module, name?, rewrite(item, rules) → rules | null }
        registerRewriter: (rewriter) => register(ruleRewriters, rewriter, ["rewrite"]),
        // transformer: { module, name?, transform(entry, parent) → entry }
        registerCreateTransformer: (transformer) => register(createTransformers, transformer, ["transform"])
    }),
    d20: Object.freeze({
        // provider: { module, name?, limits(actor, checkType) → { min, max } | null }
        registerLimitProvider: (provider) => register(d20Providers, provider, ["limits"])
    }),
    terrain: Object.freeze({
        // provider: { module, name?, selective(behavior) → spec | null } (see src/patch-logic.js selectiveDifficulty)
        registerProvider: (provider) => register(terrainProviders, provider, ["selective"])
    }),
    conventions: Object.freeze({ activeGM, isLeadGM, isSystemContextMessage, isTurnChange })
});
