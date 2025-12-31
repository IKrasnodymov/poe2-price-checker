// src/components/SettingsPanel.tsx
// Settings panel component

import { FC, useState, useEffect } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  DropdownItem,
  ToggleField,
  TextField,
  Spinner,
} from "@decky/ui";
import { call } from "@decky/api";
import { FaArrowLeft, FaClipboard } from "react-icons/fa";
import { PluginSettings, League, LeaguesResult } from "../lib/types";
import { LOADING_CONTAINER, DEBUG_STYLES } from "../styles/constants";

interface SettingsPanelProps {
  onBack: () => void;
}

// Default leagues fallback
const DEFAULT_LEAGUES: League[] = [
  { id: "Fate of the Vaal", text: "Fate of the Vaal" },
  { id: "HC Fate of the Vaal", text: "HC Fate of the Vaal" },
  { id: "Standard", text: "Standard" },
  { id: "Hardcore", text: "Hardcore" },
];

export const SettingsPanel: FC<SettingsPanelProps> = ({ onBack }) => {
  const [settings, setSettings] = useState<PluginSettings>({
    league: "Fate of the Vaal",
    useTradeApi: true,
    usePoe2Scout: true,
    autoCheckOnOpen: true,
    poesessid: "",
  });
  const [leagues, setLeagues] = useState<League[]>(DEFAULT_LEAGUES);
  const [isLoading, setIsLoading] = useState(true);
  const [debugInfo, setDebugInfo] = useState<string>("");
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const settingsResult = await call<[], PluginSettings>("get_settings");
      setSettings(settingsResult);

      try {
        const leaguesResult = await call<[], LeaguesResult>("get_available_leagues");
        if (leaguesResult.success && leaguesResult.leagues.length > 0) {
          setLeagues(leaguesResult.leagues);
        }
      } catch {
        // Keep default leagues
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
      setDebugInfo(`Settings error: ${e}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadDebugInfo = async () => {
    try {
      const [logsResult, clipboardTest, currencyRates, debugListings] = await Promise.all([
        call<[number], { success: boolean; logs: string; path: string }>("get_logs", 30),
        call<[], Record<string, unknown>>("test_clipboard"),
        call<[], { success: boolean; rates: Record<string, number> }>("get_currency_rates"),
        call<[], { success: boolean; listings: Array<{ amount: number; currency: string; account: string }> }>("get_debug_listings"),
      ]);

      let info = "=== CURRENCY RATES (from poe2scout) ===\n";
      if (currencyRates?.rates) {
        const rates = currencyRates.rates;
        info += `  1 divine = ${rates["divine"]?.toFixed(2) || "?"} chaos\n`;
        info += `  1 exalted = ${rates["exalted"]?.toFixed(3) || "?"} chaos\n`;
        info += `  1 regal = ${rates["regal"]?.toFixed(2) || "?"} chaos\n`;
      } else {
        info += "  (not loaded)\n";
      }

      info += "\n=== LAST TRADE LISTINGS (first 3) ===\n";
      if (debugListings?.listings && debugListings.listings.length > 0) {
        debugListings.listings.slice(0, 3).forEach((listing, i) => {
          info += `  ${i + 1}. ${listing.amount} ${listing.currency} (${listing.account})\n`;
        });
      } else {
        info += "  (no listings yet - search for an item)\n";
      }

      info += "\n=== CLIPBOARD TEST ===\n";
      info += JSON.stringify(clipboardTest, null, 2);
      info += "\n\n=== RECENT LOGS ===\n";
      info += logsResult.logs || "No logs";
      info += `\n\nLog path: ${logsResult.path}`;

      setDebugInfo(info);
    } catch (e) {
      setDebugInfo(`Debug error: ${e}`);
    }
  };

  const updateSetting = async <K extends keyof PluginSettings>(
    key: K,
    value: PluginSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await call<[Partial<PluginSettings>], unknown>("update_settings", { [key]: value });
  };

  if (isLoading) {
    return (
      <PanelSection title="Settings">
        <PanelSectionRow>
          <div style={LOADING_CONTAINER}>
            <Spinner />
            <span>Loading...</span>
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onBack}>
            <FaArrowLeft style={{ marginRight: 8 }} />
            Back to Price Check
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="League">
        <PanelSectionRow>
          <DropdownItem
            label="Active League"
            rgOptions={leagues.map((l) => ({
              data: l.id,
              label: l.text,
            }))}
            selectedOption={settings.league}
            onChange={(option) => updateSetting("league", option.data as string)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Data Sources">
        <PanelSectionRow>
          <ToggleField
            label="Use poe2scout"
            description="For unique items and currency prices"
            checked={settings.usePoe2Scout}
            onChange={(v) => updateSetting("usePoe2Scout", v)}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <ToggleField
            label="Use Trade API"
            description="For rare/magic item searches"
            checked={settings.useTradeApi}
            onChange={(v) => updateSetting("useTradeApi", v)}
          />
        </PanelSectionRow>

        <PanelSectionRow>
          <ToggleField
            label="Auto-check on open"
            description="Automatically check clipboard when plugin opens"
            checked={settings.autoCheckOnOpen}
            onChange={(v) => updateSetting("autoCheckOnOpen", v)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Authentication (Optional)">
        <PanelSectionRow>
          <TextField
            label="POESESSID"
            description="For accessing private listings (optional)"
            value={settings.poesessid}
            onChange={(e) => updateSetting("poesessid", e.target.value)}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="How to Use">
        <PanelSectionRow>
          <div style={{ padding: 8, fontSize: 11, color: "#888" }}>
            1. Hover cursor on item in PoE2
            <br />
            2. Press Ctrl+C (copy)
            <br />
            3. Open Decky (...) → price appears automatically
            <br />
            <br />
            <span style={{ color: "#0ff" }}>
              Tip: Map back button (L4/R4) to Ctrl+C in Steam Input
            </span>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Debug">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={() => {
              if (!showDebug) {
                loadDebugInfo();
              }
              setShowDebug(!showDebug);
            }}
          >
            {showDebug ? "Hide Debug Info" : "Show Debug Info"}
          </ButtonItem>
        </PanelSectionRow>

        {showDebug && (
          <>
            <PanelSectionRow>
              <ButtonItem
                layout="below"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(debugInfo);
                  } catch {
                    // Fallback: call backend to copy
                    await call<[string], void>("copy_to_clipboard", debugInfo);
                  }
                }}
              >
                <FaClipboard style={{ marginRight: 8 }} />
                Copy Debug Info
              </ButtonItem>
            </PanelSectionRow>
            <PanelSectionRow>
              <div style={DEBUG_STYLES}>
                {debugInfo || "Loading..."}
              </div>
            </PanelSectionRow>
          </>
        )}
      </PanelSection>
    </>
  );
};

export default SettingsPanel;
