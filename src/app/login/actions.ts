"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ACCESS_COOKIE,
  ACCESS_MAX_AGE_SECONDS,
  accessToken,
  safeNextPath,
  sameString,
} from "@/lib/access";

export interface LogInState {
  error?: string;
}

/** Check the password; on success remember this browser for a year. */
export async function logIn(_prev: LogInState, formData: FormData): Promise<LogInState> {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return { error: "No password has been set for this site yet (SITE_PASSWORD)." };
  }

  const given = String(formData.get("password") ?? "");
  const token = await accessToken(password);
  if (!sameString(await accessToken(given), token)) {
    return { error: "That password isn't right." };
  }

  (await cookies()).set(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(String(formData.get("next") ?? "")));
}
