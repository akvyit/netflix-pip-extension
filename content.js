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

  // Netflix純正アイコンと同じ24x24のviewBoxに合わせたPiPのグリフ
  const PIP_ICON_INNER =
    '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" stroke-width="1.7" fill="none"/>' +
    '<rect x="11.5" y="11.5" width="7" height="5" rx="1" fill="currentColor"/>';

  // Netflix自身のコントロールボタン(例: 再生速度・字幕・全画面など)の中から
  // 1つを丸ごと複製し、アイコンだけ差し替えることでNetflix標準の見た目・余白・
  // ホバー挙動をそのまま流用する。data-uiaはNetflixのテスト用属性で、
  // 見た目のクラス名(ハッシュ値)より変更されにくいためこちらを優先して探す。
  const ANCHOR_SELECTORS = [
    '[data-uia="control-speed"]',
    '[data-uia="control-audio-subtitle"]',
    '[data-uia="control-episodes"]',
    '[data-uia="control-fullscreen-enter"]',
    '[data-uia="control-fullscreen"]',
    '[data-uia="control-volume-slider"]',
    '[data-uia^="control-"]'
  ];

  function findAnchorButton() {
    for (const sel of ANCHOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function buildDockedButton(anchorButton) {
    // ボタンを包んでいる直近のdiv(Netflixの各コントロールのラッパー)ごと複製する
    const anchorWrapper = anchorButton.parentElement;
    if (!anchorWrapper) return null;

    const newWrapper = anchorWrapper.cloneNode(true);
    const newButton = newWrapper.querySelector("button");
    if (!newButton) return null;

    // 複製元のボタンが持っていた識別情報・ポップアップ状態などをリセットする
    newButton.id = BTN_ID;
    newButton.setAttribute("data-uia", "control-pip");
    newButton.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    newButton.setAttribute("title", "ピクチャー イン ピクチャー");
    newButton.removeAttribute("aria-haspopup");
    newButton.removeAttribute("aria-expanded");
    newButton.removeAttribute("aria-describedby");

    const svg = newButton.querySelector("svg");
    if (svg) {
      // サイズ・fill・role等の属性は維持しつつ中身の図形だけ差し替える
      svg.setAttribute("data-icon", "PictureInPicture");
      svg.removeAttribute("data-icon-id");
      svg.innerHTML = PIP_ICON_INNER;
    } else {
      newButton.innerHTML =
        '<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">' +
        PIP_ICON_INNER +
        "</svg>";
    }

    newButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });

    return newWrapper;
  }

  function tryDockNative() {
    if (document.getElementById(BTN_ID)) return true;

    const anchorButton = findAnchorButton();
    if (!anchorButton) return false;

    const anchorWrapper = anchorButton.parentElement;
    const rowContainer = anchorWrapper && anchorWrapper.parentElement;
    if (!rowContainer) return false;

    const dockedWrapper = buildDockedButton(anchorButton);
    if (!dockedWrapper) return false;

    anchorWrapper.after(dockedWrapper);
    return true;
  }

  // コントロールバーへの差し込みに失敗した場合のフォールバック:
  // ビューポート基準ではなく、動画プレーヤーのコンテナ基準で右下に浮かせる。
  // (ウィンドウが小さい・全画面でない場合でも位置がズレないようにするため)
  function findPlayerContainer(video) {
    return (
      video.closest('[data-uia="video-canvas"]') ||
      video.closest(".watch-video--player-view") ||
      video.closest(".watch-video") ||
      video.parentElement
    );
  }

  function ensureFloatingButton() {
    if (document.getElementById(BTN_ID)) return;
    const video = getVideo();
    if (!video) return;

    const container = findPlayerContainer(video);
    if (!container) return;

    const computedPosition = getComputedStyle(container).position;
    if (computedPosition === "static") {
      container.style.position = "relative";
    }

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "nf-pip-btn nf-pip-btn--floating";
    btn.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    btn.setAttribute("title", "ピクチャー イン ピクチャー");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">' +
      PIP_ICON_INNER +
      "</svg>";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });

    container.appendChild(btn);
  }

  function attempt() {
    keepPiPUnlocked();
    if (!tryDockNative()) {
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
