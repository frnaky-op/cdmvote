import { headers } from "next/headers";
import { getBigscreenStatus } from "@/lib/match-state";
import { generateQrCodeDataUrl } from "@/lib/qr";
import { BigscreenShell } from "../bigscreen-shell";

export const dynamic = "force-dynamic";

export default async function BigscreenPage() {
  const [initialStatus, headerList] = await Promise.all([getBigscreenStatus(), headers()]);

  const protocol = headerList.get("x-forwarded-proto") ?? "http";
  const host = headerList.get("host");
  const audienceUrl = host ? `${protocol}://${host}/` : null;
  const qrCodeDataUrl = audienceUrl ? await generateQrCodeDataUrl(audienceUrl) : null;

  return <BigscreenShell initialStatus={initialStatus} qrCodeDataUrl={qrCodeDataUrl} />;
}
