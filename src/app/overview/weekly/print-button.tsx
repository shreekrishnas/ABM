"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog; "Save as PDF" there gives the PDF to send on. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-brand btn-sm no-print" onClick={() => window.print()}>
      <Printer size={14} aria-hidden /> Print or save as PDF
    </button>
  );
}
