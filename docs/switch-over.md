# Switching the spell module onto the core (milestone 2, step 2)

For the session that owns `pf2e-automatic-resolution`. The core is built and tested (40 Node tests). This page says what the spell module changes. The core's side is done, including the four requests from the spell session's dry run (2026-10-08).

## The core

- **Module id:** `pf2e-resolution-core`. Folder `PF2e RESOLUTION CORE` (beside the other modules' folders), linked as:
  - `~/.local/share/FoundryVTT/Data/modules/pf2e-resolution-core`, for Foundry
  - `~/Documents/ChatGPT/pf2e-resolution-core`, a sibling of the spell module's folder, so the same relative import resolves both in Node and in Foundry (`/modules/pf2e-resolution-core/...`): `../../pf2e-resolution-core/...` from `scripts/`, and `../../../pf2e-resolution-core/...` from `src/compiler/` *(corrected after the spell session's review)*
- **API:** `game.modules.get("pf2e-resolution-core").api` exists from the core's `init` (it loads first as a dependency). The `pf2eResolutionCoreReady` hook also fires with it.
  - `api.registry`: families, compilers, `planFor`, `validatePlan`, `resolve`, `resolveEvent` (for step 3)
  - `api.patches`: see below
  - `api.runtimeUtils`, `api.textPatterns`, `api.model`
- **Safety:** each patch waits until every module's `ready` handlers have run, except the rules patch, which installs at `setup` when a module registered a rewriter at `init` (see section 5 for the re-prepare that follows). Each **stands aside while the spell module's own patch is installed**. It checks the markers `Actor.prototype.__pf2eAutoDamageTypes`, `prepareRuleElements["pf2e-automatic-resolution"]`, `Check.roll["pf2e-automatic-resolution"]` and `_pf2eAutoSelective`. Enabling the core before the switch is therefore harmless. `api.patches.status()` says who owns each patch: `"core"`, `"spell-module"` or `"not-installed"`.

## Spell-module changes

### 1. Depend on the core

In `module.json`:

```json
"relationships": { "requires": [{ "id": "pf2e-resolution-core", "type": "module" }], "systems": [...] }
```

### 2. Shared helpers: forward, so no importer changes

The core's copies are checked identical by the core's test `the core's text patterns and runtime helpers match the spell module's`.

- `scripts/runtime-utils.js` becomes:

  ```js
  export * from "../../pf2e-resolution-core/scripts/runtime-utils.js";
  export const MODULE_ID = "pf2e-automatic-resolution";   // the module's own flags stay its own
  ```
- `src/compiler/text-patterns.js` becomes:

  ```js
  export * from "../../../pf2e-resolution-core/src/text/text-patterns.js";
  ```
- Optional: `htmlToPlainText` and `durationSeconds` can also come from the core (`src/text/plain-text.js`). They're identical.

### 3. Remove the four patches and register providers

Register on the core's hook, set up when the script loads:

```js
Hooks.once("pf2eResolutionCoreReady", (core) => { /* register here */ });
```

The core fires it in its `init` handler, after every module's script has been evaluated, so it works whichever module loads first. Don't read `game.modules.get("pf2e-resolution-core").api` in your own `init`. Foundry orders modules by the `relationships.requires` it read at server start, so a module that gains the requirement later (or is enabled without a restart) can load before the core, find no api, and register nothing. *(Found in the live switch-over, 2026-10-08.)* If the spell module is active but registered nothing, the core warns in the console at ready. `core` below is the hook's argument.

