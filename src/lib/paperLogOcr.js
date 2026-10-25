import { parsePaperLog } from '@/lib/paperLogParse.js'

// Reads the photo on this device with Tesseract (#521): free, works offline
// once loaded, and the photo never leaves the phone. Its files are served
// from our own site (vite.config.js) and load only on the first scan.
let workerPromise = null
export async function readOnDevice(file, onProgress) {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => {
      const base = `${import.meta.env.BASE_URL}tesseract`
      return createWorker('eng', 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/core`,
        langPath: `${base}/lang`,
        workerBlobURL: false,
        logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress) },
      })
    })
    workerPromise.catch(() => { workerPromise = null })
  }
  const worker = await workerPromise
  const { data } = await worker.recognize(file)
  return parsePaperLog(data.text)
}

