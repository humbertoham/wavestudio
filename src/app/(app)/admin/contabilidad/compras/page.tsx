import { redirect } from "next/navigation";

export default function PurchasesPage() {
  redirect("/admin?tab=accounting&accounting=purchases");
}
