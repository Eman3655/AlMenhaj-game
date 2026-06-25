const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
import { getToken } from "./auth.js";

async function apiCall(path, body) {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`فشل الطلب: ${res.status}`);
  return res.json();
}

export async function getContent() {
  const response = await fetch(`${API_URL}/game/content`);
  if (!response.ok) throw new Error("فشل تحميل محتوى اللعبة");
  return response.json();
}

export async function getProgress(token) {
  const response = await fetch(`${API_URL}/game/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("فشل تحميل تقدم الطالب");
  return response.json();
}

export async function completeDoorOnServer(token, doorId, keyId, score, maxScore) {
  return apiCall("/game/complete-door", { doorId, keyId, score, maxScore });
}

export async function resolveObstacleOnServer(token, obstacleId) {
  return apiCall("/game/resolve-obstacle", { obstacleId });
}

export async function saveDoorOnServer(token, data) {
  return apiCall("/game/save-door", data);
}

export async function addDoorOnServer(data) {
  return apiCall("/game/add-door", data);
}

export async function deleteDoorOnServer(doorId) {
  return apiCall("/game/delete-door", { doorId });
}

export async function saveCardOnServer(data) {
  return apiCall("/game/save-card", data);
}

export async function addCardOnServer(data) {
  return apiCall("/game/add-card", data);
}

export async function deleteCardOnServer(cardId) {
  return apiCall("/game/delete-card", { cardId });
}

export async function saveObstacleOnServer(data) {
  return apiCall("/game/save-obstacle", data);
}

export async function addObstacleOnServer(data) {
  return apiCall("/game/add-obstacle", data);
}

export async function deleteObstacleOnServer(obstacleId) {
  return apiCall("/game/delete-obstacle", { obstacleId });
}

export async function resetProgressOnServer() {
  return apiCall("/game/reset-progress", {});
}