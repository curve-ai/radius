"use client";

import { LazyMotion } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

const loadMotionFeatures = () =>
  import("@/components/ui/motion-features").then((module) => module.default);

export default function AppProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <LazyMotion features={loadMotionFeatures} strict>
        {children}
        <Toaster />
      </LazyMotion>
    </ThemeProvider>
  );
}
