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
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
