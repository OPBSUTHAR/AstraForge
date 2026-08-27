import { config } from "../config.js";
import { projects, assets, jobs } from "../data.js";
import { runVisionJob } from "../services/vision.js";
import type { KarmashalaResult, ModelAsset } from "@astraforge/shared";

type Intent =
  | "greeting"
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
const MUTATE_KEYWORDS = ["color", "recolor", "tint", "scale", "resize", "rotate", "spin", "move", "translate", "shift", "lift", "lower", "reset", "delete", "remove", "hide", "show", "duplicate", "red", "blue", "cyan", "green", "yellow", "orange", "purple", "pink", "white", "black", "bigger", "smaller", "larger"];
const SPAWN_KEYWORDS = ["spawn", "add", "create", "place", "put", "drop", "import", "new"];
const REDESIGN_KEYWORDS = ["redesign", "remix", "restyle", "transform", "reimagine"];
const GREETING_KEYWORDS = ["hi", "hello", "hey", "hola", "greetings", "good morning", "good afternoon", "good evening", "howdy", "yo"];

const INTENT_LABELS: Intent[] = [
  "greeting",
  "status",
  "list-projects",
  "list-assets",
  "vision",
  "scene-mutate",
  "scene-spawn",
  "redesign",
  "geometry-split",
  "help",
  "unknown",
];

const SYSTEM_PROMPT =
  "You classify user commands for AstraForge into exactly one label: " +
  INTENT_LABELS.map((l) => `"${l}"`).join(", ") +
  ". Reply with only the label.";

const MAX_INPUT = 1000;

