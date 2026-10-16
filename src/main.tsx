import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { CleanStart } from "./components/CleanStart";
import { registerServiceWorker } from "./sw-update";
import { watchInstallPrompt } from "./pwa/platform";
import { detectStorageEviction, shouldShowCleanStart, type EvictionCheck } from "./pwa/eviction";
import { createDb } from "./db/dexie-schema";
import { getLocale } from "./i18n";
import { deviceLocale } from "./settings/store";
import "./index.css";

// Theme before paint: system preference by default, explicit choice wins.
const storedTheme = localStorage.getItem("pv-theme");
if (storedTheme === "dark") {
  document.documentElement.classList.add("dark");
} else if (storedTheme === "light") {
  document.documentElement.classList.add("light");
} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}

// Locale default = device locale, fallback ID.
const initialLocale = getLocale() === "en" ? "en" : deviceLocale();
document.documentElement.lang = initialLocale;

/**
 * iOS ITP gate (PRD §5 G11): if local storage was evicted while the app shell
 * survived, render the clean start instead of an empty/half vault.
 */
function Root() {
  const [eviction, setEviction] = useState<EvictionCheck | null>(null);

  useEffect(() => {
    let cancelled = false;
    const db = createDb();
    void detectStorageEviction(db)
      .then((check) => {
        if (!cancelled) setEviction(check);
      })
      .catch(() => {
        // Detection is best-effort: never block the app on it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (eviction && shouldShowCleanStart(eviction)) {
    return (
      <CleanStart
        wasEvicted={eviction.state === "evicted"}
        onRestoreFromKit={() => {
          window.location.assign("/?restore=recovery-kit");
        }}
        onPairDevice={() => {
          window.location.assign("/?pair=1");
        }}
        onCreateVault={() => {
          window.location.assign("/?create=1");
        }}
        onImportExport={() => {
          window.location.assign("/?import=1");
        }}
      />
    );
  }

  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

// PWA surface: install prompt capture + worker lifecycle (prod only).
watchInstallPrompt();
void registerServiceWorker({ enabled: import.meta.env.PROD });