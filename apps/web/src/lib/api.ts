import { NextResponse } from "next/server";
import type { WorkflowErrorReason, WorkflowResult } from "@/lib/workflows";

export async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object") return body as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

const STATUS_BY_REASON: Record<WorkflowErrorReason, number> = {
  unauthorized: 401,
  not_found: 404,
  invalid: 400,
  error: 500,
};

export function workflowResultResponse<T>(result: WorkflowResult<T>): NextResponse {
  if (result.ok) return NextResponse.json({ data: result.data }, { status: 200 });
  return NextResponse.json(
    { reason: result.reason, message: result.message },
    { status: STATUS_BY_REASON[result.reason] },
  );
}