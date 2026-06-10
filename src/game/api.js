const API_URL = "http://localhost:5000/api";

export async function getContent() {
  const response = await fetch(`${API_URL}/game/content`);

  if (!response.ok) {
    throw new Error("فشل تحميل محتوى اللعبة");
  }

  return response.json();
}

export async function getProgress(token) {
  const response = await fetch(`${API_URL}/game/progress`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error("فشل تحميل تقدم الطالب");
  }

  return response.json();
}

export async function completeDoorOnServer(token, doorId, cardId) {
  const response = await fetch(`${API_URL}/game/complete-door`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      doorId,
      cardId,
    }),
  });

  if (!response.ok) {
    throw new Error("فشل حفظ تقدم الباب");
  }

  return response.json();
}

export async function resolveObstacleOnServer(token, obstacleId) {
  const response = await fetch(`${API_URL}/game/resolve-obstacle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ obstacleId }),
  });

  if (!response.ok) {
    throw new Error("فشل حفظ تجاوز العقبة");
  }

  return response.json();
}