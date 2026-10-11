# PF2e Resolution Core

The `pf2e-resolution-core` Foundry module: the shared plan model, the pure resolver registry, the shared helpers, and the one copy of each shared PF2e patch. It serves PF2e Automatic Spell Resolution, PF2e Automatic Ability Resolution, PF2e Automatic Kineticist Resolution and the PF2e Combat Simulator.

## Install

It's a library: on its own it adds nothing to the game. The modules that need it (PF2e Automatic Spell Resolution and the others above) offer to install it with them.

To install it yourself, in Foundry go to **Add-on Modules → Install Module**, paste this manifest URL and click **Install**:

```
https://github.com/Theholycole/PF2e-Automation-Core/releases/latest/download/module.json
```

Foundry 14 and the PF2e system 8.5 or later. [libWrapper](https://foundryvtt.com/packages/lib-wrapper) is optional: when it's active, the core's patches (PF2e's `applyDamage`, `prepareRuleElements`, item `createDocuments`, `Check.roll`, `CheckRoll#evaluate` and the difficult-terrain behaviour) go through it, so modules that wrap the same functions (PF2e Toolbelt, PF2E Incapacitation Variants) are ordered with them. The classes PF2e keeps at no global path are named under `CONFIG.pf2eResolutionCore` for libWrapper. MIT licensed (see [LICENSE](LICENSE)); the Pathfinder rules text it reads comes from the PF2e system under Paizo's ORC license.

**Status (2026-10-08): milestones 2 and 3 under way.** 54 Node tests pass.

- **Step 1** is done: the version-13 model, outline check and reader, typed decisions, change ops, registry, roller and context contracts.
- **Step 2** is done: the spell module runs on the core's patches in `pftest` (`api.patches.status()` shows `"core"` four times). Its guide is [docs/switch-over.md](docs/switch-over.md).
- **Step 3.1**, saves and spell attacks, is built: the `save` family (`src/families/save.js`), which the core registers itself. All 740 compiled `save` plans resolve; 436 of them with no gaps.
- **Step 3.2**, healing and automatic damage, is built against the payloads agreed with the spell session on 2026-10-08. The spell compiler will fill them from PF2e's item data.
  - `resolution.healing` holds `{ components, heightening, recipients }`, where recipients are living, undead, willing or any.
  - `resolution.byActions` holds partial overlays of targeting, healing and sharedDamage per action count.
  - `resolution.missiles` holds `{ perActions, perRanks: { interval, extra } }`.
  - The `healing` family (`src/families/healing.js`) handles plans with no check.
  - The `direct-damage` family (`src/families/direct-damage.js`) handles missiles, combined per target.
  - The `save` family heals Heal's and Harm's recipients, who skip the save.
  - `planWithActions` (`src/families/shared.js`) applies an action overlay.
  - The new numbers sit under `resolution.native`, which live play never reads (agreed with the spell session).
- **Step 3.4**, the most common gaps:
  - The `effect` family (`src/families/effect.js`) turns PF2e spell-effect applications into `effect` changes, plus native healing (Soothe).
  - The `unsupported` fallback (`src/families/unsupported.js`) resolves the spells live play leaves to PF2e's own card (Telekinetic Projectile, Force Barrage, Lay on Hands) from `resolution.native` alone.
    - It uses `check` + `outcomes` through `save`, else `missiles`, else `healing`.
    - `native.variants` (Lay on Hands: "Vs. Undead" or "Healing") are chosen per target.
    - `native.damageTypeChoices` become a pre-cast decision per component.
    - `native.byActions` entries can bring their own `outcomes` and `check` (Blazing Bolt).
    - `native.applications` (Bless) become PF2e spell-effect changes on their recipients: self, target, allies or enemies in the area.
- **Milestone 3:** the `check` family (`src/families/check.js`): the actor's skill against a target's DC (`check.roll: "skill"`, `against: { dc: "target", statistic }`), as basic actions and monster riders use it. Effects can name `recipient: "self"`, and `end-condition` effects end conditions (Escape, or stabilize with First Aid). A condition can be scoped to one creature's attacks (Feint), and `disarm` effects knock items away. It shares the save family's steps. A `check.roll` of `"automatic"` (2026-10-10) rolls nothing: every target gets the success row ("The target takes 3d8 fire damage"). A `temp-hp` effect (2026-10-10: `{ kind: "temp-hp", amount | formula, duration }`) gives temporary Hit Points, as a `tempHp` change (the formula rolled); a `heal` effect (`{ kind: "heal", amount | formula, excessAsTemp }`) heals, as a `heal` change. Either can take `fromDamage: true`: the amount of the row's damage on that target ("temporary Hit Points equal to the damage dealt"). A skill check can carry its own bonus (2026-10-10: `check.bonus: { value, type }`, "a +4 status bonus to the Athletics check"): added to the roll's modifier, and passed in the roll's options as `bonus`.
- A whole-catalogue test resolves every compiled plan of every family over the spell module's real compile (with its native-effect catalog), at every action count and two ranks.

### Families

A family turns a plan into Change ops and typed decisions. It's written as **steps**: a generator that yields `roll`, `damage` and `choose` requests (`src/drive.js`).

- `registry.resolve(plan, context, io)` drives it with `await`, for live play (rolls go through PF2e).
- `registry.resolveSync(plan, context, io)` drives it without awaiting, for the Combat Simulator. Its engine is synchronous, and its planner can force a degree and use average damage.

`saveGaps(plan)` lists what the family doesn't resolve yet (lingering areas, stored triggers and the like). Parts the GM or PF2e carries out still become changes, which the simulator decides whether it can model:

- note effects and PF2e spell effects become `effect` changes
- manual instructions become `note` changes marked `manual`

| Path | Holds |
|---|---|
| `src/` | pure code (Node, Web Workers, the simulator): `index.js`, `model/` (including `dice.js`, PF2e damage formulas), `families/`, `registry.js`, `drive.js`, `io.js`, `patch-logic.js`, `text/` (shared text readers, including `hazard-text.js`: a hazard's Disable options, routine actions, Strikes without a multiple attack penalty) |
| `scripts/` | Foundry: `main.js` (the API), `patches.js` (the shared PF2e patches), `wrap.js` (each patch through libWrapper when it's active, directly otherwise), `runtime-utils.js` |
| `docs/plan-model.md` | the agreed design |
| `docs/switch-over.md` | what the spell module changes to use the core |

Run the tests with `node --test`.

**Forced movement** (`src/model/grid.js`, pure; `scripts/forced-movement.js`, Foundry; `api.forcedMovement.forcedMove`): pushes and pulls by the user's grid rule of 2026-10-05: square by square in the nearest of the 8 directions, diagonals 5 then 10 feet, stopping at walls and the scene's edge, never ending in another creature's space. The ability module's cards use it; the spell module has its own copy (`scripts/forced-movement.js`) and can switch to this one. The same file measures PF2e distances between creatures' spaces (`distanceFeet`, `withinEmanation`) and the squares a move passes (`pathPositions`), for the ability module's aura cards.
