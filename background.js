// 右クリックのコンテキストメニューに「ピクチャー イン ピクチャー」を追加する

const MENU_ID = "netflix-pip-toggle";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "ピクチャー イン ピクチャー",
    // 動画上での右クリック、および再生ページ全体での右クリックの両方に対応
    contexts: ["video", "page"],
    documentUrlPatterns: ["*://*.netflix.com/*"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || !tab.id) return;

  chrome.tabs.sendMessage(tab.id, { action: "toggle-pip" }).catch(() => {
    // content script がまだ読み込まれていない場合は注入してから再送する
    chrome.scripting.executeScript(
      {
        target: { tabId: tab.id },
        files: ["content.js"]
      },
      () => {
        chrome.tabs.sendMessage(tab.id, { action: "toggle-pip" });
      }
    );
  });
});
