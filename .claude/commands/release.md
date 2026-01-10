---
description: Build release zip, update version, commit and push to git
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
argument-hint: [patch|minor|major|x.y.z]
---

# Release Command

Create a new release of the PoE2 Price Checker plugin.

## Arguments

- `$ARGUMENTS` - Version bump type: `patch`, `minor`, `major`, or explicit version like `1.2.3`
- Default: `patch` if no argument provided

## Steps to Execute

1. **Read current version** from `package.json`

2. **Calculate new version** based on argument:
   - `patch`: 1.0.0 → 1.0.1
   - `minor`: 1.0.0 → 1.1.0
   - `major`: 1.0.0 → 2.0.0
   - `x.y.z`: Use exact version provided

3. **Update version** in `package.json`

4. **Build the project**: Run `pnpm run build`

5. **Create release zip**:
   ```bash
   rm -rf /tmp/poe2-zip-build
   mkdir -p /tmp/poe2-zip-build/poe2-price-checker
   cp plugin.json main.py package.json /tmp/poe2-zip-build/poe2-price-checker/
   cp -r dist backend data defaults /tmp/poe2-zip-build/poe2-price-checker/
   find /tmp/poe2-zip-build -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
   cd /tmp/poe2-zip-build && zip -r poe2-price-checker.zip poe2-price-checker
   mv /tmp/poe2-zip-build/poe2-price-checker.zip ./
   ```

6. **Git operations**:
   - `git add -A`
   - `git commit -m "Release v{VERSION}"`
   - `git push origin master`

7. **Report results**: Show the new version, zip file size, and git status

## Important

- Always verify the build succeeded before creating zip
- Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` in commit
- Report any errors clearly
