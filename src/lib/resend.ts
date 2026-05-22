import { Resend } from "resend";
import { getRequiredServerEnv } from "./env";

let resend: Resend | null = null;

export function getResendClient() {
  resend ??= new Resend(getRequiredServerEnv("RESEND_API_KEY"));
  return resend;
}
