"use client";
import { auth } from "@/lib/firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import firebase from "firebase/compat/app";

export default function RegisterPage() {
  const [user, loading] = useAuthState(auth);
  const router = useRouter();
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!loading && !user) router.push("/");
  }, [user, loading, router]);

  const handleRegister = async () => {
    if (!text.trim() || !title.trim()) return;
    setStatus("Registering... (backend coming in Phase 3)");
    console.log("Will send:", { title, text });
  };

  if (loading || !user) return <div className="p-8">Loading...</div>;

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">📝 Register Your Work</h1>
      <div className="flex flex-col gap-4">
        <input
          type="text"
          placeholder="Title of your work"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border rounded-lg px-4 py-2 w-full"
        />
        <textarea
          placeholder="Paste your text here..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="border rounded-lg px-4 py-2 w-full font-mono text-sm"
        />
        <button
          onClick={handleRegister}
          className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 w-full"
        >
          🔮 Register Ownership
        </button>
        {status && <p className="text-sm text-gray-500">{status}</p>}
      </div>
    </main>
  );
}