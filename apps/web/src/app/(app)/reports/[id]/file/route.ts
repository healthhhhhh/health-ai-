import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens the original upload via a 5-minute signed link issued by the API after its ownership check. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  try {
    const { url } = await api<{ url: string; expiresIn: number }>(`documents/${id}/file`);
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    unstable_rethrow(error);
    const status = error instanceof ApiError && error.status >= 400 && error.status < 500 ? error.status : 502;
    return new NextResponse(status === 404 ? "Not found" : "The file isn't available right now.", { status });
  }
}
