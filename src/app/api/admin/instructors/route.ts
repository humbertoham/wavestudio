import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdminUser, requireClassManagerUser } from "../_utils";
import {
  createInstructorWithRate,
  payrollErrorResponse,
} from "@/lib/payroll";

export async function GET(req: NextRequest) {
  const auth = await requireClassManagerUser(req);
  if (!auth.ok) return auth.response;

  const items = await prisma.instructor.findMany({
    orderBy: { createdAt: "desc" },
    where: { isVisible: true },
    select:
      auth.user.role === "ADMIN"
        ? {
            id: true,
            name: true,
            bio: true,
            payrollRate: true,
            createdAt: true,
            isVisible: true,
          }
        : {
            id: true,
            name: true,
            bio: true,
            createdAt: true,
            isVisible: true,
          },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { name, bio, payrollRate } = await req.json();
    const item = await createInstructorWithRate({
      name,
      bio,
      payrollRate,
      actorUserId: auth.user.id,
    });
    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    const known = payrollErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error("INSTRUCTOR_POST_ERROR", error);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: "No se pudo crear el instructor." },
      { status: 500 }
    );
  }
}
