import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "HEOR Provenance Agent",
  description:
    "Drafts pharma HEOR value-dossier sections from real evidence, then makes every claim independently verifiable.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
