import fs from "fs";
import path from "path";
import { pool } from "./db.js";

const root = process.cwd();

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const schemaPath = path.join(root, "src", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");

  await pool.query(schema);

const contentPath = path.join(root, "src", "content");
  const doors = readJson(path.join(contentPath, "doors.json"));
  const cards = readJson(path.join(contentPath, "cards.json"));
  const obstacles = readJson(path.join(contentPath, "obstacles.json"));

  for (const card of cards) {
    await pool.query(
      `INSERT INTO cards (id, title, icon, power)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id)
       DO UPDATE SET title = EXCLUDED.title, icon = EXCLUDED.icon, power = EXCLUDED.power`,
      [card.id, card.title, card.icon || "", card.power || ""]
    );
  }

  for (const door of doors) {
    const detailsPath = path.join(contentPath, "doors", door.file);
    const details = fs.existsSync(detailsPath) ? readJson(detailsPath) : {};

    await pool.query(
      `INSERT INTO doors
       (id, number, title, summary, illustration, key_points, quiz, scenario, mini, card_id, xp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id)
       DO UPDATE SET
         number = EXCLUDED.number,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         illustration = EXCLUDED.illustration,
         key_points = EXCLUDED.key_points,
         quiz = EXCLUDED.quiz,
         scenario = EXCLUDED.scenario,
         mini = EXCLUDED.mini,
         card_id = EXCLUDED.card_id,
         xp = EXCLUDED.xp`,
      [
        door.id,
        door.number,
        door.title,
        details.summary || "",
        details.illustration || "",
        JSON.stringify(details.keyPoints || []),
        JSON.stringify(details.quiz || {}),
        JSON.stringify(details.scenario || {}),
        JSON.stringify(details.mini || {}),
        door.cardId,
        door.xp || 80,
      ]
    );
  }

  for (const obstacle of obstacles) {
    await pool.query(
      `INSERT INTO obstacles
       (id, title, gate_after, required_card_id, prompt, options, answer_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id)
       DO UPDATE SET
         title = EXCLUDED.title,
         gate_after = EXCLUDED.gate_after,
         required_card_id = EXCLUDED.required_card_id,
         prompt = EXCLUDED.prompt,
         options = EXCLUDED.options,
         answer_index = EXCLUDED.answer_index`,
      [
        obstacle.id,
        obstacle.title,
        obstacle.gateAfter,
        obstacle.requiredCardId,
        obstacle.prompt,
        JSON.stringify(obstacle.options || []),
        obstacle.answerIndex || 0,
      ]
    );
  }

  console.log("Database seeded successfully");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});