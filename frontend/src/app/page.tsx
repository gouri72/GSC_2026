"use client";

import { useSignInWithGoogle, useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./lib/firebase"; 
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const [signInWithGoogle, gUser, gLoading, gError] = useSignInWithGoogle(auth);
  const [user, loading] = useAuthState(auth);
  const router = useRouter();

  // If the user successfully logs in, send them straight to the register page!
  useEffect(() => {
    if (user) {
      router.push("/register");
    }
  }, [user, router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-5xl font-bold mb-4 text-blue-600 tracking-tight">Aura GSC 2026</h1>
      <p className="text-xl text-gray-600 mb-8 max-w-md">
        Login to register your work and extract its semantic shadow securely.
      </p>
      
      {loading || gLoading ? (
        <div className="px-6 py-3 rounded-lg bg-gray-100 text-gray-700 animate-pulse">
          Checking authentication...
        </div>
      ) : (
        <button 
          onClick={() => signInWithGoogle()}
          className="bg-black text-white px-8 py-4 rounded-xl hover:bg-gray-800 transition font-medium shadow-xl hover:shadow-2xl hover:-translate-y-1"
        >
          Sign in with Google
        </button>
      )}
      
      {gError && <div className="text-red-500 mt-6 bg-red-50 p-4 rounded-lg border border-red-100">Error: {gError.message}</div>}
    </main>
  );
}
