"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  {
    href: "/",
    label: "Control ROAS",
    desc: "Rentabilidad publicitaria por workspace",
  },
  {
    href: "/pendientes",
    label: "Pendientes",
    desc: "Control operativo de tareas",
  },
  {
    href: "/manychat",
    label: "ManyChat",
    desc: "Leads de WhatsApp",
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-[#111111] text-white transition-[width] duration-300 ${
          collapsed ? "w-0 overflow-hidden" : "w-72"
        }`}
      >
        <div className="shrink-0 border-b border-white/10 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-500">
            Lima Retail
          </p>
          <h1 className="mt-3 text-2xl font-bold">LR Suite</h1>
          <p className="mt-2 text-sm text-gray-400">
            Suite operativa Lima Retail
          </p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {NAV.map(({ href, label, desc }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`block rounded-2xl px-4 py-3 transition ${
                  active
                    ? "bg-red-700 font-bold text-white"
                    : "text-gray-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-xs text-gray-400">
                  {desc}
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
        className={`fixed top-6 z-50 flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-[#111111] text-white shadow-lg transition-[left] duration-300 ${
          collapsed ? "left-3" : "left-[276px]"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`}
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
    </>
  );
}
