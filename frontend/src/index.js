import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// Suppress known cosmetic Recharts warning when chart parent is briefly 0×0
// during route transitions / collapsed tabs. Pre-existing P3 issue, no functional impact.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  const _origWarn = console.warn;
  console.warn = (...args) => {
    const msg = String(args[0] || "");
    if (msg.includes("The width") && msg.includes("of chart") && msg.includes("0")) return;
    if (msg.includes("width(-1)") || msg.includes("height(-1)")) return;
    _origWarn.apply(console, args);
  };

  // Browsers may emit this harmless observer delivery warning while a Radix
  // menu/popover is measuring itself during a layout transition. In the CRA
  // development overlay it is presented as a runtime failure even though the
  // interaction completes successfully.
  window.addEventListener("error", (event) => {
    const message = String(event?.message || "");
    if (message.includes("ResizeObserver loop completed with undelivered notifications") || message.includes("ResizeObserver loop limit exceeded")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
