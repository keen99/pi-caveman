import { DEFAULT_MODE } from "./constants.js";
import { getCavemanInstructions } from "./skill.js";
import { readDefaultMode, writeDefaultMode } from "./config.js";
import { normalizePersistedMode, parseCavemanCommand, resolveSessionMode } from "./modes.js";

export default function cavemanExtension(pi) {
  let currentMode = DEFAULT_MODE;
  let configuredDefaultMode = readDefaultMode();

  const setMode = (mode, ctx) => {
    const normalized = normalizePersistedMode(mode);
    if (!normalized) {
      return;
    }

    currentMode = normalized;
    pi.appendEntry("caveman-mode", { mode: normalized });

    if (ctx?.ui?.notify) {
      ctx.ui.notify(`Caveman mode set to ${normalized}.`, "info");
    }
  };

  const sendAlias = (skillName, args, ctx) => {
    const normalized = String(args || "").trim();
    const message = normalized ? `${skillName} ${normalized}` : skillName;

    if (ctx?.isIdle?.() === false) {
      pi.sendUserMessage(message, { deliverAs: "followUp" });
      if (ctx?.ui?.notify) {
        ctx.ui.notify(`${skillName} queued as follow-up.`, "info");
      }
      return;
    }

    pi.sendUserMessage(message);
  };

  pi.registerCommand("caveman", {
    description: "Set or report Caveman mode",
    handler: async (args, ctx) => {
      const parsed = parseCavemanCommand(args, configuredDefaultMode);

      if (parsed.type === "status") {
        if (ctx?.ui?.notify) {
          ctx.ui.notify(`Caveman: current ${currentMode} - default ${configuredDefaultMode}`, "info");
        }
        return;
      }

      if (parsed.type === "set-default") {
        const written = writeDefaultMode(parsed.mode);
        if (written) {
          configuredDefaultMode = readDefaultMode();
          if (ctx?.ui?.notify) {
            if (configuredDefaultMode !== written) {
              ctx.ui.notify(
                `Saved default ${written}, but active env override keeps default at ${configuredDefaultMode}.`,
                "info",
              );
            } else {
              ctx.ui.notify(`Default Caveman mode set to ${written}.`, "info");
            }
          }
        }
        return;
      }

      if (parsed.type === "set-mode") {
        setMode(parsed.mode, ctx);
        return;
      }

      if (parsed.type === "invalid") {
        if (ctx?.ui?.notify) {
          ctx.ui.notify("Unknown or unsupported /caveman mode.", "warning");
        }
        return;
      }
    },
  });

  pi.registerCommand("caveman-commit", {
    description: "Run /skill:caveman-commit",
    handler: (_args, ctx) => {
      sendAlias("/skill:caveman-commit", "", ctx);
    },
  });

  pi.registerCommand("caveman-review", {
    description: "Run /skill:caveman-review",
    handler: (_args, ctx) => {
      sendAlias("/skill:caveman-review", "", ctx);
    },
  });

  pi.registerCommand("caveman-help", {
    description: "Run /skill:caveman-help",
    handler: (_args, ctx) => {
      sendAlias("/skill:caveman-help", "", ctx);
    },
  });

  pi.registerCommand("caveman:compress", {
    description: "Run /skill:caveman-compress",
    handler: (args, ctx) => {
      sendAlias("/skill:caveman-compress", args, ctx);
    },
  });

  pi.on("input", async (event) => {
    if (event?.source === "extension") {
      return;
    }

    const text = String(event?.text || "");
    if (currentMode !== "off" && /\b(stop caveman|normal mode)\b/i.test(text)) {
      setMode("off");
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx?.sessionManager?.getBranch?.() || ctx?.sessionManager?.getEntries?.() || [];
    configuredDefaultMode = readDefaultMode();
    currentMode = resolveSessionMode(entries, configuredDefaultMode);
  });

  // System prompt injection --- full rules from SKILL.md
  pi.on("before_agent_start", async (event) => {
    if (!currentMode || currentMode === "off") {
      return;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${getCavemanInstructions(currentMode)}`,
    };
  });

  // Per-turn reinforcement: pre-flight check right before every LLM call.
  // This is critical --- the system prompt rules get ignored mid-session.
  // The context hook fires before every LLM turn, so the model sees this
  // check list RIGHT BEFORE generating. It can't skip it.
  // IMPORTANT: messages returned from the context hook are HIDDEN from the
  // user's TUI but VISIBLE to the LLM. Do not assume the user can see them.
  pi.on("context", async (event) => {
    if (!currentMode || currentMode === "off") return undefined;

    const reminder = [
      { type: "text", text: "[CAVEMAN MODE ACTIVE. Respond terse like smart caveman. English only. All technical substance stay. Only fluff die. Drop articles/filler/pleasantries/hedging. Fragments OK. Code/commits/security: write normal.]" },
    ];

    const msgs = event.messages;
    const last = msgs[msgs.length - 1];
    if (last?.role === "user" && Array.isArray(last?.content)) {
      const t = last.content.find((c) => c.type === "text" && c.text?.includes("CAVEMAN MODE ACTIVE"));
      if (t) return undefined;
    }

    return {
      messages: [...msgs, { role: "user", content: reminder }],
    };
  });
}
