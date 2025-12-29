# PoE2 Price Checker - Decky Loader Plugin

A Steam Deck plugin for checking Path of Exile 2 item prices directly in Gaming Mode using poe2scout and the official Trade API.

## Features

- **Auto Price Check**: Automatically checks clipboard when you open the plugin
- **Smart Caching**: Shows cached prices instantly for previously scanned items
- **Tiered Search System**: Progressive search from exact match to base type for best price accuracy
- **Trade API Integration**: Search official PoE2 Trade API with real-time listings
- **poe2scout Prices**: Get aggregated price data for uniques and currency
- **Scan History**: View all previously scanned items with price dynamics over time
- **Modifier Filtering**: Toggle modifiers to refine price search
- **League Selection**: Choose your current league in settings

## Requirements

- Steam Deck with **Decky Loader** installed
- Path of Exile 2 set to **English language** (required for item parsing)
- Internet connection

## Installation

### Step 1: Install Decky Loader

If you don't have Decky Loader installed:

```bash
curl -L https://github.com/SteamDeckHomebrew/decky-installer/releases/latest/download/install_release.sh | sh
```

### Step 2: Install Required Tools

Connect to your Steam Deck via SSH or use Desktop Mode terminal:

```bash
sudo pacman -S xclip xsel wl-clipboard xdotool
```

### Step 3: Install the Plugin

#### Option A: Install via Decky Developer Mode (Easiest)

