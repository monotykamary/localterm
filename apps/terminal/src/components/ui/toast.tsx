import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Check, Info } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

// Module-level manager: the Terminal renders the <ToastProvider> itself, so its
// own toast callbacks run before the provider is an ancestor — context won't
// reach them. The singleton lets any caller enqueue; the provider subscribes.
const toastManager = ToastPrimitive.createToastManager();

const useToast = () => toastManager;

// Panel + enter/exit animation mirror the app's popover/modal overlays
// (animation-classes.ts): fade + zoom + slide from the top, duration-150 in /
// duration-100 out, ease-snappy. Base UI keeps data-starting-style for the
// toast's life and swaps to data-ending-style on dismiss, so the keyframe
// utilities (not CSS transitions) are what actually fire here.
const toastPanel =
  "pointer-events-none rounded-lg bg-background/90 px-3 py-2 text-xs shadow-md ring-1 ring-foreground/10 backdrop-blur-md outline-none ease-snappy max-w-[calc(100vw-2rem)] [&[data-starting-style]]:animate-in [&[data-starting-style]]:fade-in-0 [&[data-starting-style]]:zoom-in-95 [&[data-starting-style]]:slide-in-from-top-2 [&[data-starting-style]]:duration-150 [&[data-ending-style]]:animate-out [&[data-ending-style]]:fade-out-0 [&[data-ending-style]]:zoom-out-95 [&[data-ending-style]]:slide-out-to-top-2 [&[data-ending-style]]:duration-100";

const toastIconVariants = cva("size-4 shrink-0", {
  variants: {
    variant: {
      default: "text-muted-foreground",
      loading: "text-muted-foreground",
      success: "text-emerald-400",
      destructive: "text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

type ToastVariant = VariantProps<typeof toastIconVariants>["variant"];

const resolveToastVariant = (type: string | undefined): ToastVariant => {
  if (type === "success" || type === "destructive" || type === "loading") return type;
  return "default";
};

const ToastIcon = ({ variant }: { variant: ToastVariant }) => {
  if (variant === "loading") {
    return (
      <Spinner
        aria-hidden="true"
        className={cn("shrink-0 text-muted-foreground", toastIconVariants({ variant }))}
      />
    );
  }
  if (variant === "success") {
    return <Check aria-hidden="true" className={toastIconVariants({ variant })} />;
  }
  if (variant === "destructive") {
    return <AlertTriangle aria-hidden="true" className={toastIconVariants({ variant })} />;
  }
  return <Info aria-hidden="true" className={toastIconVariants({ variant })} />;
};

const ToastProvider = (props: React.ComponentProps<typeof ToastPrimitive.Provider>) => (
  <ToastPrimitive.Provider toastManager={toastManager} {...props} />
);

const ToastViewport = ({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) => (
  <ToastPrimitive.Viewport
    data-slot="toast-viewport"
    className={cn(
      "fixed top-4 inset-x-0 z-[60] flex flex-col items-center gap-2 pointer-events-none",
      className,
    )}
    {...props}
  />
);

const Toast = ({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Root>) => (
  <ToastPrimitive.Root
    data-slot="toast"
    swipeDirection={[]}
    className={cn(toastPanel, className)}
    {...props}
  />
);

const ToastContent = ({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Content>) => (
  <ToastPrimitive.Content
    data-slot="toast-content"
    className={cn("flex items-center gap-2.5", className)}
    {...props}
  />
);

const ToastTitle = ({ className, ...props }: React.ComponentProps<typeof ToastPrimitive.Title>) => (
  <ToastPrimitive.Title
    data-slot="toast-title"
    className={cn("min-w-0 text-foreground", className)}
    {...props}
  />
);

const ToastDescription = ({
  className,
  ...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) => (
  <ToastPrimitive.Description
    data-slot="toast-description"
    className={cn("min-w-0 text-muted-foreground", className)}
    {...props}
  />
);

const Toaster = () => {
  const { toasts } = ToastPrimitive.useToastManager();
  return (
    <ToastViewport>
      {toasts.map((toast) => {
        const variant = resolveToastVariant(toast.type);
        return (
          <Toast key={toast.id} toast={toast}>
            <ToastContent>
              <ToastIcon variant={variant} />
              {toast.title ? <ToastTitle>{toast.title}</ToastTitle> : null}
              {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
            </ToastContent>
          </Toast>
        );
      })}
    </ToastViewport>
  );
};

export {
  Toast,
  ToastContent,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  Toaster,
  useToast,
};
