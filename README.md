# pi-caveman

Compressed caveman communication style for [pi](https://pi.dev), with persistence. Model responds terse — drops articles, filler, pleasantries, hedging. Keeps full technical accuracy. Code/commits/PRs written normal.

Adapted from [vedang's PR #162](https://github.com/JuliusBrussee/caveman/pull/162) on JuliusBrussee/caveman, with an added `context` hook for per-turn reinforcement so the style doesn't drift mid-session.

## Install

```bash
pi install git:github.com/keen99/pi-caveman
```

Caveman is **ON by default every session** (`DEFAULT_MODE = "full"`). Toggle with `/caveman`, switch levels with `/caveman lite|full|ultra`, disable with `/caveman off`, or persist a default with `/caveman default <mode>`.

## What it is

Caveman mode: compressed communication style. Model responds terse like smart caveman. Strips articles, filler, pleasantries, hedging. Keeps full technical accuracy. Code blocks untouched.

Adapted from [vedang's PR #162](https://github.com/JuliusBrussee/caveman/pull/162) on JuliusBrussee/caveman, with an added `context` hook for per-turn reinforcement.

## Files

```
caveman/
├── extension.js     # Main: commands, hooks, context-layer reminder
├── skill.js         # Reads SKILL.md at runtime, filters by mode
├── modes.js         # Mode parsing, normalization, session resolution
├── config.js        # Default mode persistence (~/.config/caveman/config.json)
├── constants.js     # DEFAULT_MODE, mode sets, paths
├── index.js         # Re-exports
└── package.json

skills/caveman/
└── SKILL.md         # Single source of truth for caveman rules
```

## Commands

- `/caveman` — report current mode
- `/caveman lite|full|ultra` — set mode
- `/caveman off` — disable
- `/caveman default <mode>` — persist default to config file
- `/caveman-commit`, `/caveman-review`, `/caveman-help` — skill aliases
- `/caveman:compress` — compression skill

## How it works

1. **Session start** — reads default mode from config (or env `CAVEMAN_DEFAULT_MODE`), or falls back to `DEFAULT_MODE` constant. Resolves any saved mode from session entries.
2. **`before_agent_start`** — injects SKILL.md content (filtered to active mode) into system prompt.
3. **`context` hook** (our addition) — fires before every LLM call. Injects a short reminder message so the model doesn't drift mid-session. These messages are HIDDEN from the user TUI but VISIBLE to the LLM.
4. **`input` hook** — catches "stop caveman" / "normal mode" to disable.

## ⚠️ DEFAULT_MODE is "full"

Caveman is **ON by default** every session. No `/caveman` activation needed. This is why caveman appears "without activating" it — it's never off.

To require explicit activation, change `DEFAULT_MODE` to `"off"` in `constants.js`.

## Persistence

- **Config file**: `~/.config/caveman/config.json` — persists default mode across sessions.
- **Session entries**: mode changes written via `pi.appendEntry("caveman-mode", ...)`. Restored on `/resume`.
- **Env var**: `CAVEMAN_DEFAULT_MODE` overrides config.

## Intensity levels

| Level | Behavior |
|-------|----------|
| off | Normal output |
| lite | No filler/hedging. Articles + full sentences kept. Professional. |
| full | Drop articles, fragments OK, short synonyms. Default. |
| ultra | Max compression. Abbreviate prose (DB/auth/fn/impl), arrows, telegraphic. |

## Known issues / findings (GLM-5.1)

- **Flavor vs persistence tradeoff**: skill-only (no extension) produces best caveman flavor but drifts after 2-3 turns. Extension's `context` hook prevents drift but slightly dilutes flavor with its reminder noise.
- **Model resistance**: GLM-5.1 resists full grammar stripping. Achieves ~50-60% context reduction vs the 75% benchmark claim. Pirate mode (additive dialect) works better than caveman (subtractive grammar stripping) because adding flavor doesn't fight training, stripping grammar does.
- **Persona approaches** ("grumpy engineer", dialect maps, pre-flight checklists) were tested and all performed equal or worse than the simple original SKILL.md.
- **Original SKILL.md** (from JuliusBrussee repo) had best flavor. Restored after testing alternatives.

## Related

- Original: https://github.com/JuliusBrussee/caveman
- PR #162 (pi extension source): https://github.com/JuliusBrussee/caveman/pull/162
- Alternative: https://github.com/v2nic/pi-caveman (simpler, no persistence)
- Pirate extension (sibling): `../pirate.ts` — uses same pattern for additive dialect
