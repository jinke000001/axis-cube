import type { AnchorHTMLAttributes, ReactNode } from "react";
import { navigate, routeHref } from "./router";

export function Link({ to, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }) {
  return <a {...props} href={routeHref(to)} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target) return;
    event.preventDefault(); navigate(to);
  }}>{children}</a>;
}
