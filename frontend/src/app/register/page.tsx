"use client";

import { useState, useEffect } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../lib/firebase"; 
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

export default function AuraInterface() {
  // 1. Auth Guard & State
  const [user, userLoading] = useAuthState(auth);
  const router = useRouter();

  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(""); 
  const [results, setResults] = useState<any>(null);
  const [mode, setMode] = useState<"register" | "verify">("verify");

  // Redirect if not logged in
  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/");
    }
  }, [user, userLoading, router]);

  // Logout Handler
  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // Main Processing Handler
  const handleProcess = async () => {
    if (!user) return;
    
    setLoading(true);
    setResults(null);
    const endpoint = mode === "register" ? "/api/register" : "/api/verify";
    
    setStatus(mode === "register" ? "Extracting Semantic Shadows..." : "Analyzing Linguistics...");

    try {
      // 1. Grab the secure Firebase ID token for the backend!
      const token = await user.getIdToken();

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          // 2. Inject the VIP pass so your backend doesn't reject the request
          "Authorization": `Bearer ${token}` 
        },
        body: JSON.stringify({
          title: title || "Untitled Analysis",
          text,
          isOG: mode === "register"
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setResults(data);

      // 3. The Redirect Logic!
      if (data.success && mode === "register") {
        // Wait 2.5 seconds so they can see the "Aura Locked" animation
        setTimeout(() => {
          // You can change '/vault' to '/' if you just want to go back to the home page
          router.push(`/vault`); 
        }, 2500);
      }

    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  if (userLoading) return <div className="flex h-screen items-center justify-center font-mono">Initializing Aura...</div>;
  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">
      <header className="mb-8 flex justify-between items-end">
        <div>
           <h1 className="text-4xl font-black text-indigo-600 tracking-tighter">AURA</h1>
           <p className="text-gray-500 text-sm">Semantic Plagiarism Engine • GSC 2026</p>
        </div>
        
        <div className="text-right flex flex-col items-end">
            <p className="text-xs font-bold text-gray-400 uppercase">Authenticated As</p>
            <p className="text-sm font-medium">{user.displayName || user.email}</p>
            <button 
              onClick={handleLogout} 
              className="text-xs text-red-500 hover:text-red-700 font-bold transition-colors mt-1 px-3 py-1 border border-red-100 hover:bg-red-50 rounded shadow-sm"
            >
              Sign Out
            </button>
        </div>
      </header>

      {/* Mode Switcher */}
      <div className="flex bg-gray-100 p-1 rounded-xl mb-6">
        <button 
          onClick={() => { setMode("verify"); setResults(null); }}
          className={`flex-1 py-3 rounded-lg transition-all ${mode === 'verify' ? 'bg-white shadow-md text-indigo-600 font-bold' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Check Plagiarism
        </button>
        <button 
          onClick={() => { setMode("register"); setResults(null); }}
          className={`flex-1 py-3 rounded-lg transition-all ${mode === 'register' ? 'bg-white shadow-md text-indigo-600 font-bold' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Register Original
        </button>
      </div>

      <div className="space-y-4">
        {mode === "register" && (
          <input 
            type="text" 
            placeholder="Document Title (e.g., Thesis Chapter 1)"
            className="w-full p-4 border-2 border-gray-100 rounded-xl outline-indigo-500 transition-all focus:border-indigo-300"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <textarea
          rows={10}
          className="w-full p-6 border-2 border-gray-100 rounded-2xl shadow-inner focus:ring-4 focus:ring-indigo-50/50 outline-none resize-none text-gray-700 leading-relaxed"
          placeholder={mode === "register" ? "Enter your original work to protect it..." : "Paste suspicious content to verify its aura..."}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        <button
          onClick={handleProcess}
          disabled={loading || !text}
          className={`w-full py-5 rounded-2xl font-black text-lg shadow-lg transition-all active:scale-[0.98] ${
            loading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200'
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-3">
              <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {status}
            </span>
          ) : (
            mode === "register" ? "REGISTER IN VAULT" : "RUN FORENSIC SCAN"
          )}
        </button>
      </div>

      {/* RESULTS SECTION (VERIFY MODE) */}
      {results && mode === "verify" && (
        <div className="mt-12 space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500">
          <div className={`p-8 rounded-3xl border-l-8 shadow-xl ${results.overallVerdict === 'PLAGIARISM DETECTED' ? 'border-red-500 bg-white' : 'border-emerald-500 bg-white'}`}>
            <h2 className={`text-sm font-bold uppercase tracking-widest mb-2 ${results.overallVerdict === 'PLAGIARISM DETECTED' ? 'text-red-500' : 'text-emerald-500'}`}>
              {results.overallVerdict}
            </h2>
            <div className="flex items-baseline gap-2">
               <span className="text-5xl font-black text-gray-900">{results.results?.[0]?.highestMatch?.score || 0}%</span>
               <span className="text-gray-400 font-bold">Similarity Index</span>
            </div>
          </div>

          <div className="grid gap-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest px-2">Linguistic Breakdown</h3>
            {results?.results?.map((res: any, i: number) => (
              <div key={i} className="group p-5 bg-white border border-gray-100 rounded-2xl hover:border-indigo-200 transition-all shadow-sm">
                <div className="flex justify-between items-center mb-3">
                   <span className="text-[10px] font-bold bg-gray-100 px-2 py-1 rounded text-gray-500">SEGMENT {i + 1}</span>
                   <span className={`text-xs font-black ${res.highestMatch.flagged ? 'text-red-500' : 'text-indigo-500'}`}>
                    {res.highestMatch.score}% MATCH
                   </span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed italic border-l-2 border-indigo-100 pl-4">
                    "{res.shadow.core_thesis}"
                </p>
                <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between text-[11px]">
                    <span className="text-gray-400 font-medium">Source: <span className="text-gray-700">{res.highestMatch.title}</span></span>
                    <span className="text-gray-300">ID: {res.highestMatch.docId.slice(0,8)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RESULTS SECTION (REGISTER MODE) */}
      {results && mode === "register" && (
        <div className="mt-8 p-10 bg-emerald-50 rounded-3xl text-center border-2 border-emerald-100 animate-in zoom-in duration-300">
          <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200">
             <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-emerald-900 font-black text-2xl">Aura Locked</p>
          <p className="text-emerald-600 font-medium mt-1">Your work is now registered and protected.</p>
          {results.certificatePreview && (
            <p className="text-xs text-emerald-400 font-mono mt-4 break-all max-w-sm mx-auto">
              Sig: {results.certificatePreview}
            </p>
          )}
        </div>
      )}
    </div>
  );
}