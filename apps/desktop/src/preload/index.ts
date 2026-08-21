import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("radius", {
  platform: process.platform,
});
