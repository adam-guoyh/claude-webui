import { useState } from "react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Overrides the default outer wrapper className. */
  wrapperClassName?: string;
}

/**
 * <input type="password"> with a built-in eye toggle that flips the
 * underlying type to "text" so the user can sanity-check what they typed.
 * Everything else (placeholder, value, onChange, autoComplete, …) is
 * forwarded as-is so the call site looks identical to a raw input.
 */
export function PasswordInput({
  className = "",
  wrapperClassName = "relative",
  ...rest
}: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <div className={wrapperClassName}>
      <input
        {...rest}
        type={visible ? "text" : "password"}
        // pad-right leaves room for the icon button
        className={`${className} pr-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Anchored to the input's right edge. The wrapper is position:relative
        // by default; the input keeps its own border / focus ring.
        className="absolute inset-y-0 right-0 px-2 flex items-center text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 focus:outline-none"
        aria-label={t(visible ? "common.hidePassword" : "common.showPassword")}
        title={t(visible ? "common.hidePassword" : "common.showPassword")}
        tabIndex={-1}
      >
        {visible ? (
          <EyeSlashIcon className="w-4 h-4" />
        ) : (
          <EyeIcon className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
