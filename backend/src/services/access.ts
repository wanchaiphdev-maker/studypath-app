import { Role } from "@prisma/client";
import { prisma } from "../auth";

export async function canAccessRoom(userId: string, role: Role, roomId: string) {
  if (role === Role.ADMIN) return true;

  const room = await prisma.room.findFirst({
    where: {
      id: roomId,
      OR: [
        { members: { has: userId } },
        { group: { members: { some: { id: userId } } } },
      ],
    },
    select: { id: true },
  });

  return room !== null;
}
