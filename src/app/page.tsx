import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)]">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
          Welcome to Aiven
        </h1>
        <p className="mt-2 text-xl font-semibold tracking-tight text-blue-600">
          AI Driven ERP
        </p>
        <p className="mt-6 text-lg leading-8 text-gray-600">
          Aiven is a modern, AI-driven business management solution designed to help small and
          medium enterprises streamline their operations and grow their business.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <Link
            to="./register"
            className="rounded-md bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            Get started
          </Link>
          <Link
            to="./about"
            className="text-sm font-semibold leading-6 text-gray-900"
          >
            Learn more <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
} 