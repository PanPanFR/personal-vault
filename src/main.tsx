import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./hooks/useAuth";
import { registerServiceWorker } from "./sw-update";
import { watchInstallPrompt } from "./pwa/platform";
import { getLocale } from "./i18n";
import { applyTheme, readStoredTheme } from "./lib/theme";
import "./index.css";

// Theme before paint: the stored choice wins, otherwise the device decides.
applyTheme(readStoredTheme());

document.documentElement.lang = getLocale();

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
