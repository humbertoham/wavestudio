import Link from "next/link";

export function ChallengeNavLink({
  active,
  className,
  role,
}: {
  active: boolean;
  className: string;
  role?: "menuitem";
}) {
  if (!active) return null;

  return (
    <Link href="/challenge" className={className} role={role}>
      ¿Cómo funciona el Challenge?
    </Link>
  );
}
