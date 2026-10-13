/**
 * Read canonical base64 bytes for one browser attachment, without a main-thread byte loop.
 * @param file - browser file to read.
 * @returns the data URL payload without its media-type prefix.
 */
export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => { reject(reader.error ?? new Error('attachment read failed')) }
    reader.readAsDataURL(file)
  })
}
