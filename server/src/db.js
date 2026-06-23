import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const { Pool } = pg;

function getSslConfig(connectionString) {
  if (!connectionString) return false;

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");

  if (sslMode === "require") {
    return { rejectUnauthorized: false };
  }

  return false;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSslConfig(process.env.DATABASE_URL),
});
