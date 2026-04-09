/**
 * Preview PIN gate.
 *
 * Soft barrier for the prototype -- not a security mechanism. Stores auth
 * in sessionStorage so it only asks once per browser tab. The PIN is
 * hardcoded because this is a preview gate, not access control.
 */
const STORAGE_KEY = "undrr_preview_auth";
const CORRECT_PIN = "5498";

const gate = document.getElementById("pin-gate");
const input = document.getElementById("pin-input");
const errorMsg = document.getElementById("pin-error");

function unlock() {
  sessionStorage.setItem(STORAGE_KEY, "1");
  gate.classList.add("pin-gate--unlocking");
  gate.addEventListener("animationend", () => gate.remove(), { once: true });
}

function attempt() {
  if (input.value === CORRECT_PIN) {
    unlock();
  } else {
    errorMsg.hidden = false;
    input.value = "";
    input.setAttribute("aria-invalid", "true");
    input.focus();
    // Clear the shake animation after it plays (matches CSS animation duration)
    setTimeout(() => input.removeAttribute("aria-invalid"), 1200);
  }
}

if (sessionStorage.getItem(STORAGE_KEY) === "1") {
  gate.remove();
} else {
  input.addEventListener("input", () => {
    errorMsg.hidden = true;
    if (input.value.length === 4) attempt();
  });
  input.focus();
}
