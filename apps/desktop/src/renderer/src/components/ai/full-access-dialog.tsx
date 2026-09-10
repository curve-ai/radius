import { Folder, Globe, SquareTerminal, TriangleAlert } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@renderer/components/ui/dialog";

export function FullAccessDialog({
  applicationName,
  learnMoreHref,
  onConfirm,
  onOpenChange,
  onRestoreFocus,
  open,
}: {
  applicationName: string;
  learnMoreHref?: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: () => void;
  open: boolean;
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-2xl p-5 sm:max-w-[40rem] sm:p-6"
        overlayClassName="bg-black/15"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle className="type-md! flex items-center gap-3">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          Turn on Full Access?
        </DialogTitle>
        <DialogDescription className="text-base leading-6">
          {applicationName} will be able to run commands, use the internet, and
          create and edit files anywhere on this computer without your
          permission. This includes but is not limited to:
        </DialogDescription>
        <ul className="divide-y divide-border rounded-2xl bg-muted/60 px-4">
          <li className="flex items-center gap-4 py-3">
            <Folder
              className="size-6 shrink-0 fill-brand/20 text-brand"
              aria-hidden
            />
            <div>
              <p className="text-base font-medium">Files and folders</p>
              <p className="text-sm leading-5 text-muted-foreground">
                Read, create, modify, upload, or delete files anywhere on this
                computer
              </p>
            </div>
          </li>
          <li className="flex items-center gap-4 py-3">
            <SquareTerminal
              className="size-6 shrink-0 text-foreground/80"
              aria-hidden
            />
            <div>
              <p className="text-base font-medium">Terminal commands</p>
              <p className="text-sm leading-5 text-muted-foreground">
                Run commands, install software, and change system settings
              </p>
            </div>
          </li>
          <li className="flex items-center gap-4 py-3">
            <Globe className="size-6 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-base font-medium">
                Internet and connected apps
              </p>
              <p className="text-sm leading-5 text-muted-foreground">
                Access websites, send data, and use enabled plugins
              </p>
            </div>
          </li>
        </ul>
        <p className="text-base leading-6 text-muted-foreground">
          This comes with risks like loss or exposure of sensitive data and
          prompt injection. You can turn this off.{" "}
          {learnMoreHref ? (
            <a
              href={learnMoreHref}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Learn more
            </a>
          ) : null}
        </p>
        <DialogFooter className="flex-row justify-end gap-3">
          <Button
            ref={cancelRef}
            type="button"
            variant="ghost"
            className="min-w-24 bg-muted/60 hover:bg-muted"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-w-28 gap-2 bg-negative/10 text-negative hover:bg-negative/15 hover:text-negative"
            onClick={onConfirm}
          >
            <TriangleAlert className="size-4" aria-hidden />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
