(function () {
  const BTN_ID = "nf-pip-btn";
  const FLOAT_SIZE = 32;
  const RIGHT_OFFSET = 56; // 全画面ボタン等と重ならないよう右端から離す距離
  const BOTTOM_OFFSET = 40; // コントロールバーのアイコン列に高さを合わせる距離

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

  // background.js からの右クリックメニュー選択を受け取る
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === "toggle-pip") {
      togglePiP();
    }
  });

  const PIP_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke="white" stroke-width="1.7" fill="none"/>' +
    '<rect x="11.5" y="11.5" width="7" height="5" rx="1" fill="white"/>' +
    "</svg>";

  let floatingBtn = null;
  let lastVideo = null;

  // 動画要素の実座標を基準に、コントロールバーと重ならない位置へ配置する。
  // NetflixのDOM構造やクラス名には一切依存しない。
  function positionFloatingButton() {
    if (!floatingBtn) return;
    const video = getVideo();
    if (!video) {
      floatingBtn.style.display = "none";
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      floatingBtn.style.display = "none";
      return;
    }

    floatingBtn.style.display = "flex";
    const left = rect.right - FLOAT_SIZE - RIGHT_OFFSET;
    const top = rect.bottom - FLOAT_SIZE - BOTTOM_OFFSET;
    floatingBtn.style.left = Math.max(0, left) + "px";
    floatingBtn.style.top = Math.max(0, top) + "px";
  }

  function ensureFloatingButton() {
    if (floatingBtn && document.body.contains(floatingBtn)) {
      positionFloatingButton();
      return;
    }

    floatingBtn = document.createElement("button");
    floatingBtn.id = BTN_ID;
    floatingBtn.type = "button";
    floatingBtn.className = "nf-pip-btn nf-pip-btn--floating";
    floatingBtn.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    floatingBtn.setAttribute("title", "ピクチャー イン ピクチャー");
    floatingBtn.innerHTML = PIP_ICON_SVG;
    floatingBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });

    // Netflix本体のDOMツリーの外(bodyの直下)に置くことで、
    // Netflix(React)の再描画による衝突を避ける
    document.body.appendChild(floatingBtn);
    positionFloatingButton();
  }

  function tick() {
    const video = getVideo();

    if (video !== lastVideo) {
      lastVideo = video;
    }

    if (video) {
      unlockPiP(video);
      ensureFloatingButton();
    } else if (floatingBtn) {
      floatingBtn.style.display = "none";
    }
  }

  // Netflix本体のDOM構造は監視せず、一定間隔でのポーリングのみ行う。
  // (MutationObserverで全体を監視するとNetflix側の描画と競合するリスクがあるため)
  setInterval(tick, 800);
  window.addEventListener("resize", positionFloatingButton);
  document.addEventListener("fullscreenchange", () => setTimeout(positionFloatingButton, 200));

  tick();
})();