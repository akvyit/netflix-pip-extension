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
    btn.setAttribute("aria-label", "ピクチャー イン ピクチャー");
    btn.setAttribute("title", "ピクチャー イン ピクチャー");
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

  // 実際に存在するNetflixのコントロールボタン群を「読み取り専用」で取得する。
  // ここで得た要素は座標参照のみに使い、DOMの追加・削除・複製は一切行わない。
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

  // 隣り合うボタン同士の間隔を実測する(取得できなければデフォルト値)
  function measureGap(controls, targetIndex) {
    if (targetIndex <= 0 || targetIndex >= controls.length) return DEFAULT_GAP;
    const a = controls[targetIndex - 1].getBoundingClientRect();
    const b = controls[targetIndex].getBoundingClientRect();
    const gap = b.left - a.right;
    if (!isFinite(gap) || gap < 0 || gap > 80) return DEFAULT_GAP;
    return gap;
  }

  function positionFloatingButton() {
    if (!floatingBtn) return;
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
        // 右側コントロール群の一番左にあるボタンを特定する
        let leftmost = anchor;
        for (let i = anchorIndex - 1; i >= 0; i--) {
          const currentRect = controls[i].getBoundingClientRect();
          const rightRect = controls[i + 1].getBoundingClientRect();
          // 隣り合う要素との距離を計算し、広すぎる（左右グループの境界）場合はループを抜ける
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
        // 一番左のボタンのさらに左の空きスペースへ配置
        floatingBtn.style.left = leftmostRect.left - defaultGap - size + "px";
        floatingBtn.style.top = leftmostRect.top + "px";

        // Netflix側がコントロールバーをフェードアウトさせている場合はこちらも追従させる
        const anchorOpacity = parseFloat(getComputedStyle(anchor).opacity);
        floatingBtn.style.opacity = isFinite(anchorOpacity) ? String(anchorOpacity) : "1";
        floatingBtn.style.pointerEvents = anchorOpacity < 0.1 ? "none" : "auto";
        return;
      }
    }

    // コントロールが見つからない場合の最終フォールバック:動画の右下に固定表示
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