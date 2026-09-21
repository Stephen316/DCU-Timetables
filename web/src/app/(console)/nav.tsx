"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/review", label: "Review queue" },
  { href: "/people", label: "People" },
  { href: "/audit", label: "Audit" },
];

// Listed but not built. Shown rather than hidden so the shape of the console is honest
// about what it does not do yet.
const pending = [
  { href: "/courses", label: "Courses" },
  { href: "/splits", label: "Splits" },
  { href: "/import", label: "Import" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
      {pending.map((l) => (
        <Link key={l.href} href={l.href} className="soon"
              aria-current={path === l.href ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
