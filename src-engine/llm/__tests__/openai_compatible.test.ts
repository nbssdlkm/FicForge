// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

describe("OpenAICompatibleProvider.generateStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rethrows AbortError when the external signal cancels the fetch", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("Aborted", "AbortError"));
        };

        if (!signal) {
          return;
        }
        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const controller = new AbortController();
    const iterator = provider.generateStream({
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 32,
      temperature: 1,
      top_p: 1,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const nextChunk = iterator.next();
    controller.abort();

    await expect(nextChunk).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
