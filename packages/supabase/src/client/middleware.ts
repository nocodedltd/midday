import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

export async function updateSession(
  request: NextRequest,
  response: NextResponse,
) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  // A simple mistake could make it very hard to debug issues with
  // users being randomly logged out.
  //
  // getClaims() validates the JWT signature against the project's
  // published JWKS and refreshes expired tokens. Never trust
  // getSession() inside server code — it isn't guaranteed to
  // revalidate the Auth token.
  // Self-hosted note: getClaims() verifies the JWT against the project's
  // published JWKS. Self-hosted Supabase signs symmetrically (HS256) and
  // serves an empty JWKS, so getClaims() can never succeed and every request
  // is treated as unauthenticated. getUser() revalidates against the auth
  // server instead, which works for both symmetric and asymmetric signing.
  const { data, error } = await supabase.auth.getUser();
  const isAuthenticated = !!data?.user && !error;

  return {
    response,
    isAuthenticated,
    supabase,
  };
}
