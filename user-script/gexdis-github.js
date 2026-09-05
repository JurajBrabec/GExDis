// ==UserScript==
// @name        GitHub send to GExDis
// @namespace   Violentmonkey Scripts
// @match       https://github.com/*/releases*
// @grant       GM.xmlHttpRequest
// @connect     nas.home
// @connect     http://nas.home:10203
// @version     2026-09-05
// @author      NOiSE
// @description Send GitHub repository artefacts to GexDis downloader
// @icon        https://www.google.com/s2/favicons?sz=64&domain=github.com
// @run-at      document-idle
// @downloadURL https://raw.githubusercontent.com/NOiSE-GitHub/gexdis/main/user-script/gexdis-github.js
// @updateURL   https://raw.githubusercontent.com/NOiSE-GitHub/gexdis/main/user-script/gexdis-github.js
// ==/UserScript==

(function () {
  "use strict";

  const DIV_SELECTOR =
    "#repo-content-pjax-container > div > div > div > div.Box-body > div.d-flex.flex-md-row.flex-column > div.d-flex.flex-row.flex-1.tmp-mb-3.wb-break-word > div.flex-1";
  const BUTTON_LABEL = "Download assets with GExDis";
  const BUTTON_BUSY_LABEL = "GExDis in progress…";
  const BUTTON_DISABLED_LABEL = "GExDis disabled:";

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

  function insertNumberTag(count) {
    return `[${count}]`;
  }

  function insertActionTags(actions = []) {
    const container = document.querySelector("#gexdis-actions");
    if (!container) return;

    container.innerHTML = "";

    actions.forEach((action) => {
      const tag = document.createElement("span");
      tag.dataset.viewComponent = "true";
      tag.classList.add("Label", "Label--large");
      switch (action.status) {
        case "error":
          tag.classList.add("Label--danger");
          tag.textContent = `Error`;
          tag.title = JSON.stringify(action);
          break;
        case "downloaded":
          tag.textContent = `Downloaded ${insertNumberTag(1)}`;
          tag.title = action.path;
          break;
        case "removed":
          tag.classList.add("Label--warning");
          tag.textContent = `Removed ${insertNumberTag(action.removed)}`;
          tag.title = action.rule;
          break;
        case "unpacked":
          tag.textContent = `Unpacked ${insertNumberTag(action.unpacked)}`;
          tag.title = action.path;
          break;
        case "copied":
          tag.classList.add("Label--success");
          tag.textContent = `Copied ${insertNumberTag(action.copied)}`;
          tag.title = action.rule;
          break;
        default:
          tag.classList.add("Label--info");
          tag.textContent = `Unknown (${action.status})`;
          tag.title = JSON.stringify(action);
      }
      container.appendChild(tag);
    });
  }

  // Called once the job has finished (status is no longer "running").
  function handleResult(result) {
    console.log("Job result:", result.status, result.actions);

    insertActionTags(result.actions);

    if (result.status != "completed") {
      alert(`Job not completed ${result}`);
    }

    result.actions.map((action) => {
      if (action.status == "error") {
        alert(`Action failed ${action}`);
      }
    });
  }

  // Disables the button and shows progress while a job is in flight.
  function setButtonBusy(busy) {
    if (!gexdisButton) return;
    gexdisButton.disabled = busy;
    gexdisButton.textContent = busy
      ? BUTTON_BUSY_LABEL
      : `${BUTTON_LABEL} ${insertNumberTag(gexdisDownloads)}`;
  }

  function setButtonDisabled(text) {
    if (!gexdisButton) return;
    gexdisButton.disabled = true;
    gexdisButton.textContent = `${BUTTON_DISABLED_LABEL} ${text}`;
  }

  async function queryVariant() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}&dry_run=true`;

    setButtonBusy(true);

    try {
      // 1) Start the job
      const start = await requestJson(processUrl);
      console.log("Job started:", start);

      if (start.error) {
        gexdisDownloads = 0;
        setButtonDisabled(start.error);
        return;
      }

      gexdisDownloads = start.length;
      const title = start.reduce((acc, action) => {
        return acc + `\n${action.url.split("/").pop()}`;
      }, "");
      gexdisButton.title = title;
      setButtonBusy(false);
    } catch (err) {
      console.error("queryVariant failed:", err);
    }
  }

  async function onButtonClick() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}`;

    setButtonBusy(true);
    insertActionTags();

    try {
      // 1) Start the job
      const start = await requestJson(processUrl);
      console.log("Job started:", start);

      if (start.error) {
        alert(start.error);
        return;
      }

      // 2) Poll the status endpoint until the job is done
      const statusUrl = `${API_BASE}${start.statusUrl}`;

      let result = start;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        result = await requestJson(statusUrl);
        if (result.status !== "running") break;
        insertActionTags(result.actions);
      }

      if (result.status === "running") {
        console.warn("Job still running after max attempts; giving up.");
      }

      // 3) Final payload (status "completed" / "failed", actions, ...)
      handleResult(result);
    } catch (err) {
      console.error("onButtonClick failed:", err);
    } finally {
      setButtonBusy(false);
    }
  }

  function insertButton() {
    const div = document.querySelector(DIV_SELECTOR);

    if (!div) return; // div not rendered (yet)

    // Avoid duplicate buttons after pjax navigations / re-renders
    if (div.querySelector("#gexdis-container")) return;

    const span = document.createElement("span");
    span.id = "gexdis-container";

    const button = document.createElement("button");
    button.addEventListener("click", onButtonClick);
    button.classList.add(
      "Button--primary",
      "Button--small",
      "Button",
      "v-align-text-bottom",
      "d-none",
      "d-md-inline-block",
    );
    button.dataset.viewComponent = "true";
    button.textContent = BUTTON_LABEL;
    button.type = "button";

    const actions = document.createElement("span");
    actions.id = "gexdis-actions";

    span.appendChild(button);
    span.appendChild(actions);
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
