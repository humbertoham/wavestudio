import { redirect } from "next/navigation";

export default function AccountingPage() {
  redirect("/admin?tab=accounting");
}
