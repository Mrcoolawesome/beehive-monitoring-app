"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { Prisma } from "@/app/generated/prisma/client";

const boardSchema = z.object({
  piId: z.string().min(1),
  label: z.string().trim().min(1, "Label is required").max(100),
  bluetoothMac: z
    .string()
    .trim()
    .regex(
      /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/,
      "Enter a MAC address like 00:1F:32:22:03:BF",
    )
    .transform((s) => s.toUpperCase()),
  // Coerced from the <select>'s string value - matches the WiiBoardManager
  // instance (wiiBoardManager0..wiiBoardManager3) this board is deployed
  // to, see prisma/schema.prisma's Board model.
  slotIndex: z.coerce.number().int().min(0).max(3),
});

export async function createBoardAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const parsed = boardSchema.safeParse({
    piId: formData.get("piId"),
    label: formData.get("label"),
    bluetoothMac: formData.get("bluetoothMac"),
    slotIndex: formData.get("slotIndex"),
  });
  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? "Invalid input.";
  }

  try {
    await prisma.board.create({ data: parsed.data });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return "That slot or MAC address is already used on this Pi.";
    }
    throw error;
  }

  revalidatePath(`/admin/pis/${parsed.data.piId}`);
}

// Bound with (piId, boardId) via .bind(null, piId, board.id) in each row's
// delete <form> - see deletePiAction in ../actions.ts for why binding args
// rather than a hidden input.
export async function deleteBoardAction(
  piId: string,
  boardId: string,
  _formData: FormData,
) {
  await requireAdmin();
  await prisma.board.delete({ where: { id: boardId } });
  revalidatePath(`/admin/pis/${piId}`);
}
