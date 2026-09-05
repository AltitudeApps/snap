import { createServer } from "node:http";

import type { Output } from "../presentation.js";
import { serializeRepository } from "../repository.js";
import { locateWorkspace, readRepository } from "../workspace.js";

const RESOURCE = "/repository.json";
const CONTENT_TYPE = "application/json; charset=utf-8";
const HOST = "127.0.0.1";

/**
 * SPEC.md §7.9 and §9. Validates and snapshots the repository at startup,
 * binds only to loopback, prints the actual URL, and serves that one snapshot
 * until SIGINT or SIGTERM.
 *
 * The startup URL is written directly rather than returned as an Output: §7.11
 * makes it the one line that always stays plain, so a client can consume it
 * without stripping terminal escapes.
 */
export function serve(cwd: string, port: number): Promise<Output> {
  const workspace = locateWorkspace(cwd);
  const snapshot = serializeRepository(readRepository(workspace));
  const length = Buffer.byteLength(snapshot);

  return new Promise((settle, fail) => {
    const server = createServer((incoming, response) => {
      // The raw origin-form target is matched exactly, without decoding or
      // normalization, so a query string is a different resource.
      if (incoming.url !== RESOURCE) {
        response.writeHead(404, { "content-type": CONTENT_TYPE });
        response.end();
        return;
      }
      if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD", "content-type": CONTENT_TYPE });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": CONTENT_TYPE,
        "content-length": String(length),
      });
      // HEAD returns the same status and headers without a body.
      response.end(incoming.method === "HEAD" ? undefined : snapshot);
    });

    server.on("error", (error: Error) => fail(error));

    server.listen(port, HOST, () => {
      const address = server.address();
      const actual = typeof address === "object" && address !== null ? address.port : port;
      process.stdout.write("http://" + HOST + ":" + String(actual) + RESOURCE + "\n");
    });

    const shutdown = (): void => {
      server.close();
      settle({ kind: "silent" });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
