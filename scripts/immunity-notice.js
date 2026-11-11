// (2026-11-11, Cole: "any time an effect wouldn't be applied due to an immunity on a creature, make sure there is a message to the GM".)
// The GM's immunity notices, for every module of the suite:
//
//   notify({ actor?, token?, target?, blocked, why?, source?, once? })
//       A chat line whispered to the GMs alone: "Immunity: Goblin Warrior isn't affected by Frightened 2 from Demoralize (immune to fear
//       effects)." From a player's client it goes to the active GM over the core's socket, and the GM's client posts it, so the player who
//       acted never sees it. With no GM logged in it's left out (and logged to the console). The same notice twice within moments is posted
//       once, and one given a `once` key (a sync that runs on every move: "<cast>:<creature>") only the first time in the session. The
//       world setting "Immunity notices for the GM" turns them off.
//   blockedWords(actor, effect)
//       The words for the immunity of a creature's that blocks a PF2e effect or condition (an item, its source, or a condition slug), else
//       null: "immune to fear effects".
//   checkCreated(data, parent)
//       Called by the core's ItemPF2e.createDocuments patch (scripts/patches.js) before PF2e's own: every Effect or condition PF2e is about
//       to drop because the creature is immune to it (or can't have it) gets a notice. PF2e only shows a toast to whoever applied it.

import { noticeFields, noticeHTML, noticeKey, seenRecently, immunityWords } from "../src/immunity-notice.js";

const CORE_ID = "pf2e-resolution-core";
const SETTING = "immunityNotices";
const SOCKET = `module.${CORE_ID}`;
const seen = new Map();
const once = new Set();

export function registerImmunitySetting() {
    game.settings.register(CORE_ID, SETTING, {
        name: "Immunity notices for the GM",
        hint: "Whisper the GM a chat line whenever an effect, condition or other automation isn't applied to a creature because of an immunity (its own or a temporary one).",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
}

const enabled = () => {
    try {
        return game.settings.get(CORE_ID, SETTING) !== false;
    } catch {
        return true;
    }
};

const leadGM = () => game.users?.activeGM ?? game.users?.find?.((user) => user.active && user.isGM) ?? null;

async function post(fields, speaker, onceKey = null) {
    if (onceKey && once.has(onceKey)) return null;
    if (seenRecently(seen, noticeKey(fields), Date.now())) return null;
    if (onceKey) once.add(onceKey);
    const whisper = (game.users?.filter?.((user) => user.isGM) ?? []).map((user) => user.id);
    if (!whisper.length) return null;
    return ChatMessage.create({ content: noticeHTML(fields), whisper, speaker: speaker ?? { alias: "Immunity" }, flags: { [CORE_ID]: { immunityNotice: fields } } }).catch((error) => {
        console.warn(`${CORE_ID} | The GM's immunity notice failed.`, error);
        return null;
    });
}

/** A GM-only chat line saying what an immunity kept from a creature. → the message (on this client), or null. */
export async function notify({ actor = null, token = null, target = null, blocked, why = null, source = null, once: onceKey = null } = {}) {
    if (!enabled()) return null;
    if (onceKey && once.has(onceKey)) return null;
    const document = token?.document ?? token ?? null;
    const name = target ?? document?.name ?? actor?.name ?? null;
    const fields = noticeFields({ target: name, blocked, why, source });
    let speaker = null;
    try {
        speaker = actor || document ? ChatMessage.getSpeaker({ actor: actor ?? document?.actor ?? undefined, token: document ?? undefined }) : null;
    } catch {
        speaker = null;
    }
    if (game.user?.isGM) return post(fields, speaker, onceKey);
    const gm = leadGM();
    if (!gm) {
        console.info(`${CORE_ID} | Immunity (no GM logged in to tell): ${fields.target} isn't affected by ${fields.blocked}${fields.why ? ` (${fields.why})` : ""}.`);
        return null;
    }
    // (A player's client: the GM's posts it, so the whisper isn't the player's own message.)
    if (seenRecently(seen, `sent|${noticeKey(fields)}`, Date.now())) return null;
    if (onceKey) once.add(onceKey);
    game.socket?.emit?.(SOCKET, { type: "immunityNotice", to: gm.id, fields, speaker, once: onceKey });
    return null;
}

/** The words for the creature's immunity that blocks this PF2e effect/condition (item, source or condition slug), else null. */
export function blockedWords(actor, effect) {
    try {
        if (!actor?.isImmuneTo?.(effect)) return null;
        const item = typeof effect === "string" ? null : "parent" in effect ? effect : itemFrom(effect, actor);
        const statements = new Set(item ? item.getRollOptions("item") : ["item:type:condition", `item:slug:${effect}`]);
        return immunityWords(actor.attributes?.immunities, statements) ?? "immune";
    } catch {
        return null;
    }
}

function itemFrom(source, actor) {
    const Class = CONFIG.PF2E?.Item?.documentClasses?.[source?.type];
    return Class ? new Class(foundry.utils.deepClone(source), { parent: actor }) : null;
}

// "Frightened 2", "Effect: Inspire Courage" → its words for the notice.
function effectName(item, source) {
    const value = item?.isOfType?.("condition") ? Number(item.value ?? source?.system?.value?.value) : NaN;
    return Number.isFinite(value) && value > 0 && item?.system?.value?.isValued !== false ? `${item.name} ${value}` : item?.name ?? source?.name ?? "an effect";
}

function originName(item) {
    const origin = item?.system?.context?.origin;
    try {
        const from = origin?.item ? fromUuidSync(origin.item) : null;
        return from?.name ?? null;
    } catch {
        return null;
    }
}

/** Before PF2e's createDocuments: a notice for each Effect or condition it will drop for an immunity. Never throws. */
export function checkCreated(data, parent) {
    try {
        if (!enabled() || !parent || parent.documentName !== "Actor" || typeof parent.isImmuneTo !== "function") return;
        for (const source of [data].flat()) {
            if (!["condition", "effect", "affliction"].includes(source?.type)) continue;
            const item = itemFrom(source, parent);
            if (!item) continue;
            // (An aura's Effect PF2e tries again each time a creature moves in it: it says nothing for those, nor does this.)
            if (item.isOfType?.("effect") && item.fromAura) continue;
            const unaffected = item.isOfType?.("condition") && typeof parent.isAffectedBy === "function" && !parent.isAffectedBy(item);
            const immune = !unaffected && parent.isImmuneTo(item);
            if (!unaffected && !immune) continue;
            const why = unaffected ? "it can't have this condition" : immunityWords(parent.attributes?.immunities, new Set(item.getRollOptions("item"))) ?? "immune";
            notify({ actor: parent, token: parent.token ?? null, blocked: effectName(item, source), why, source: originName(item) });
        }
    } catch (error) {
        console.warn(`${CORE_ID} | Checking created effects for immunities failed.`, error);
    }
}

// The active GM's client posts the notices players' clients send.
export function listenForNotices() {
    game.socket?.on?.(SOCKET, (message) => {
        if (message?.type !== "immunityNotice" || !game.user?.isGM) return;
        if (message.to && message.to !== game.user.id) return;
        post(noticeFields(message.fields ?? {}), message.speaker ?? null, typeof message.once === "string" ? message.once : null);
    });
}

export const immunityApi = Object.freeze({ notify, blockedWords });
