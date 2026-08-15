"use server";

// Server Action backing the signup form. Every new account starts as
// VIEWER (see prisma/schema.prisma's UserRole) - there's no signup flow to
// ADMIN, that role can only be granted by an existing admin (once Phase 3
// adds the admin panel; for now, direct DB access / scripts/create-admin.ts).
//
// Only creates the account, then redirects to /login rather than also
// signing the user in immediately - see app/login/LoginForm.tsx's header
// for why calling lib/auth.ts's signIn() from inside a Server Action is
// avoided here.

import { redirect } from "next/navigation";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db";

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.email("Enter a valid email address"),
  // 8 chars is a floor, not a strength requirement - this app has no
  // password-strength meter or breach-checking, just a sanity minimum.
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function signupAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid input.";
  }
  const { name, email, password } = parsed.data;

  const hashedPassword = await bcrypt.hash(password, 12);

  try {
    await prisma.user.create({
      data: { name, email, hashedPassword },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return "An account with that email already exists.";
    }
    throw error;
  }

  // redirect() throws internally (Next.js's own control-flow mechanism) -
  // letting that propagate out of this action is correct and expected,
  // not an error to catch.
  redirect("/login?created=1");
}
