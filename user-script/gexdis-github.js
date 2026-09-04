// ==UserScript==
// @name        GitHub send to GExDis
// @namespace   Violentmonkey Scripts
// @match       https://github.com/*/releases*
// @grant       GM.xmlHttpRequest
// @connect     nas.home
// @connect     http://nas.home:10203
// @version     2026-09-04
// @author      NOiSE
// @description Send GitHub repository artefacts to GexDis downloader
// @icon        https://www.google.com/s2/favicons?sz=64&domain=github.com
// @run-at      document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DIV_SELECTOR =
    '#repo-content-pjax-container > div > div > div > div.Box-body > div.d-flex.flex-md-row.flex-column > div.d-flex.flex-row.flex-1.tmp-mb-3.wb-break-word > div.flex-1';
  const BUTTON_LABEL = 'Download assets with GExDis';
  const BUTTON_BUSY_LABEL = 'GExDis is processing…';

  // Backend API configuration
  const API_BASE = 'http://nas.home:10203';
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
        method: 'GET',
        url,
        headers: { Accept: 'application/json' },
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

  // Called once the job has finished (status is no longer "running").
  function handleResult(result) {
    console.log('Job result:', result.status, result.actions);

    if (result.status != 'completed') {
      alert(`Job not completed ${result}`);
    }

    result.actions.map((action) => {
      if (action.status == 'error') {
        alert(`Action failed ${action}`);
      }
    });
  }

  // Disables the button and shows progress while a job is in flight.
  function setButtonBusy(busy) {
    if (!currentButton) return;
    currentButton.disabled = busy;
    currentButton.textContent = busy
      ? BUTTON_BUSY_LABEL
      : `${BUTTON_LABEL} (${numDownloads})`;
  }

  function setButtonDisabled(text) {
    if (!currentButton) return;
    currentButton.disabled = true;
    currentButton.textContent = text;
  }

  async function queryVariant() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}&dry_run=true`;

    setButtonBusy(true);

    try {
      // 1) Start the job
      const start = await requestJson(processUrl);
      console.log('Job started:', start);

      if (start.error) {
        numDownloads = 0;
        setButtonDisabled(`GExDis: ${start.error}`);
        return;
      }

      numDownloads = start.length;
      setButtonBusy(false);
    } catch (err) {
      console.error('queryVariant failed:', err);
    }
  }

  async function onButtonClick() {
    const targetUrl = location.href;
    const processUrl = `${API_BASE}/process?url=${encodeURIComponent(targetUrl)}`;

    setButtonBusy(true);
    try {
      // 1) Start the job
      const start = await requestJson(processUrl);
      console.log('Job started:', start);

      if (start.error) {
        alert(start.error);
        return;
      }

      // 2) Poll the status endpoint until the job is done
      const statusUrl = start.statusUrl.startsWith('http')
        ? start.statusUrl
        : `${API_BASE}${start.statusUrl}`;

      let result = start;
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await sleep(POLL_INTERVAL_MS);
        result = await requestJson(statusUrl);
        if (result.status !== 'running') break;
      }

      if (result.status === 'running') {
        console.warn('Job still running after max attempts; giving up.');
      }

      // 3) Final payload (status "completed" / "failed", actions, ...)
      handleResult(result);
    } catch (err) {
      console.error('onButtonClick failed:', err);
    } finally {
      setButtonBusy(false);
    }
  }

  function insertButton() {
    const div = document.querySelector(DIV_SELECTOR);

    if (!div) return; // div not rendered (yet)

    // Avoid duplicate buttons after pjax navigations / re-renders
    if (div.querySelector('span[data-custom-button]')) return;

    const span = document.createElement('span');
    span.dataset.customButton = 'true';

    const button = document.createElement('button');
    button.addEventListener('click', onButtonClick);
    button.classList.add(
      'Button--primary',
      'Button--small',
      'Button',
      'v-align-text-bottom',
      'd-none',
      'd-md-inline-block',
    );
    button.dataset.viewComponent = 'true';
    button.textContent = BUTTON_LABEL;
    button.type = 'button';

    const label = document.createElement('span');
    label.dataset.component = 'CounterLabel';
    label.dataset.variant = 'secondary';
    label.textContent = '666';

    const counter = document.createElement('span');
    counter.dataset.component = 'counter';
    counter.appendChild(label);

    button.appendChild(counter);
    span.appendChild(button);
    div.appendChild(span);

    currentButton = button;
    queryVariant();
  }

  let currentButton;
  let numDownloads = 0;

  // Initial insert (page may still be loading, so also wait for DOMContentLoaded)
  insertButton();

  document.addEventListener('DOMContentLoaded', insertButton);

  // GitHub navigates with pjax; re-insert after each navigation
  document.addEventListener('pjax:end', insertButton);

  // Fallback: watch for the nav being re-rendered
  const observer = new MutationObserver(insertButton);
  observer.observe(document.body, { childList: true, subtree: true });
})();
