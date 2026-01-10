---
description: Build and deploy to Steam Deck via SSH for testing
allowed-tools: Bash, Read, Write, Edit
---

# Deploy to Steam Deck

Build the project and deploy to Steam Deck via SSH for testing.

## Steam Deck Connection

- **Host:** 192.168.0.113
- **User:** deck
- **Password:** 422755
- **Plugin path:** ~/homebrew/plugins/poe2-price-checker/

## Steps to Execute

1. **Build the project**: Run `pnpm run build`

2. **Copy files to Steam Deck**:
   ```bash
   scp dist/index.js main.py deck@192.168.0.113:/tmp/
   ```

3. **Install files and restart plugin_loader**:
   ```bash
   ssh deck@192.168.0.113 "echo '422755' | sudo -S cp /tmp/index.js ~/homebrew/plugins/poe2-price-checker/dist/ && echo '422755' | sudo -S cp /tmp/main.py ~/homebrew/plugins/poe2-price-checker/ && echo '422755' | sudo -S systemctl restart plugin_loader"
   ```

4. **Verify installation**: Check file timestamps and show recent logs
   ```bash
   ssh deck@192.168.0.113 "ls -la ~/homebrew/plugins/poe2-price-checker/dist/index.js ~/homebrew/plugins/poe2-price-checker/main.py"
   ```

5. **Show recent logs** (optional):
   ```bash
   ssh deck@192.168.0.113 "cat ~/homebrew/logs/poe2-price-checker/*.log 2>/dev/null | tail -20"
   ```

## Important

- Ensure Steam Deck is on the same network (192.168.0.x)
- Steam Deck must be in Desktop Mode or have SSH enabled
- Report success with file sizes and timestamps
