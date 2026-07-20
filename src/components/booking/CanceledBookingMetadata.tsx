import { formatBookingCancellation } from "@/lib/class-cancellation";

type Props = {
  status: "ACTIVE" | "CANCELED";
  canceledAt?: string | null;
  hasPenalty: boolean;
};

export function CanceledBookingMetadata({
  status,
  canceledAt,
  hasPenalty,
}: Props) {
  if (status !== "CANCELED") return null;

  const cancellationText = formatBookingCancellation(status, canceledAt);

  return (
    <>
      {cancellationText && (
        <p className="text-xs text-muted-foreground">{cancellationText}</p>
      )}

      {hasPenalty && (
        <p className="text-xs font-semibold text-red-600">
          {"Debe $100 de penalizaci\u00F3n"}
        </p>
      )}
    </>
  );
}
