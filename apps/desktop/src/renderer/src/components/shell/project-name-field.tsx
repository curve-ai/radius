import { Folder } from "lucide-react";
import type { ChangeEventHandler, ReactNode } from "react";

import { Input } from "@renderer/components/ui/input";

export function ProjectNameField({
  autoFocus,
  id,
  onChange,
  placeholder,
  value,
}: {
  autoFocus?: boolean;
  id: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  value: string;
}): ReactNode {
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        Project name
      </label>
      <div className="flex h-11 overflow-hidden rounded-md border border-input bg-background transition-[border-color,box-shadow] focus-within:border-foreground/25 focus-within:ring-1 focus-within:ring-ring">
        <span className="flex w-11 shrink-0 items-center justify-center border-r border-border text-muted-foreground">
          <Folder className="size-4" aria-hidden />
        </span>
        <Input
          id={id}
          autoFocus={autoFocus}
          maxLength={120}
          value={value}
          placeholder={placeholder}
          className="h-full rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onChange={onChange}
        />
      </div>
    </div>
  );
}
