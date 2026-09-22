import { describe, it, expect, vi, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

/**
 * dataLocation() decides between the project folder (lasting) and the temp
 * folder (e.g. Vercel, where the project folder is read-only). The result is
 * remembered, so each test loads a fresh copy of the module.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

async function freshStorage(projectWritable: boolean) {
  vi.resetModules();
  const fs = await import("node:fs");
  vi.spyOn(fs.promises, "access").mockImplementation(async () => {
    if (!projectWritable) throw Object.assign(new Error("read-only"), { code: "EROFS" });
  });
  return import("./storage");
}

describe("dataLocation", () => {
  it("uses the project folder when it's writable, and it lasts", async () => {
    const storage = await freshStorage(true);
    expect(await storage.dataLocation()).toEqual({ dir: process.cwd(), persistent: true });
    expect(await storage.cacheDir()).toBe(path.join(process.cwd(), "cache"));
  });

  it("falls back to the temp folder on a read-only host, marked as not lasting", async () => {
    const storage = await freshStorage(false);
    expect(await storage.dataLocation()).toEqual({
      dir: path.join(os.tmpdir(), "hindsight"),
      persistent: false,
    });
  });

  it("turns off saving answers where storage doesn't last", async () => {
    await freshStorage(false);
    const { canSaveLabels } = await import("./labels/labelStore");
    expect(await canSaveLabels()).toBe(false);
  });
});
