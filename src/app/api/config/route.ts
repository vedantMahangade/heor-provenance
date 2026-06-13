/**
 * GET /api/config — reports which keyed features are available so the UI can
 * gate them. Never exposes any key value, only presence. Keyless by design.
 */
import { getFeatureConfig } from "@/lib/featureConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getFeatureConfig());
}
