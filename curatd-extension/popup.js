const stateLoading = document.getElementById("state-loading");
const stateLoggedIn = document.getElementById("state-logged-in");
const stateLoggedOut = document.getElementById("state-logged-out");
const userLabel = document.getElementById("user-label");
const openCuratdBtn = document.getElementById("open-curatd-btn");

const CURATD_URL = "https://curatd.live";

function showState(name) {
  stateLoading.classList.remove("visible");
  stateLoggedIn.classList.remove("visible");
  stateLoggedOut.classList.remove("visible");
  if (name === "loading") stateLoading.classList.add("visible");
  if (name === "logged-in") stateLoggedIn.classList.add("visible");
  if (name === "logged-out") stateLoggedOut.classList.add("visible");
}

function setLoggedIn(session) {
  const email = session?.email || session?.uid || "your account";
  userLabel.innerHTML = `Logged in as <strong>${escapeHtml(email)}</strong>`;
  showState("logged-in");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setLoggedOut() {
  showState("logged-out");
}

async function checkSession() {
  showState("loading");
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_CURATD_SESSION" });
    if (response?.session?.idToken) {
      setLoggedIn(response.session);
    } else {
      setLoggedOut();
    }
  } catch {
    setLoggedOut();
  }
}

openCuratdBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: CURATD_URL });
});

checkSession();
