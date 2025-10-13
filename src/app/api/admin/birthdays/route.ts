import { NextRequest, NextResponse } from "next/server";
import { prisma, requireAdmin } from "../_utils";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req); if (auth) return auth;

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") ?? 30);

  const users = await prisma.user.findMany({
    select:{ id:true, name:true, email:true, dateOfBirth:true }
  });

  const today = new Date();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const todayList = users.filter(u=>{
    if (!u.dateOfBirth) return false;
    const d = new Date(u.dateOfBirth);
    return d.getMonth()===todayMonth && d.getDate()===todayDate;
  });

  // próximos N días (solo mes/día, ignora año)
  const upcoming: { user:any; date:string }[] = [];
  for (const u of users) {
    if (!u.dateOfBirth) continue;
    const dob = new Date(u.dateOfBirth);
    // próximo cumpleaños en este año o el siguiente
    let next = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (next < today) next = new Date(today.getFullYear()+1, dob.getMonth(), dob.getDate());
    const diff = Math.ceil((+next - +today) / (1000*60*60*24));
    if (diff>0 && diff<=days) {
      upcoming.push({ user:u, date: next.toISOString() });
    }
  }
  upcoming.sort((a,b)=> +new Date(a.date) - +new Date(b.date));

  return NextResponse.json({ today: todayList, upcoming });
}
