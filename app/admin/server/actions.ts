"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

const hostSchema = z.string().trim().min(1, "Host is required");

// ServerConfig is a singleton (see prisma/schema.prisma) - upsert-by-first-
// row rather than a fixed known id, since the row doesn't exist until the
// first save.
export async function updateServerConfigAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const parsed = hostSchema.safeParse(formData.get("host"));
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid host.";
  }

  const existing = await prisma.serverConfig.findFirst();
  if (existing) {
    await prisma.serverConfig.update({
      where: { id: existing.id },
      data: { host: parsed.data },
    });
  } else {
    await prisma.serverConfig.create({ data: { host: parsed.data } });
  }

  revalidatePath("/admin/server");
}
