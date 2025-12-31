// src/hooks/usePluginSettings.ts
// Custom hook for managing plugin settings

import { useState, useEffect, useCallback } from "react";
import { call } from "@decky/api";
import { PluginSettings, League, LeaguesResult } from "../lib/types";

// Default settings
const DEFAULT_SETTINGS: PluginSettings = {
  league: "Fate of the Vaal",
  useTradeApi: true,
  usePoe2Scout: true,
  autoCheckOnOpen: true,
  poesessid: "",
};

// Default leagues fallback
const DEFAULT_LEAGUES: League[] = [
  { id: "Fate of the Vaal", text: "Fate of the Vaal" },
  { id: "HC Fate of the Vaal", text: "HC Fate of the Vaal" },
  { id: "Standard", text: "Standard" },
  { id: "Hardcore", text: "Hardcore" },
];

interface UsePluginSettingsResult {
  settings: PluginSettings;
  leagues: League[];
  isLoading: boolean;
  error: string | null;
  updateSetting: <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => Promise<void>;
  reloadSettings: () => Promise<void>;
}

export function usePluginSettings(): UsePluginSettingsResult {
  const [settings, setSettings] = useState<PluginSettings>(DEFAULT_SETTINGS);
  const [leagues, setLeagues] = useState<League[]>(DEFAULT_LEAGUES);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const settingsResult = await call<[], PluginSettings>("get_settings");
      setSettings(settingsResult);

      // Try to load leagues
      try {
        const leaguesResult = await call<[], LeaguesResult>("get_available_leagues");
        if (leaguesResult.success && leaguesResult.leagues.length > 0) {
          setLeagues(leaguesResult.leagues);
        }
      } catch {
        // Keep default leagues on error
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(`Failed to load settings: ${errorMsg}`);
      console.error("Failed to load settings:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateSetting = useCallback(async <K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K]
  ): Promise<void> => {
    // Optimistic update
    setSettings((prev) => ({ ...prev, [key]: value }));

    try {
      await call<[Partial<PluginSettings>], unknown>("update_settings", { [key]: value });
    } catch (e) {
      // Revert on error
      console.error(`Failed to update setting ${key}:`, e);
      // Reload settings to get correct state
      await loadSettings();
    }
  }, [loadSettings]);

  return {
    settings,
    leagues,
    isLoading,
    error,
    updateSetting,
    reloadSettings: loadSettings,
  };
}

export default usePluginSettings;
