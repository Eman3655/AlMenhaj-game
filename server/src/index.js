import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config();

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://al-menhaj-game.vercel.app",
  "https://al-menhaj-game-git-main-eman3655s-projects.vercel.app"
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/game", gameRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "Mirath Game API is running" });
});

const port = process.env.PORT || 5000;

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Mirath Game API listening on http://localhost:${port}`);
  });
}

export default app;
