import { Router, Response } from "express";
import { verifyFirebaseToken, AuthRequest } from "../middleware/auth";

const router = Router();

router.post("/", verifyFirebaseToken, async (req: AuthRequest, res: Response) => {
  const { title, text } = req.body;
  const userId = req.user?.uid;

  if (!text || !title) {
    res.status(400).json({ error: "Title and text are required" });
    return;
  }

  // Phase 3: Gemini extracts semantic shadow here
  // Phase 4: Embedding generated here
  // Phase 5: Stored in Firestore here
  // Original text is NEVER stored

  res.json({
    message: "Text received. Pipeline coming in Phase 3.",
    userId,
    title,
  });
});

export default router;