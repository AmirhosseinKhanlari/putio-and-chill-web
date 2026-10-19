import { afterEach, describe, expect, it, vi } from "vitest";
import { PutioClient } from "./putio";

afterEach(() => vi.unstubAllGlobals());

/** Records each request and answers with `body`. */
function stubFetch(body: unknown) {
  const calls: { url: string; method: string; body: string; auth: string }[] = [];
  vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? String(init.body) : "", auth: (init.headers as Record<string, string>).Authorization });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

describe("start-from (put.io's documented endpoints)", () => {
  const putio = new PutioClient("t0ken");

  it("saves with POST files/{id}/start-from and a whole-second time", async () => {
    const calls = stubFetch({ status: "OK" });
    await putio.setStartFrom(42, 125.8);
    expect(calls).toEqual([{ url: "https://api.put.io/v2/files/42/start-from", method: "POST", body: "time=125", auth: "token t0ken" }]);
  });

  it("reads with GET files/{id}/start-from", async () => {
    const calls = stubFetch({ start_from: 1250, status: "OK" });
    expect(await putio.getStartFrom(42)).toBe(1250);
    expect(calls).toMatchObject([{ url: "https://api.put.io/v2/files/42/start-from", method: "GET", body: "" }]);
  });

  it("reads a missing position as 0", async () => {
    stubFetch({ status: "OK" });
    expect(await putio.getStartFrom(42)).toBe(0);
  });

  it("resets with POST files/{id}/start-from/delete", async () => {
    const calls = stubFetch({ status: "OK" });
    await putio.resetStartFrom(42);
    expect(calls).toMatchObject([{ url: "https://api.put.io/v2/files/42/start-from/delete", method: "POST" }]);
  });
});
