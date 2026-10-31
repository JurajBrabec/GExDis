// ==UserScript==
// @name         GitHub send to GExDis
// @namespace    Violentmonkey Scripts
// @match        https://github.com/*/releases*
// @grant        GM.xmlHttpRequest
// @connect      nas.home
// @connect      http://nas.home:10203
// @version      2026.10.31
// @author       NOiSE
// @description  Send GitHub repository artefacts to GexDis downloader
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/JurajBrabec/GExDis/refs/heads/main/user-script/gexdis-github.js
// @updateURL    https://raw.githubusercontent.com/JurajBrabec/GExDis/refs/heads/main/user-script/gexdis-github.js
// ==/UserScript==

(function () {
  "use strict";

  const DIV_SELECTOR =
    "#repo-content-pjax-container > div > div > div > div.Box-body > div.d-flex.flex-md-row.flex-column > div.d-flex.flex-row.flex-1.tmp-mb-3.wb-break-word > div.flex-1";
  const BUTTON_LABEL = "Download assets with GExDis";
  const BUTTON_BUSY_LABEL = "GExDis working…";

  // Backend API configuration
  const API_BASE = "http://nas.home:10203";
  const POLL_INTERVAL_MS = 2000; // how often to poll the status endpoint
  const MAX_POLL_ATTEMPTS = 60; // safety cap (~2 min at 2s interval)

  // --- Backend helpers -------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Wraps GM.xmlHttpRequest in a Promise so we can use async/await.
  // GM.xmlHttpRequest bypasses CORS and mixed-content blocking, which
  // plain fetch() cannot do here (https github.com -> http nas.home).
  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: "GET",
        url,
        headers: { Accept: "application/json" },
        onload: (res) => {
          try {
            resolve(JSON.parse(res.responseText));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        },
        onerror: () => reject(new Error(`Request failed: ${url}`)),
        ontimeout: () => reject(new Error(`Request timed out: ${url}`)),
      });
    });
  }

  function injectStyles() {
    if (document.querySelector("#gexdis-styles")) return;
    const style = document.createElement("style");
    style.id = "gexdis-styles";
    style.textContent = `
      #gexdis-container { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      #gexdis-status { flex-basis: 100%; color: var(--color-fg-muted, #656d76); font-size: 12px; line-height: 1.4; margin-top: 3px; }
      #gexdis-status[data-tone="error"] { color: var(--color-danger-fg, #cf222e); }
      #gexdis-status[data-tone="success"] { color: var(--color-success-fg, #1a7f37); }
      #gexdis-actions { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
      #gexdis-actions .gexdis-action-tag { display: inline-flex; align-items: center; gap: 4px; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #gexdis-actions .gexdis-action-tag strong { font-weight: 600; }
      #gexdis-actions .gexdis-action-tag > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    `;
    document.head.appendChild(style);
  }

  function actionDetails(action) {
    const parts = [];
    if (action.path) parts.push(action.path);
    if (action.rule) parts.push(`Rule: ${action.rule}`);
    if (action.error) parts.push(action.error);
    if (action.status === "unpacked") parts.push(`${action.unpacked ?? 0} files extracted`);
    if (action.status === "copied") parts.push(`${action.copied ?? 0} items copied`);
    if (action.status === "removed") {
      parts.push(`${action.removed ?? 0} paths removed`);
      if (action.failed) parts.push(`${action.failed} removals failed`);
    }
    return parts.join(" · ") || action.url || JSON.stringify(action);
  }

  function actionLabel(action) {
    switch (action.status) {
      case "failed":
        return { icon: "✕", label: "Failed", tone: "danger", summary: action.error || action.path || "Processing failed" };
      case "downloaded":
        return { icon: "↓", label: "Downloaded", tone: "info", summary: action.path || "file" };
      case "unpacked":
        return { icon: "▣", label: "Unpacked", tone: "info", summary: `${action.unpacked ?? 0} files` };
      case "copied":
        return { icon: "✓", label: "Copied", tone: "success", summary: `${action.copied ?? 0} items` };
      case "removed":
        return {
          icon: action.failed ? "⚠" : "⌫",
          label: action.failed ? "Cleanup partial" : "Cleaned",
          tone: "warning",
          summary: `${action.removed ?? 0} removed${action.failed ? ` · ${action.failed} failed` : ""}`,
        };
      case "planned":
        return { icon: "✓", label: "Matched", tone: "success", summary: action.url?.split("/").pop() || "asset" };
      default:
        return { icon: "?", label: action.status || "Unknown", tone: "info", summary: action.path || "" };
    }
  }

  function insertActionTags(actions = []) {
    const container = document.querySelector("#gexdis-actions");
    if (!container) return;

    container.innerHTML = "";

    actions.forEach((action) => {
      const tag = document.createElement("span");
      tag.dataset.viewComponent = "true";
      tag.classList.add("Label", "Label--large");
      tag.classList.add("gexdis-action-tag");
      const { icon, label, tone, summary } = actionLabel(action);
      tag.classList.add(`Label--${tone}`);
      tag.dataset.status = action.status || "unknown";
      tag.title = `${label}: ${actionDetails(action)}`;
      tag.setAttribute("aria-label", tag.title);

      const iconNode = document.createElement("span");
      iconNode.setAttribute("aria-hidden", "true");
      iconNode.textContent = icon;
      const labelNode = document.createElement("strong");
      labelNode.textContent = label;
      const summaryNode = document.createElement("span");
      summaryNode.textContent = summary;
      tag.append(iconNode, labelNode, summaryNode);
      container.appendChild(tag);
    });
  }

  function setStatus(message, tone = "muted") {
    const status = document.querySelector("#gexdis-status");
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setButtonBusy(busy) {
    if (!gexdisButton) return;
    gexdisButton.disabled = busy;
    gexdisButton.textContent = busy ? BUTTON_BUSY_LABEL : `${BUTTON_LABEL} (${gexdisDownloads})`;
  }

  function setButtonDisabled(reason) {
    if (!gexdisButton) return;
    gexdisButton.disabled = true;
    gexdisButton.textContent = "GExDis unavailable";
    gexdisButton.title = reason;
    setStatus(reason, "error");
  }

  function displayProgress(progress) {
    if (!progress) return;
    const phaseLabels = {
      queued: "Queued",
      downloading: "Downloading",
      removing: "Removing old files",
      unpacking: "Unpacking",
      copying: "Copying",
      completed: "Completed",
      failed: "Failed",
    };
    const phase = phaseLabels[progress.phase] || progress.phase;
    const position = progress.total
      ? ` · File ${progress.current}/${progress.total}`
      : "";
    const file = progress.file ? ` · ${progress.file}` : "";
    setStatus(`${phase}${position}${file}${progress.message && !file ? ` · ${progress.message}` : ""}`);
  }

  async function queryVariant() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}&dry_run=true`;

    setButtonBusy(true);
    setStatus("Checking release and matching assets…");

    try {
      const result = await requestJson(processUrl);
      if (result.status !== "ready") {
        gexdisDownloads = 0;
        insertActionTags(result.actions || []);
        setButtonDisabled(result.reason || result.error || "No matching assets are available.");
        return;
      }

      gexdisDownloads = result.count ?? result.actions?.length ?? 0;
      const title = (result.actions || []).map((action) => action.url?.split("/").pop()).filter(Boolean).join("\n");
      gexdisButton.title = title;
      setButtonBusy(false);
      setStatus(`${gexdisDownloads} matching ${gexdisDownloads === 1 ? "asset" : "assets"} ready to download.`, "success");
    } catch (err) {
      console.error("queryVariant failed:", err);
      gexdisDownloads = 0;
      setButtonDisabled(`Availability check failed: ${err.message || err}`);
    }
  }

  async function onButtonClick() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}`;

    setButtonBusy(true);
    setStatus("Starting download…");
    insertActionTags();
    let keepDisabled = false;

    try {
      // 1) Start the job
      const start = await requestJson(processUrl);
      console.log("Job started:", start);

      if (start.error) {
        setStatus(`Download could not start: ${start.error}`, "error");
        return;
      }
      if (start.status !== "running" || !start.statusUrl) {
        keepDisabled = true;
        insertActionTags(start.actions || []);
        setButtonDisabled(start.reason || start.error || "The server did not start a download job.");
        return;
      }

      // Poll the status endpoint until the job is done.
      const statusUrl = `${API_BASE}${start.statusUrl}`;

      let result = start;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        displayProgress(result.progress);
        await sleep(POLL_INTERVAL_MS);
        result = await requestJson(statusUrl);
        insertActionTags(result.actions);
        displayProgress(result.progress);
        if (result.status !== "running") break;
      }

      if (result.status === "running") {
        console.warn("Job still running after max attempts; stopping status polling.");
        setStatus(`Still ${result.progress?.phase || "running"}; status polling timed out. The server job may continue.`, "error");
        return;
      }

      if (result.status === "completed") {
        const failed = (result.actions || []).filter((action) => action.status === "failed").length;
        setStatus(
          failed
            ? `Processing finished · ${failed} of ${result.actions.length} actions failed.`
            : `Download completed · ${(result.actions || []).length} action${result.actions?.length === 1 ? "" : "s"}.`,
          failed ? "error" : "success",
        );
      } else {
        setStatus(`Download failed: ${result.error || result.progress?.message || "Unknown error"}`, "error");
      }
    } catch (err) {
      console.error("onButtonClick failed:", err);
      setStatus(`Download status unavailable: ${err.message || err}`, "error");
    } finally {
      if (!keepDisabled) setButtonBusy(false);
    }
  }

  function insertButton() {
    const div = document.querySelector(DIV_SELECTOR);

    if (!div) return; // div not rendered (yet)

    // Avoid duplicate buttons after pjax navigations / re-renders
    if (div.querySelector("#gexdis-container")) return;

    injectStyles();

    const span = document.createElement("span");
    span.id = "gexdis-container";

    const anchor = document.createElement("a");
    anchor.classList.add(
      "Button--secondary",
      "Button--small",
      "Button",
      "v-align-text-bottom",
    );
    anchor.dataset.viewComponent = "true";
    anchor.href = `${API_BASE}/editor`;
    anchor.target = "_blank";
    anchor.textContent = "⚙️";
    anchor.title = "Open GExDis editor";
    anchor.type = "button";

    const button = document.createElement("button");
    button.addEventListener("click", onButtonClick);
    button.classList.add(
      "Button--primary",
      "Button--small",
      "Button",
      "v-align-text-bottom",
    );
    button.dataset.viewComponent = "true";
    button.textContent = BUTTON_LABEL;
    button.type = "button";

    const actions = document.createElement("span");
    actions.id = "gexdis-actions";

    const status = document.createElement("span");
    status.id = "gexdis-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    span.appendChild(anchor);
    span.appendChild(button);
    span.appendChild(actions);
    span.appendChild(status);
    div.appendChild(span);

    gexdisButton = button;
    queryVariant();
  }

  let gexdisButton = null;
  let gexdisDownloads = 0;

  // Initial insert (page may still be loading, so also wait for DOMContentLoaded)
  insertButton();

  document.addEventListener("DOMContentLoaded", insertButton);

  // GitHub navigates with pjax; re-insert after each navigation
  document.addEventListener("pjax:end", insertButton);

  // Fallback: watch for the nav being re-rendered
  const observer = new MutationObserver(insertButton);
  observer.observe(document.body, { childList: true, subtree: true });
})();
