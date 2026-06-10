import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

router.post("/register", async (req, res) => {
  try {
    const { name, username, password } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ message: "الاسم واسم المستخدم وكلمة المرور مطلوبة" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, username, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, username, role`,
      [name, username, passwordHash]
    );

    const user = result.rows[0];

    res.json({
      user,
      token: createToken(user),
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "اسم المستخدم موجود مسبقًا" });
    }

    console.error(error);
    res.status(500).json({ message: "حدث خطأ في التسجيل" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      `SELECT * FROM users WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
      },
      token: createToken(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "حدث خطأ في تسجيل الدخول" });
  }
});

export default router;