import { redirect } from "next/navigation";

export default function PayrollPage() {
  redirect("/admin?tab=accounting");
}
