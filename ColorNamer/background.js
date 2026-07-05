// Clicking the toolbar icon injects the picker into the active tab.
// No popup, no menus — the eyedropper opens immediately.
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
    .catch((err) => {
      // Fails on restricted pages (chrome://, the Web Store, PDF viewer, etc.)
      console.warn("Color Name Finder can't run on this page:", err.message);
    });
});
