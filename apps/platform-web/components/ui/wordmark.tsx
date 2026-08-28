import { cn } from "@/lib/utils";

type WordmarkSize = "xs" | "sm" | "md" | "lg";

const SIZES: Record<WordmarkSize, { text: string }> = {
  xs: { text: "text-[11px]" },
  sm: { text: "text-[13px]" },
  md: { text: "text-lg" },
  lg: { text: "text-[34px]" },
};

export function Wordmark({
  size = "sm",
  label = "Radius",
  showCube: _showCube = false,
  staticCube: _staticCube = true,
  className,
}: {
  size?: WordmarkSize;
  label?: string;
  showCube?: boolean;
  staticCube?: boolean;
  className?: string;
}) {
  const selectedSize = SIZES[size];

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          selectedSize.text,
          "font-normal uppercase leading-none tracking-[0.05em]",
        )}
      >
        {label}
      </span>
    </span>
  );
}
