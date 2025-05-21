import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import https from "https";
import http from "http";
import { initializeSocketServer, startGamePolling } from "./controllers/live_stream_controller";
import appInit from "./server";

// 🟡 טען את קובץ הסביבה המתאים
const envFile = process.env.NODE_ENV === "production" ? ".env_prod" : ".env_dev";
console.log("📄 Loading env file:", envFile);
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });

console.log("🔧 DB_CONNECTION from env:", process.env.DB_CONNECTION);
console.log("🌍 NODE_ENV:", process.env.NODE_ENV);

// ✅ פונקציית הרצה
const tmpFunc = async () => {
  const app = await appInit();

  if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT || 3060;
    app.listen(port, () => {
      console.log(`🟢 Dev server listening at http://localhost:${port}`);
    });
  } else {
    // ✅ הגדרת HTTPS פעם אחת
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, "..", "myserver.key")),
      cert: fs.readFileSync(path.join(__dirname, "..", "CSB.crt")),
    };

    // ✅ יצירת השרת פעם אחת
    const httpsServer = https.createServer(httpsOptions, app);

    // ✅ חיבור socket.io לשרת
    const io = initializeSocketServer(httpsServer);
    app.set("socketio", io);
    startGamePolling(io);

    // ✅ הרצת HTTPS (פעם אחת בלבד!)
    httpsServer.listen(443, () => {
      console.log("🔒 HTTPS server running on port 443");
    });

    // ✅ הרצת HTTP רק כ־redirect (מומלץ)
    http.createServer((req, res) => {
      const host = req.headers.host?.replace(/:\d+$/, "") || "automatch.cs.colman.ac.il";
      res.writeHead(301, { Location: `https://${host}${req.url}` });
      res.end();
    }).listen(80, () => {
      console.log("🌐 HTTP redirect server running on port 80");
    });
  }
};

tmpFunc();


