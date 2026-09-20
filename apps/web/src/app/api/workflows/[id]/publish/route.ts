import { NextResponse } from "next/server";
import { workflowResultResponse } from "@/lib/api";
import { getCreatorSession } from "@/lib/session";
import { publishWorkflow } from "@/lib/workflows";

type PublishRouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: PublishRouteContext) {
  const { id } = await context.params;
  const session = await getCreatorSession();
  if (!session) {
    return NextResponse.json({ reason: "unauthorized" }, { status: 401 });
  }

  const result = await publishWorkflow(session.supabase, id, session.user.id);
  return workflowResultResponse(result);
}