1. Download [`poe2-price-checker.zip`](https://github.com/ikrasnodymov/poe2-price-checker/raw/main/poe2-price-checker.zip)
2. Copy the ZIP file to your Steam Deck (USB drive, cloud, or network transfer)
3. On Steam Deck, open **Decky Loader** (... button → Decky)
4. Go to **Settings** (gear icon) → **Developer**
5. Enable **Developer Mode**
6. Click **Install Plugin from ZIP**
7. Select the downloaded `poe2-price-checker.zip`
8. Done! The plugin will appear in your Decky menu

#### Option B: Manual Install via SSH

1. Download `poe2-price-checker.zip` from the link above
2. Copy to Steam Deck and extract:
   ```bash
   sudo unzip poe2-price-checker.zip -d ~/homebrew/plugins/
   sudo chown -R deck:deck ~/homebrew/plugins/poe2-price-checker
   sudo systemctl restart plugin_loader
   ```

#### Option C: Build from Source

```bash
# Clone repository
git clone https://github.com/ikrasnodymov/poe2-price-checker.git
cd poe2-price-checker

# Install dependencies and build
pnpm install
pnpm run build

# Deploy to Steam Deck (replace IP)
scp -r . deck@STEAMDECK_IP:/tmp/poe2-price-checker
ssh deck@STEAMDECK_IP "sudo cp -r /tmp/poe2-price-checker ~/homebrew/plugins/ && sudo systemctl restart plugin_loader"
```

## Usage

### 1. Set PoE2 to English

**Important!** The plugin only works with English item text.

- In PoE2: **Options → UI → Language → English**
- Restart the game

### 2. Quick Price Check (Recommended)

1. Hover over any item in Path of Exile 2
2. Press **Ctrl+C** to copy the item
3. Press **Steam button (...)** to open Quick Access Menu
4. Go to **Decky Loader → PoE2 Price Checker**
5. **Price appears automatically!**

### 3. Pro Tip: Configure Back Button

For even faster price checks, configure a back button (L4 or R4) to send Ctrl+C:

1. Open Steam → Controller Settings
2. Edit the PoE2 controller layout
3. Assign **L4** or **R4** to **Ctrl+C**

Now you can: Hover item → Press L4 → Open Decky → See price!

### 4. View Results

- See price estimates from poe.ninja (for uniques/currency)
- See Trade API listings with actual prices
- Toggle modifiers on/off to refine your search

## Settings

| Setting | Description |
|---------|-------------|
| **League** | Select your current league (e.g., "Fate of the Vaal") |
| **Use Trade API** | Enable/disable official Trade API searches |
| **Use poe2scout** | Enable/disable poe2scout price lookups for uniques/currency |
| **Auto-check on open** | Automatically check clipboard when plugin opens |
| **POESESSID** | Optional: Your session ID for authenticated requests |

## Troubleshooting

### "No clipboard tool available"

Install the required clipboard tools:
```bash
sudo pacman -S xclip xsel wl-clipboard
```

### "Clipboard does not contain PoE2 item data"

- Make sure you hover over an item and press Ctrl+C
- Verify PoE2 is set to **English language**
- Try copying the item again

### "Unknown item type"

This error appears for:
- Currency items and fragments
- Quest items
- Non-tradeable items

These items cannot be searched via Trade API.

### "Rate limited"

The Trade API has rate limits. Wait 2-3 seconds and try again.

### Plugin not appearing in Decky

1. Check Decky Loader status:
   ```bash
   systemctl status plugin_loader
   ```

2. Restart Decky:
   ```bash
   sudo systemctl restart plugin_loader
   ```

3. Check plugin logs:
   ```bash
   cat ~/homebrew/logs/poe2-price-checker/*.log
   ```

### Debug Info

Click **"Show Debug Info"** in Settings to see:
- Available clipboard tools
- Environment variables
- Current clipboard content

## Technical Architecture

```
┌─────────────────────────────────────────────────────┐
│  PoE2 Game                                          │
│  Ctrl+C copies item text to clipboard               │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  Clipboard (xclip)                                  │
│  DISPLAY=:0 (XWayland in Gaming Mode)              │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  Python Backend (main.py)                           │
│  - Reads clipboard via subprocess                   │
│  - Tiered search: exact → your item → similar → base│
│  - Calls poe2scout API for uniques/currency        │
│  - Calls Trade API for rares/magic                 │
│  - Scan history with price dynamics                │
│  - Smart caching for instant results               │
└──────────────────────┬──────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────┐
│  React Frontend (index.tsx)                         │
│  - Auto-checks clipboard on open                   │
│  - Cache-first: shows cached prices instantly      │
│  - Parses item text (English only)                 │
│  - Displays tiered search results                  │
│  - Scan history with rescan option                 │
└─────────────────────────────────────────────────────┘
```

## API Endpoints

| API | Endpoint | Purpose |
|-----|----------|---------|
| poe2scout | `https://poe2scout.com/api/items` | Unique/currency prices |
| Trade Search | `https://www.pathofexile.com/api/trade2/search/poe2/{league}` | Find items |
| Trade Fetch | `https://www.pathofexile.com/api/trade2/fetch/{ids}` | Get listings |

## File Structure

```
poe2-price-checker/
├── src/
│   ├── index.tsx              # Main plugin UI (auto-check, price display)
│   ├── lib/
│   │   ├── itemParser.ts      # PoE2 item text parser
│   │   └── types.ts           # TypeScript definitions
│   └── utils/
│       └── modifierMatcher.ts # Modifier matching utilities
├── main.py                    # Python backend
├── plugin.json                # Plugin metadata
├── package.json               # Node dependencies
├── rollup.config.js           # Build configuration
└── README.md
```

## Known Limitations

- **English only**: Item parsing requires English game client
- **Rate limits**: Trade API allows ~1 request per 1.5 seconds
- **Currency**: Some currency items not searchable via Trade API
- **Steam Deck only**: Designed for Decky Loader on Steam Deck
- **No hotkey overlay**: Steam Deck API doesn't allow custom hotkeys for plugins

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Credits

- [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) - Plugin framework
- [poe2scout](https://poe2scout.com) - Price data for uniques and currency
- [Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) - Parser reference
- [Path of Exile 2](https://pathofexile.com) - Trade API

## Disclaimer

This plugin is not affiliated with or endorsed by Grinding Gear Games. Path of Exile is a registered trademark of Grinding Gear Games. Use at your own risk.
