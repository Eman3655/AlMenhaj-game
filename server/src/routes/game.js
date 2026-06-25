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
        questions: door.questions || [],
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

    const keys = await pool.query(
      `SELECT key_id FROM user_keys WHERE user_id = $1`,
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
      keys: keys.rows.map((row) => row.key_id),
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
    const { doorId, keyId, score, maxScore } = req.body;

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

    const finalKeyId = keyId || door.id;
    const finalScore = Number(score) || 0;
    const finalMaxScore = Number(maxScore) || 0;
    const earnedCard = finalMaxScore > 0 && finalScore >= Math.ceil(finalMaxScore * 0.8);

    await pool.query(
      `
      INSERT INTO user_progress (user_id, door_id, completed, completed_at)
      VALUES ($1, $2, true, NOW())
      ON CONFLICT (user_id, door_id)
      DO UPDATE SET completed = true, completed_at = NOW()
      `,
      [req.user.id, doorId]
    );

    if (finalKeyId) {
      await pool.query(
        `
        INSERT INTO user_keys (user_id, key_id, door_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, key_id) DO NOTHING
        `,
        [req.user.id, finalKeyId, doorId]
      );
    }

    if (door.card_id) {
      if (earnedCard) {
        await pool.query(
          `
          INSERT INTO user_cards (user_id, card_id)
          VALUES ($1, $2)
          ON CONFLICT (user_id, card_id) DO NOTHING
          `,
          [req.user.id, door.card_id]
        );
      } else {
        await pool.query(
          `DELETE FROM user_cards WHERE user_id = $1 AND card_id = $2`,
          [req.user.id, door.card_id]
        );
      }
    }

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر حفظ التقدم" });
  }
});

router.post("/award-card", auth, async (req, res) => {
  try {
    res.status(410).json({ message: "حفظ البطاقة يتم من نتيجة إكمال الباب فقط" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر حفظ البطاقة" });
  }
});

router.post("/reset-progress", auth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM user_progress WHERE user_id = $1`, [req.user.id]);
    await pool.query(`DELETE FROM user_cards WHERE user_id = $1`, [req.user.id]);
    await pool.query(`DELETE FROM user_obstacles WHERE user_id = $1`, [req.user.id]);
    await pool.query(`DELETE FROM user_keys WHERE user_id = $1`, [req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "تعذر تصفير التقدم" });
  }
});

router.post("/save-door", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { doorId, title, summary, illustration, keyPoints, cardId, xp, questions } = req.body;

    if (!doorId) {
      return res.status(400).json({ message: "doorId مطلوب" });
    }

    // معالجة قاتلة للـ keyPoints: نضمن دائماً أنه نص JSON صالح
    let finalKeyPoints = keyPoints;
    if (Array.isArray(finalKeyPoints)) {
      finalKeyPoints = JSON.stringify(finalKeyPoints);
    } else if (typeof finalKeyPoints === 'string') {
      try {
        const parsed = JSON.parse(finalKeyPoints);
        finalKeyPoints = JSON.stringify(Array.isArray(parsed) ? parsed : [finalKeyPoints]);
      } catch (e) {
        finalKeyPoints = JSON.stringify([finalKeyPoints]);
      }
    } else {
      finalKeyPoints = null;
    }

    // معالجة قاتلة للـ questions: نضمن دائماً أنه نص JSON صالح
    let finalQuestions = questions;
    if (Array.isArray(finalQuestions)) {
      finalQuestions = JSON.stringify(finalQuestions);
    } else if (typeof finalQuestions === 'string') {
      try {
        const parsed = JSON.parse(finalQuestions);
        finalQuestions = JSON.stringify(Array.isArray(parsed) ? parsed : []);
      } catch (e) {
        finalQuestions = JSON.stringify([]);
      }
    } else {
      finalQuestions = null;
    }

    // لاحظ إضافة ::jsonb في الاستعلام لإجبار قاعدة البيانات على قراءة النص كـ JSON
    await pool.query(
      `UPDATE doors SET 
        title = COALESCE($1, title),
        summary = COALESCE($2, summary),
        illustration = COALESCE($3, illustration),
        key_points = COALESCE($4::jsonb, key_points),
        card_id = COALESCE($5, card_id),
        xp = COALESCE($6, xp),
        questions = COALESCE($7::jsonb, questions)
      WHERE id = $8`,
      [title, summary, illustration, finalKeyPoints, cardId, xp, finalQuestions, doorId]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حفظ الباب:", error);
    res.status(500).json({ message: "تعذر حفظ الباب" });
  }
});
router.post("/save-card", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { cardId, title, icon, power } = req.body;
    if (!cardId) return res.status(400).json({ message: "cardId مطلوب" });

    await pool.query(
      `UPDATE cards SET 
        title = COALESCE($1, title),
        icon = COALESCE($2, icon),
        power = COALESCE($3, power)
      WHERE id = $4`,
      [title, icon, power, cardId]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حفظ البطاقة:", error);
    res.status(500).json({ message: "تعذر حفظ البطاقة" });
  }
});

router.post("/save-obstacle", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { obstacleId, title, gateAfter, requiredCardId, prompt, options, answerIndex, referenceType, referenceTitle, referenceLink } = req.body;
    if (!obstacleId) return res.status(400).json({ message: "obstacleId مطلوب" });

    // معالجة قاتلة للـ options
    let finalOptions = options;
    if (Array.isArray(finalOptions)) {
      finalOptions = JSON.stringify(finalOptions);
    } else if (typeof finalOptions === 'string') {
      try {
        const parsed = JSON.parse(finalOptions);
        finalOptions = JSON.stringify(Array.isArray(parsed) ? parsed : [finalOptions]);
      } catch (e) {
        finalOptions = JSON.stringify([finalOptions]);
      }
    } else {
      finalOptions = null;
    }

    await pool.query(
      `UPDATE obstacles SET 
        title = COALESCE($1, title),
        gate_after = COALESCE($2, gate_after),
        required_card_id = COALESCE($3, required_card_id),
        prompt = COALESCE($4, prompt),
        options = COALESCE($5::jsonb, options),
        answer_index = COALESCE($6, answer_index),
        reference_type = COALESCE($7, reference_type),
        reference_title = COALESCE($8, reference_title),
        reference_link = COALESCE($9, reference_link)
      WHERE id = $10`,
      [title, gateAfter, requiredCardId, prompt, finalOptions, answerIndex, referenceType, referenceTitle, referenceLink, obstacleId]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حفظ العقبة:", error);
    res.status(500).json({ message: "تعذر حفظ العقبة" });
  }
});

router.post("/add-door", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { doorId, title, summary, illustration, keyPoints, cardId, xp, questions } = req.body;
    if (!doorId || !title) return res.status(400).json({ message: "doorId و title مطلوبان" });

    const maxNum = await pool.query(`SELECT COALESCE(MAX(number), 0) + 1 AS next_num FROM doors`);
    const num = maxNum.rows[0].next_num;

    await pool.query(
      `INSERT INTO doors (id, number, title, summary, illustration, key_points, card_id, xp, questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [doorId, num, title, summary, illustration, keyPoints, cardId, xp, questions || []]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في إضافة الباب:", error);
    res.status(500).json({ message: "تعذر إضافة الباب" });
  }
});

router.post("/add-card", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { cardId, title, icon, power } = req.body;
    if (!cardId || !title) return res.status(400).json({ message: "cardId و title مطلوبان" });

    await pool.query(
      `INSERT INTO cards (id, title, icon, power) VALUES ($1, $2, $3, $4)`,
      [cardId, title, icon, power]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في إضافة البطاقة:", error);
    res.status(500).json({ message: "تعذر إضافة البطاقة" });
  }
});

