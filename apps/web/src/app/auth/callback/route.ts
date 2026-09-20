import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeInternalRedirect } from "@/lib/redirect";
import { resolvePostAuthDestination } from "@/lib/slug";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirectAfterAuth = url.searchParams.get("redirect");

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

  // Only continue to an internal Permudah path. Reject external URLs,
  // protocol-relative URLs, javascript: URLs, and other open-redirect variants.
  if (redirectAfterAuth && isSafeInternalRedirect(redirectAfterAuth)) {
    return NextResponse.redirect(`${url.origin}${redirectAfterAuth}`);
  }

  const { data: creator } = await supabase
    .from("creator_storefronts")
    .select("id, slug, display_name, bio, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return NextResponse.redirect(resolvePostAuthDestination(creator, url.origin));
}