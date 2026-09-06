(function () {
  // ==========================================
  // 【追加】スクリプトの二重起動を完全にブロック
  // ==========================================
  if (window.__nfPipInjected || document.documentElement.hasAttribute("data-nf-pip-injected")) return;
  window.__nfPipInjected = true;
  document.documentElement.setAttribute("data-nf-pip-injected", "1");

  const BTN_ID = "nf-pip-btn";
  const DEFAULT_SIZE = 32;
  const DEFAULT_GAP = 12;

  // 【追加】ページロード時に残っている古いボタンがあれば強制削除（ゴミ掃除）
  document.querySelectorAll("#" + BTN_ID).forEach(el => el.remove());

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

  let floatingBtn = null;

  // ==========================================
  // 【追加】表示/非表示のちらつき(点滅)防止用のヒステリシス
  // ==========================================
  // ネイティブのフルスクリーンボタン等の不透明度は、ホバーや内部の再描画で
  // 一瞬だけ揺れることがある。その揺れをそのまま反映すると点滅して見えるため、
  // 「同じ判定が連続して出たときだけ」実際の表示状態を切り替えるようにする。
  let visibleState = true; // 現在ボタンに実際に適用している表示状態
  let pendingVisible = true;
  let pendingStreak = 0;
  const STATE_CONFIRM_TICKS = 2; // tick間隔(400ms) x 2 = 800ms 安定したら確定

  function createFloatingButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.className = "nf-pip-btn";
    
    const labelText = chrome.i18n ? chrome.i18n.getMessage("pip_title") || "ピクチャー イン ピクチャー" : "ピクチャー イン ピクチャー";
    btn.setAttribute("aria-label", labelText);
    btn.setAttribute("title", labelText);
    
    btn.innerHTML = PIP_ICON_SVG;
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

        // 【変更】Netflix自身のコントロール(フルスクリーンボタン等)の実際の不透明度を基準にする。
        // ただし単発の値をそのまま反映すると瞬間的なブレで点滅するため、
        // 同じ判定が連続で出たときだけ表示状態を切り替える(ヒステリシス)。
        const anchorOpacity = getEffectiveOpacity(anchor);
        const wantVisible = anchorOpacity >= 0.05;

        if (wantVisible === pendingVisible) {
          pendingStreak++;
        } else {
          pendingVisible = wantVisible;
          pendingStreak = 1;
        }

        if (pendingStreak >= STATE_CONFIRM_TICKS) {
          visibleState = pendingVisible;
        }

        if (visibleState) {
          floatingBtn.style.opacity = "1";
          floatingBtn.style.pointerEvents = "auto";
        } else {
          floatingBtn.style.opacity = "0";
          floatingBtn.style.pointerEvents = "none";
        }
        return;
      }
    }

    // ==========================================
    // 【削除・変更】右下に強制表示するフォールバックを全削除しました
    // ==========================================
    // コントロールバーが見つからない場合は、ボタンも完全に非表示（display: none）にします。
    floatingBtn.style.display = "none";
  }

  function tick() {
    const video = getVideo();
    if (video) unlockPiP(video);

    // 【追加】何らかの理由でボタンが複数存在してしまった場合、1つだけ残して残りを削除する
    const existingButtons = document.querySelectorAll("#" + BTN_ID);
    if (existingButtons.length > 1) {
      existingButtons.forEach((el, i) => {
        if (i > 0) el.remove();
      });
    }

    // 【変更】ローカル変数を過信せず、常に実際のDOMから単一のボタンを取得する
    floatingBtn = document.getElementById(BTN_ID);
    if (!floatingBtn) {
      floatingBtn = createFloatingButton();
    }
    positionFloatingButton();
  }

  setInterval(tick, 400);
  window.addEventListener("resize", positionFloatingButton);
  document.addEventListener("fullscreenchange", () => setTimeout(positionFloatingButton, 200));

  tick();
})();