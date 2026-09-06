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
    if (!video) return;

    unlockPiP(video);

    try {
      if (isPiPActive()) {
        await document.exitPictureInPicture();
        return;
      }
      if (video.readyState < 1) return;
      await video.requestPictureInPicture();
    } catch (err) {
      console.error("[Netflix PinP]", err);
    }
  }

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

  // ==========================================
  // 【追加】ユーザーの操作（アイドル状態）を監視
  // ==========================================
  let isUserActive = true;
  let activityTimeout = null;

  function resetActivity() {
    isUserActive = true;
    if (activityTimeout) clearTimeout(activityTimeout);
    // NetflixのUIが消える約2.5秒に合わせて非アクティブ化
    activityTimeout = setTimeout(() => {
      isUserActive = false;
    }, 2500);
  }

  // マウスやキーボードの動きを検知
  window.addEventListener("mousemove", resetActivity, { passive: true });
  window.addEventListener("mousedown", resetActivity, { passive: true });
  window.addEventListener("keydown", resetActivity, { passive: true });
  window.addEventListener("touchstart", resetActivity, { passive: true });
  window.addEventListener("wheel", resetActivity, { passive: true });
  resetActivity();
  // ==========================================

  let floatingBtn = null;

  function createFloatingButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "nf-pip-btn";
    
    const labelText = chrome.i18n ? chrome.i18n.getMessage("pip_title") || "ピクチャー イン ピクチャー" : "ピクチャー イン ピクチャー";
    btn.setAttribute("aria-label", labelText);
    btn.setAttribute("title", labelText);
    
    btn.innerHTML = PIP_ICON_SVG;
    
    // 【追加】自然にフワッと消えるようにアニメーションを追加
    btn.style.transition = "transform 0.1s ease, opacity 0.3s ease";
    
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePiP();
    });
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

        const anchorOpacity = getEffectiveOpacity(anchor);
        
        // 【変更】透明度が低い、またはユーザーが操作していない場合は確実に隠す
        if (anchorOpacity < 0.05 || !isUserActive) {
          floatingBtn.style.opacity = "0";
          floatingBtn.style.pointerEvents = "none";
        } else {
          floatingBtn.style.opacity = String(anchorOpacity);
          floatingBtn.style.pointerEvents = "auto";
        }
        return;
      }
    }

    // --- コントロールが見つからない場合のフォールバック ---
    
    // 【追加】ユーザーがマウスを動かしていない（アイドル状態）なら強制的に隠す
    if (!isUserActive) {
      floatingBtn.style.opacity = "0";
      floatingBtn.style.pointerEvents = "none";
      return;
    }

    // ここまで来たら表示（ユーザーがマウスを動かしているが、標準コントロールがない状態）
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

  setInterval(tick, 400);
  window.addEventListener("resize", positionFloatingButton);
  document.addEventListener("fullscreenchange", () => setTimeout(positionFloatingButton, 200));

  tick();
})();