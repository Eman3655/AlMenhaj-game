import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const isLocalDatabase =
  process.env.DATABASE_URL?.includes("localhost") ||
  process.env.DATABASE_URL?.includes("127.0.0.1");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
});