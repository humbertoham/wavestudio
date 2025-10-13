import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../../_utils";

export async function PUT(req: NextRequest, { params }: { params:{ id:string }}) {
  const auth = await requireAdmin(req); if (auth) return auth;
  const { date, ...rest } = await req.json();
  const item = await prisma.class.update({
    where:{ id: params.id },
    data:{ ...(date ? { date:new Date(date) } : {}), ...rest }
  });
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest, { params }: { params:{ id:string }}) {
  const auth = await requireAdmin(req); if (auth) return auth;
  await prisma.class.delete({ where:{ id: params.id }});
  return NextResponse.json({ ok:true });
}
