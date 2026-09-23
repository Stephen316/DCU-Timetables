"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/review", label: "Review queue" },
  { href: "/ask", label: "Ask" },
  { href: "/courses", label: "Courses" },
  { href: "/people", label: "People" },
  { href: "/security", label: "Security" },
  { href: "/audit", label: "Audit" },
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
    </nav>
  );
}
