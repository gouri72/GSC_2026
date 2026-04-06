import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "Aura Backend Ready 🔮", phase: 1 });
});

app.post("/register", (req, res) => {
  res.json({ message: "Register route - Phase 3 coming soon" });
});

app.post("/verify", (req, res) => {
  res.json({ message: "Verify route - Phase 5 coming soon" });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});