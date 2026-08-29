"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

const createPiSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  tailscaleName: z
    .string()
    .trim()
    .min(1, "Tailscale name is required")
    .max(255),
  userId: z.string().min(1, "Select a user"),
});

// Dedicated GDS/decoder instance per Pi (see the "Multi-Pi / multi-board
// fleet management" plan) needs its own port - assigned once here, at
// registration, starting from this base.
const BASE_PORT = 50001;

export async function createPiAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const parsed = createPiSchema.safeParse({
    name: formData.get("name"),
    tailscaleName: formData.get("tailscaleName"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid input.";
  }

  // Next free port, starting at BASE_PORT. Not transactionally safe against
  // two admins registering a Pi at the exact same instant (a real race,
  // but the assignedPort unique constraint means the worst case is a
  // rejected insert to retry, not a silent port collision) - an acceptable
  // trade at this app's admin-only, one-or-two-people scale.
  const maxPort = await prisma.pi.aggregate({ _max: { assignedPort: true } });
  const assignedPort = Math.max(
    BASE_PORT,
    (maxPort._max.assignedPort ?? BASE_PORT - 1) + 1,
  );

  const pi = await prisma.pi.create({
    data: {
      name: parsed.data.name,
      tailscaleName: parsed.data.tailscaleName,
      userId: parsed.data.userId,
      assignedPort,
    },
  });

  revalidatePath("/admin/pis");
  redirect(`/admin/pis/${pi.id}`);
}

// Bound with piId via .bind(null, pi.id) in the delete <form>'s action=,
// so the client only ever needs to submit the form itself, not smuggle the
// id through a hidden input an admin could tamper with in devtools (not
// that it'd matter much here - requireAdmin() already gates this to
// admins only - but it's the standard, slightly more robust pattern for a
// Server Action bound to a specific row).
export async function deletePiAction(piId: string, _formData: FormData) {
  await requireAdmin();
  await prisma.pi.delete({ where: { id: piId } });
  revalidatePath("/admin/pis");
}
