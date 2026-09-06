import { redirect } from "next/navigation";

export default function RevenuePage() {
  redirect("/admin?tab=accounting&accounting=revenue");
}
