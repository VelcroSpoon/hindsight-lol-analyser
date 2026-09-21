import { config as loadDotenv } from "dotenv";
import path from "node:path";

/**
 * Load environment variables for standalone scripts. Next.js loads .env.local
 * automatically, but plain Node/tsx does not — so scripts import this first.
 * .env.local wins over .env.
 */
loadDotenv({ path: path.join(process.cwd(), ".env") });
loadDotenv({ path: path.join(process.cwd(), ".env.local"), override: true });
