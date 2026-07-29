import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";
import { applyTheme, getInitialTheme } from "./lib/theme.js";

// apply before first paint so there's no flash of the wrong theme
applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
