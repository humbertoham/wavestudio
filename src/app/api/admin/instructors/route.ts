import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const items = await prisma.instructor.findMany({ orderBy:{ createdAt:"desc"}});
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const { name, bio } = await req.json();
  const item = await prisma.instructor.create({ data:{ name, bio }});
  return NextResponse.json(item, { status: 201 });
}
