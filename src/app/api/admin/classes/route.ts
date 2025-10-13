import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const items = await prisma.class.findMany({
    include:{ instructor:true },
    orderBy:{ date:"desc" }
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const { title, focus, date, durationMin, capacity, instructorId } = await req.json();
  const item = await prisma.class.create({
    data:{ title, focus, date: new Date(date), durationMin, capacity, instructorId }
  });
  return NextResponse.json(item, { status: 201 });
}
