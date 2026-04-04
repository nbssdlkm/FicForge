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
