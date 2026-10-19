import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { registerServiceWorker } from "./sw-update";
import { watchInstallPrompt } from "./pwa/platform";
import { getLocale } from "./i18n";
import type { Locale } from "./i18n/keys";
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

// Locale default = stored choice, else device locale (Indonesian devices → id).
function deviceLocale(): Locale {
  try {
    return navigator.language.toLowerCase().startsWith("id") ? "id" : "en";
  } catch {
    return "en";
  }
}
const initialLocale = getLocale() === "en" ? deviceLocale() : getLocale();
document.documentElement.lang = initialLocale;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>,
);

// PWA surface: install prompt capture + worker lifecycle (prod only).
watchInstallPrompt();
void registerServiceWorker({ enabled: import.meta.env.PROD });
