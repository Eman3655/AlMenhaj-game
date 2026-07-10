import { login, register } from "./auth.js";

export function renderAuthView(container, onSuccess) {
  let mode = "login";

  function render() {
    container.innerHTML = `
      <section class="auth-screen" dir="rtl">
        <div class="auth-shell">
          <aside class="auth-hero">
            <div class="auth-emblem">🗺️</div>
            <p class="auth-kicker">مغامرة تعليمية</p>
            <h1>خريطة ميراث النبوة</h1>
            <p>
              ادخل إلى رحلتك، افتح الأبواب، اجمع البطاقات، واحفظ تقدمك في حسابك.
            </p>

            <div class="auth-features">
              <span>📘 أبواب تعليمية</span>
              <span>🏆 تقدم محفوظ</span>
              <span>🎯 تحديات تفاعلية</span>
            </div>
          </aside>

          <main class="auth-panel">
            <div class="auth-panel-head">
              <h2>${mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}</h2>
              <p>${mode === "login" ? "أكمل رحلتك من حيث توقفت" : "ابدأ رحلتك التعليمية الآن"}</p>
            </div>

            <form class="auth-form" id="auth-form">
              ${
                mode === "register"
                  ? `<label>
                      <span>اسم المستخدم</span>
                      <input name="name" type="text" placeholder="مثال: أحمد" required />
                    </label>`
                  : ""
              }

              <label>
                <span>البريد الإلكتروني</span>
                <input name="username" type="text" placeholder="مثال: ahmed@example.com" required />
              </label>

              <label>
                <span>كلمة المرور</span>
                <input name="password" type="password" placeholder="••••••••" required />
              </label>

              <button class="auth-submit" type="submit">
                ${mode === "login" ? "دخول إلى الرحلة" : "إنشاء الحساب"}
              </button>
            </form>

            <button class="auth-switch" id="toggle-auth">
              ${mode === "login" ? "ليس لديك حساب؟ أنشئ حسابًا" : "لديك حساب؟ سجل الدخول"}
            </button>

            <p class="auth-error" id="auth-error"></p>
          </main>
        </div>
      </section>
    `;

    container.querySelector("#toggle-auth").addEventListener("click", () => {
      mode = mode === "login" ? "register" : "login";
      render();
    });

    container.querySelector("#auth-form").addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(event.target);
      const errorBox = container.querySelector("#auth-error");
      const submitButton = container.querySelector(".auth-submit");

      errorBox.textContent = "";
      submitButton.disabled = true;
      submitButton.textContent = "جاري المعالجة...";

      try {
        if (mode === "login") {
          await login(formData.get("username"), formData.get("password"));
        } else {
          await register(
            formData.get("name"),
            formData.get("username"),
            formData.get("password")
          );
        }

        await onSuccess();
      } catch (error) {
        errorBox.textContent = error?.message || "حدث خطأ غير متوقع";
        submitButton.disabled = false;
        submitButton.textContent = mode === "login" ? "دخول إلى الرحلة" : "إنشاء الحساب";
      }
    });
  }

  render();
}