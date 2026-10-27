# Suliworld Signifiers

Bullet journal signifiers for [Obsidian](https://obsidian.md) tasks. Works with any theme, and pairs with the [Suliworld theme](https://github.com/sulistef/obsidian-suliworld).

The character between a task's brackets picks its signifier:

| Markdown | Signifier |
| --- | --- |
| `- [ ]` | • Task |
| `- [x]` | × Done |
| `- [*]` | ✱ Event |
| `- [n]` | ■ Note |
| `- [>]` | › Migrated |
| `- [<]` | ‹ Scheduled |
| `- [!]` | ! Important |

## What it does

- **Draws the signifiers** in your notes, with any theme. With the Suliworld theme, the theme draws them and your Style Settings choices (symbols, colors, size) apply; the plugin's colors otherwise follow your theme's accent colors.
- **Click** a signifier to mark it done, and click again to mark it not done. Every signifier behaves the same way.
- **Right-click** (or **long-press** on mobile) a signifier to open a menu: mark done, pick any of the seven signifiers, or turn the line back into a plain bullet. The menu shows your own symbols and colors from the theme's Style Settings.
- **Type `- [`** to get a list of signifiers to pick from, instead of typing a character inside the brackets.
- **Press Enter** at the end of an event, a note, or any other signifier to start a new line with the same one. An empty line ends the list. Tasks keep Obsidian's usual behavior.
- **Commands** (assign your own hotkeys): "Set signifier: Event", one per signifier, "Cycle signifier", and "Remove signifier (plain bullet)". They work on every selected line.

Works in Live Preview and in reading view, on desktop and mobile.

## Settings

- Draw signifiers (on by default): turn it off if your theme already draws alternate checkboxes its own way
- Keep the signifier on a new line (on by default)
- Suggest signifiers after `- [` (on by default)

## Installation

Until the plugin is listed in Obsidian's community plugins:

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Put them in your vault, in `.obsidian/plugins/suliworld-signifiers/`.
3. In Obsidian, go to Settings → Community plugins, and turn on Suliworld Signifiers.

## Development

The plugin is written in TypeScript (`src/`) and bundled with esbuild into `main.js`.

```bash
npm install
npm run dev     # rebuild main.js on every change
npm run build   # type-check (strict) and build for production
npm run lint    # ESLint with Obsidian's official rules (eslint-plugin-obsidianmd)
```

To try it in a vault, copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/suliworld-signifiers/`.

## Releasing

Run `npm version patch` (or `minor`, `major`): it updates `manifest.json` and `versions.json`. Push the commit and the tag. The release workflow lints, builds, and attaches `main.js`, `manifest.json`, and `styles.css` to a GitHub release.

## License

[MIT](LICENSE)
