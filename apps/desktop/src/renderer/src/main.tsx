import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, type FeatureBundle } from "motion/react";

import { App } from "@renderer/app/app";
import { initializeTheme } from "@renderer/lib/theme";
import "../app/globals.css";
import "./index.css";

const root = document.getElementById("root");
const loadMotionFeatures = (): Promise<FeatureBundle> =>
  import("@renderer/components/ui/motion-features").then(
    (module) => module.default,
  );

if (!root) {
  throw new Error("Radius could not find its renderer root.");
}

document.documentElement.dataset.platform = window.radius.platform;
void window.radius.setNativeTheme(initializeTheme());

createRoot(root).render(
  <StrictMode>
    <LazyMotion features={loadMotionFeatures} strict>
      <App />
    </LazyMotion>
  </StrictMode>,
);
