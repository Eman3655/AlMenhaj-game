import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import gameRoutes from "./routes/game.js";

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

export default app;