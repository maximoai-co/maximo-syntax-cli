import { feature } from 'bun:bundle'
import { randomBytes } from 'crypto'
import { execa } from 'execa'
import { homedir } from 'os'
import { basename, extname, isAbsolute, join, resolve } from 'path'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { getFsImplementation } from './fsOperations.js'
import {
  detectImageFormatFromBase64,
  type ImageDimensions,
} from './imageResizer.js'
import { logError } from './log.js'

// Native NSPasteboard reader. GrowthBook gate tengu_collage_kaleidoscope is
// a kill switch (default on). Falls through to osascript when off.
// The gate string is inlined at each callsite INSIDE the feature() condition
// — module-scope helpers are NOT tree-shaken (see docs/feature-gating.md).

type SupportedPlatform = 'darwin' | 'linux' | 'win32'

// Threshold in characters for when to consider text a "large paste"
export const PASTE_THRESHOLD = 800
function getClipboardCommands() {
  const platform = process.platform as SupportedPlatform

  // Platform-specific temporary file paths
  // Use MAXIMO_SYNTAX_TMPDIR if set, otherwise fall back to platform defaults
  const baseTmpDir =
    process.env.MAXIMO_SYNTAX_TMPDIR ||
    (platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : '/tmp')
  const screenshotFilename = 'maximo_syntax_latest_screenshot.png'
  const tempPaths: Record<SupportedPlatform, string> = {
    darwin: join(baseTmpDir, screenshotFilename),
    linux: join(baseTmpDir, screenshotFilename),
    win32: join(baseTmpDir, screenshotFilename),
  }

  const screenshotPath = tempPaths[platform] || tempPaths.linux

  // Platform-specific clipboard commands
  const commands: Record<
    SupportedPlatform,
    {
      checkImage: string
      saveImage: string
      getPath: string
      deleteFile: string
    }
  > = {
    darwin: {
      checkImage: `osascript -e 'the clipboard as «class PNGf»' >/dev/null 2>&1 || osascript -e 'the clipboard as «class TIFF»' >/dev/null 2>&1`,
      saveImage: `osascript -e 'set image_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'set eof fp to 0' -e 'write image_data to fp' -e 'close access fp' || osascript -e 'set image_data to (the clipboard as «class TIFF»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'set eof fp to 0' -e 'write image_data to fp' -e 'close access fp'`,
      getPath: `osascript -e 'get POSIX path of (the clipboard as «class furl»)'`,
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    linux: {
      checkImage:
        'xclip -selection clipboard -t TARGETS -o 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)" || wl-paste -l 2>/dev/null | grep -E "image/(png|jpeg|jpg|gif|webp|bmp)"',
      saveImage: `xclip -selection clipboard -t image/png -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/png > "${screenshotPath}" 2>/dev/null || xclip -selection clipboard -t image/bmp -o > "${screenshotPath}" 2>/dev/null || wl-paste --type image/bmp > "${screenshotPath}"`,
      getPath:
        'xclip -selection clipboard -t text/plain -o 2>/dev/null || wl-paste 2>/dev/null',
      deleteFile: `rm -f "${screenshotPath}"`,
    },
    win32: {
      checkImage:
        'powershell -NoProfile -Command "(Get-Clipboard -Format Image) -ne $null"',
      saveImage: `powershell -NoProfile -Command "$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png) }"`,
      getPath: 'powershell -NoProfile -Command "Get-Clipboard"',
      deleteFile: `del /f "${screenshotPath}"`,
    },
  }

  return {
    commands: commands[platform] || commands.linux,
    screenshotPath,
  }
}

export type ImageWithDimensions = {
  base64: string
  mediaType: string
  dimensions?: ImageDimensions
  sourcePath?: string
  originalSizeBytes?: number
}

function readImageDimensions(
  buffer: Buffer,
): { width: number; height: number } | null {
  // PNG: width and height are fixed-width fields in IHDR.
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    }
  }

  // GIF: logical screen width and height are little-endian.
  if (
    buffer.length >= 10 &&
    buffer.subarray(0, 3).toString('ascii') === 'GIF'
  ) {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    }
  }

  // JPEG: scan for a Start Of Frame marker carrying dimensions.
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const sofMarkers = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
      0xce, 0xcf,
    ])
    let offset = 2
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      if (marker === undefined) break
      if (marker === 0xff || marker === 0x00) {
        offset += 1
        continue
      }
      if (sofMarkers.has(marker)) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        }
      }
      // Standalone markers do not carry a segment length.
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      if (offset + 3 >= buffer.length) break
      const segmentLength = buffer.readUInt16BE(offset + 2)
      if (segmentLength < 2) break
      offset += 2 + segmentLength
    }
  }

  return null
}

