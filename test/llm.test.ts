import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LlmClient, extractJson } from "../src/llm.js";

let server: http.Server | undefined;
let requests = 0;

async function start(handler: http.RequestListener): Promise<string> {
  requests = 0;
  server = http.createServer((req, res) => {
    requests++;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
  server = undefined;
});

const client = (baseUrl: string) =>
  new LlmClient({ baseUrl, apiKey: "k", model: "m", timeoutMs: 300 });

describe("LlmClient", () => {
  it("returns the model's reply", async () => {
    const url = await start((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "hello" } }] }));
    });

    expect(await client(url).complete("s", "u")).toBe("hello");
  });

  it("returns null instead of throwing when the reply stalls after the headers", async () => {
    const url = await start((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write(" "); // headers and a bit of body, then nothing
    });

    await expect(client(url).complete("s", "u")).resolves.toBeNull();
  });

  it("returns null on an error status", async () => {
    const url = await start((_, res) => {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "No endpoints found" } }));
    });

    expect(await client(url).complete("s", "u")).toBeNull();
  });

  it("stops asking after two failures in a row", async () => {
    const url = await start((_, res) => {
      res.writeHead(500);
      res.end("nope");
    });
    const llm = client(url);

    await llm.complete("s", "u");
    await llm.complete("s", "u");
    const before = requests;
    await llm.complete("s", "u");

    expect(requests).toBe(before);
  });
});

describe("extractJson", () => {
  it("finds JSON inside a code fence", () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson("no json here")).toBeNull();
  });
});
