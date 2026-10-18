// Local preview: serves the built site with an in-memory stand-in for the GitHub-backed API.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { validateDecision, type Decisions } from "../src/model.ts";
import { knownItems, loadFindings, readImage } from "../server/findings.ts";

const decisions: Decisions = {};
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT ?? 4173);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const json = (status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/api/review") return json(200, { viewer: { login: "preview", canWrite: true }, ...(await loadFindings()), decisions });
  if (url.pathname === "/api/image") {
    const image = await readImage(url.searchParams.get("path") ?? "");
    if (!image) return json(404, { error: "Image not found." });
    res.writeHead(200, { "Content-Type": image.type });
    return res.end(image.bytes);
  }
  if (url.pathname === "/api/decision" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const input = validateDecision(JSON.parse(raw), await knownItems());
      decisions[input.id] = { ...input, by: "preview", at: new Date().toISOString() };
      return json(200, { decisions });
    } catch (e) {
      return json(400, { error: (e as Error).message });
    }
  }
  try {
    const file = url.pathname === "/" ? "/index.html" : url.pathname;
    const body = await readFile(join("dist", file));
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`Preview on http://localhost:${port}`));
