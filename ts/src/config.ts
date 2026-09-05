import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { SnapError } from "./errors.js";
import { asObject, asString, field, parseJson, requireFields } from "./json.js";
import { requireContributorId } from "./version.js";
import { CONFIG_FILE, metadataPath, type Workspace } from "./workspace.js";

export const GLOBAL_CONFIG_FILE = ".snapconfig.json";

/** §8. Configuration is ordinary UTF-8 JSON with exactly this shape. */
function parseConfig(text: string): string {
  const root = asObject(parseJson(text), "configuration");
  requireFields(root, ["contributor"], "configuration");
  const contributor = asObject(field(root, "contributor", "configuration"), "contributor");
  requireFields(contributor, ["id"], "contributor");
  return requireContributorId(asString(field(contributor, "id", "contributor"), "contributor id"));
}

function readConfigFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  return parseConfig(readFileSync(path, "utf8"));
}

export function globalConfigPath(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const home = env["HOME"];
  if (home === undefined || home === "") return undefined;
  return resolve(home, GLOBAL_CONFIG_FILE);
}

/**
 * §8. Local configuration is read first; if it provides an ID the global file
 * is not read at all. A malformed file that *is* read is an error.
 */
export function readContributorId(
  workspace: Workspace | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (workspace !== undefined) {
    const local = readConfigFile(metadataPath(workspace, CONFIG_FILE));
    if (local !== undefined) return local;
  }
  const global = globalConfigPath(env);
  if (global === undefined) return undefined;
  return readConfigFile(global);
}

export function requireContributor(
  workspace: Workspace | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const id = readContributorId(workspace, env);
  if (id === undefined) {
    throw new SnapError("contributor.id is required; configure it locally or globally");
  }
  return id;
}

export function writeContributorId(path: string, id: string): void {
  writeFileSync(path, JSON.stringify({ contributor: { id } }, null, 2) + "\n");
}
