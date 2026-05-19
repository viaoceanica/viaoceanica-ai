/**
 * Minimal server entry point for Manus deployment.
 * The actual backend runs as separate microservices on VPS.
 * This file serves the built frontend assets via Express.
 */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Serve static frontend assets
app.use(express.static(path.join(__dirname, "public")));

// SPA fallback - serve index.html for all routes
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}/`);
});
