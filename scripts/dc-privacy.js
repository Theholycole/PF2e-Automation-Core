// (2026-11-21, Cole: "Automation modules shouldn't reveal monster DCs to players when rolling".)
// Every chat message a suite module creates is stamped (flags.pf2e-resolution-core.suiteCard), and
// a player's client hides the DCs in it that aren't theirs to know (src/dc-privacy.js has the rules).
// The GM sees everything. PF2e's metagame setting "Show DCs" and the world setting
// "Hide monster DCs from players" turn it off.

import { fromSuite, redactDCText, redactionMode, suiteFlagged } from "../src/dc-privacy.js";

const CORE_ID = "pf2e-resolution-core";
const SETTING = "hideMonsterDCs";
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA"]);
const ATTRIBUTES = ["title", "data-tooltip", "aria-label", "placeholder"];

export function registerDCPrivacySetting() {
    game.settings.register(CORE_ID, SETTING, {
        name: "Hide monster DCs from players",
        hint: "On the suite's chat cards, players don't see the DCs of creatures they don't own (\"DC 33 basic Reflex save\" shows as \"DC ? basic Reflex save\"), as PF2e does on its own rolls. Flat checks keep their DC. PF2e's metagame setting \"Show DCs\" turns this off too.",
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

// Where the message comes from: read once, while it's created (on the creating client).
function stampSuite(document) {
    try {
        if (suiteFlagged(document.flags)) return;
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 80;
        const stack = new Error().stack;
        Error.stackTraceLimit = limit;
        if (fromSuite(stack)) document.updateSource({ [`flags.${CORE_ID}.suiteCard`]: true });
    } catch {
        // Best effort: an unstamped card keeps its DCs.
    }
}

function speakerHasPlayerOwner(message) {
    try {
        const actor = message.speakerActor ?? ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
        return !!actor?.hasPlayerOwner;
    } catch {
        return false;
    }
}

/** Hide the DCs in a rendered message's element (mode "all" or "opposed"). */
export function redactElement(root, mode) {
    if (!root || !mode) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!SKIP.has(node.parentElement?.tagName)) nodes.push(node);
    }
    for (const node of nodes) {
        const next = redactDCText(node.nodeValue, mode);
        if (next !== node.nodeValue) node.nodeValue = next;
    }
    for (const element of root.querySelectorAll("*")) {
        for (const name of ATTRIBUTES) {
            const value = element.getAttribute(name);
            if (!value) continue;
            const next = redactDCText(value, mode);
            if (next !== value) element.setAttribute(name, next);
        }
    }
    if (mode !== "all") return;
    // A card's DC field (the GM's to change): not shown to players.
    for (const input of root.querySelectorAll("input")) {
        const field = [input.name, ...Object.entries(input.dataset ?? {}).filter(([key]) => /field$/i.test(key)).map(([, value]) => value)];
        if (!field.some((value) => /^dc$/i.test(String(value ?? "")))) continue;
        (input.closest("label") ?? input).remove();
    }
}

function redactMessage(message, html) {
    try {
        if (!(html instanceof HTMLElement)) return;
        if (!message.getFlag?.(CORE_ID, "suiteCard") && !suiteFlagged(message.flags)) return;
        const mode = redactionMode({
            isGM: !!game.user?.isGM,
            showDCs: !!game.pf2e?.settings?.metagame?.dcs,
            enabled: enabled(),
            speakerHasPlayerOwner: speakerHasPlayerOwner(message)
        });
        redactElement(html, mode);
        // Again once the content modules' own render hooks (registered after this one) have wired the card.
        if (mode) queueMicrotask(() => redactElement(html, mode));
    } catch (error) {
        console.warn(`${CORE_ID} | Hiding DCs from a chat card failed.`, error);
    }
}

export function installDCPrivacy() {
    Hooks.on("preCreateChatMessage", (document) => stampSuite(document));
    Hooks.on("renderChatMessageHTML", (message, html) => redactMessage(message, html));
}
