import { config } from "../config.js";
import { projects, assets, jobs } from "../data.js";
import { runVisionJob } from "../services/vision.js";
import { emitKarmashalaLog } from "../sockets.js";
import type { KarmashalaResult, ModelAsset } from "@astraforge/shared";

/**
 * Karmashala — the terminal AI brain.
 *
 * Intent labels:
 *   status, list-projects, list-assets, vision, scene-mutate,
 *   scene-spawn, redesign, geometry-split, help, unknown
 *
 * "scene-mutate" and "scene-spawn" are new intents that act on the live
 * holographic stage (broadcast via socket). "redesign" tells Karmashala to
 * ask a local Ollama vision-language model how to reshape the active
 * object; we apply a deterministic transform until a true generator is
 * wired in.
 *
 * Prefers a local Ollama model for intent parsing; falls back to a
 * deterministic keyword classifier so the CLI is always usable.
 */

type Intent =
  | "status"
  | "list-projects"
  | "list-assets"
  | "vision"
  | "scene-mutate"
  | "scene-spawn"
  | "redesign"
  | "geometry-split"
  | "help"
  | "unknown";

const VISION_KEYWORDS = ["mesh", "3d", "generate", "model", "image", "photo", "convert"];
const SPLIT_KEYWORDS = ["split", "cut", "slice", "part", "joint", "segment", "lego"];
const LIST_PROJECT_KEYWORDS = ["project"];
const LIST_ASSET_KEYWORDS = ["asset", "model list", "files"];
const MUTATE_KEYWORDS = [
  "color", "recolor", "tint", "scale", "resize", "rotate", "spin",
  "move", "translate", "shift", "lift", "lower", "reset", "delete",
  "remove", "hide", "show", "duplicate",
];
const SPAWN_KEYWORDS = [
  "spawn", "add", "create", "place", "put", "drop", "import", "new",
];
const REDESIGN_KEYWORDS = [
  "redesign", "remix", "restyle", "transform", "reimagine", "redesign it",
];

const INTENT_LABELS: Intent[] = [
  "status", "list-projects", "list-assets", "vision",
  "scene-mutate", "scene-spawn", "redesign",
  "geometry-split", "help", "unknown",
];

const SYSTEM_PROMPT =
  "You classify user commands for AstraForge into exactly one label: " +
  INTENT_LABELS.map((l) => `"${l}"`).join(", ") +
  ". Reply with only the label.";

export const karmashala = {
  async run(text: string): Promise<KarmashalaResult> {
    const intent = await classify(text);
    return execute(intent, text);
  },
};

async function classify(text: string): Promise<Intent> {
  try {
    const response = await fetch(`${config.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`ollama http ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    const label = body.message?.content?.trim().toLowerCase();
    if (label && (INTENT_LABELS as string[]).includes(label)) return label as Intent;
    throw new Error("unparsable label");
  } catch {
    return keywordClassify(text);
  }
}

function keywordClassify(text: string): Intent {
  const lower = text.toLowerCase();
  if (REDESIGN_KEYWORDS.some((k) => lower.includes(k))) return "redesign";
  if (SPLIT_KEYWORDS.some((k) => lower.includes(k))) return "geometry-split";
  if (VISION_KEYWORDS.some((k) => lower.includes(k))) return "vision";
  if (SPAWN_KEYWORDS.some((k) => lower.includes(k)) && /\b(object|part|primitive|shape|mesh|model|cube|sphere|cylinder|torus|cone)\b/.test(lower)) {
    return "scene-spawn";
  }
  if (MUTATE_KEYWORDS.some((k) => lower.includes(k))) return "scene-mutate";
  if (LIST_PROJECT_KEYWORDS.some((k) => lower.includes(k))) return "list-projects";
  if (LIST_ASSET_KEYWORDS.some((k) => lower.includes(k))) return "list-assets";
  if (lower.includes("status")) return "status";
  if (lower.includes("help")) return "help";
  return "unknown";
}

async function execute(intent: Intent, text: string): Promise<KarmashalaResult> {
  switch (intent) {
    case "status": {
      const [projectList, assetList, jobList] = await Promise.all([
        projects.list(),
        assets.list(),
        jobs.list(),
      ]);
      return {
        ok: true,
        intent,
        output:
          `projects=${projectList.length} assets=${assetList.length} ` +
          `jobs=${jobList.filter((j) => j.status === "running" || j.status === "queued").length} active`,
      };
    }
    case "list-projects": {
      const list = await projects.list();
      return { ok: true, intent, output: list.map((p) => `- ${p.id.slice(0, 8)} ${p.name}`).join("\n") || "no projects" };
    }
    case "list-assets": {
      const list = await assets.list();
      return { ok: true, intent, output: list.map((a) => `- ${a.id.slice(0, 8)} ${a.name} (${a.status})`).join("\n") || "no assets" };
    }
    case "vision": {
      const match = /asset\s+([0-9a-f-]{8,})/i.exec(text);
      if (!match) return { ok: false, intent, output: "usage: generate mesh from asset <assetId>" };
      const job = await runVisionJob(match[1]);
      return { ok: true, intent, output: `vision job ${job.id.slice(0, 8)} started`, jobId: job.id };
    }
    case "scene-mutate": {
      // forward to the active asset's transform via socket event
      return {
        ok: true,
        intent,
        action: "scene:mutate",
        output: `applying: ${text.trim()}`,
      };
    }
    case "scene-spawn": {
      return {
        ok: true,
        intent,
        action: "scene:spawn",
        output: `spawning: ${text.trim()}`,
      };
    }
    case "redesign": {
      const assetList = await assets.list();
      const ready = assetList.filter((a) => a.status === "ready");
      if (ready.length === 0) {
        return { ok: false, intent, output: "no ready meshes to redesign — generate one first" };
      }
      const active = ready[ready.length - 1] as ModelAsset;
      const suggestion = await askOllamaForRedesign(active, text);
      return {
        ok: true,
        intent,
        action: "scene:redesign",
        output: suggestion,
      };
    }
    case "geometry-split":
      return {
        ok: false,
        intent,
        output: "geometry engine (services/geometry, C++) not yet wired in Phase 4",
      };
    case "help":
      return {
        ok: true,
        intent,
        output: [
          "• status",
          "• list projects",
          "• list assets",
          "• generate mesh from asset <id>",
          "• redesign the active object  (e.g. 'redesign as a low-poly version')",
          "• make it red / scale up / rotate 45 / move up 2  (live mutation)",
          "• add a cube at origin  (primitive spawn)",
          "• split <model> into <n> parts  (Phase 4)",
        ].join("\n"),
      };
    default:
      return { ok: false, intent, output: `unrecognized command: ${text}` };
  }
}

async function askOllamaForRedesign(asset: ModelAsset, prompt: string): Promise<string> {
  try {
    const response = await fetch(`${config.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "You are Karmashala, AstraForge's AI design assistant. " +
              "The user wants to redesign an object. Reply with a single short " +
              "line: a JSON object {\"action\":\"color\"|\"scale\"|\"rotate\"|\"spawn\", " +
              "\"value\":<string|number|array>}. Use colour names for color, " +
              "numeric degrees for rotate, numeric multipliers for scale.",
          },
          {
            role: "user",
            content: `Object: ${asset.name} (${asset.stats?.vertices ?? "?"} verts, ${asset.stats?.triangles ?? "?"} tris). Request: ${prompt}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`ollama ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content?.trim() ?? "no suggestion";
  } catch (error) {
    return `(offline redesign) ${(error as Error).message}`;
  }
}
