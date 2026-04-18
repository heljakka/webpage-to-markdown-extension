const DEFAULT_OPTIONS = {
  headingStyle: "atx",
  bulletMarker: "-"
};

const STORAGE_KEY = "markdownConverterOptions";

const elements = {
  headingStyle: document.querySelector("#headingStyle"),
  bulletMarker: document.querySelector("#bulletMarker"),
  convertButton: document.querySelector("#convertButton"),
  copyButton: document.querySelector("#copyButton"),
  downloadButton: document.querySelector("#downloadButton"),
  markdownOutput: document.querySelector("#markdownOutput"),
  status: document.querySelector("#status")
};

let latestResult = null;

void initialize();

async function initialize() {
  await restoreOptions();

  elements.convertButton.addEventListener("click", handleConvert);
  elements.copyButton.addEventListener("click", handleCopy);
  elements.downloadButton.addEventListener("click", handleDownload);
  elements.headingStyle.addEventListener("change", persistOptions);
  elements.bulletMarker.addEventListener("change", persistOptions);
}

async function restoreOptions() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const options = {
    ...DEFAULT_OPTIONS,
    ...(stored[STORAGE_KEY] || {})
  };

  elements.headingStyle.value = options.headingStyle;
  elements.bulletMarker.value = options.bulletMarker;
}

async function persistOptions() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: getOptions()
  });
}

function getOptions() {
  return {
    headingStyle: elements.headingStyle.value,
    bulletMarker: elements.bulletMarker.value
  };
}

function setStatus(message, type = "info") {
  elements.status.textContent = message;
  elements.status.className = `status status-${type}`;
}

function setBusy(isBusy) {
  elements.convertButton.disabled = isBusy;
  elements.copyButton.disabled = isBusy || !latestResult?.markdown;
  elements.downloadButton.disabled = isBusy || !latestResult?.markdown;
}

async function handleConvert() {
  latestResult = null;
  setBusy(true);
  setStatus("Converting the active tab to Markdown...", "info");

  try {
    await persistOptions();

    const tab = await getActiveTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "convert-page",
      options: getOptions()
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The page could not be converted.");
    }

    latestResult = response;
    elements.markdownOutput.value = response.markdown;
    elements.markdownOutput.scrollTop = 0;
    setBusy(false);
    setStatus(buildSuccessMessage(response), "success");
  } catch (error) {
    elements.markdownOutput.value = "";
    setBusy(false);
    setStatus(getReadableError(error), "error");
  }
}

async function handleCopy() {
  if (!latestResult?.markdown) {
    return;
  }

  try {
    await navigator.clipboard.writeText(latestResult.markdown);
    setStatus("Markdown copied to the clipboard.", "success");
  } catch (error) {
    setStatus(getReadableError(error), "error");
  }
}

async function handleDownload() {
  if (!latestResult?.markdown) {
    return;
  }

  const blob = new Blob([latestResult.markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const filename = `${sanitizeFilename(latestResult.title || "page")}.md`;

  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true
    });
    setStatus(`Markdown downloaded as ${filename}.`, "success");
  } catch (error) {
    setStatus(getReadableError(error), "error");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  return tab;
}

function buildSuccessMessage(result) {
  const parts = [`Converted ${result.wordCount} words from the active page.`];

  if (result.includedIframeCount > 0) {
    parts.push(`Included ${result.includedIframeCount} iframe section(s).`);
  }

  if (result.skippedIframeCount > 0) {
    parts.push(`Skipped ${result.skippedIframeCount} inaccessible iframe(s).`);
  }

  return parts.join(" ");
}

function getReadableError(error) {
  if (!error) {
    return "Something went wrong.";
  }

  const message = error.message || String(error);

  if (message.includes("Cannot access a chrome://")) {
    return "Chrome internal pages cannot be converted.";
  }

  if (message.includes("The message port closed before a response was received")) {
    return "The page did not respond. Try reloading the tab and converting again.";
  }

  if (message.includes("Cannot access contents of")) {
    return "This page blocks extension access. Try a regular webpage instead.";
  }

  return message;
}

function sanitizeFilename(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}
