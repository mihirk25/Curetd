(function () {
  const ROOT_ID = "curatd-clipper-root";
  const BTN_ID = "curatd-save-btn";
  const PANEL_ID = "curatd-save-panel";
  const MIN_CLIP_SECONDS = 1;

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

  /** @param {number} sec */
  function formatHMS(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  /** @param {number} sec */
  function formatClipLength(sec) {
    const s = Math.max(0, Math.floor(sec));
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = s % 60;
      if (r > 0) return `${h}h ${m}m ${r}s`;
      if (m > 0) return `${h}h ${m}m`;
      return `${h}h`;
    }
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m > 0 && r > 0) return `${m}m ${r}s`;
    if (m > 0) return `${m}m`;
    return `${r}s`;
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

  /**
   * @param {HTMLElement} container
   * @param {{ duration: number, start: number, end: number }} opts
   * @returns {{ getStart: () => number, getEnd: () => number, destroy: () => void }}
   */
  function createDualRangeSlider(container, opts) {
    const duration = Math.max(MIN_CLIP_SECONDS, opts.duration);
    let start = Math.max(0, Math.min(opts.start, duration - MIN_CLIP_SECONDS));
    let end = Math.max(start + MIN_CLIP_SECONDS, Math.min(opts.end, duration));

    const root = document.createElement("div");
    root.className = "curatd-range";
    root.innerHTML = `
      <div class="curatd-range-track" id="curatd-range-track">
        <div class="curatd-range-track-bg"></div>
        <div class="curatd-range-track-fill"></div>
        <button type="button" class="curatd-range-handle curatd-range-handle-start" aria-label="Clip start time"></button>
        <button type="button" class="curatd-range-handle curatd-range-handle-end" aria-label="Clip end time"></button>
      </div>
      <div class="curatd-range-labels">
        <span class="curatd-range-label curatd-range-label-start"></span>
        <span class="curatd-range-label curatd-range-label-end"></span>
      </div>
      <p class="curatd-clip-summary"></p>
    `;

    container.appendChild(root);

    const track = root.querySelector("#curatd-range-track");
    const fill = root.querySelector(".curatd-range-track-fill");
    const handleStart = root.querySelector(".curatd-range-handle-start");
    const handleEnd = root.querySelector(".curatd-range-handle-end");
    const labelStart = root.querySelector(".curatd-range-label-start");
    const labelEnd = root.querySelector(".curatd-range-label-end");
    const summary = root.querySelector(".curatd-clip-summary");

    function pct(time) {
      return duration > 0 ? (time / duration) * 100 : 0;
    }

    function timeFromClientX(clientX) {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const ratio = rect.width > 0 ? x / rect.width : 0;
      return Math.round(ratio * duration);
    }

    function render() {
      const startPct = pct(start);
      const endPct = pct(end);

      handleStart.style.left = `${startPct}%`;
      handleEnd.style.left = `${endPct}%`;
      fill.style.left = `${startPct}%`;
      fill.style.width = `${Math.max(0, endPct - startPct)}%`;

      labelStart.textContent = formatHMS(start);
      labelEnd.textContent = formatHMS(end);
      labelStart.style.left = `${startPct}%`;
      labelEnd.style.left = `${endPct}%`;

      const len = Math.max(0, end - start);
      summary.textContent = `Clip: ${formatHMS(start)} → ${formatHMS(end)} (${formatClipLength(len)})`;
    }

    let activeHandle = null;

    function onPointerMove(e) {
      if (!activeHandle) return;
      const t = timeFromClientX(e.clientX);

      if (activeHandle === "start") {
        start = Math.max(0, Math.min(t, end - MIN_CLIP_SECONDS));
      } else {
        end = Math.min(duration, Math.max(t, start + MIN_CLIP_SECONDS));
      }
      render();
    }

    function onPointerUp() {
      activeHandle = null;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      handleStart.releasePointerCapture?.();
      handleEnd.releasePointerCapture?.();
    }

    function bindHandle(handleEl, which) {
      handleEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        activeHandle = which;
        handleEl.setPointerCapture?.(e.pointerId);
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerUp);
      });
    }

    bindHandle(handleStart, "start");
    bindHandle(handleEnd, "end");

    track.addEventListener("pointerdown", (e) => {
      if (e.target === handleStart || e.target === handleEnd) return;
      const t = timeFromClientX(e.clientX);
      const distStart = Math.abs(t - start);
      const distEnd = Math.abs(t - end);
      if (distStart <= distEnd) {
        start = Math.max(0, Math.min(t, end - MIN_CLIP_SECONDS));
        activeHandle = "start";
      } else {
        end = Math.min(duration, Math.max(t, start + MIN_CLIP_SECONDS));
        activeHandle = "end";
      }
      render();
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    });

    render();

    return {
      getStart: () => start,
      getEnd: () => end,
      destroy: () => root.remove(),
    };
  }

  function showPanel(anchor) {
    removePanel();
    const video = getVideoElement();
    const duration =
      video?.duration && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : 3600;
    const current = video?.currentTime && Number.isFinite(video.currentTime) ? video.currentTime : 0;

    let startDefault = Math.floor(current);
    let endDefault = Math.min(Math.floor(current + 60), Math.floor(duration));
    if (endDefault <= startDefault) {
      endDefault = Math.min(startDefault + MIN_CLIP_SECONDS, Math.floor(duration));
    }

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "curatd-panel";
    panel.innerHTML = `
      <div class="curatd-panel-header">
        <span class="curatd-panel-brand">Save to Curatd</span>
        <button type="button" class="curatd-panel-close" aria-label="Close">&times;</button>
      </div>
      <p class="curatd-panel-title"></p>
      <div class="curatd-range-host"></div>
      <p class="curatd-status" id="curatd-status" hidden></p>
      <div class="curatd-actions">
        <button type="button" class="curatd-btn curatd-btn-primary" id="curatd-save">Save Clip</button>
        <button type="button" class="curatd-btn curatd-btn-ghost" id="curatd-cancel">Cancel</button>
      </div>
    `;

    panel.querySelector(".curatd-panel-title").textContent = getVideoTitle();

    const rangeHost = panel.querySelector(".curatd-range-host");
    const slider = createDualRangeSlider(rangeHost, {
      duration,
      start: startDefault,
      end: endDefault,
    });

    panel.querySelector(".curatd-panel-close").addEventListener("click", () => {
      slider.destroy();
      removePanel();
    });
    panel.querySelector("#curatd-cancel").addEventListener("click", () => {
      slider.destroy();
      removePanel();
    });

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

      const startTime = slider.getStart();
      const endTime = slider.getEnd();

      if (endTime <= startTime) {
        statusEl.hidden = false;
        statusEl.className = "curatd-status curatd-status-error";
        statusEl.textContent = "End time must be after start time.";
        return;
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
        setTimeout(() => {
          slider.destroy();
          removePanel();
        }, 1400);
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
