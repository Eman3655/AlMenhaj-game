import express from "express";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const router = express.Router();

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ message: "غير مصرح" });
  }

  const token = header.replace("Bearer ", "");

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "جلسة غير صالحة" });
  }
}

router.get("/content", async (req, res) => {
  try {
    const doors = await pool.query(`SELECT * FROM doors ORDER BY number ASC`);
    const cards = await pool.query(`SELECT * FROM cards ORDER BY id ASC`);
    const obstacles = await pool.query(`SELECT * FROM obstacles ORDER BY id ASC`);

    res.json({
      doors: doors.rows.map((door) => ({
        id: door.id,
        number: door.number,
        title: door.title,
        summary: door.summary,
        illustration: door.illustration,
        keyPoints: door.key_points || [],
        quiz: door.quiz || {},
        scenario: door.scenario || {},
        mini: door.mini || {},
        cardId: door.card_id,
        xp: door.xp,
      })),
      cards: cards.rows.map((card) => ({
        id: card.id,
        title: card.title,
        icon: card.icon,
        power: card.power,
      })),
      obstacles: obstacles.rows.map((item) => ({
        id: item.id,
        title: item.title,
        gateAfter: item.gate_after,
        requiredCardId: item.required_card_id,
        prompt: item.prompt,
        options: item.options || [],
        answerIndex: item.answer_index,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تحميل محتوى اللعبة" });
  }
});

router.get("/progress", auth, async (req, res) => {
  try {
    const completedDoors = await pool.query(
      `SELECT door_id FROM user_progress WHERE user_id = $1 AND completed = true`,
      [req.user.id]
    );

    const cards = await pool.query(
      `SELECT card_id FROM user_cards WHERE user_id = $1`,
      [req.user.id]
    );

    const resolvedObstacles = await pool.query(
      `SELECT obstacle_id FROM user_obstacles WHERE user_id = $1`,
      [req.user.id]
    );

    const xpResult = await pool.query(
      `
      SELECT COALESCE(SUM(d.xp), 0) AS xp
      FROM user_progress up
      JOIN doors d ON d.id = up.door_id
      WHERE up.user_id = $1 AND up.completed = true
      `,
      [req.user.id]
    );

    res.json({
      completedDoors: completedDoors.rows.map((row) => row.door_id),
      resolvedObstacles: resolvedObstacles.rows.map((row) => row.obstacle_id),
      cards: cards.rows.map((row) => row.card_id),
      xp: Number(xpResult.rows[0]?.xp || 0),
      achievements: [],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تحميل التقدم" });
  }
});

router.post("/resolve-obstacle", auth, async (req, res) => {
  try {
    const { obstacleId } = req.body;

    if (!obstacleId) {
      return res.status(400).json({ message: "obstacleId مطلوب" });
    }

    await pool.query(
      `
      INSERT INTO user_obstacles (user_id, obstacle_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, obstacle_id) DO NOTHING
      `,
      [req.user.id, obstacleId]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر حفظ العقبة" });
  }
});

router.post("/complete-door", auth, async (req, res) => {
  try {
    const { doorId, cardId } = req.body;

    if (!doorId) {
      return res.status(400).json({ message: "doorId مطلوب" });
    }

    const doorResult = await pool.query(
      `SELECT id, card_id FROM doors WHERE id = $1`,
      [doorId]
    );

    const door = doorResult.rows[0];

    if (!door) {
      return res.status(404).json({ message: "الباب غير موجود" });
    }

    const finalCardId = cardId || door.card_id;

    await pool.query(
      `
      INSERT INTO user_progress (user_id, door_id, completed, completed_at)
      VALUES ($1, $2, true, NOW())
      ON CONFLICT (user_id, door_id)
      DO UPDATE SET completed = true, completed_at = NOW()
      `,
      [req.user.id, doorId]
    );

    if (finalCardId) {
      await pool.query(
        `
        INSERT INTO user_cards (user_id, card_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, card_id) DO NOTHING
        `,
        [req.user.id, finalCardId]
      );
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر حفظ التقدم" });
  }
});

router.post("/reset-progress", auth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [req.user.id]);
    await pool.query(`DELETE FROM user_cards WHERE user_id = $1`, [req.user.id]);
    await pool.query(`DELETE FROM user_obstacles WHERE user_id = $1`, [req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تصفير التقدم" });
  }
});

export default router;