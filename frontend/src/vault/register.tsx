"use client";

import { useEffect, useState } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth, db } from "../app/lib/firebase"; 
import { collection, query, where, getDocs } from "firebase/firestore";
import { useRouter } from "next/navigation";

interface ProtectedDocument {
  id: string;
  title: string;
  createdAt: any;
  kmsSignature: string;
  totalChunks: number;
}

export default function VaultPage() {
  const [user, userLoading] = useAuthState(auth);
  const router = useRouter();
  
  const [documents, setDocuments] = useState<ProtectedDocument[]>([]);
  const [loading, setLoading] = useState(true);

  // 1. Auth Guard
  useEffect(() => {
    if (!userLoading && !user) {
      router.push("/");
    }
  }, [user, userLoading, router]);

  // 2. Fetch User's Protected Documents
  useEffect(() => {
    const fetchVault = async () => {
      if (!user) return;
      
      try {
        const q = query(
          collection(db, "documents"), 
          where("userId", "==", user.uid)
        );
        
        const querySnapshot = await getDocs(q);
        const docsData: ProtectedDocument[] = [];
        
        querySnapshot.forEach((doc) => {
          docsData.push({ id: doc.id, ...doc.data() } as ProtectedDocument);
        });

        // Sort locally by newest first to avoid needing a complex Firestore composite index
        docsData.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
        
        setDocuments(docsData);
      } catch (error) {
        console.error("Failed to load vault:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchVault();
  }, [user]);

  if (userLoading || loading) return <div className="flex h-screen items-center justify-center font-mono text-gray-500">Decrypting Vault...</div>;
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        
        {/* Header */}
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <h1 className="text-4xl font-black text-gray-900 tracking-tight">Your IP Vault</h1>
            </div>
            <p className="text-gray-500 text-sm">Cryptographically secured by Google Cloud KMS</p>
          </div>
          
          <div className="flex gap-3">
            <button 
              onClick={() => router.push("/register")}
              className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition-colors shadow-sm text-sm"
            >
              + Register New IP
            </button>
          </div>
        </header>

        {/* Vault Grid */}
        {documents.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 shadow-sm mt-10">
            <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">Your Vault is Empty</h3>
            <p className="text-gray-500 max-w-md mx-auto">You haven't protected any intellectual property yet. Head back to the dashboard to register your first document.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {documents.map((doc) => (
              <div key={doc.id} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden">
                
                {/* Decorative background element */}
                <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-500 -z-10" />

                <div className="flex justify-between items-start mb-4">
                  <div className="bg-emerald-100 text-emerald-700 text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider">
                    Verified
                  </div>
                  <span className="text-xs text-gray-400 font-medium">
                    {doc.createdAt ? new Date(doc.createdAt.toMillis()).toLocaleDateString() : 'Just now'}
                  </span>
                </div>

                <h3 className="text-lg font-bold text-gray-900 mb-1 truncate" title={doc.title}>
                  {doc.title}
                </h3>
                <p className="text-xs text-gray-500 mb-6 font-medium">
                  {doc.totalChunks} Semantic Chunk{doc.totalChunks !== 1 ? 's' : ''} Locked
                </p>

                <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">KMS Signature (RSA-2048)</p>
                  <p className="text-xs font-mono text-gray-600 break-all line-clamp-3 leading-relaxed">
                    {doc.kmsSignature}
                  </p>
                </div>

                <div className="mt-5 pt-4 border-t border-gray-50 flex justify-between items-center text-xs">
                  <span className="text-gray-400">ID: {doc.id.substring(0, 8)}...</span>
                  <button className="text-indigo-600 font-bold hover:text-indigo-800 transition-colors">
                    View Cert
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}