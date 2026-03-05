import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function listModels() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return;

  // Use a simple fetch to list models if SDK doesn't expose it easily or just try SDK first
  // Actually SDK has no direct listModels on the main class in some versions, but let's try a direct REST call
  // to be sure what is available for this key.
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  try {
      const resp = await fetch(url);
      const data = await resp.json();
      console.log("Available Models:", JSON.stringify(data, null, 2));
  } catch (e) {
      console.error(e);
  }
}

listModels();