async function prepareImageForPaste(
  imageBuffer: Buffer,
  _extension: string,
): Promise<ImageWithDimensions> {
  const base64 = imageBuffer.toString('base64')
  const mediaType = detectImageFormatFromBase64(base64)
  const dimensions = readImageDimensions(imageBuffer)

  // Preserve the source bytes exactly. Model providers can apply their own
  // limits or transforms, but the CLI must not silently resize, recompress,
  // or change the format of a user's clipboard/drop attachment.
  return {
    base64,
    mediaType,
    originalSizeBytes: imageBuffer.length,
    dimensions: dimensions
      ? {
          originalWidth: dimensions.width,
          originalHeight: dimensions.height,
          displayWidth: dimensions.width,
          displayHeight: dimensions.height,
        }
      : undefined,
  }
}

/**
 * Check if clipboard contains an image without retrieving it.
 */
export async function hasImageInClipboard(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false
  }
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    // Native NSPasteboard check (~0.03ms warm). Fall through to osascript
    // when the module/export is missing. Catch a throw too: it would surface
    // as an unhandled rejection in useClipboardImageHint's setTimeout.
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const hasImage = getNativeModule()?.hasClipboardImage
      if (hasImage) {
        return hasImage()
      }
    } catch (e) {
      logError(e as Error)
    }
  }
  const result = await execFileNoThrowWithCwd('osascript', [
    '-e',
    'the clipboard as «class PNGf»',
  ])
  return result.code === 0
}

export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  // Prefer an actual clipboard file URL over a rasterized pasteboard flavor.
  // This keeps copied Finder images in their original format and preserves
  // every source byte, just like a dragged file attachment.
  const clipboardFile = await tryReadImageFileFromClipboard()
  if (clipboardFile) return clipboardFile

  // Fast path: native NSPasteboard reader (macOS only). Reads PNG bytes
  // directly in-process at the original resolution. ~5ms cold, sub-ms warm
  // — vs. ~1.5s for the osascript path below. Throws if the native module is
  // unavailable, in which case the catch block falls through to osascript.
  // A `null` return means the bitmap flavor was unavailable, so copied Finder
  // files still fall through to the file-URL path.
  if (
    feature('NATIVE_CLIPBOARD_IMAGE') &&
    process.platform === 'darwin' &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_collage_kaleidoscope', true)
  ) {
    try {
      const { getNativeModule } = await import('image-processor-napi')
      const readClipboard = getNativeModule()?.readClipboardImage
      if (!readClipboard) {
        throw new Error('native clipboard reader unavailable')
      }
      // Ask the native reader for the original resolution. The CLI preserves
      // the returned PNG bytes instead of applying its previous 2000px cap.
      const native = readClipboard(0x7fffffff, 0x7fffffff)
      if (native) {
        const buffer: Buffer = native.png
        return {
          base64: buffer.toString('base64'),
          mediaType: 'image/png',
          originalSizeBytes: buffer.length,
          dimensions: {
            originalWidth: native.originalWidth,
            originalHeight: native.originalHeight,
            displayWidth: native.width,
            displayHeight: native.height,
          },
        }
      }
      // A copied Finder file has a file URL but no bitmap payload. Fall
      // through so the portable path can resolve and read that image file.
    } catch (e) {
      logError(e as Error)
      // Fall through to osascript fallback.
    }
  }

  const { commands, screenshotPath } = getClipboardCommands()
  try {
    // Check if clipboard has image
    const checkResult = await execa(commands.checkImage, {
      shell: true,
      reject: false,
    })
    if (checkResult.exitCode !== 0) {
      return await tryReadImageFileFromClipboard()
    }

    // Save the image
    const saveResult = await execa(commands.saveImage, {
      shell: true,
      reject: false,
    })
    if (saveResult.exitCode !== 0) {
      return null
    }

    // Read the image and convert to base64
    let imageBuffer = getFsImplementation().readFileBytesSync(screenshotPath)

    // BMP is not supported by the API — convert to PNG via Sharp.
    // This handles WSL2 where Windows copies images as BMP by default.
    if (
      imageBuffer.length >= 2 &&
      imageBuffer[0] === 0x42 &&
      imageBuffer[1] === 0x4d
    ) {
      const sharp = await getImageProcessor()
      imageBuffer = await sharp(imageBuffer).png().toBuffer()
    }

    const prepared = await prepareImageForPaste(imageBuffer, 'png')

    // Cleanup (fire-and-forget, don't await)
    void execa(commands.deleteFile, { shell: true, reject: false })

    return prepared
  } catch {
    return await tryReadImageFileFromClipboard()
  }
}

