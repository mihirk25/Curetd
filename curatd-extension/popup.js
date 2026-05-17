const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loggedOutEl = document.getElementById("logged-out");
const loggedInEl = document.getElementById("logged-in");
const userLabel = document.getElementById("user-label");
const errorEl = document.getElementById("error");

const { signInWithEmailPassword, signOut, getValidSession } = CuratdFirebaseRest;

function showError(msg) {
  if (!msg) {
    errorEl.textContent = "";
    errorEl.classList.remove("visible");
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.add("visible");
}

function setView(session) {
  if (session) {
    loggedOutEl.classList.remove("visible");
    loggedInEl.classList.add("visible");
    userLabel.textContent = `You're logged in as ${session.email || session.uid}`;
  } else {
    loggedInEl.classList.remove("visible");
    loggedOutEl.classList.add("visible");
    userLabel.textContent = "";
  }
}

async function restoreSession() {
  try {
    const session = await getValidSession();
    setView(session);
  } catch {
    setView(null);
  }
}

restoreSession();

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";
  try {
    const session = await signInWithEmailPassword(
      emailInput.value.trim(),
      passwordInput.value,
    );
    passwordInput.value = "";
    setView(session);
  } catch (err) {
    showError(err?.message || "Sign in failed.");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in";
  }
});

logoutBtn.addEventListener("click", async () => {
  showError("");
  try {
    await signOut();
    setView(null);
  } catch (err) {
    showError(err?.message || "Sign out failed.");
  }
});
