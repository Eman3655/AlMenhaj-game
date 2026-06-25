const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
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

export async function completeDoorOnServer(token, doorId, keyId, score, maxScore) {
  const response = await fetch(`${API_URL}/game/complete-door`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      doorId,
      keyId,
      score,
      maxScore,
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

export async function saveDoorOnServer(token, doorData) {
  const response = await fetch(`${API_URL}/game/save-door`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(doorData),
  });

  if (!response.ok) {
    throw new Error("فشل حفظ الباب في السيرفر");
  }

  return response.json();
}
