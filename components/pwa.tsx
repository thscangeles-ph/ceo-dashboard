"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Registers the service worker that makes the app installable and usable offline (production builds only). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * "Install app" button. Android and desktop Chrome/Edge show the browser's install prompt;
 * iPhone and iPad (which have no prompt) get Add to Home Screen instructions instead.
 * Hidden once the app is installed or when the browser cannot install it.
 */
export function InstallAppButton() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const onInstalled = () => setPrompt(null);
    const detect = setTimeout(() => setIos(isIos() && !isStandalone()), 0);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { clearTimeout(detect); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (!prompt && !ios) return null;
  const install = async () => {
    if (!prompt) { setShowTip(true); return; }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => void install()} aria-label="Install app"><Download size={16} /><span className="hide-sm">Install app</span></button>
      {showTip && (
        <div role="dialog" aria-label="Install on iPhone or iPad" className="install-tip">
          <div className="install-tip-head">
            <strong>Install on iPhone or iPad</strong>
            <button type="button" onClick={() => setShowTip(false)} aria-label="Close" className="icon-btn"><X size={18} /></button>
          </div>
          <ol>
            <li>In Safari, tap the <Share size={15} className="inline-icon" /> <strong>Share</strong> button.</li>
            <li>Tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>. The CEO Dashboard opens from your home screen, full screen.</li>
          </ol>
        </div>
      )}
    </>
  );
}
