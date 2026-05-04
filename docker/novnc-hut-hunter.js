const isTouchLayout =
  window.matchMedia("(any-pointer: coarse)").matches ||
  (navigator.maxTouchPoints || 0) > 0;

function openControlBar() {
  const anchor = document.getElementById("noVNC_control_bar_anchor");
  const bar = document.getElementById("noVNC_control_bar");
  anchor?.classList.remove("noVNC_idle");
  bar?.classList.add("noVNC_open");
}

function openKeyboard() {
  openControlBar();
  const button = document.getElementById("noVNC_keyboard_button");
  const input = document.getElementById("noVNC_keyboardinput");
  if (!input) {
    return;
  }

  const focusInput = () => {
    input.focus();
    input.click?.();
    try {
      const length = input.value ? input.value.length : 0;
      input.setSelectionRange(length, length);
    } catch (_error) {
      // Some mobile browsers do not expose setSelectionRange here.
    }
  };

  button?.classList.add("noVNC_selected");
  focusInput();
  window.setTimeout(focusInput, 60);
  window.setTimeout(focusInput, 220);
  window.setTimeout(focusInput, 500);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "hh-open-keyboard") {
    openKeyboard();
  } else if (message.type === "hh-open-toolbar") {
    openControlBar();
  }
});

if (isTouchLayout) {
  const armMobileLayout = () => {
    openControlBar();
    window.setTimeout(openControlBar, 250);
    window.setTimeout(openControlBar, 1000);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", armMobileLayout, { once: true });
  } else {
    armMobileLayout();
  }
}
