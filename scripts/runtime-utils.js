// Runtime helpers the content modules share. Moved from the spell module (scripts/runtime-utils.js, 2026-10-08) unchanged,
// except MODULE_ID, which each module keeps for its own flags.
export function escapeHTML(value) {
    const text = String(value ?? "");
    if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
    return text.replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
}

/**
 * A modifyMovementCost behavior's difficulties for terrain that hinders the listed movement types. Terrain on the ground also applies to PF2e's
 * "travel" action (how a creature moves outside combat), which Foundry costs separately from "walk"; fly-only terrain stays fly-only.
 */
export function terrainDifficulties(movement, difficulty) {
    const types = [...movement];
    if (types.includes("walk") && !types.includes("travel")) types.push("travel");
    return Object.fromEntries(types.map(type => [type, difficulty]));
}

export function clone(value) {
    return foundry.utils.deepClone(value);
}

export function randomID() {
    return foundry.utils.randomID();
}

export function actorFromTarget(target) {
    if (!target) return null;
    if (target.documentName === "Actor") return target;
    return target.actor ?? target.document?.actor ?? null;
}

export function activeUsers() {
    return (game.users?.contents ?? [...(game.users ?? [])])
        .filter(user => user.active)
        .sort((left, right) => left.id.localeCompare(right.id));
}

export async function confirmAction({ title, content, label }) {
    const result = await foundry.applications.api.DialogV2.prompt({
        window: { title },
        content,
        ok: { label, callback: () => true },
        rejectClose: false,
        modal: true
    });
    return result === true;
}

/**
 * A spell at its cast rank. PF2e applies fixed-level heightening data (Dehydrate's 4d6 at 3rd) only when it loads that rank, so a spell
 * already at the cast rank is loaded too when it has such levels up to that rank.
 */
export function spellAtCastRank(item, castRank) {
    if (typeof item?.loadVariant !== "function" || !Number.isFinite(Number(castRank))) return item;
    const fixedLevels = item.system?.heightening?.type === "fixed" && Object.keys(item.system.heightening.levels ?? {}).some(rank => Number(rank) <= Number(castRank));
    if (Number(item.rank) === Number(castRank) && !fixedLevels) return item;
    try { return item.loadVariant({ castRank: Number(castRank) }) ?? item; } catch { return item; }
}

// ---- Helpers the runtimes shared as copies (merged 2026-10-08) ----

// Neighbouring modules. (MODULE_ID stays in each content module: its flags are its own.)
export const AFFLICTION_HANDLER = "pseudo-afflictions";

// Users: the active GM (the one client that acts on hooks), the GMs, an actor's owners.
export const activeGM = () => game.user?.isGM && game.users.activeGM?.id === game.user.id;
export const gmIds = () => game.users.filter(user => user.isGM).map(user => user.id);
export const ownerIds = actor => game.users.filter(user => actor?.testUserPermission?.(user, "OWNER")).map(user => user.id);

// Chat: a line from an actor (wrapped in a paragraph, or as given), and the spell-cast messages PF2e posts.
export const say = (actor, text) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${text}</p>` }).catch(() => null);
export const post = (actor, content) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content }).catch(() => null);
export const isCastMessage = message => message?.flags?.pf2e?.context?.type === "spell-cast" || (!message?.flags?.pf2e?.context?.type && message?.flags?.pf2e?.origin?.type === "spell" && message?.flags?.pf2e?.casting);
export const castRankOf = message => Number(message.flags?.pf2e?.origin?.castRank ?? message.flags?.pf2e?.casting?.castRank ?? message.item?.rank ?? 1);

// Documents and creatures.
export const docOf = token => token?.document ?? token;
export const actorOf = target => target.actor ?? target;
export const allied = (a, b) => a === b || Boolean(a?.alliance && a.alliance === b?.alliance);
export const familiarOf = caster => game.actors.find(actor => actor.type === "familiar" && (actor.system?.master?.id === caster.id || actor.master?.id === caster.id)) ?? null;
export const DamageRollClass = () => { const found = (CONFIG.Dice?.rolls ?? []).find(candidate => candidate?.name === "DamageRoll"); if (!found) throw new Error("PF2e's DamageRoll class could not be resolved."); return found; };

// The lead GM: the first active GM by id (a stable choice among several).
export function isLeadGM() {
    const gms = game.users.filter(user => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id));
    return gms[0]?.id === game.user.id;
}

// A check's degree (0 critical failure … 3 critical success) from its total, the DC and the natural die.
export function degreeOf(total, dc, natural) {
    let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
    if (natural === 20) degree = Math.min(3, degree + 1);
    if (natural === 1) degree = Math.max(0, degree - 1);
    return degree;
}

// Degrees, from worst to best; duration units; plain text from HTML.
export const DEGREES = Object.freeze(["criticalFailure", "failure", "success", "criticalSuccess"]);
export const UNITS = new Set(["rounds", "minutes", "hours", "days"]);
export const plainText = html => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().replace(/[’]/g, "'");
