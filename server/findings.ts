import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Bug, Idea, Kind, Proposal } from "../src/model.js";

const root = process.cwd();

export async function loadFindings(): Promise<{ bugs: Bug[]; ideas: Idea[]; proposals: Proposal[] }> {
  const [bugs, ideas, proposals] = await Promise.all([
    readList<Bug>("data/bugs.json"),
    readList<Idea>("data/ux.json"),
    readList<Proposal>("data/proposals.json").catch(() => []),
  ]);
  return { bugs, ideas, proposals };
}

async function readList<T>(path: string): Promise<T[]> {
  const parsed = JSON.parse(await readFile(join(root, path), "utf8")) as T[] | { items?: T[] };
  return Array.isArray(parsed) ? parsed : parsed.items ?? [];
}

export async function knownItems(): Promise<Map<string, Kind>> {
  const { bugs, ideas, proposals } = await loadFindings();
  return new Map<string, Kind>([
    ...bugs.map((b) => [b.id, "bug"] as const),
    ...ideas.map((i) => [i.id, "idea"] as const),
    ...proposals.map((p) => [p.id, "proposal"] as const),
  ]);
}

const IMAGE = /^screenshots\/[A-Za-z0-9_\-/]+\.(png|jpe?g|webp)$/;

export async function readImage(path: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (!IMAGE.test(path) || path.split("/").some((p) => p === ".." || p === "." || p === "")) return null;
  try {
    const bytes = await readFile(join(root, path));
    const ext = path.split(".").pop()!;
    return { bytes, type: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg" };
  } catch {
    return null;
  }
}
