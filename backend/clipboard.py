# backend/clipboard.py
# Clipboard operations for Steam Deck / Linux
#
# NOTE: This module is designed for use within Decky Loader.
# The `decky` module must be imported inside methods, not at module level.

import asyncio
import os
import shutil
from typing import Dict, Any, Callable, Optional


class ClipboardManager:
    """
    Manages clipboard operations for Steam Deck / Linux environment.

    Handles:
    - Reading from clipboard using wl-paste, xclip, xsel
    - Writing to clipboard using xclip
    - Simulating Ctrl+C via xdotool, ydotool, wtype
    - Pasting to game chat via keyboard simulation
    """

    # Environment variables for Steam Deck Gaming Mode
    DEFAULT_ENV = {
        "DISPLAY": ":0",              # XWayland display
        "XDG_RUNTIME_DIR": "/run/user/1000",  # deck user runtime
        "WAYLAND_DISPLAY": "wayland-1"
    }

    def __init__(self, logger: Optional[Callable[[str], None]] = None):
        """
        Initialize clipboard manager.

        Args:
            logger: Optional logging function (e.g., decky.logger.info)
        """
        self._logger = logger

    def _log(self, message: str, level: str = "info") -> None:
        """Log a message if logger is available"""
        if self._logger:
            self._logger(f"[Clipboard] {message}")

    def _get_env(self) -> Dict[str, str]:
        """Get environment variables for subprocess calls"""
        env = os.environ.copy()
        for key, value in self.DEFAULT_ENV.items():
            if key not in env:
                env[key] = value
        return env

    # =========================================================================
    # ITEM VALIDATION
    # =========================================================================

    @staticmethod
    def is_poe_item(text: str) -> bool:
        """
        Check if text appears to be a PoE2 item.

        PoE items typically have:
        - "Item Class:" or "Rarity:" in the first few lines
        - Section separators (---------)
        """
        if not text:
            return False

        lines = text.strip().split("\n")
        if len(lines) < 3:
            return False

        first_lines = "\n".join(lines[:5]).lower()
        return (
            "item class:" in first_lines or
            "rarity:" in first_lines or
            "--------" in text
        )

    # =========================================================================
    # READ OPERATIONS
    # =========================================================================

    async def read_clipboard(self) -> Dict[str, Any]:
        """
        Read item text from clipboard using multiple methods.
        Tries wl-paste, xclip, xsel in order.

        Returns:
            {success: bool, text?: str, error?: str}
        """
        self._log("Reading clipboard...")

        clipboard_tools = [
            ["wl-paste", "-n"],
            ["xclip", "-selection", "clipboard", "-o"],
            ["xsel", "--clipboard", "--output"],
        ]

        last_error = "No clipboard tool available"
        env = self._get_env()

        for tool_cmd in clipboard_tools:
            try:
                self._log(f"Trying {tool_cmd[0]}")

                proc = await asyncio.create_subprocess_exec(
                    *tool_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )

                try:
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(),
                        timeout=5.0
                    )
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                    last_error = "Clipboard read timed out"
                    self._log(f"Timeout with {tool_cmd[0]}")
                    continue

                if proc.returncode == 0:
                    clipboard_text = stdout.decode("utf-8", errors="replace")

                    if self.is_poe_item(clipboard_text):
                        self._log(f"Read PoE item ({len(clipboard_text)} chars)")
                        return {
                            "success": True,
                            "text": clipboard_text,
                            "error": None
                        }
                    else:
                        return {
                            "success": False,
                            "text": clipboard_text[:100] if clipboard_text else None,
                            "error": "Clipboard does not contain PoE2 item data. Hover over an item in PoE2 and press Ctrl+C."
                        }
                else:
                    stderr_text = stderr.decode("utf-8", errors="replace").strip()
                    last_error = stderr_text if stderr_text else f"{tool_cmd[0]} failed"
                    self._log(f"{tool_cmd[0]} failed: {last_error}")
                    continue

            except FileNotFoundError:
                self._log(f"{tool_cmd[0]} not found")
                continue
            except Exception as e:
                last_error = str(e)
                self._log(f"Error with {tool_cmd[0]}: {e}")
                continue

        return {
            "success": False,
            "text": None,
            "error": f"Could not read clipboard: {last_error}"
        }

    # =========================================================================
    # WRITE OPERATIONS
    # =========================================================================

    async def copy_to_clipboard(self, text: str) -> Dict[str, Any]:
        """
        Copy text to clipboard using xclip.

        Args:
            text: Text to copy

        Returns:
            {success: bool, error?: str}
        """
        self._log(f"Copying to clipboard ({len(text)} chars)")

        try:
            env = self._get_env()

            proc = await asyncio.create_subprocess_exec(
                "xclip", "-selection", "clipboard",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await proc.communicate(input=text.encode("utf-8"))

            if proc.returncode == 0:
                return {"success": True}

            return {"success": False, "error": "xclip failed"}
        except FileNotFoundError:
            return {"success": False, "error": "xclip not found. Install: sudo pacman -S xclip"}
        except Exception as e:
            self._log(f"Copy error: {e}")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # KEYBOARD SIMULATION
    # =========================================================================

    async def simulate_copy(self) -> Dict[str, Any]:
        """
        Simulate Ctrl+C keypress to copy item from game.
        Tries ydotool (Wayland), xdotool (X11), wtype (Wayland native) in order.

        Returns:
            {success: bool, method?: str, error?: str}
        """
        self._log("Simulating Ctrl+C")
        env = self._get_env()

        # Try ydotool (Wayland / Steam Deck)
        try:
            self._log("Trying ydotool")
            proc = await asyncio.create_subprocess_exec(
                "ydotool", "key", "29:1", "46:1", "46:0", "29:0",  # Ctrl+C keycodes
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

            if proc.returncode == 0:
                await asyncio.sleep(0.2)  # Wait for clipboard update
                self._log("ydotool successful")
                return {"success": True, "method": "ydotool"}
            else:
                self._log(f"ydotool failed: {stderr.decode()}")
        except FileNotFoundError:
            self._log("ydotool not found")
        except asyncio.TimeoutError:
            self._log("ydotool timed out")
        except Exception as e:
            self._log(f"ydotool error: {e}")

        # Try xdotool (X11 / XWayland)
        try:
            self._log("Trying xdotool")
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "key", "ctrl+c",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

            if proc.returncode == 0:
                await asyncio.sleep(0.2)
                self._log("xdotool successful")
                return {"success": True, "method": "xdotool"}
            else:
                self._log(f"xdotool failed: {stderr.decode()}")
        except FileNotFoundError:
            self._log("xdotool not found")
        except asyncio.TimeoutError:
            self._log("xdotool timed out")
        except Exception as e:
            self._log(f"xdotool error: {e}")

        # Try wtype (Wayland native)
        try:
            self._log("Trying wtype")
            proc = await asyncio.create_subprocess_exec(
                "wtype", "-M", "ctrl", "-P", "c", "-p", "c", "-m", "ctrl",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=3.0)

            if proc.returncode == 0:
                await asyncio.sleep(0.2)
                self._log("wtype successful")
                return {"success": True, "method": "wtype"}
            else:
                self._log(f"wtype failed: {stderr.decode()}")
        except FileNotFoundError:
            self._log("wtype not found")
        except asyncio.TimeoutError:
            self._log("wtype timed out")
        except Exception as e:
            self._log(f"wtype error: {e}")

        return {
            "success": False,
            "error": "No tool available to simulate Ctrl+C. Install: sudo pacman -S ydotool"
        }

    async def paste_to_game_chat(self, text: str, send: bool = False) -> Dict[str, Any]:
        """
        Paste text into game chat.

        Process:
        1. Copy text to clipboard
        2. Wait for Decky menu to close
        3. Simulate Enter (open chat)
        4. Simulate Ctrl+V (paste)
        5. Optionally simulate Enter (send)

        Args:
            text: Text to paste
            send: Whether to send the message (press Enter again)

        Returns:
            {success: bool, error?: str}
        """
        self._log(f"Pasting to game chat: {text[:50]}...")
        env = self._get_env()

        try:
            # Step 1: Copy to clipboard
            proc = await asyncio.create_subprocess_exec(
                "xclip", "-selection", "clipboard",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await proc.communicate(input=text.encode("utf-8"))

            if proc.returncode != 0:
                return {"success": False, "error": "Failed to copy to clipboard"}

            self._log("Text copied to clipboard")

            # Step 2: Wait for Decky menu to close
            await asyncio.sleep(0.5)

            # Step 3: Open chat (Enter)
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "key", "Return",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await asyncio.wait_for(proc.communicate(), timeout=3.0)
            self._log("Sent Enter to open chat")

            await asyncio.sleep(0.1)

            # Step 4: Paste (Ctrl+V)
            proc = await asyncio.create_subprocess_exec(
                "xdotool", "key", "ctrl+v",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env
            )
            await asyncio.wait_for(proc.communicate(), timeout=3.0)
            self._log("Sent Ctrl+V to paste")

            # Step 5: Optionally send (Enter)
            if send:
                await asyncio.sleep(0.1)
                proc = await asyncio.create_subprocess_exec(
                    "xdotool", "key", "Return",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env
                )
                await asyncio.wait_for(proc.communicate(), timeout=3.0)
                self._log("Sent Enter to send message")

            return {"success": True}

        except asyncio.TimeoutError:
            return {"success": False, "error": "Keyboard simulation timed out"}
        except FileNotFoundError:
            return {"success": False, "error": "xdotool not found. Install: sudo pacman -S xdotool"}
        except Exception as e:
            self._log(f"Paste error: {e}")
            return {"success": False, "error": str(e)}

    # =========================================================================
    # DEBUG & INFO
    # =========================================================================

    def get_available_tools(self) -> Dict[str, bool]:
        """Check which clipboard/keyboard tools are available"""
        return {
            "wl_paste": shutil.which("wl-paste") is not None,
            "xclip": shutil.which("xclip") is not None,
            "xsel": shutil.which("xsel") is not None,
            "xdotool": shutil.which("xdotool") is not None,
            "ydotool": shutil.which("ydotool") is not None,
            "wtype": shutil.which("wtype") is not None,
        }

    def get_environment_info(self) -> Dict[str, str]:
        """Get relevant environment variables"""
        return {
            "DISPLAY": os.environ.get("DISPLAY", "not set"),
            "WAYLAND_DISPLAY": os.environ.get("WAYLAND_DISPLAY", "not set"),
            "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", "not set"),
            "XDG_SESSION_TYPE": os.environ.get("XDG_SESSION_TYPE", "not set"),
        }

    async def test_clipboard(self) -> Dict[str, Any]:
        """
        Test clipboard access and return debug info.

        Returns:
            Dict with tool availability, environment, and clipboard test result
        """
        self._log("Testing clipboard access")

        debug_info = {
            "tools": self.get_available_tools(),
            "environment": self.get_environment_info(),
        }

        # Try to read clipboard
        result = await self.read_clipboard()
        debug_info["clipboard_result"] = result

        return debug_info
