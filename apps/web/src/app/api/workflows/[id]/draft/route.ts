import { NextResponse } from "next/server";
import { parseJsonBody, workflowResultResponse } from "@/lib/api";
import { getCreatorSession } from "@/lib/session";
import { updateWorkflowDraft } from "@/lib/workflows";

type DraftRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: DraftRouteContext) {
  const { id } = await context.params;
  const session = await getCreatorSession();
  if (!session) {
    return NextResponse.json({ reason: "unauthorized" }, { status: 401 });
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ reason: "invalid", message: "Invalid request body." }, { status: 400 });
  }

  const result = await updateWorkflowDraft(session.supabase, id, session.user.id, {
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
    instructions: typeof body.instructions === "string" ? body.instructions : "",
    inputFields: Array.isArray(body.inputFields) ? body.inputFields : undefined,
  });

  return workflowResultResponse(result);
}