router.post("/add-obstacle", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }

    const { obstacleId, title, gateAfter, requiredCardId, prompt, options, answerIndex, referenceType, referenceTitle, referenceLink } = req.body;
    if (!obstacleId || !title) return res.status(400).json({ message: "obstacleId و title مطلوبان" });

    // معالجة قاتلة للـ options
    let finalOptions = options;
    if (Array.isArray(finalOptions)) {
      finalOptions = JSON.stringify(finalOptions);
    } else if (typeof finalOptions === 'string') {
      try {
        const parsed = JSON.parse(finalOptions);
        finalOptions = JSON.stringify(Array.isArray(parsed) ? parsed : [finalOptions]);
      } catch (e) {
        finalOptions = JSON.stringify([finalOptions]);
      }
    } else {
      finalOptions = '[]';
    }

    await pool.query(
      `INSERT INTO obstacles (id, title, gate_after, required_card_id, prompt, options, answer_index, reference_type, reference_title, reference_link)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [obstacleId, title, gateAfter, requiredCardId, prompt, finalOptions, answerIndex, referenceType, referenceTitle, referenceLink]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في إضافة العقبة:", error);
    res.status(500).json({ message: "تعذر إضافة العقبة" });
  }
});

router.post("/delete-door", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }
    const { doorId } = req.body;
    if (!doorId) return res.status(400).json({ message: "doorId مطلوب" });

    await pool.query(`DELETE FROM user_progress WHERE door_id = $1`, [doorId]);
    await pool.query(`DELETE FROM user_keys WHERE door_id = $1`, [doorId]);
    await pool.query(`DELETE FROM obstacles WHERE gate_after = $1`, [doorId]);
    await pool.query(`DELETE FROM doors WHERE id = $1`, [doorId]);

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حذف الباب:", error);
    res.status(500).json({ message: "تعذر حذف الباب" });
  }
});

router.post("/delete-card", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }
    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ message: "cardId مطلوب" });

    await pool.query(`DELETE FROM user_cards WHERE card_id = $1`, [cardId]);
    await pool.query(`DELETE FROM cards WHERE id = $1`, [cardId]);

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حذف البطاقة:", error);
    res.status(500).json({ message: "تعذر حذف البطاقة" });
  }
});

router.post("/delete-obstacle", auth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "غير مصرح" });
    }
    const { obstacleId } = req.body;
    if (!obstacleId) return res.status(400).json({ message: "obstacleId مطلوب" });

    await pool.query(`DELETE FROM user_obstacles WHERE obstacle_id = $1`, [obstacleId]);
    await pool.query(`DELETE FROM obstacles WHERE id = $1`, [obstacleId]);

    res.json({ ok: true });
  } catch (error) {
    console.error("خطأ في حذف العقبة:", error);
    res.status(500).json({ message: "تعذر حذف العقبة" });
  }
});

export default router;
