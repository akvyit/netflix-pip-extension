(function () {
  const BTN_ID = "nf-pip-btn";

  function getVideo() {
    return document.querySelector("video");
  }

  function isPiPActive() {
    return !!document.pictureInPictureElement;
  }

  // NetflixはPiPを明示的に無効化していることが多いため、都度解除する
  function unlockPiP(video) {
    try {
      video.removeAttribute("disablepictureinpicture");
      video.disablePictureInPicture = false;
    } catch (e) {
      /* no-op */
    }
  }

  async function togglePiP() {
    const video = getVideo();
    if (!video) {
      console.warn("[Netflix PinP] 再生中の動画が見つかりません");
      return;
    }

    unlockPiP(video);

    try {
      if (isPiPActive()) {
        await document.exitPictureInPicture();
        return;
      }

      if (video.readyState < 1) {
        console.warn("[Netflix PinP] 動画がまだ準備できていません(readyState不足)");
        return;
      }

      await video.requestPictureInPicture();
    } catch (err) {
      console.error("[Netflix PinP] PiPの切替に失敗しました:", err.name, err.message);
    }
  }

  // Netflix側が後からdisablePictureInPictureを再設定してくる場合があるため常時監視して解除する
  function keepPiPUnlocked() {
    const video = getVideo();
    if (!video) return;
    unlockPiP(video);
    const attrObserver = new MutationObserver(() => unlockPiP(video));
    attrObserver.observe(video, { attributes: true, attributeFilter: ["disablepictureinpicture"] });
  }

  // background.js からの右クリックメニュー選択を受け取る
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === "toggle-pip") {
      togglePiP();
    }
  });

  const PIP_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="2.5" y="4.5" width="19" height="15" rx="1.5" stroke="white" stroke-width="1.6"/>' +
    '<rect x="12.5" y="11.5" width="7" height="5" rx="1" fill="white"/>' +
    "</svg>";

  function createButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "nf-pip-btn";
    btn.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    btn.setAttribute("title", "ピクチャー イン ピクチャー");
    btn.innerHTML = PIP_ICON_SVG;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });
    return btn;
  }

  // Netflixのコントロールバー(右側、全画面ボタン付近)へ差し込みを試みる。
  // クラス名は変更される可能性があるため、複数候補を用意している。
  function tryDockIntoControls() {
    if (document.getElementById(BTN_ID)) return true;

    const fullscreenSelectors = [
      '[data-uia="control-fullscreen-enter"]',
      '[data-uia="control-fullscreen"]',
      'button[aria-label*="全画面"]',
      'button[data-uia*="fullscreen"]'
    ];

    let fullscreenBtn = null;
    for (const sel of fullscreenSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        fullscreenBtn = el;
        break;
      }
    }

    if (fullscreenBtn && fullscreenBtn.parentElement) {
      const btn = createButton();
      btn.classList.add("nf-pip-btn--docked");
      fullscreenBtn.parentElement.insertBefore(btn, fullscreenBtn);
      return true;
    }

    return false;
  }

  // コントロールバーが見つからない場合のフォールバック:
  // 画面右下に浮かせたボタンを常時表示する。
  function ensureFloatingButton() {
    if (document.getElementById(BTN_ID)) return;
    if (!getVideo()) return;
    const btn = createButton();
    btn.classList.add("nf-pip-btn--floating");
    document.body.appendChild(btn);
  }

  function attempt() {
    keepPiPUnlocked();
    if (!tryDockIntoControls()) {
      ensureFloatingButton();
    }
  }

  // NetflixはSPAで画面がDOM書き換えにより頻繁に変化するため監視する
  const observer = new MutationObserver(() => {
    attempt();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 初回・再読込タイミング用のフォールバック実行
  setTimeout(attempt, 1000);
  setTimeout(attempt, 3000);
})();
