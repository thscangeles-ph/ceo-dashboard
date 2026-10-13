"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";

/** Builds and downloads a tab's PDF report; the PDF library loads on the first click. */
export function PdfButton({ make, label = "Download PDF" }: { make: () => Promise<void>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true); setError("");
    try { await make(); } catch (e) { setError(e instanceof Error ? e.message : "The report could not be made."); }
    setBusy(false);
  };
  return (
    <>
      <button type="button" className="btn btn-outline" onClick={() => void run()} disabled={busy}><FileDown size={16} />{busy ? "Making PDF…" : label}</button>
      {error && <span className="hint" role="alert">{error}</span>}
    </>
  );
}
