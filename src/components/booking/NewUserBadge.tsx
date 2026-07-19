export function NewUserBadge({ isNewUser }: { isNewUser: boolean }) {
  if (!isNewUser) return null;

  return (
    <p className="mt-1 text-[11px] font-bold text-[color:var(--color-primary)]">
      NEW USER
    </p>
  );
}
