"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, MoreVertical, Share, SquarePlus, X } from "lucide-react";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/*
 * Chrome, Edge and Android fire "beforeinstallprompt" once, early, often before the sign-in screen or the
 * dashboard header is on screen. It is caught here, when this module first loads (the layout imports it
 * on every page), so the Install app button can use it whenever it appears.
 */
let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferred = event as InstallPromptEvent; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; installed = true; notify(); });
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const usePrompt = () => useSyncExternalStore(subscribe, () => deferred, () => null);
const useInstalled = () => useSyncExternalStore(subscribe, () => installed, () => false);

/** Registers the service worker that makes the app installable and usable offline (production builds only). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}

type Platform = "ios" | "android" | "mac-safari" | "firefox" | "desktop";
function detect(): { platform: Platform; standalone: boolean } {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const platform: Platform = ios ? "ios" : /Android/i.test(ua) ? "android" : /Firefox\//.test(ua) ? "firefox"
    : /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua) ? "mac-safari" : "desktop";
  return { platform, standalone };
}

const STEPS: Record<Platform, { title: string; steps: React.ReactNode[] }> = {
  ios: { title: "Install on iPhone or iPad", steps: [
    <>Open this page in <strong>Safari</strong> (or Chrome on iOS 16.4 and later).</>,
    <>Tap the <Share size={15} className="inline-icon" /> <strong>Share</strong> button.</>,
    <>Scroll down and tap <strong>Add to Home Screen</strong> <SquarePlus size={15} className="inline-icon" />, then <strong>Add</strong>.</>,
  ] },
  android: { title: "Install on Android", steps: [
    <>Open this page in <strong>Chrome</strong>.</>,
    <>Tap the <MoreVertical size={15} className="inline-icon" /> menu at the top right.</>,
    <>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then <strong>Install</strong>.</>,
  ] },
  "mac-safari": { title: "Install on a Mac (Safari)", steps: [
    <>In the menu bar, choose <strong>File → Add to Dock</strong> (Safari 17 or later).</>,
    <>Click <strong>Add</strong>. The app opens from the Dock in its own window.</>,
    <>Or open this page in <strong>Chrome</strong> or <strong>Edge</strong> and use their Install button.</>,
  ] },
  firefox: { title: "Install on this computer", steps: [
    <>Firefox can&apos;t install web apps. Open this page in <strong>Chrome</strong> or <strong>Microsoft Edge</strong>.</>,
    <>Click the install icon at the right end of the address bar, or this <strong>Install app</strong> button.</>,
    <>Click <strong>Install</strong>. The app opens in its own window and gets a desktop / Start menu icon.</>,
  ] },
  desktop: { title: "Install on this computer", steps: [
    <><strong>Chrome:</strong> click the install icon at the right end of the address bar, or the <MoreVertical size={15} className="inline-icon" /> menu → <strong>Cast, save and share → Install page as app</strong>.</>,
    <><strong>Edge:</strong> the <strong>…</strong> menu → <strong>Apps → Install this site as an app</strong>.</>,
    <>Click <strong>Install</strong>. The app gets its own window and a desktop / Start menu icon.</>,
  ] },
};

/**
 * "Install app" button, shown everywhere except inside the installed app. Where the browser can install
 * directly (Chrome, Edge, Android) it opens the browser's install prompt; elsewhere it shows the steps for
 * this device (Safari on iPhone, iPad and Mac, Firefox, or a browser that already used its prompt).
 */
export function InstallAppButton({ label = "Install app", variant = "ghost" }: { label?: string; variant?: "ghost" | "outline" }) {
  const prompt = usePrompt();
  const done = useInstalled();
  const [info, setInfo] = useState<{ platform: Platform; standalone: boolean } | null>(null);
  const [showTip, setShowTip] = useState(false);
  useEffect(() => { const t = setTimeout(() => setInfo(detect()), 0); return () => clearTimeout(t); }, []);

  if (!info || info.standalone || done) return null;
  const install = async () => {
    if (!prompt) { setShowTip(true); return; }
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    deferred = null; notify(); // a prompt can be used only once
    if (outcome === "dismissed") setShowTip(false);
  };
  const help = STEPS[info.platform];

  return (
    <>
      <button type="button" className={`btn btn-${variant}`} onClick={() => void install()} aria-label="Install app"><Download size={16} /><span className={variant === "ghost" ? "hide-sm" : undefined}>{label}</span></button>
      {showTip && (
        <div className="install-overlay" onClick={() => setShowTip(false)}>
          <div role="dialog" aria-modal="true" aria-label={help.title} className="install-tip" onClick={(e) => e.stopPropagation()}>
            <div className="install-tip-head">
              <strong>{help.title}</strong>
              <button type="button" onClick={() => setShowTip(false)} aria-label="Close" className="icon-btn"><X size={18} /></button>
            </div>
            <ol>{help.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
            <p className="install-note">Once installed, the Summary Dashboard opens from your home screen, Dock or Start menu in its own window, and stays signed in.</p>
          </div>
        </div>
      )}
    </>
  );
}
