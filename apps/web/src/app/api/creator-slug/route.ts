import { NextRequest, NextResponse } from "next/server";
import { checkSlugAvailability } from "@/lib/check-slug";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";
  const supabase = await createClient();
  const result = await checkSlugAvailability(slug, supabase);
  return NextResponse.json(result);
}