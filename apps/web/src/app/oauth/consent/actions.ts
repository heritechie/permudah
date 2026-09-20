"use server";

import { createClient } from "@/lib/supabase/server";

type OAuthRedirect = {
  redirect_url: string;
};

export type ConsentActionResult =
  | { ok: true; redirect_url: string }
  | { ok: false; error: string };

export async function approveAuthorizationAction(
  authorizationId: string,
): Promise<ConsentActionResult> {
  const supabase = await createClient();
  const { data, error } = await (
    supabase.auth.oauth as {
      approveAuthorization: (id: string) => Promise<{ data: OAuthRedirect | null; error: { message: string } | null }>;
    }
  ).approveAuthorization(authorizationId);

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to approve authorization" };
  }

  return { ok: true, redirect_url: data.redirect_url };
}

export async function denyAuthorizationAction(
  authorizationId: string,
): Promise<ConsentActionResult> {
  const supabase = await createClient();
  const { data, error } = await (
    supabase.auth.oauth as {
      denyAuthorization: (id: string) => Promise<{ data: OAuthRedirect | null; error: { message: string } | null }>;
    }
  ).denyAuthorization(authorizationId);

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to deny authorization" };
  }

  return { ok: true, redirect_url: data.redirect_url };
}
