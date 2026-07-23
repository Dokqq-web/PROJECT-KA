const loginPanel = document.querySelector("#login-panel");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("[data-testid=login-error]");
const dashboard = document.querySelector("[data-testid=dashboard]");
const loadButton = document.querySelector("#load-data");
const loading = document.querySelector("[data-testid=loading]");
const orders = document.querySelector("[data-testid=orders]");

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const values = new FormData(loginForm);
  const valid =
    values.get("email") === "qa@example.test" &&
    values.get("password") === "testing123";

  loginError.hidden = valid;
  loginPanel.hidden = valid;
  dashboard.hidden = !valid;
});

loadButton.addEventListener("click", () => {
  loadButton.disabled = true;
  loading.hidden = false;
  setTimeout(() => {
    loading.hidden = true;
    orders.hidden = false;
    loadButton.disabled = false;
  }, 600);
});

