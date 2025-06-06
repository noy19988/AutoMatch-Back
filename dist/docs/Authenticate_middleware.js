"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
        return res.status(401).json({ message: "Access Denied: No Token Provided" });
    }
    if (!process.env.TOKEN_SECRET) {
        return res.status(500).json({ message: "Server Error: Missing TOKEN_SECRET" });
    }
    jsonwebtoken_1.default.verify(token, process.env.TOKEN_SECRET, (err, payload) => {
        if (err) {
            return res.status(403).json({ message: "Invalid Token" });
        }
        const jwtPayload = payload;
        req.userId = jwtPayload._id;
        next();
    });
};
exports.authenticateToken = authenticateToken;