export async function getImagePathFromClipboard(): Promise<string | null> {
  const { commands } = getClipboardCommands()

  try {
    // Try to get text from clipboard
    const result = await execa(commands.getPath, {
      shell: true,
      reject: false,
    })
    if (result.exitCode !== 0 || !result.stdout) {
      return null
    }
    return result.stdout.trim()
  } catch (e) {
    logError(e as Error)
    return null
  }
}

async function tryReadImageFileFromClipboard(): Promise<ImageWithDimensions | null> {
  const clipboardValue = await getImagePathFromClipboard()
  if (!clipboardValue) return null

  for (const candidate of splitPastedFilePaths(clipboardValue)) {
    if (!isImageFilePath(candidate)) continue
    const image = await tryReadImageFromPath(candidate)
    if (image) {
      return {
        ...image,
        sourcePath: image.path,
      }
    }
  }
  return null
}

/**
 * Regex pattern to match supported image file extensions. Kept in sync with
 * MIME_BY_EXT in BriefTool/upload.ts — attachments.ts uses this to set isImage
 * on the wire, and remote viewers fetch /preview iff isImage is true. An ext
 * here but not in MIME_BY_EXT (e.g. bmp) uploads as octet-stream and has no
 * /preview variant → broken thumbnail.
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

/**
 * Split file paths emitted by terminal drag/drop without breaking spaces
 * inside quoted or shell-escaped filenames.
 */
export function splitPastedFilePaths(text: string): string[] {
  const tokens: string[] = []
  let token = ""
  let quote: "'" | '"' | null = null
  let escaping = false

  const pushToken = () => {
    const value = token.trim()
    if (value) tokens.push(value)
    token = ""
  }

  for (const char of text.replace(/\r/g, "\n")) {
    if (escaping) {
      token += char
      escaping = false
      continue
    }
    if (char === "\\" && quote !== "'") {
      escaping = true
      continue
    }
    if ((char === "'" || char === '"') && (!quote || quote === char)) {
      quote = quote === char ? null : char
      continue
    }
    if (!quote && /\s/.test(char)) {
      pushToken()
      continue
    }
    token += char
  }
  if (escaping) token += "\\"
  pushToken()
  return tokens
}

/**
 * Remove outer single or double quotes from a string
 * @param text Text to clean
 * @returns Text without outer quotes
 */
function removeOuterQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Remove shell escape backslashes from a path (for macOS/Linux/WSL)
 * On Windows systems, this function returns the path unchanged
 * @param path Path that might contain shell-escaped characters
 * @returns Path with escape backslashes removed (on macOS/Linux/WSL only)
 */
