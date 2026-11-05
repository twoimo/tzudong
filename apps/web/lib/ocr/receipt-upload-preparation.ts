import { OCR_REVIEW_VERIFICATION_MAX_BYTES } from '@/lib/ocr/review-verification-contract';

const SUPPORTED_RECEIPT_MIME_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

type ReceiptImageCompressor = (file: File, options: {
  maxSizeMB: number;
  maxWidthOrHeight: number;
  fileType: 'image/jpeg' | 'image/png' | 'image/webp';
  initialQuality: number;
  useWebWorker: boolean;
  signal?: AbortSignal;
}) => Promise<Blob>;

export class ReceiptUploadPreparationError extends Error {
  constructor(public readonly code: 'unsupported' | 'too_large') {
    super(code === 'unsupported'
      ? 'REVIEW_VERIFICATION_FORMAT_UNSUPPORTED'
      : 'REVIEW_VERIFICATION_PREPARATION_FAILED');
    this.name = 'ReceiptUploadPreparationError';
  }
}

/** Produces the exact bytes used for both OCR and the private Storage upload. */
export async function prepareVerificationUploadFile(input: {
  file: File;
  filename: string;
  compress: ReceiptImageCompressor;
  signal?: AbortSignal;
}): Promise<File> {
  const { file, filename, compress, signal } = input;
  signal?.throwIfAborted();
  if (!SUPPORTED_RECEIPT_MIME_TYPES.has(file.type)) {
    throw new ReceiptUploadPreparationError('unsupported');
  }

  let bytes: Blob = file;
  if (file.size > OCR_REVIEW_VERIFICATION_MAX_BYTES) {
    try {
      bytes = await compress(file, {
        maxSizeMB: OCR_REVIEW_VERIFICATION_MAX_BYTES / 1024 / 1024,
        maxWidthOrHeight: 3000,
        fileType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
        initialQuality: 1,
        useWebWorker: true,
        signal,
      });
    } catch {
      signal?.throwIfAborted();
      throw new ReceiptUploadPreparationError('too_large');
    }
  }

  signal?.throwIfAborted();
  const prepared = new File([bytes], filename, { type: file.type });
  if (prepared.size < 1 || prepared.size > OCR_REVIEW_VERIFICATION_MAX_BYTES) {
    throw new ReceiptUploadPreparationError('too_large');
  }
  return prepared;
}
