/**
 * Windows-specific clipboard utilities for images
 * Uses PowerShell with System.Windows.Forms
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
 * Execute a PowerShell command and return the output
 */
async function runPowerShell(script: string): Promise<string> {
	const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script])
	return stdout.trim()
}

/**
 * Check if clipboard contains an image on Windows
 */
export async function hasClipboardImageWindows(): Promise<boolean> {
	try {
		const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::ContainsImage()
`
		const result = await runPowerShell(script)
		return result.toLowerCase() === "true"
	} catch (error) {
		logs.debug("Windows clipboard check failed", "clipboard", {
			error: error instanceof Error ? error.message : String(error),
		})
		return false
	}
}

/**
 * Save clipboard image to a temp file on Windows
 */
export async function saveClipboardImageWindows(): Promise<SaveClipboardResult> {
	const clipboardDir = await ensureClipboardDir()
	const filename = generateClipboardFilename("png")
	const filePath = path.join(clipboardDir, filename)

	// Escape backslashes for PowerShell string
	const escapedPath = filePath.replace(/\\/g, "\\\\")

	try {
		// PowerShell script to get clipboard image and save as PNG
		const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) {
    Write-Output "NO_IMAGE"
    exit 0
}

try {
    $img.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "SUCCESS"
} catch {
    Write-Output "ERROR: $_"
} finally {
    $img.Dispose()
}
`
		const result = await runPowerShell(script)

		if (result === "NO_IMAGE") {
			return {
				success: false,
				error: "No image found in clipboard.",
			}
		}

		if (result.startsWith("ERROR:")) {
			return {
				success: false,
				error: result.substring(7).trim(),
			}
		}

		// Verify the file was created
		try {
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
		} catch {
			return {
				success: false,
				error: "Image file was not created.",
			}
		}
	} catch (error) {
		// Clean up partial file if it exists
		try {
			await fs.promises.unlink(filePath)
		} catch {
			// Ignore cleanup errors
		}

		logs.debug("Windows clipboard save failed", "clipboard", {
			error: error instanceof Error ? error.message : String(error),
		})

		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
