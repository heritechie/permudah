import { NextResponse } from "next/server";
import { parseJsonBody, workflowResultResponse } from "@/lib/api";
import { getCreatorSession } from "@/lib/session";
import { createWorkflow } from "@/lib/workflows";

export async function POST(request: Request) {
  const session = await getCreatorSession();
  if (!session) {
    return NextResponse.json({ reason: "unauthorized" }, { status: 401 });
  }

  const body = await parseJsonBody(request);
  if (!body) {
    return NextResponse.json({ reason: "invalid", message: "Invalid request body." }, { status: 400 });
  }

  const result = await createWorkflow(session.supabase, {
    creator_id: session.user.id,
    name: typeof body.name === "string" ? body.name : "",
    description: typeof body.description === "string" ? body.description : null,
    instructions: typeof body.instructions === "string" ? body.instructions : "",
    inputFields: Array.isArray(body.inputFields) ? body.inputFields : undefined,
  });

  return workflowResultResponse(result);
}