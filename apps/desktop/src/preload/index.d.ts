import type { RadiusApi } from "../radius-api";

export {};

declare global {
  interface Window {
    radius: RadiusApi;
  }
}
