import { config } from "../config.js";
import { projects, assets, jobs } from "../data.js";
import { runVisionJob } from "../services/vision.js";
import type { KarmashalaResult } from "@astraforge/shared";

type Intent =
  | "status"
  | "list-projects"
  | "list-assets"
  | "vision"
  | "geometry-split"
  | "help"
  | "unknown";

const VISION_KEYWORDS = ["mesh", "3d", "generate", "model", "image", "photo"];
const SPLIT_KEYWORDS = ["split", "cut", "slice", "part", "joint", "segment", "lego"];
const LIST_PROJECT_KEYWORDS = ["project"];
const LIST_ASSET_KEYWORDS = ["asset", "model list", "files"];

/**
 * Karmashala — the terminal AI brain.
 *
 * Prefers a local Llama model (Ollama) for intent parsing; when Ollama is
 * offline, falls back to a deterministic keyword classifier so the CLI is
 * always usable.
 */
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
          {
            role: "system",
            content:
              "You classify user commands for AstraForge into exactly one label: " +
              '["status","list-projects","list-assets","vision","geometry-split","help","unknown"]. ' +
              "Reply with only the label.",
          },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`ollama http ${response.status}`);
    const body = (await response.json()) as { message?: { content?: string } };
    const label = body.message?.content?.trim().toLowerCase();
    if (label && /^[a-z-]+$/.test(label)) return label as Intent;
    throw new Error("unparsable label");
  } catch {
    return keywordClassify(text);
  }
}

function keywordClassify(text: string): Intent {
  const lower = text.toLowerCase();
  if (SPLIT_KEYWORDS.some((k) => lower.includes(k))) return "geometry-split";
  if (VISION_KEYWORDS.some((k) => lower.includes(k))) return "vision";
  if (LIST_PROJECT_KEYWORDS.some((k) => lower.includes(k))) return "list-projects";
  if (LIST_ASSET_KEYWORDS.some((k) => lower.includes(k))) return "list-assets";
  if (lower.includes("status") || lower.includes("help")) return lower.includes("status") ? "status" : "help";
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
          `jobs=${jobList.filter((j) => j.status === "running" || j.status === "queued").length} queued`,
      };
    }
    case "list-projects": {
      const list = await projects.list();
      return { ok: true, intent, output: list.map((p) => `- ${p.id} ${p.name}`).join("\n") || "no projects" };
    }
    case "list-assets": {
      const list = await assets.list();
      return { ok: true, intent, output: list.map((a) => `- ${a.id} ${a.name} (${a.status})`).join("\n") || "no assets" };
    }
    case "vision": {
      const match = /asset\s+([0-9a-f-]{8,})/i.exec(text);
      if (!match) return { ok: false, intent, output: "usage: generate mesh from asset <assetId>" };
      const job = await runVisionJob(match[1]);
      return { ok: true, intent, output: `vision job ${job.id} started`, jobId: job.id };
    }
    case "geometry-split":
      return {
        ok: false,
        intent,
        output: "geometry engine (services/geometry, C++) not yet wired in Phase 1",
      };
    case "help":
      return {
        ok: true,
        intent,
        output: [
          "status",
          "list projects",
          "list assets",
          "generate mesh from asset <id>",
          "split <model> into <n> parts with joints (Phase 4)",
        ].join("\n"),
      };
    default:
      return { ok: false, intent, output: `unrecognized command: ${text}` };
  }
}