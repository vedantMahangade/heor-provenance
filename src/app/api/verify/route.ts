/**
 * POST /api/verify — resolve an ENS name, fetch its pinned bundle from Walrus,
 * and recompute the sha256. Body: { name: string }. Keys stay server-side.
 */
import { verifyByEnsName } from "@/lib/verify";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected JSON body { name }." }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) {
    return Response.json({ error: "An ENS name is required." }, { status: 400 });
  }

  try {
    const result = await verifyByEnsName(name);
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
