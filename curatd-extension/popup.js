/* global firebase, FIREBASE_CONFIG */

const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loggedOutEl = document.getElementById("logged-out");
const loggedInEl = document.getElementById("logged-in");
const userLabel = document.getElementById("user-label");
const errorEl = document.getElementById("error");

if (!firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

const auth = firebase.auth();

function showError(msg) {
  if (!msg) {
    errorEl.textContent = "";
    errorEl.classList.remove("visible");
    return;
  }
  errorEl.textContent = msg;
  errorEl.classList.add("visible");
}

function setView(user) {
  if (user) {
    loggedOutEl.classList.remove("visible");
    loggedInEl.classList.add("visible");
    userLabel.textContent = `You're logged in as ${user.email || user.uid}`;
    chrome.storage.local.set({
      user: { uid: user.uid, email: user.email || "" },
    });
  } else {
    loggedInEl.classList.remove("visible");
    loggedOutEl.classList.add("visible");
    userLabel.textContent = "";
    chrome.storage.local.remove(["user"]);
  }
}

auth.onAuthStateChanged((user) => {
  setView(user);
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in…";
  try {
    await auth.signInWithEmailAndPassword(
      emailInput.value.trim(),
      passwordInput.value,
    );
    passwordInput.value = "";
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
    await auth.signOut();
  } catch (err) {
    showError(err?.message || "Sign out failed.");
  }
});
