import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
// DEFAULT_MODE controls whether caveman is ON at session start.
// "full" = caveman active by default every session (no /caveman needed).
// This is why caveman appears "without activating" it --- it's never off.
// Set to "off" to require explicit /caveman to enable.
export const DEFAULT_MODE = "full";
export const FALLBACK_MODES = new Set([
  "off",
  "lite",
  "full",
  "ultra",
]);
export const CONFIG_MODES = new Set([...FALLBACK_MODES, "commit", "review", "compress"]);
export const INDEPENDENT_MODES = new Set(["commit", "review", "compress"]);

// Bundled skill lives inside this package at ./skills/caveman/SKILL.md.
// (When loaded from ~/.pi/agent/extensions/caveman/, the skill lived one
// level up in the shared skills dir. The package layout keeps it local.)
export const SKILL_PATH = join(EXTENSION_DIR, "skills", "caveman", "SKILL.md");
