import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const EVIDENCE_SCHEMA_VERSION = "babysitter-evidence/v1";
export const REQUIRED_EVIDENCE_CATEGORIES = Object.freeze(["input", "command", "dv", "review", "diff", "commit", "integration", "hash"]);
const TRANSITIONS = new Set(["preparation", "review", "closure", "integration", "publication", "cleanup", "delivery"]);
const SHA256 = /^[a-f0-9]{64}$/;

function invalid(message) { throw new TypeError(`Invalid evidence manifest: ${message}`); }
function safeRelativePath(value) {
  if (typeof value !== "string" || value === "" || path.isAbsolute(value) || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** Read and hash-verify the complete immutable evidence set for a run transition. */
export async function verifyEvidenceManifest({ runDirectory, manifestPath = path.join(runDirectory ?? "", "manifest.json") } = {}) {
  if (typeof runDirectory !== "string" || runDirectory === "") invalid("run directory is required");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); } catch { invalid("manifest is unreadable or malformed"); }
  if (!isObject(manifest) || manifest.schemaVersion !== EVIDENCE_SCHEMA_VERSION || !Array.isArray(manifest.artifacts)) invalid("schema version or artifacts is invalid");
  if (Object.keys(manifest).some((key) => !["schemaVersion", "artifacts"].includes(key))) invalid("unexpected manifest field");
  if (manifest.artifacts.length !== REQUIRED_EVIDENCE_CATEGORIES.length) invalid("required categories are incomplete");
  const categories = new Set();
  const artifactPaths = new Set();
  for (const artifact of manifest.artifacts) {
    if (!isObject(artifact) || Object.keys(artifact).some((key) => !["path", "category", "sha256", "transition"].includes(key))) invalid("artifact schema is invalid");
    if (!safeRelativePath(artifact.path)) invalid("artifact path is unsafe");
    if (!REQUIRED_EVIDENCE_CATEGORIES.includes(artifact.category) || categories.has(artifact.category)) invalid("artifact category is missing or duplicated");
    if (artifactPaths.has(artifact.path)) invalid("artifact path is duplicated");
    if (typeof artifact.transition !== "string" || !TRANSITIONS.has(artifact.transition)) invalid("artifact transition is invalid");
    if (typeof artifact.sha256 !== "string" || !SHA256.test(artifact.sha256)) invalid("artifact hash is malformed");
    let bytes;
    try { bytes = await readFile(path.resolve(runDirectory, artifact.path)); } catch { invalid(`artifact is missing: ${artifact.path}`); }
    const target = path.resolve(runDirectory, artifact.path);
    if (target !== path.resolve(runDirectory) && !target.startsWith(`${path.resolve(runDirectory)}${path.sep}`)) invalid("artifact path escapes run directory");
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== artifact.sha256) invalid(`artifact hash mismatch: ${artifact.path}`);
    categories.add(artifact.category);
    artifactPaths.add(artifact.path);
  }
  if (REQUIRED_EVIDENCE_CATEGORIES.some((category) => !categories.has(category))) invalid("required categories are incomplete");
  return Object.freeze({ schemaVersion: manifest.schemaVersion, artifacts: manifest.artifacts.map((artifact) => Object.freeze({ ...artifact })) });
}
