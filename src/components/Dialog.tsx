import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { Button, IconButton } from "./controls";
import "./Dialog.css";

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 440,
  onSubmit,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  onSubmit?(): void;
}) {
  const panel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button.btn-primary");
    first?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      previous?.focus?.();
    };
  }, [onClose]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={panel}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width }}
        onSubmit={submit}
      >
        <header>
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </form>
    </div>
  );
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  hint?: ReactNode;
  confirm?: string;
  /** Returns an error message to keep the dialog open. */
  validate?(value: string): string | null;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirm: string;
  danger?: boolean;
}

interface Dialogs {
  prompt(options: PromptOptions): Promise<string | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

const DialogContext = createContext<Dialogs | null>(null);

export const useDialogs = () => {
  const dialogs = useContext(DialogContext);
  if (!dialogs) throw new Error("useDialogs outside DialogProvider");
  return dialogs;
};

type Active =
  | { kind: "prompt"; options: PromptOptions; resolve(value: string | null): void }
  | { kind: "confirm"; options: ConfirmOptions; resolve(value: boolean): void };

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => setActive({ kind: "prompt", options, resolve })),
    [],
  );
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setActive({ kind: "confirm", options, resolve })),
    [],
  );
  const [value] = useState<Dialogs>(() => ({ prompt, confirm }));
  return (
    <DialogContext.Provider value={value}>
      {children}
      {active?.kind === "prompt" && (
        <PromptDialog
          options={active.options}
          done={(result) => {
            setActive(null);
            active.resolve(result);
          }}
        />
      )}
      {active?.kind === "confirm" && (
        <Dialog
          title={active.options.title}
          onClose={() => {
            setActive(null);
            active.resolve(false);
          }}
          onSubmit={() => {
            setActive(null);
            active.resolve(true);
          }}
          footer={
            <>
              <Button
                onClick={() => {
                  setActive(null);
                  active.resolve(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant={active.options.danger ? "danger" : "primary"} autoFocus>
                {active.options.confirm}
              </Button>
            </>
          }
        >
          <div className="dialog-message">{active.options.message}</div>
        </Dialog>
      )}
    </DialogContext.Provider>
  );
}

function PromptDialog({ options, done }: { options: PromptOptions; done(value: string | null): void }) {
  const [text, setText] = useState(options.initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Select the name part, not the extension, like file managers do.
    const value = input.current?.value ?? "";
    const dot = value.lastIndexOf(".");
    input.current?.setSelectionRange(value.lastIndexOf("/") + 1, dot > value.lastIndexOf("/") ? dot : value.length);
  }, []);
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    const problem = options.validate?.(value) ?? null;
    if (problem) setError(problem);
    else done(value);
  };
  return (
    <Dialog
      title={options.title}
      onClose={() => done(null)}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={() => done(null)}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!text.trim()}>
            {options.confirm ?? "OK"}
          </Button>
        </>
      }
    >
      <label className="field">
        {options.label}
        <input
          ref={input}
          className="input"
          autoFocus
          value={text}
          placeholder={options.placeholder}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </label>
      {error ? <p className="dialog-error">{error}</p> : options.hint && <p className="dialog-hint">{options.hint}</p>}
    </Dialog>
  );
}
