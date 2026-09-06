(function () {
  const BTN_ID = "nf-pip-btn";
  const DEFAULT_SIZE = 32;
  const DEFAULT_GAP = 12;

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
    '<svg viewBox="0 0 24 24" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="4" y="4.5" width="16" height="15" rx="1.3" stroke="white" stroke-width="1.6" fill="none"/>' +
    '<rect x="11.5" y="11.5" width="7" height="5" rx="1" fill="white"/>' +
    "</svg>";

  let floatingBtn = null;

  function createFloatingButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "nf-pip-btn";
    
    // 多言語化対応済みの場合は chrome.i18n を使用（フォールバック付き）
    const labelText = chrome.i18n ? chrome.i18n.getMessage("pip_title") || "ピクチャー イン ピクチャー" : "ピクチャー イン ピクチャー";
    btn.setAttribute("aria-label", labelText);
    btn.setAttribute("title", labelText);
    
    btn.innerHTML = PIP_ICON_SVG;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });
    // Netflix(React)のDOMツリーには入れず、body直下の独立要素として重ねるだけにする
    document.body.appendChild(btn);
    return btn;
  }

  function getReadOnlyControlButtons() {
    return Array.from(document.querySelectorAll('[data-uia^="control-"]')).filter(
      (el) => el.id !== BTN_ID
    );
  }

  function findFullscreenButton(controls) {
    return (
      controls.find((el) => /fullscreen/i.test(el.getAttribute("data-uia") || "")) ||
      controls[controls.length - 1] ||
      null
    );
  }

  function measureGap(controls, targetIndex) {
    if (targetIndex <= 0 || targetIndex >= controls.length) return DEFAULT_GAP;
    const a = controls[targetIndex - 1].getBoundingClientRect();
    const b = controls[targetIndex].getBoundingClientRect();
    const gap = b.left - a.right;
    if (!isFinite(gap) || gap < 0 || gap > 80) return DEFAULT_GAP;
    return gap;
  }

  // 【追加】親要素を遡って実際の透明度（Opacity）を計算する関数
  function getEffectiveOpacity(el) {
    let opacity = 1;
    let current = el;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      opacity *= parseFloat(style.opacity);
      if (style.display === 'none' || style.visibility === 'hidden') {
        return 0;
      }
      if (opacity === 0) return 0;
      current = current.parentElement;
    }
    return opacity;
  }

  function positionFloatingButton() {
    if (!floatingBtn) return;

    // 動画視聴ページ（/watch/〜）以外にいる場合はボタンを隠して処理を終了する
    if (!window.location.pathname.startsWith("/watch")) {
      floatingBtn.style.display = "none";
      return;
    }

    const video = getVideo();
    if (!video) {
      floatingBtn.style.display = "none";
      return;
    }

    const controls = getReadOnlyControlButtons();
    const anchor = findFullscreenButton(controls);

    if (anchor) {
      const anchorIndex = controls.indexOf(anchor);
      const rect = anchor.getBoundingClientRect();

      if (rect.width > 0 && rect.height > 0) {
        let leftmost = anchor;
        for (let i = anchorIndex - 1; i >= 0; i--) {
          const currentRect = controls[i].getBoundingClientRect();
          const rightRect = controls[i + 1].getBoundingClientRect();
          const currentGap = rightRect.left - currentRect.right;
          if (currentGap > 80 || Math.abs(currentRect.top - rightRect.top) > 10) {
            break;
          }
          leftmost = controls[i];
        }

        const leftmostRect = leftmost.getBoundingClientRect();
        const defaultGap = measureGap(controls, anchorIndex);
        const size = Math.max(rect.width, rect.height);

        floatingBtn.style.display = "flex";
        floatingBtn.style.width = size + "px";
        floatingBtn.style.height = size + "px";
        floatingBtn.style.left = leftmostRect.left - defaultGap - size + "px";
        floatingBtn.style.top = leftmostRect.top + "px";

        // 【修正】親要素を含めた実際の透明度を取得して追従させる
        const anchorOpacity = getEffectiveOpacity(anchor);
        floatingBtn.style.opacity = String(anchorOpacity);
        floatingBtn.style.pointerEvents = anchorOpacity < 0.1 ? "none" : "auto";
        return;
      }
    }

    // --- コントロールが見つからない場合 ---

    // 【追加】動画が再生中であれば、ユーザーが操作しておらずUIが消えているだけなのでボタンも隠す
    if (video && !video.paused) {
      floatingBtn.style.opacity = "0";
      floatingBtn.style.pointerEvents = "none";
      return;
    }

    // ここから下は「動画が一時停止中なのにコントロールがない（特殊なUIなど）」の本当のフォールバック
    const videoRect = video.getBoundingClientRect();
    if (videoRect.width === 0 || videoRect.height === 0) {
      floatingBtn.style.display = "none";
      return;
    }
    floatingBtn.style.display = "flex";
    floatingBtn.style.opacity = "1";
    floatingBtn.style.pointerEvents = "auto";
    floatingBtn.style.width = DEFAULT_SIZE + "px";
    floatingBtn.style.height = DEFAULT_SIZE + "px";
    floatingBtn.style.left = videoRect.right - DEFAULT_SIZE - 60 + "px";
    floatingBtn.style.top = videoRect.bottom - DEFAULT_SIZE - 40 + "px";
  }

  function tick() {
    const video = getVideo();
    if (video) unlockPiP(video);

    if (!floatingBtn || !document.body.contains(floatingBtn)) {
      floatingBtn = createFloatingButton();
    }
    positionFloatingButton();
  }

  // NetflixのDOMは監視・改変せず、一定間隔のポーリングで座標だけ追従する
  setInterval(tick, 400);
  window.addEventListener("resize", positionFloatingButton);
  document.addEventListener("fullscreenchange", () => setTimeout(positionFloatingButton, 200));

  tick();
})();