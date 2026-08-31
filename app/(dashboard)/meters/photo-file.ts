/**
 * Shrinking a phone photo before it is uploaded.
 *
 * This is not an optimisation. A Server Action body is capped at 1 MB by
 * default and a modern phone camera produces three to eight times that, so
 * without this step the first real photo anybody takes fails — not with the
 * action's careful "could not read this photo" but with a framework error
 * thrown before the action is entered. The browser is also the only place the
 * work is free: the bytes are already here, and a 12-megapixel picture of a
 * dial carries no digits a 1280-pixel one does not.
 *
 * Everything here degrades to "send what we were given". A browser without
 * createImageBitmap, a canvas that will not encode, a format nobody can decode
 * — each ends with the original file and the server deciding, because a photo
 * that might have worked is worth more than a certainty that it did not.
 */

/**
 * Comfortably under the Server Action limit, with room for the multipart
 * envelope and the rest of the form around it.
 */
const TARGET_BYTES = 700_000

/** Attempts, widest and best-looking first. A dial is legible at all of them. */
const ATTEMPTS: readonly { edge: number; quality: number }[] = [
  { edge: 1600, quality: 0.82 },
  { edge: 1280, quality: 0.7 },
  { edge: 960, quality: 0.6 },
]

function canvasFor(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/**
 * A JPEG of the photo small enough to upload, or the original file if it is
 * already small or cannot be re-encoded here.
 */
export async function prepareMeterPhoto(file: File): Promise<File> {
  if (file.size <= TARGET_BYTES) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    // A format this browser cannot decode — HEIC on a desktop, or something
    // that was never an image. The server's own type check answers it.
    return file
  }

  try {
    let smallest: Blob | null = null

    for (const { edge, quality } of ATTEMPTS) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = canvasFor(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale)),
      )
      const context = canvas.getContext('2d')
      if (!context) return file

      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await encode(canvas, quality)
      if (!blob) return file

      if (!smallest || blob.size < smallest.size) smallest = blob
      if (blob.size <= TARGET_BYTES) break
    }

    // Even the smallest attempt may still be too big — a photo of a wall of
    // noise compresses badly. It is sent anyway: the action answers with a
    // sentence about the size, which is the failure we want, rather than a
    // framework error thrown before it runs.
    if (!smallest || smallest.size >= file.size) return file

    return new File([smallest], renamedToJpeg(file.name), { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

/** The bytes are now a JPEG; a name saying `.heic` would be a small lie. */
function renamedToJpeg(name: string): string {
  return `${name.replace(/\.[^.]+$/, '') || 'meter'}.jpg`
}
