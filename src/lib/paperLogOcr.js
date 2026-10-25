import { Capacitor } from '@capacitor/core'
import { parsePaperLog } from '@/lib/paperLogParse.js'
import { tr } from '@/lib/i18n.js'

// Reads the photo on this device with Tesseract (#521): free, works offline
// once loaded, and the photo never leaves the phone. Its files are served
// from our own site (vite.config.js) and load only on the first scan.

// Android's asset packaging un-gzips `eng.traineddata.gz` and drops the
// extension, so the Android app asks for the plain file (#525).
const GZIPPED_MODEL = Capacitor.getPlatform() !== 'android'
// A reader that can't load its files reports the error to its errorHandler
// but never settles, which would leave the Scan button spinning forever.
const LOAD_TIMEOUT_MS = 90_000

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(tr('The photo reader didn’t load. Check your connection and try again.'))), ms)),
  ])
}

let workerPromise = null
export async function readOnDevice(file, onProgress) {
  if (!workerPromise) {
    workerPromise = withTimeout(import('tesseract.js').then((mod) => {
      // The production build exposes the CommonJS package as `default` only.
      const createWorker = mod.createWorker || mod.default?.createWorker
      const base = `${import.meta.env.BASE_URL}tesseract`
      return new Promise((resolve, reject) => {
        createWorker('eng', 1, {
          workerPath: `${base}/worker.min.js`,
          corePath: `${base}/core`,
          langPath: `${base}/lang`,
          gzip: GZIPPED_MODEL,
          workerBlobURL: false,
          logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress) },
          errorHandler: (error) => reject(error instanceof Error ? error : new Error(String(error))),
        }).then(resolve, reject)
      })
    }), LOAD_TIMEOUT_MS)
    workerPromise.catch(() => { workerPromise = null })
  }
  const worker = await workerPromise
  const { data } = await worker.recognize(file)
  return parsePaperLog(data.text)
}
