/**
 * Linux-specific clipboard utilities for images
 * Uses xclip (preferred) or xsel as fallback
 */

import * as fs from "fs"
import * as path from "path"
import { logs } from "../services/logs.js"
import {
	ensureClipboardDir,
	execFileAsync,
	generateClipboardFilename,
	type SaveClipboardResult,
} from "./clipboard-shared.js"

/**
 * Check if xclip is available on the system
 */
async function hasXclip(): Promise<boolean> {
	try {
		await execFileAsync("which", ["xclip"])
		return true
	} catch {
		return false
	}
}

/**
 * Check if xsel is available on the system
 */
async function hasXsel(): Promise<boolean> {
	try {
		await execFileAsync("which", ["xsel"])
		return true
	} catch {
		return false
	}
}

/**
 * Check if wl-paste is available (Wayland)
 */
async function hasWlPaste(): Promise<boolean> {
	try {
		await execFileAsync("which", ["wl-paste"])
		return true
	} catch {
		return false
	}
}

/**
 * Detect if running under Wayland
 */
function isWayland(): boolean {
	return !!process.env["WAYLAND_DISPLAY"]
}

/**
 * Check if clipboard contains an image on Linux
 * Tries wl-paste (Wayland), xclip, then xsel
 */
export async function hasClipboardImageLinux(): Promise<boolean> {
	// Try Wayland first if running under Wayland
	if (isWayland() && (await hasWlPaste())) {
		try {
			const { stdout } = await execFileAsync("wl-paste", ["--list-types"])
			return stdout.includes("image/png") || stdout.includes("image/jpeg") || stdout.includes("image/gif")
		} catch (error) {
			logs.debug("wl-paste --list-types failed", "clipboard", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Try xclip
	if (await hasXclip()) {
		try {
			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
			return stdout.includes("image/png") || stdout.includes("image/jpeg") || stdout.includes("image/gif")
		} catch (error) {
			logs.debug("xclip TARGETS check failed", "clipboard", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Try xsel (doesn't have a direct way to list types, so we try to read)
	if (await hasXsel()) {
		try {
			// xsel doesn't have a TARGETS equivalent, try reading image/png directly
			await execFileAsync("xsel", ["--clipboard", "--output"], {
				encoding: "buffer",
				maxBuffer: 1024, // Just check if it exists
			})
			// If we get here without error, there's something in clipboard
			// We can't definitively say it's an image with xsel alone
			return false // Conservative - xsel doesn't reliably detect image type
		} catch {
			// xsel not suitable for image detection
		}
	}

	return false
}

/**
 * Save clipboard image to a temp file on Linux
 * Tries wl-paste (Wayland), xclip, then xsel
 */
export async function saveClipboardImageLinux(): Promise<SaveClipboardResult> {
	const clipboardDir = await ensureClipboardDir()

	// Determine image format and get the data
	let imageData: Buffer | null = null
	let format = "png" // Default format

	// Try Wayland first
	if (isWayland() && (await hasWlPaste())) {
		try {
			// Check available types
			const { stdout: types } = await execFileAsync("wl-paste", ["--list-types"])

			let mimeType = "image/png"
			if (types.includes("image/png")) {
				mimeType = "image/png"
				format = "png"
			} else if (types.includes("image/jpeg")) {
				mimeType = "image/jpeg"
				format = "jpeg"
			} else if (types.includes("image/gif")) {
				mimeType = "image/gif"
				format = "gif"
			} else {
				return {
					success: false,
					error: "No image found in clipboard.",
				}
			}

			const { stdout } = await execFileAsync("wl-paste", ["--type", mimeType], {
				encoding: "buffer",
				maxBuffer: 50 * 1024 * 1024,
			})

			imageData = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
		} catch (error) {
			logs.debug("wl-paste failed, trying xclip", "clipboard", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// Try xclip if Wayland didn't work
	if (!imageData && (await hasXclip())) {
		try {
			// Check available types
			const { stdout: targets } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])

			let mimeType = "image/png"
			if (targets.includes("image/png")) {
				mimeType = "image/png"
				format = "png"
			} else if (targets.includes("image/jpeg")) {
				mimeType = "image/jpeg"
				format = "jpeg"
			} else if (targets.includes("image/gif")) {
				mimeType = "image/gif"
				format = "gif"
			} else {
				return {
					success: false,
					error: "No image found in clipboard.",
				}
			}

			const { stdout } = await execFileAsync("xclip", ["-selection", "clipboard", "-t", mimeType, "-o"], {
				encoding: "buffer",
				maxBuffer: 50 * 1024 * 1024,
			})

			imageData = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
		} catch (error) {
			logs.debug("xclip failed, trying xsel", "clipboard", {
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// xsel doesn't reliably support image types, skip it for saving
	if (!imageData) {
		// Check if any clipboard tool is available
		const hasAnyTool = (await hasWlPaste()) || (await hasXclip()) || (await hasXsel())
		if (!hasAnyTool) {
			return {
				success: false,
				error: "No clipboard tool available. Please install xclip (sudo apt install xclip) or wl-clipboard for Wayland.",
			}
		}
		return {
			success: false,
			error: "No image found in clipboard.",
		}
	}

	// Check if we got valid data
	if (imageData.length === 0) {
		return {
			success: false,
			error: "Clipboard image is empty.",
		}
	}

	// Save to file
	const filename = generateClipboardFilename(format)
	const filePath = path.join(clipboardDir, filename)

	try {
		await fs.promises.writeFile(filePath, imageData)

		// Verify the file was written correctly
		const stats = await fs.promises.stat(filePath)
		if (stats.size === 0) {
			await fs.promises.unlink(filePath)
			return {
				success: false,
				error: "Failed to write image data to file.",
			}
		}

		return {
			success: true,
			filePath,
		}
	} catch (error) {
		// Clean up partial file if it exists
		try {
			await fs.promises.unlink(filePath)
		} catch {
			// Ignore cleanup errors
		}
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
