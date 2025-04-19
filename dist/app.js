"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = __importDefault(require("./server"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const port = process.env.PORT || 3000;
const tmpFunc = async () => {
    const app = await (0, server_1.default)();
    app.listen(port, () => {
        console.log(`Server running at ${process.env.BASE_URL}:${port}`);
    });
};
tmpFunc();