| Remove | Register instead |
|---|---|
| `installDamageTypeMemory()` and the `attachDamageSource` preCreateChatMessage hook | Demon Bone Tiles' shield shards: `core.patches.damage.onApply({ module: MODULE_ID, name: "shield-shards", before(actor, params) { …find shards as now…; return shards ? () => shards.setFlag(MODULE_ID, "shieldShards", { …, blockedAt: Date.now() }) : null; } })` |
| `wrapApplyDamage` in `main.js` (the fifth wrapper) | `core.patches.damage.onApply({ module: MODULE_ID, name: "spell-damage", before(actor, params) { return { params: halvedOrSame(actor, params), after: async (result) => { …the absorb, rescue, count, ward and report steps, with HP captured in before()… } }; } })`. `before()` may return an after-callback, or `{ params, after }` to replace the parameters. After-callbacks are **awaited in order, each in its own try/catch**, before the caller's `await applyDamage` resolves. |
| `installTextRules()`: both the `prepareRuleElements` wrapper and the `ItemPF2e.createDocuments` wrapper | `core.patches.rules.registerRewriter({ module: MODULE_ID, name: "text-rules", rewrite(item, rules) { const read = textRulesFor(item); return read?.add \|\| read?.drop ? rulesWithText(rules, read) : null; } })` and `core.patches.rules.registerCreateTransformer({ module: MODULE_ID, name: "arcane-cascade", transform: (entry, parent) => cascadeTypeAhead(entry, parent) })` |
| `installD20Clamp()` (`Check.roll` and `CheckRoll#evaluate`) | `core.patches.d20.registerLimitProvider({ module: MODULE_ID, limits: (actor, type) => d20LimitsFor(actor, type) })` |
| `patchSelectiveTerrain()` (both hooks) | `core.patches.terrain.registerProvider({ module: MODULE_ID, selective: (behavior) => behavior.behavior?.flags?.[MODULE_ID]?.selectiveTerrain ?? behavior.parent?.flags?.[MODULE_ID]?.selectiveTerrain ?? null })`. The difficulty rules (per creature, by size, living, default, actions) are the core's `selectiveDifficulty`, moved unchanged. |

### 4. Readers

| Now | After |
|---|---|
| `lastDamageTypes.get(holder.uuid)?.types` (`catalystSporesOnDamage`) | `core.patches.damage.lastTypes(holder.uuid)` |
| `message.flags?.[MODULE_ID]?.damageSource` (`catalyst-runtime.js`) | `core.patches.damage.sourceOf(message)`. It reads the core's stamp `flags.pf2e-resolution-core.damageSource` and falls back to the older spell-module stamp. |

### 5. Behaviour differences to expect

- **The rule patch installs at `setup`** when a rewriter or transformer is already registered, i.e. when the spell module registers in `init`; otherwise at `ready`. *(Corrected after the spell session's review.)* Foundry 14 prepares world documents **before** `setup` (`initializeDocuments` runs first), and PF2e's own `ready` hook re-prepares only a few actors. So, either way, after every module's `ready` handlers the core re-prepares the actors that hold an item a registered rewriter changes. It checks each world actor and each unlinked token actor on every scene; actors no rewriter touches are left alone, which keeps big worlds cheap. Live testing found such actors already had their rules after a reload, both before and after the switch, so this is a safety net rather than a fix.
- **The damage stamp moves** to `flags.pf2e-resolution-core.damageSource`. Read it with `sourceOf`.
- **The d20 roll's domain mark** becomes `pf2e-resolution-core-d20:min:max`. `options.d20Clamped` is set as before.
- **The terrain wrapper also reads `flags.pf2e-resolution-core.selectiveTerrain`** first. That's for future modules; spell regions are unaffected.

## Order of the switch

1. **The user restarts Foundry**, so its server discovers the new `pf2e-resolution-core` package.
2. **Enable `pf2e-resolution-core` in `pftest`.** With the spell module unchanged, `api.patches.status()` should show `"spell-module"` four times, and nothing is wrapped twice.
3. **The spell-module session applies sections 1–4.** It runs its unit tests and the byte-identical compile check, then a live regression in `pftest`, where `api.patches.status()` should show `"core"` four times.
4. **Tell the auto-combat session.** Step 3 (splitting families into pure resolvers, starting with basic saves and spell attacks) starts after that.
