import { App, Notice, PluginSettingTab, requireApiVersion, Setting, type SettingDefinitionItem } from "obsidian";
import type SuliworldSignifiers from "./main";
import { characterError } from "./config";
import { DEFAULT_SIGNIFIERS, glyphEl, type Signifier } from "./signifiers";

type Row = { name: string; desc?: string; render: (setting: Setting) => void };

/** Shared rows keep the searchable 1.13+ UI and the older Obsidian UI equivalent. */
export class SignifiersSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SuliworldSignifiers) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{ type: "group", heading: "Display and behavior", items: this.generalRows() },
			...this.plugin.settings.signifiers.map((sig): SettingDefinitionItem => ({
				type: "page", get name() { return sig.label; }, get desc() { return `[${sig.char}] ${sig.glyph}`; },
				items: this.signifierRows(sig),
			})),
			this.addRow(),
		];
	}

	display(): void {
		this.renderLegacy();
	}

	private renderLegacy(): void {
		this.containerEl.empty();
		for (const row of this.generalRows()) this.renderRow(row);
		for (const sig of this.plugin.settings.signifiers) {
			new Setting(this.containerEl).setName(sig.label).setHeading();
			for (const row of this.signifierRows(sig)) this.renderRow(row);
		}
		this.renderRow(this.addRow());
	}

	private renderRow(row: Row): void {
		const setting = new Setting(this.containerEl).setName(row.name);
		if (row.desc) setting.setDesc(row.desc);
		row.render(setting);
	}

	private refresh(): void {
		if (requireApiVersion("1.13.0")) this.update();
		else this.renderLegacy();
	}

	private generalRows(): Row[] {
		const rows: Row[] = ([
			["drawSignifiers", "Draw signifiers", "Replace task checkboxes with your configured symbols, with any theme."],
			["keepOnEnter", "Keep the signifier on a new line", "Continue a configured signifier with Enter. An empty line ends the list; tasks keep Obsidian’s behavior."],
			["autocomplete", "Suggest signifiers as you type", "Typing a list marker followed by [ opens the signifier list."],
		] as const).map(([key, name, desc]) => ({
			name, desc,
			render: (setting) => {
				setting.addToggle((toggle) => toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				}));
			},
		}));
		rows.push({
			name: "Signifier size", desc: "Size in notes, relative to the surrounding text.",
			render: (setting) => {
				setting.addSlider((slider) => slider.setLimits(0.7, 1.6, 0.05).setValue(this.plugin.settings.size).onChange(async (value) => {
					this.plugin.settings.size = value;
					await this.plugin.saveSettings();
				}));
			},
		});
		return rows;
	}

	private signifierRows(sig: Signifier): Row[] {
		const rows: Row[] = [{
			name: "Preview", desc: "Changing a Markdown character does not rewrite existing notes.",
			render: (setting) => {
				const doc = setting.settingEl.ownerDocument;
				const glyph = glyphEl(sig, doc);
				setting.controlEl.appendChild(glyph);
				// Obsidian builds sub-pages in the main document, then adopts them
				// into its settings window after this render callback returns.
				queueMicrotask(() => {
					if (!glyph.isConnected) return;
					this.plugin.preparePreview(glyph.ownerDocument);
					this.plugin.applyDrawing();
				});
			},
		}];
		for (const [field, name] of [["char", "Markdown character"], ["label", "Name"], ["glyph", "Symbol"]] as const) {
			rows.push({
				name,
				desc: field === "char" ? "One character between the brackets. Space and x/X are reserved for tasks." : undefined,
				render: (setting) => {
					setting.addText((text) => {
						text.setValue(sig[field]).setDisabled(field === "char" && (sig.id === "todo" || sig.id === "done"));
						text.inputEl.setAttribute("aria-label", `${sig.label}: ${name}`);
						text.onChange(async (value) => {
							const error = field === "char" ? characterError(value, sig.id, this.plugin.settings.signifiers)
								: !value.trim() || /[\r\n\0]/.test(value) ? "Enter a non-empty value on one line." : undefined;
							text.inputEl.setAttribute("aria-invalid", String(Boolean(error)));
							setting.setDesc(error ?? (field === "char" ? "Existing notes keep their original Markdown character." : ""));
							if (error) return;
							sig[field] = field === "label" ? value.trim() : value;
							await this.plugin.saveSettings();
						});
					});
				},
			});
		}
		for (const [field, mode] of [["colorLight", "light"], ["colorDark", "dark"]] as const) {
			rows.push({
				name: `Color in ${mode} mode`, desc: sig[field] || "Automatic: follows the active theme’s palette.",
				render: (setting) => {
					setting.addColorPicker((picker) => {
						const color = sig[field] || this.plugin.previewColor(sig, mode, setting.settingEl.ownerDocument);
						picker.setValue(color).onChange(async (value) => {
							sig[field] = value;
							setting.setDesc(value);
							await this.plugin.saveSettings();
						});
					});
					setting.addExtraButton((button) => button.setIcon("reset").setTooltip("Use automatic color").onClick(async () => {
						sig[field] = "";
						await this.plugin.saveSettings();
						this.refresh();
					}));
				},
			});
		}
		rows.push({
			name: "Tinted disc", desc: "Draw a tinted disc behind the symbol in notes.",
			render: (setting) => { setting.addToggle((toggle) => toggle.setValue(sig.disc).onChange(async (value) => {
				sig.disc = value;
				await this.plugin.saveSettings();
			})); },
		}, {
			name: "Reset appearance", desc: "Restore the default symbol and automatic colors. Keep the name and Markdown character.",
			render: (setting) => { setting.addButton((button) => button.setButtonText("Reset").onClick(async () => {
				const preset = DEFAULT_SIGNIFIERS.find((item) => item.id === sig.id);
				sig.glyph = preset?.glyph ?? sig.char;
				sig.colorLight = "";
				sig.colorDark = "";
				sig.disc = preset?.disc ?? false;
				await this.plugin.saveSettings();
				this.refresh();
			})); },
		});
		if (sig.id !== "todo" && sig.id !== "done") rows.push({
			name: "Remove signifier", desc: "Existing notes keep their Markdown. This character will use a standard checkbox.",
			render: (setting) => { setting.addButton((button) => button.setButtonText("Remove").onClick(async () => {
				this.plugin.settings.signifiers = this.plugin.settings.signifiers.filter((item) => item.id !== sig.id);
				await this.plugin.saveSettings();
				this.refresh();
			})); },
		});
		return rows;
	}

	private addRow(): Row {
		return {
			name: "Add signifier", desc: "Create another signifier, with its own character, name, symbol and colors.",
			render: (setting) => { setting.addButton((button) => button.setButtonText("Add signifier").onClick(async () => {
				const char = "?+o-=~@#$%&abcdefghijklmnopqrstuvwxyz0123456789".split("").find((value) => !characterError(value, "new", this.plugin.settings.signifiers));
				if (!char) { new Notice("No free character in the suggested set. Change an existing signifier’s character first."); return; }
				this.plugin.settings.signifiers.push({ id: `custom-${crypto.randomUUID()}`, char, label: "Custom signifier", glyph: char, colorLight: "", colorDark: "", disc: false });
				await this.plugin.saveSettings();
				this.refresh();
			})); },
		};
	}
}
