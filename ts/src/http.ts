import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SnapError } from "./errors.js";
import { parseRepository, type Repository } from "./repository.js";
import { METADATA_DIRECTORY } from "./tree.js";
import { validateRepository } from "./validate.js";
import { REPOSITORY_FILE } from "./workspace.js";

export function isHttpOperand(operand: string): boolean {
  return operand.startsWith("http://") || operand.startsWith("https://");
}

/**
 * SPEC.md §9. One GET of that exact URL, requiring status 200. HTTP is
 * read-only, and redirects are out of scope: a 3xx is reported, not followed.
 */
export function fetchText(url: string): Promise<string> {
  return new Promise((settle, fail) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      fail(new SnapError("invalid repository URL: " + url));
      return;
    }

    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const call = send(target, { method: "GET" }, (response) => {
      const status = response.statusCode ?? 0;
      if (status !== 200) {
        response.resume();
        fail(new SnapError("HTTP " + String(status) + " from " + url));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => settle(body));
      response.on("error", (error: Error) => fail(new SnapError(error.message)));
    });
    call.on("error", (error: Error) => fail(new SnapError(error.message)));
    call.end();
  });
}

/**
 * §7. A repository operand is an explicit `http://` or `https://` URL, or
 * otherwise a local path to a repository root. Either way the value is
 * validated before use.
 */
export async function readOperandRepository(
  cwd: string,
  operand: string,
): Promise<Repository> {
  const text = isHttpOperand(operand)
    ? await fetchText(operand)
    : readLocalText(cwd, operand);
  const repository = parseRepository(text);
  validateRepository(repository);
  return repository;
}

function readLocalText(cwd: string, operand: string): string {
  const path = resolve(cwd, operand, METADATA_DIRECTORY, REPOSITORY_FILE);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new SnapError("not a Snap repository: " + operand);
  }
}
