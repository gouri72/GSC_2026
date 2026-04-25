"use client";

import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "./lib/firebase"; 
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuthState } from "react-firebase-hooks/auth";

export default function LandingPage() {
  const [user, loading] = useAuthState(auth);
  const router = useRouter();

  // Auto-redirect if already logged in
  useEffect(() => {
    if (user) {
      router.push("/register");
    }
  }, [user, router]);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    
    // THE MAGIC FIX: Forces the Google account chooser every time
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    try {
      await signInWithPopup(auth, provider);
      // It will auto-redirect due to the useEffect above
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center font-mono text-gray-500">Checking Aura Access...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-white p-10 rounded-3xl shadow-xl text-center border border-gray-100">
        <h1 className="text-5xl font-black text-indigo-600 tracking-tighter mb-2">AURA</h1>
        <p className="text-gray-500 mb-10 font-medium text-sm">Zero-Trust Intellectual Property Protection</p>
        
        <button 
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 hover:border-indigo-600 hover:bg-indigo-50 text-gray-800 font-bold py-4 px-6 rounded-xl transition-all shadow-sm active:scale-95"
        >
          {/* Google G Logo */}
          <svg className="w-6 h-6" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign In with Google
        </button>
        <p className="mt-8 text-xs text-gray-400 font-semibold uppercase tracking-widest">GSC 2026 Internal Access</p>
      </div>
    </div>
  );
}
