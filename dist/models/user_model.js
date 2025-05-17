"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const Schema = mongoose_1.default.Schema;
const userSchema = new Schema({
    email: {
        type: String,
        unique: true,
        sparse: true,
    },
    password: {
        type: String,
    },
    refreshToken: {
        type: [String],
        default: [],
    },
    lichessId: {
        type: String,
        unique: true,
        sparse: true,
    },
    lichessAccessToken: {
        type: String,
    },
    balance: {
        type: Number,
        required: true, // חובה – תוודא שניתן ערך בקוד יצירת המשתמש
    },
    cheatingDetections: {
        type: [
            {
                gameId: String,
                timestamp: Date,
                confidence: Number,
                analysis: String,
            },
        ],
        default: [],
    },
});
const userModel = mongoose_1.default.model("Users", userSchema);
exports.default = userModel;
