(function () {
  const BTN_ID = "nf-pip-btn";
  const FLOAT_SIZE = 40;
  const FLOAT_MARGIN = 12;

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

  function buildIconSvg(size) {
    return (
      '<svg viewBox="0 0 24 24" width="' +
      size +
      '" height="' +
      size +
      '" xmlns="http://www.w3.org/2000/svg">' +
      PIP_ICON_INNER +
      "</svg>"
    );
  }

  // ============ 1. コントロールバーへのネイティブ差し込み ============
  // data-uiaはNetflixのテスト用属性で、見た目のクラス名(ハッシュ値)より
  // 変更されにくいためこちらを起点にする。存在する control-* ボタンを
  // すべて集め、全画面ボタンの「直前」に差し込む(=Netflix純正のPiPボタンが
  // 表示される位置と同じ場所を狙う)。全画面ボタンが見つからない場合は
  // 最後に見つかった control-* ボタンの前に差し込む。
  function findControlButtons() {
    return Array.from(document.querySelectorAll('[data-uia^="control-"]')).filter(
      (el) => el.id !== BTN_ID
    );
  }

  function pickAnchorButton() {
    const controls = findControlButtons();
    if (!controls.length) return null;

    const fullscreenBtn = controls.find((el) =>
      /fullscreen/i.test(el.getAttribute("data-uia") || "")
    );
    return fullscreenBtn || controls[controls.length - 1];
  }

  function buildDockedButton(sourceButton) {
    const sourceWrapper = sourceButton.parentElement;
    if (!sourceWrapper) return null;

    const newWrapper = sourceWrapper.cloneNode(true);
    const newButton = newWrapper.querySelector("button");
    if (!newButton) return null;

    newButton.id = BTN_ID;
    newButton.setAttribute("data-uia", "control-pip");
    newButton.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    newButton.setAttribute("title", "ピクチャー イン ピクチャー");
    newButton.removeAttribute("aria-haspopup");
    newButton.removeAttribute("aria-expanded");
    newButton.removeAttribute("aria-describedby");

    const svg = newButton.querySelector("svg");
    if (svg) {
      svg.setAttribute("data-icon", "PictureInPicture");
      svg.removeAttribute("data-icon-id");
      svg.innerHTML = PIP_ICON_INNER;
    } else {
      newButton.innerHTML = buildIconSvg(24);
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

    const anchorButton = pickAnchorButton();
    if (!anchorButton) return false;

    const anchorWrapper = anchorButton.parentElement;
    if (!anchorWrapper || !anchorWrapper.parentElement) return false;

    const dockedWrapper = buildDockedButton(anchorButton);
    if (!dockedWrapper) return false;

    // 全画面ボタン(または最後のコントロール)の直前に挿入する
    anchorWrapper.before(dockedWrapper);
    return true;
  }

  // ============ 2. フォールバック(動画要素基準の絶対座標) ============
  // コンテナのCSS position設定に依存すると意図しない位置に飛ぶことがあるため、
  // 動画要素の実際の画面上の座標(getBoundingClientRect)を毎回計算し、
  // position: fixed で動画の右下に直接配置する。
  let floatingBtn = null;

  function positionFloatingButton() {
    if (!floatingBtn) return;
    const video = getVideo();
    if (!video) return;

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const left = rect.right - FLOAT_SIZE - FLOAT_MARGIN;
    const top = rect.bottom - FLOAT_SIZE - FLOAT_MARGIN - 60; // コントロールバー分の余白を確保

    floatingBtn.style.left = Math.max(0, left) + "px";
    floatingBtn.style.top = Math.max(0, top) + "px";
  }

  function ensureFloatingButton() {
    const video = getVideo();
    if (!video) return;

    if (!floatingBtn || !document.body.contains(floatingBtn)) {
      floatingBtn = document.createElement("button");
      floatingBtn.id = BTN_ID;
      floatingBtn.type = "button";
      floatingBtn.className = "nf-pip-btn nf-pip-btn--floating";
      floatingBtn.setAttribute("aria-label", "ピクチャー イン ピクチャー");
      floatingBtn.setAttribute("title", "ピクチャー イン ピクチャー");
      floatingBtn.innerHTML = buildIconSvg(20);
      floatingBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePiP();
      });
      document.body.appendChild(floatingBtn);
    }

    positionFloatingButton();
  }

  function removeFloatingButtonIfDocked() {
    // ネイティブ差し込みに成功した場合、フォールバックの浮動ボタンが
    // 残っていたら重複しないよう削除する
    if (floatingBtn && floatingBtn.classList.contains("nf-pip-btn--floating")) {
      floatingBtn.remove();
      floatingBtn = null;
    }
  }

  function attempt() {
    keepPiPUnlocked();
    if (tryDockNative()) {
      removeFloatingButtonIfDocked();
    } else {
      ensureFloatingButton();
    }
  }

  // NetflixはSPAで画面がDOM書き換えにより頻繁に変化するため監視する
  const observer = new MutationObserver(() => {
    attempt();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("resize", positionFloatingButton);
  document.addEventListener("fullscreenchange", () => setTimeout(attempt, 200));

  // 初回・再読込タイミング用のフォールバック実行
  setTimeout(attempt, 1000);
  setTimeout(attempt, 3000);
})();