import type { SignifiersSettings } from "./config";

const COLORS: Record<string, string> = {
	todo: "var(--text-normal)", done: "var(--text-faint)", event: "var(--color-orange)",
	note: "var(--color-green)", migrated: "var(--text-muted)", scheduled: "var(--text-muted)", important: "var(--color-red)",
};

/** Escape CSS string delimiters, backslashes and control characters. */
function cssString(value: string): string {
	return `"${Array.from(value, (char) => {
		const code = char.codePointAt(0)!;
		return char === '"' || char === "\\" || code < 32 || code === 127 ? `\\${code.toString(16)} ` : char;
	}).join("")}"`;
}

export function drawingCss(settings: SignifiersSettings): string {
	const rules = [`body.sw-signifiers-plugin { --sws-size: ${settings.size}em; }`];
	const checkboxes: string[] = [];
	for (const sig of settings.signifiers) {
		const states = sig.id === "todo" ? ["", " "] : sig.id === "done" ? ["x", "X"] : [sig.char];
		const task = `:is(${states.map((char) => `[data-task=${cssString(char)}]`).join(",")})`;
		// Scope the decoration to the checkbox's own task, so nested lists do not inherit it.
		const checkbox = `:is(li${task} > input.task-list-item-checkbox, li${task} > p > input.task-list-item-checkbox, .HyperMD-task-line${task} .task-list-item-checkbox)`;
		checkboxes.push(checkbox);
		const fallback = COLORS[sig.id] ?? "var(--text-accent)";
		for (const [mode, color] of [["light", sig.colorLight], ["dark", sig.colorDark]] as const) {
			rules.push(`body.sw-signifiers-plugin.theme-${mode} .sws-glyph[data-sig=${cssString(sig.id)}], body.sw-signifiers-plugin.sws-draw.theme-${mode} ${checkbox} { --sws-color: ${color || fallback}; }`);
		}
		rules.push(`body.sw-signifiers-plugin.sws-draw ${checkbox} { --sws-glyph: ${cssString(sig.glyph)}; --sws-disc: ${sig.disc ? "color-mix(in srgb, var(--sws-color) 22%, transparent)" : "transparent"}; --sws-scale: ${sig.disc ? "0.75" : "1"}; }`);
		if (sig.id !== "todo" && sig.id !== "done") {
			rules.push(`body.sw-signifiers-plugin.sws-draw .markdown-rendered li${task}, body.sw-signifiers-plugin.sws-draw .markdown-source-view.mod-cm6 .HyperMD-task-line${task} { color: ${sig.id === "migrated" || sig.id === "scheduled" ? "var(--text-muted)" : "var(--text-normal)"}; text-decoration: none; }`);
		}
	}
	const owned = `body.sw-signifiers-plugin.sws-draw :is(${checkboxes.join(",")})`;
	rules.push(`${owned} { position: relative; appearance: none; border: 0; border-radius: 0; background: none; background-image: none; box-shadow: none; font-size: inherit; cursor: pointer; }`);
	rules.push(`${owned}::before { display: none; }`);
	rules.push(`${owned}::after { content: var(--sws-glyph); position: absolute; inset: 0; width: auto; height: auto; display: flex; align-items: center; justify-content: center; -webkit-mask-image: none; mask-image: none; background: var(--sws-disc); border-radius: 50%; font-family: var(--font-text); font-size: calc(var(--sws-size) * var(--sws-scale)); font-weight: 700; font-style: normal; line-height: 1; color: var(--sws-color); transform: none; }`);
	rules.push(`${owned}:hover::after { opacity: 0.7; }`);
	return rules.join("\n");
}
