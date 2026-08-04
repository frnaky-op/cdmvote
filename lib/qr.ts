import QRCode from "qrcode";

/**
 * Server-side QR generation only — no external QR image API, since the
 * venue network may not have reliable outbound internet. Returns a PNG
 * data URI, embeddable directly in an <img src>.
 */
export async function generateQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 320 });
}
