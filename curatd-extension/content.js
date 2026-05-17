(function () {
  "use strict";

  console.log("Curatd content script loaded");

  const LOG = "[Curatd]";
  const FLOAT_ROOT_ID = "curatd-floating-root";
  const BTN_ID = "curatd-save-btn";
  const PANEL_ID = "curatd-save-panel";
  const POS_STORAGE_KEY = "curatdFloatingBtnPos";
  const MIN_CLIP_SECONDS = 1;
  const DRAG_THRESHOLD_PX = 6;
  const DEFAULT_POS = { left: 20, bottom: 80 };

  const TITLE_SELECTORS = [
    "h1.ytd-video-primary-info-renderer",
    "#title h1",
    "ytd-watch-metadata h1",
    "h1.ytd-watch-metadata",
  ];

  let floatingRoot = null;
  let routeCheckInterval = null;

  function log(...args) {
    console.log(LOG, ...args);
  }

  function hasChromeRuntime() {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          if (typeof chrome !== "undefined" && chrome.runtime?.lastError) {
            log("storage get error", chrome.runtime.lastError.message);
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (e) {
        log("storage get exception", e);
        resolve({});
      }
    });
  }

  function storageSet(data) {
    return new Promise((resolve) => {
      if (!hasChromeStorage()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(data, () => {
          if (typeof chrome !== "undefined" && chrome.runtime?.lastError) {
            log("storage set error", chrome.runtime.lastError.message);
          }
          resolve();
        });
      } catch (e) {
        log("storage set exception", e);
        resolve();
      }
    });
  }

  function sendExtensionMessage(message) {
    return new Promise((resolve, reject) => {
      if (!hasChromeRuntime()) {
        reject(new Error("Curatd extension runtime is not available."));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (typeof chrome !== "undefined" && chrome.runtime?.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  function isWatchPage() {
    const ok =
      location.hostname.includes("youtube.com") &&
      (location.pathname === "/watch" || location.pathname.startsWith("/watch/"));
    if (!ok) log("not a watch page", location.pathname);
    return ok;
  }

  function getVideoId() {
    try {
      const id = new URLSearchParams(location.search).get("v") || "";
      if (!id) log("no video id in URL");
      return id;
    } catch (e) {
      log("getVideoId error", e);
      return "";
    }
  }

  function getVideoElement() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function getVideoTitle() {
    const h1 = findTitleH1();
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

  function findTitleH1() {
    for (const selector of TITLE_SELECTORS) {
      const el = document.querySelector(selector);
      if (el) {
        log("found title element:", selector);
        return el;
      }
    }
    log("title h1 not found yet, tried:", TITLE_SELECTORS.join(", "));
    return null;
  }

  function removePanel() {
    document.getElementById(PANEL_ID)?.remove();
  }

  function applyButtonPosition(el, pos) {
    if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      el.style.bottom = "auto";
      el.style.right = "auto";
      return;
    }
    el.style.left = `${DEFAULT_POS.left}px`;
    el.style.bottom = `${DEFAULT_POS.bottom}px`;
    el.style.top = "auto";
    el.style.right = "auto";
  }

  async function loadButtonPosition() {
    const result = await storageGet([POS_STORAGE_KEY]);
    return result[POS_STORAGE_KEY] || null;
  }

  async function saveButtonPosition(pos) {
    await storageSet({ [POS_STORAGE_KEY]: pos });
    log("saved button position", pos);
  }

  function clampPosition(left, top, width, height) {
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.max(8, Math.min(maxLeft, left)),
      top: Math.max(8, Math.min(maxTop, top)),
    };
  }

  function setupDraggableButton(btn) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = btn.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      btn.style.bottom = "auto";
      btn.style.right = "auto";
      btn.style.left = `${startLeft}px`;
      btn.style.top = `${startTop}px`;
      btn.classList.add("curatd-save-trigger--dragging");
      btn.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    btn.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        moved = true;
      }
      if (!moved) return;
      const next = clampPosition(
        startLeft + dx,
        startTop + dy,
        btn.offsetWidth,
        btn.offsetHeight,
      );
      btn.style.left = `${next.left}px`;
      btn.style.top = `${next.top}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      btn.classList.remove("curatd-save-trigger--dragging");
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      if (moved) {
        const left = parseFloat(btn.style.left) || 0;
        const top = parseFloat(btn.style.top) || 0;
        void saveButtonPosition({ left, top });
        return;
      }

      if (isWatchPage() && getVideoId()) {
        showPanel();
      }
    };

    btn.addEventListener("pointerup", endDrag);
    btn.addEventListener("pointercancel", endDrag);
  }

  function positionPanelNearButton(panel) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) {
      panel.style.left = "20px";
      panel.style.bottom = "160px";
      return;
    }
    const rect = btn.getBoundingClientRect();
    const panelWidth = 360;
    const left = Math.max(12, Math.min(window.innerWidth - panelWidth - 12, rect.left));
    let top = rect.bottom + 12;
    if (top + 320 > window.innerHeight) {
      top = Math.max(12, rect.top - 320);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function updateFloatingButtonVisibility() {
    if (!floatingRoot) return;
    const show = isWatchPage() && Boolean(getVideoId());
    floatingRoot.style.display = show ? "block" : "none";
    log("floating button visibility", show);
  }

  async function ensureFloatingButton() {
    if (floatingRoot && document.body.contains(floatingRoot)) {
      updateFloatingButtonVisibility();
      return floatingRoot;
    }

    const existing = document.getElementById(FLOAT_ROOT_ID);
    if (existing) {
      floatingRoot = existing;
      updateFloatingButtonVisibility();
      return floatingRoot;
    }

    log("creating floating button");
    const root = document.createElement("div");
    root.id = FLOAT_ROOT_ID;
    root.className = "curatd-floating-root";

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "curatd-save-trigger";
    btn.title = "Save this moment to Curatd";
    btn.innerHTML = `
      <svg class="curatd-save-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 4h12a2 2 0 0 1 2 2v14l-8-4-8 4V6a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <span>Save to Curatd</span>
    `;

    const savedPos = await loadButtonPosition();
    applyButtonPosition(btn, savedPos);
    setupDraggableButton(btn);

    root.appendChild(btn);
    document.body.appendChild(root);
    floatingRoot = root;
    updateFloatingButtonVisibility();
    log("floating button created");
    return floatingRoot;
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

  /**
   * @param {HTMLElement} container
   * @param {{ duration: number, start: number, end: number }} opts
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

  function showPanel() {
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
    panel.className = "curatd-panel curatd-panel--floating";
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
        if (!hasChromeRuntime()) {
          throw new Error("Curatd extension runtime is not available.");
        }
        const response = await sendExtensionMessage({
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
          "Save failed. Sign in at curatd.live first, then try again.";
        saveBtn.disabled = false;
      }
    });

    document.body.appendChild(panel);
    positionPanelNearButton(panel);
    log("save panel opened");
  }

  function onRouteChange(reason) {
    log("route change", reason);
    removePanel();
    void ensureFloatingButton();
    updateFloatingButtonVisibility();
  }

  function start() {
    log("start()", { pathname: location.pathname, href: location.href });
    void ensureFloatingButton();

    window.addEventListener("yt-navigate-finish", () => onRouteChange("yt-navigate-finish"));
    window.addEventListener("yt-page-data-updated", () => onRouteChange("yt-page-data-updated"));

    let lastHref = location.href;
    if (routeCheckInterval) clearInterval(routeCheckInterval);
    routeCheckInterval = setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        onRouteChange("href-change");
      } else if (isWatchPage() && getVideoId()) {
        updateFloatingButtonVisibility();
      }
    }, 500);

    window.addEventListener("resize", () => {
      const btn = document.getElementById(BTN_ID);
      if (!btn) return;
      const left = parseFloat(btn.style.left);
      const top = parseFloat(btn.style.top);
      if (Number.isFinite(left) && Number.isFinite(top)) {
        const next = clampPosition(left, top, btn.offsetWidth, btn.offsetHeight);
        btn.style.left = `${next.left}px`;
        btn.style.top = `${next.top}px`;
      }
    });
  }

  if (document.readyState === "loading") {
    log("waiting for DOMContentLoaded");
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

