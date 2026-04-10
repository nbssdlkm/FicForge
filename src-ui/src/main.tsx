// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

// gray-matter 依赖 Node.js Buffer — 用极轻量 shim 替代完整 polyfill（省 1.3MB）
if (typeof (globalThis as Record<string, unknown>).Buffer === "undefined") {
  const encoder = new TextEncoder();
  const BufferShim = {
    isBuffer: (_v: unknown) => false,
    from: (input: string | Uint8Array, encoding?: string) => {
      if (typeof input === "string") {
        if (encoding === "base64") {
          const binary = atob(input);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          return bytes;
        }
        return encoder.encode(input);
      }
      return input;
    },
    alloc: (size: number) => new Uint8Array(size),
  };
  (globalThis as Record<string, unknown>).Buffer = BufferShim;
}

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { ContextMenuProvider } from "./ui/shared/ContextMenu";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ContextMenuProvider>
      <App />
    </ContextMenuProvider>
  </React.StrictMode>,
);