function stripBackslashEscapes(path: string): string {
  const platform = process.platform as SupportedPlatform

  // On Windows, don't remove backslashes as they're part of the path
  if (platform === 'win32') {
    return path
  }

  // On macOS/Linux/WSL, handle shell-escaped paths
  // Double-backslashes (\\) represent actual backslashes in the filename
  // Single backslashes followed by special chars are shell escapes

  // First, temporarily replace double backslashes with a placeholder
  // Use random salt to prevent injection attacks where path contains literal placeholder
  const salt = randomBytes(8).toString('hex')
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)

  // Remove single backslashes that are shell escapes
  // This handles cases like "name\ \(15\).png" -> "name (15).png"
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, '$1')

  // Replace placeholders back to single backslashes
  return withoutEscapes.replace(new RegExp(placeholder, 'g'), '\\')
}

/**
 * Check if a given text represents an image file path
 * @param text Text to check
 * @returns Boolean indicating if text is an image path
 */
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Clean and normalize a text string that might be an image file path
 * @param text Text to process
 * @returns Cleaned text with quotes removed, whitespace trimmed, and shell escapes removed, or null if not an image path
 */
export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  let unescaped = stripBackslashEscapes(cleaned)

  if (unescaped.startsWith("file://")) {
    try {
      const fileUrl = new URL(unescaped)
      if (fileUrl.protocol !== "file:") return null
      unescaped = decodeURIComponent(fileUrl.pathname)
    } catch {
      return null
    }
  }

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

/**
 * Try to find and read an image file, falling back to clipboard search
 * @param text Pasted text that might be an image filename or path
 * @returns Object containing the image path and base64 data, or null if not found
 */
export async function tryReadImageFromPath(
  text: string,
): Promise<(ImageWithDimensions & { path: string }) | null> {
  // Strip terminal added spaces or quotes to dragged in paths
  const cleanedPath = asImageFilePath(text)

  if (!cleanedPath) {
    return null
  }

  const imagePath = cleanedPath
  let imageBuffer: Buffer | undefined
  let resolvedImagePath: string | undefined

  try {
    const fs = getFsImplementation()
    const candidates: string[] = []

    if (isAbsolute(imagePath)) {
      candidates.push(imagePath)
    } else {
      // VS Code's integrated terminal can reduce Finder drops to a basename.
      // Resolve exact, bounded locations first; never recursively scan a home
      // directory from an input event.
      candidates.push(
        resolve(fs.cwd(), imagePath),
        join(homedir(), 'Downloads', imagePath),
        join(homedir(), 'Desktop', imagePath),
        join(homedir(), 'Pictures', imagePath),
      )

      // A copied Finder image can expose its full file URL on the clipboard
      // even when the terminal only inserts its basename.
      const clipboardValue = await getImagePathFromClipboard()
      if (clipboardValue) {
        for (const clipboardToken of splitPastedFilePaths(clipboardValue)) {
          const clipboardPath = asImageFilePath(clipboardToken)
          if (
            clipboardPath &&
            isAbsolute(clipboardPath) &&
            basename(clipboardPath) === basename(imagePath)
          ) {
            candidates.unshift(clipboardPath)
          }
        }
      }
    }

    for (const candidate of [...new Set(candidates)]) {
      try {
        imageBuffer = fs.readFileBytesSync(candidate)
        resolvedImagePath = candidate
        break
      } catch {
        // Try the next exact candidate.
      }
    }
  } catch (e) {
    logError(e as Error)
    return null
  }
  if (!imageBuffer || !resolvedImagePath) {
    return null
  }
  if (imageBuffer.length === 0) {
    logForDebugging(`Image file is empty: ${imagePath}`, { level: 'warn' })
    return null
  }

  // BMP is not supported by the API — convert to PNG via Sharp.
  if (
    imageBuffer.length >= 2 &&
    imageBuffer[0] === 0x42 &&
    imageBuffer[1] === 0x4d
  ) {
    const sharp = await getImageProcessor()
    imageBuffer = await sharp(imageBuffer).png().toBuffer()
  }

  try {
    // Extract extension from path for format hint. The actual media type is
    // still detected from magic bytes by prepareImageForPaste.
    const ext = extname(resolvedImagePath).slice(1).toLowerCase() || 'png'
    return {
      path: resolvedImagePath,
      sourcePath: resolvedImagePath,
      ...(await prepareImageForPaste(imageBuffer, ext)),
    }
  } catch (error) {
    logError(error as Error)
    return null
  }
}
