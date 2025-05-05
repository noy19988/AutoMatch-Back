"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = __importDefault(require("./server"));
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const port = process.env.PORT;
const tmpFunc = async () => {
    const app = await (0, server_1.default)();
    if (process.env.NODE_ENV != "production") {
        app.listen(port, () => {
            console.log(`Example app listening at http://localhost:${port}`);
        });
    }
    else {
        const prop = {
            key: fs_1.default.readFileSync(path_1.default.join(__dirname, "..", "client-key.pem")),
            cert: fs_1.default.readFileSync(path_1.default.join(__dirname, "..", "client-cert.pem"))
        };
        https_1.default.createServer(prop, app).listen(port);
    }
};
tmpFunc();
