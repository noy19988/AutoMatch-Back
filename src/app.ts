import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// טען את הקובץ הסביבתי הנכון (חייב להיות לפני import של appInit)
const envFile = process.env.NODE_ENV === "production" ? ".env_prod" : ".env_dev";
console.log("📄 Loading env file:", envFile);
dotenv.config({ path: path.resolve(__dirname, "..", envFile) });
console.log("🔧 DB_CONNECTION from env:", process.env.DB_CONNECTION);
console.log("🌍 NODE_ENV:", process.env.NODE_ENV);

import appInit from "./server";
import https from "https";
import http from "http";

const tmpFunc = async () => {
  const app = await appInit();

  if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT || 3060;
    app.listen(port, () => {
      console.log(`🟢 Dev server listening at https://localhost:${port}`);
    });
  } else {
    // הגדרת HTTPS
    const httpsOptions = {
      key: fs.readFileSync(path.join(__dirname, "..", "myserver.key")),
      cert: fs.readFileSync(path.join(__dirname, "..", "CSB.crt")),
    };
    

    // שרת HTTP על פורט 80
    http.createServer(app).listen(80, () => {
      console.log("🌐 HTTP server running on port 80");
    });


     // שרת HTTPS על פורט 443
     https.createServer(httpsOptions, app).listen(443, () => {
      console.log("🔒 HTTPS server running on port 443");
    });



  }

  
};

tmpFunc();
