import { DEFAULT_SIGNIFIERS, type Signifier } from "./signifiers";

export interface SignifiersSettings {
	schemaVersion: number;
	drawSignifiers: boolean;
	keepOnEnter: boolean;
	autocomplete: boolean;
	size: number;
	signifiers: Signifier[];
}

export function defaultSettings(): SignifiersSettings {
	return {
		schemaVersion: 1, drawSignifiers: true, keepOnEnter: true, autocomplete: true, size: 1.1,
		signifiers: DEFAULT_SIGNIFIERS.map((sig) => ({ ...sig })),
	};
}

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validColor(value: unknown): value is string {
	return typeof value === "string" && (value === "" || /^#[\da-f]{6}$/i.test(value));
}

export function characterError(char: string, id: string, signifiers: readonly Signifier[]): string | undefined {
	if (id === "todo") return char === " " ? undefined : "The task character must stay a space.";
	if (id === "done") return char === "x" ? undefined : "The done character must stay x.";
	// Obsidian task markers contain one non-whitespace UTF-16 character.
	if (char.length !== 1 || /[\s[\]xX\uD800-\uDFFF]/u.test(char)) return "Use one character, excluding whitespace, brackets and x/X.";
	if (signifiers.some((sig) => sig.id !== id && sig.char === char)) return "This character is already used by another signifier.";
	return undefined;
}

/** Validate persisted data, including manually edited JSON, before it reaches CSS or commands. */
export function loadSettings(data: unknown): SignifiersSettings {
	const raw = record(data);
	const settings = defaultSettings();
	for (const key of ["drawSignifiers", "keepOnEnter", "autocomplete"] as const) {
		if (typeof raw[key] === "boolean") settings[key] = raw[key];
	}
	if (typeof raw.size === "number" && Number.isFinite(raw.size)) settings.size = Math.min(1.6, Math.max(0.7, raw.size));
	if (Array.isArray(raw.signifiers)) {
		const entries: Signifier[] = [];
		// Reserve the two standard Markdown task states even if data.json omitted or reordered them.
		for (const id of ["todo", "done"]) {
			const fallback = DEFAULT_SIGNIFIERS.find((sig) => sig.id === id)!;
			const entry = record(raw.signifiers.find((value: unknown) => record(value).id === id));
			entries.push({ ...fallback, ...readAppearance(entry, fallback) });
		}
		for (const value of raw.signifiers) {
			const entry = record(value);
			if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id) || entries.some((sig) => sig.id === entry.id)) continue;
			if (typeof entry.char !== "string" || characterError(entry.char, entry.id, entries)) continue;
			const fallback: Signifier = { id: entry.id, char: entry.char, label: "Signifier", glyph: entry.char, colorLight: "", colorDark: "", disc: false };
			entries.push({ ...fallback, ...readAppearance(entry, fallback) });
		}
		settings.signifiers = entries;
	}
	return settings;
}

function readAppearance(entry: Record<string, unknown>, fallback: Signifier): Partial<Signifier> {
	return {
		label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : fallback.label,
		glyph: typeof entry.glyph === "string" && entry.glyph.trim() && !/[\r\n\0]/.test(entry.glyph) ? entry.glyph : fallback.glyph,
		colorLight: validColor(entry.colorLight) ? entry.colorLight : fallback.colorLight,
		colorDark: validColor(entry.colorDark) ? entry.colorDark : fallback.colorDark,
		disc: typeof entry.disc === "boolean" ? entry.disc : fallback.disc,
	};
}

/** One-time import from Style Settings' saved data; never read another plugin's runtime internals. */
export function importLegacy(settings: SignifiersSettings, legacy: unknown, raw: unknown): void {
	const old = record(raw);
	if (old.schemaVersion === 1 || Array.isArray(old.signifiers)) return;
	const values = record(legacy);
	const key = (name: string) => values[`suliworld@@sw-bujo${name}`];
	if (typeof old.drawSignifiers !== "boolean" && typeof key("") === "boolean") settings.drawSignifiers = key("") as boolean;
	const size = Number(key("-size"));
	if (Number.isFinite(size) && size >= 0.7 && size <= 1.6) settings.size = size;
	for (const sig of settings.signifiers) {
		const glyph = key(`-${sig.id}-glyph`);
		if (typeof glyph === "string" && glyph.trim() && !/[\r\n\0]/.test(glyph)) sig.glyph = glyph;
		for (const [mode, field] of [["light", "colorLight"], ["dark", "colorDark"]] as const) {
			const color = key(`-${sig.id}-color@@${mode}`);
			if (validColor(color)) sig[field] = color;
		}
	}
}
