// PF2e hazards' text: how to disable them, how many actions their routine
// takes, Strikes without a multiple attack penalty, and reactions that
// Strike. Shared by the ability module's live cards and the simulator
// (moved from the simulator's src/adapter/hazard.js, 2026-10-08).

import { htmlToPlainText } from "./plain-text.js";

// The ways to disable a hazard: [{ skill, dc, needed }] from its @Check links;
// "twice" or "three times" after a check is how many successes it takes.
export function parseDisable(html) {
    const text = String(html ?? "");
    const matches = [...text.matchAll(/@Check\[([^\]]+)\]/g)];
    const options = [];
    for (const [index, match] of matches.entries()) {
        const parts = match[1].split("|");
        const skill = parts[0].trim().toLowerCase();
        const dc = Number(parts.find((part) => part.trim().startsWith("dc:"))?.trim().slice(3));
        if (!skill || !dc) continue;
        const tail = htmlToPlainText(text.slice(match.index + match[0].length, matches[index + 1]?.index ?? text.length));
        const needed = /\b(?:three times|thrice|three successes)\b/i.test(tail) ? 3 : /\b(?:twice|two successes)\b/i.test(tail) ? 2 : 1;
        options.push({ skill, dc, needed });
    }
    return options;
}

// A complex hazard's routine: "(3 actions) …".
export const routineActions = (html) => Number(/\((\d+) actions?\)/i.exec(htmlToPlainText(html))?.[1]) || 1;

export const noMultipleAttackPenalty = (html) => /\b(?:no multiple attack penalty|(?:doesn't|does not) take a multiple attack penalty)\b/i.test(htmlToPlainText(html));

// A reaction that has the hazard Strike ("makes a Strike against the triggering creature").
export const mentionsStrike = (html) => /\bStrik(?:e|es|ing)\b/.test(htmlToPlainText(html));
