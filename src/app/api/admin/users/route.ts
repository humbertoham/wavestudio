import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const items = await prisma.user.findMany({
    select:{ id:true, name:true, email:true, dateOfBirth:true },
    orderBy:{ createdAt:"desc" }
  });
  return NextResponse.json({ items });
}
