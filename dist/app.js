"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
// טען את הקובץ הסביבתי הנכון (חייב להיות לפני import של appInit)
const envFile = process.env.NODE_ENV === "production" ? ".env_prod" : ".env_dev";
console.log("📄 Loading env file:", envFile);
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "..", envFile) });
console.log("🔧 DB_CONNECTION from env:", process.env.DB_CONNECTION);
console.log("🌍 NODE_ENV:", process.env.NODE_ENV);
const server_1 = __importDefault(require("./server"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const tmpFunc = async () => {
    const app = await (0, server_1.default)();
    if (process.env.NODE_ENV !== "production") {
        const port = process.env.PORT || 3060;
        app.listen(port, () => {
            console.log(`🟢 Dev server listening at https://localhost:${port}`);
        });
    }
    else {
        // הגדרת HTTPS
        const httpsOptions = {
            key: fs_1.default.readFileSync(path_1.default.join(__dirname, "..", "myserver.key")),
            cert: fs_1.default.readFileSync(path_1.default.join(__dirname, "..", "CSB.crt")),
        };
        // שרת HTTP על פורט 80
        http_1.default.createServer(app).listen(80, () => {
            console.log("🌐 HTTP server running on port 80");
        });
        // שרת HTTPS על פורט 443
        https_1.default.createServer(httpsOptions, app).listen(443, () => {
            console.log("🔒 HTTPS server running on port 443");
        });
    }
};
tmpFunc();