export const karmashala = {
  async run(text: string): Promise<KarmashalaResult> {
    const trimmed = text.trim().slice(0, MAX_INPUT);
    if (!trimmed) return { ok: false, intent: "unknown", output: "empty command" };
    const intent = await classify(trimmed);
    return execute(intent, trimmed);
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
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`ollama http ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    const label = body.message?.content?.trim().toLowerCase().replace(/[^a-z-]/g, "") as string;
    if ((INTENT_LABELS as string[]).includes(label)) return label as Intent;
    throw new Error("unparsable label");
  } catch {
    return keywordClassify(text);
  }
}

function keywordClassify(text: string): Intent {
  const lower = text.toLowerCase().trim();
  // Very short greeting early-return (hi / hello / yo) — but not "make it red" etc.
  if (lower.length <= 20 && GREETING_KEYWORDS.some((k) => lower === k || lower.startsWith(k + " ") || lower.startsWith(k + ",") || lower.includes(" " + k + " "))) return "greeting";
  if (/^(hi|hello|hey|yo|howdy|hola)\b/i.test(lower) && lower.length < 30 && !MUTATE_KEYWORDS.some((k) => lower.includes(k))) return "greeting";
  // natural "make it red/blue/..." is a mutate even without explicit color keyword in list
  if (/make it \w+/.test(lower) || /turn \w+/.test(lower)) return "scene-mutate";
  // Priority: redesign > split > vision > spawn > mutate > list > status > help > greeting
  if (REDESIGN_KEYWORDS.some((k) => lower.includes(k))) return "redesign";
  if (SPLIT_KEYWORDS.some((k) => lower.includes(k))) return "geometry-split";
  const isVision = VISION_KEYWORDS.some((k) => lower.includes(k));
  const isSpawn = SPAWN_KEYWORDS.some((k) => lower.includes(k)) && /\b(object|part|primitive|shape|mesh|model|cube|sphere|cylinder|torus|cone)\b/.test(lower);
  if (isVision && !isSpawn) return "vision";
  if (isSpawn) return "scene-spawn";
  if (MUTATE_KEYWORDS.some((k) => lower.includes(k))) return "scene-mutate";
  if (LIST_PROJECT_KEYWORDS.some((k) => lower.includes(k))) return "list-projects";
  if (LIST_ASSET_KEYWORDS.some((k) => lower.includes(k))) return "list-assets";
  if (lower.includes("status")) return "status";
  if (lower.includes("help")) return "help";
  if (GREETING_KEYWORDS.some((k) => lower.includes(k))) return "greeting";
  return "unknown";
}

async function execute(intent: Intent, text: string): Promise<KarmashalaResult> {
  switch (intent) {
    case "greeting": {
      const [projectList, assetList] = await Promise.all([projects.list({ limit: 5 }), assets.list({ limit: 5 })]);
      return {
        ok: true,
        intent,
        output: `Hey! I'm Karmashala — your holographic co-pilot.\nProjects: ${projectList.length} · Assets: ${assetList.length}\nTry: 'help' · 'list projects' · 'generate mesh from asset <id>' · 'make it red' · 'scale up'`,
      };
    }
    case "status": {
      const [projectList, assetList, jobList] = await Promise.all([projects.list(), assets.list(), jobs.list()]);
      return {
        ok: true,
        intent,
        output: `projects=${projectList.length} assets=${assetList.length} jobs=${jobList.filter((j) => j.status === "running" || j.status === "queued").length} active`,
      };
    }
    case "list-projects": {
      const list = await projects.list({ limit: 50 });
      return { ok: true, intent, output: list.map((p) => `- ${p.id.slice(0, 8)} ${p.name}`).join("\n") || "no projects" };
    }
    case "list-assets": {
      const list = await assets.list({ limit: 50 });
      return { ok: true, intent, output: list.map((a) => `- ${a.id.slice(0, 8)} ${a.name} (${a.status})`).join("\n") || "no assets" };
    }
    case "vision": {
      const match = /asset\s+([0-9a-f-]{8,})/i.exec(text) ?? /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
      if (!match) return { ok: false, intent, output: "usage: generate mesh from asset <assetId>" };
      try {
        const job = await runVisionJob(match[1]);
        return { ok: true, intent, output: `vision job ${job.id.slice(0, 8)} started`, jobId: job.id };
      } catch (e) {
        return { ok: false, intent, output: `vision failed: ${(e as Error).message}` };
      }
    }
    case "scene-mutate": {
      // Deterministic local parsing for colour/scale/rotate hints
      return { ok: true, intent, action: "scene:mutate", output: `applying: ${text}` };
    }
    case "scene-spawn": {
      return { ok: true, intent, action: "scene:spawn", output: `spawning: ${text}` };
    }
    case "redesign": {
      const assetList = await assets.list();
      const ready = assetList.filter((a) => a.status === "ready");
      if (ready.length === 0) return { ok: false, intent, output: "no ready meshes to redesign — generate one first" };
      const active = ready[ready.length - 1] as ModelAsset;
      const suggestion = await askOllamaForRedesign(active, text);
      // Try to parse JSON suggestion for validation
      try {
        const parsed = JSON.parse(suggestion);
        return { ok: true, intent, action: "scene:redesign", output: JSON.stringify(parsed) };
      } catch {
        return { ok: true, intent, action: "scene:redesign", output: suggestion };
      }
    }
    case "geometry-split":
      return { ok: false, intent, output: "geometry engine (services/geometry, C++) not yet wired — run services/geometry/build/astraforge_cli repair <in> <out>" };
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
      return { ok: false, intent, output: `unrecognized command: ${text} — try 'help'` };
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
              'line: a JSON object {"action":"color"|"scale"|"rotate"|"spawn", "value":<string|number|array>}. Use colour names for color, numeric degrees for rotate, numeric multipliers for scale.',
          },
          { role: "user", content: `Object: ${asset.name} (${asset.stats?.vertices ?? "?"} verts, ${asset.stats?.triangles ?? "?"} tris). Request: ${prompt}` },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`ollama ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    return body.message?.content?.trim() ?? '{"action":"color","value":"#ff3b30"}';
  } catch (error) {
    return JSON.stringify({ action: "mutate", hint: (error as Error).message.slice(0, 120) });
  }
}
