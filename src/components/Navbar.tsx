"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

export function Navbar() {
  const { data: session } = useSession();

  return (
    <nav className="bg-white shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link href="./" className="text-xl font-bold text-gray-900 leading-tight">
              <span className="block">Aiven</span>
              <span className="block text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">
                AI Driven ERP
              </span>
            </Link>
          </div>

          <div className="flex items-center space-x-4">
            {session ? (
              <>
                <Link
                  href="/dashboard"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Dashboard
                </Link>
                <Link
                  href="/tasks"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Tasks
                </Link>
                <button
                  onClick={() => signOut()}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="./login"
                  className="text-gray-600 hover:text-gray-900"
                >
                  Sign In
                </Link>
                <Link
                  href="./register"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
} 