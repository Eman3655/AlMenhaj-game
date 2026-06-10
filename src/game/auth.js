const API_URL = "http://localhost:5000/api";

export async function login(username, password) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "فشل تسجيل الدخول");
  }

  localStorage.setItem("mirath_token", data.token);
  localStorage.setItem("mirath_user", JSON.stringify(data.user));

  return data;
}

export async function register(name, username, password) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, username, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "فشل إنشاء الحساب");
  }

  localStorage.setItem("mirath_token", data.token);
  localStorage.setItem("mirath_user", JSON.stringify(data.user));

  return data;
}

export function getToken() {
  return localStorage.getItem("mirath_token");
}

export function getUser() {
  try {
    const raw = localStorage.getItem("mirath_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem("mirath_token");
  localStorage.removeItem("mirath_user");
}