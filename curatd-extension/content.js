(function () {
  const ROOT_ID = "curatd-clipper-root";
  const BTN_ID = "curatd-save-btn";
  const PANEL_ID = "curatd-save-panel";

  let injected = false;
  let observer = null;

  function getVideoId() {
    try {
      return new URLSearchParams(location.search).get("v") || "";
    } catch {
      return "";
    }
  }

  function getVideoElement() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function getVideoTitle() {
    const h1 =
      document.querySelector("h1.ytd-watch-metadata yt-formatted-string") ||
      document.querySelector("#title h1 yt-formatted-string") ||
      document.querySelector("h1.ytd-video-primary-info-renderer");
    if (h1?.textContent?.trim()) {
      return h1.textContent.trim();
    }
    const docTitle = document.title.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    return docTitle || "Untitled";
  }

  function getChannelName() {
    const el =
      document.querySelector("ytd-channel-name a") ||
      document.querySelector("#owner #channel-name a") ||
      document.querySelector("#upload-info a");
    return el?.textContent?.trim() || "YouTube";
  }

  function parseTimeInput(value) {
    const raw = String(value || "").trim();
    if (raw === "") return null;
    if (/^\d+(\.\d+)?$/.test(raw)) return Math.floor(Number(raw));
    const parts = raw.split(":").map((p) => Number(p));
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function findTitleAnchor() {
    return (
      document.querySelector("#above-the-fold #title") ||
      document.querySelector("ytd-watch-metadata #title") ||
      document.querySelector("#title")
    );
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function showPanel(anchor) {
    removePanel();
    const video = getVideoElement();
    const duration = video?.duration && Number.isFinite(video.duration) ? video.duration : 3600;
    const startDefault = video ? Math.floor(video.currentTime) : 0;
    const endDefault = Math.min(Math.floor(startDefault + 60), Math.floor(duration));

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "curatd-panel";
    panel.innerHTML = `
      <div class="curatd-panel-header">
        <span class="curatd-panel-brand">Save to Curatd</span>
        <button type="button" class="curatd-panel-close" aria-label="Close">&times;</button>
      </div>
      <p class="curatd-panel-title"></p>
      <label class="curatd-label">Start (seconds or m:ss)</label>
      <input type="text" class="curatd-input" id="curatd-start" value="${startDefault}" />
      <label class="curatd-label">End (seconds or m:ss)</label>
      <input type="text" class="curatd-input" id="curatd-end" value="${endDefault}" />
      <p class="curatd-hint">Max duration: ${formatSeconds(duration)}</p>
      <p class="curatd-status" id="curatd-status" hidden></p>
      <div class="curatd-actions">
        <button type="button" class="curatd-btn curatd-btn-primary" id="curatd-save">Save Clip</button>
        <button type="button" class="curatd-btn curatd-btn-ghost" id="curatd-cancel">Cancel</button>
      </div>
    `;

    panel.querySelector(".curatd-panel-title").textContent = getVideoTitle();

    panel.querySelector(".curatd-panel-close").addEventListener("click", removePanel);
    panel.querySelector("#curatd-cancel").addEventListener("click", removePanel);

    const statusEl = panel.querySelector("#curatd-status");
    const saveBtn = panel.querySelector("#curatd-save");

    saveBtn.addEventListener("click", async () => {
      const videoId = getVideoId();
      if (!videoId) {
        statusEl.hidden = false;
        statusEl.className = "curatd-status curatd-status-error";
        statusEl.textContent = "Could not read video ID from URL.";
        return;
      }

      const startParsed = parseTimeInput(panel.querySelector("#curatd-start").value);
      const endParsed = parseTimeInput(panel.querySelector("#curatd-end").value);

      if (startParsed == null || endParsed == null) {
        statusEl.hidden = false;
        statusEl.className = "curatd-status curatd-status-error";
        statusEl.textContent = "Enter valid start and end times.";
        return;
      }

      let startTime = startParsed;
      let endTime = endParsed;
      if (endTime <= startTime) {
        statusEl.hidden = false;
        statusEl.className = "curatd-status curatd-status-error";
        statusEl.textContent = "End time must be after start time.";
        return;
      }

      if (duration > 0) {
        startTime = Math.min(startTime, Math.floor(duration));
        endTime = Math.min(endTime, Math.floor(duration));
      }

      statusEl.hidden = false;
      statusEl.className = "curatd-status";
      statusEl.textContent = "Saving…";
      saveBtn.disabled = true;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "SAVE_CLIP",
          data: {
            videoId,
            videoTitle: getVideoTitle(),
            channelName: getChannelName(),
            startTime,
            endTime,
          },
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Save failed.");
        }

        statusEl.className = "curatd-status curatd-status-success";
        statusEl.textContent = response.merged
          ? "Moment added to your existing clip!"
          : "Clip saved to Curatd!";
        setTimeout(removePanel, 1400);
      } catch (err) {
        statusEl.className = "curatd-status curatd-status-error";
        statusEl.textContent =
          err?.message ||
          "Save failed. Sign in via the Curatd Clipper extension icon.";
        saveBtn.disabled = false;
      }
    });

    const host =
      anchor?.parentElement ||
      document.querySelector("#above-the-fold") ||
      document.querySelector("ytd-watch-metadata");

    if (host) {
      host.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  function injectButton() {
    if (injected || !getVideoId()) return;
    if (document.getElementById(BTN_ID)) {
      injected = true;
      return;
    }

    const titleAnchor = findTitleAnchor();
    if (!titleAnchor) return;

    const video = getVideoElement();
    if (!video) return;

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      titleAnchor.insertAdjacentElement("afterend", root);
    }

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "curatd-save-trigger";
    btn.textContent = "Save to Curatd";
    btn.title = "Save this moment to Curatd";
    btn.addEventListener("click", () => showPanel(titleAnchor));

    root.appendChild(btn);
    injected = true;
  }

  function tryInject() {
    if (!location.pathname.startsWith("/watch")) return;
    injectButton();
  }

  function start() {
    tryInject();
    observer = new MutationObserver(() => {
      if (!document.getElementById(BTN_ID)) {
        injected = false;
      }
      tryInject();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.addEventListener("yt-navigate-finish", () => {
    injected = false;
    removePanel();
    document.getElementById(ROOT_ID)?.remove();
    setTimeout(tryInject, 500);
  });
})();
