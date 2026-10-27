import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type SuliworldSignifiers from "./main";

export interface SignifiersSettings {
	/** Draw the signifiers in notes (styles.css), unless the Suliworld theme already does. */
	drawSignifiers: boolean;
	/** Enter at the end of a non-task signifier starts a new line with the same one. */
	keepOnEnter: boolean;
	/** Typing "- [" opens the list of signifiers. */
	autocomplete: boolean;
}

export const DEFAULT_SETTINGS: SignifiersSettings = {
	drawSignifiers: true,
	keepOnEnter: true,
	autocomplete: true,
};

type SettingKey = keyof SignifiersSettings;

function isSettingKey(key: string): key is SettingKey {
	return key in DEFAULT_SETTINGS;
}

/** One definition per setting, shared by the declarative tab (1.13+) and the fallback below. */
const SETTINGS: { key: SettingKey; name: string; desc: string }[] = [
	{
		key: "drawSignifiers",
		name: "Draw signifiers",
		desc: "Show each signifier as its symbol in your notes. Turn it off if your theme already draws them.",
	},
	{
		key: "keepOnEnter",
		name: "Keep the signifier on a new line",
		desc: "Enter at the end of an event, a note or any other signifier starts a new line with the same signifier. Tasks keep the usual behavior.",
	},
	{
		key: "autocomplete",
		name: "Suggest signifiers as you type",
		desc: "Typing a list marker followed by an opening bracket opens a list of signifiers to pick from.",
	},
];

export class SignifiersSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: SuliworldSignifiers,
	) {
		super(app, plugin);
	}

	/** Obsidian 1.13 and later: rendered by the app, and listed in the settings search. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return SETTINGS.map(({ key, name, desc }) => ({ name, desc, control: { type: "toggle", key } }));
	}

	getControlValue(key: string): unknown {
		return isSettingKey(key) ? this.plugin.settings[key] : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (!isSettingKey(key) || typeof value !== "boolean") return;
		this.plugin.settings[key] = value;
		if (key === "drawSignifiers") this.plugin.applyDrawing();
		await this.plugin.saveSettings();
	}

	/** Obsidian versions before 1.13: the same settings, rendered by hand. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		for (const { key, name, desc } of SETTINGS) {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
						this.plugin.settings[key] = value;
						if (key === "drawSignifiers") this.plugin.applyDrawing();
						await this.plugin.saveSettings();
					}),
				);
		}
	}
}
