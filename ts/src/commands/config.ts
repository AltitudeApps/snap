import { SnapError } from "../errors.js";
import type { Output } from "../presentation.js";
import { requireContributorId } from "../version.js";
import { globalConfigPath, writeContributorId } from "../config.js";
import { CONFIG_FILE, locateWorkspace, metadataPath } from "../workspace.js";

/**
 * SPEC.md §7.2. The ID is validated before writing. Without `--global` the
 * file goes in the nearest repository; with it, in `$HOME`, needing no
 * repository. Success prints nothing.
 */
export function config(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
  global: boolean,
  id: string,
): Output {
  requireContributorId(id);

  if (global) {
    const path = globalConfigPath(env);
    if (path === undefined) throw new SnapError("global configuration is unavailable");
    writeContributorId(path, id);
    return { kind: "silent" };
  }

  const workspace = locateWorkspace(cwd);
  writeContributorId(metadataPath(workspace, CONFIG_FILE), id);
  return { kind: "silent" };
}
