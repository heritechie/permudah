import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolvePostAuthDestination } from "@/lib/slug";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${url.origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${url.origin}/login?error=auth`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${url.origin}/login?error=auth`);
  }

  const { data: creator } = await supabase
    .from("creator_storefronts")
    .select("id, slug, display_name, bio, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(resolvePostAuthDestination(creator, url.origin));
}