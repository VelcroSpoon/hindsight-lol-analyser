import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where Hindsight keeps its data (the /cache folder).
 *
 * On your own computer that's the project folder, and it lasts. On a host like
 * Vercel the project folder is read-only, so data goes to the system temp
 * folder instead: it works, but only while that server stays warm, so nothing
 * that must last (hand-checked answers) is written there.
 *
 * Decided by testing whether the project folder is writable, rather than by
 * trusting a hosting platform's environment variables to be present.
 */

export interface DataLocation {
  /** Folder that holds /cache. */
  dir: string;
  /** False when data may disappear between requests (temp folder). */
  persistent: boolean;
}

let resolved: Promise<DataLocation> | null = null;

export function dataLocation(): Promise<DataLocation> {
  resolved ??= (async () => {
    const projectDir = process.cwd();
    try {
      await fs.access(projectDir, constants.W_OK);
      return { dir: projectDir, persistent: true };
    } catch {
      return { dir: path.join(os.tmpdir(), "hindsight"), persistent: false };
    }
  })();
  return resolved;
}

/** Folder holding cached timelines and accounts.json. */
export async function cacheDir(): Promise<string> {
  return path.join((await dataLocation()).dir, "cache");
}
