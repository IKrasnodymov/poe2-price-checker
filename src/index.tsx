// src/index.tsx - PoE2 Price Checker Decky Plugin
// Main plugin entry point

import { definePlugin, staticClasses } from "@decky/ui";
import { FaCoins } from "react-icons/fa";

import { ErrorBoundary, PriceCheckContent } from "./components";

// Re-export types for compatibility with existing code that might import from here
export * from "./lib/types";

// =========================================================================
// PLUGIN DEFINITION
// =========================================================================

export default definePlugin(() => {
  return {
    name: "PoE2 Price Checker",
    titleView: (
      <div className={staticClasses.Title}>PoE2 Price Checker</div>
    ),
    content: (
      <ErrorBoundary>
        <PriceCheckContent />
      </ErrorBoundary>
    ),
    icon: <FaCoins />,
    onDismount: () => {
      // Cleanup if needed
    },
  };
});
