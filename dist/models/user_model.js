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
        sparse: true // מאפשר קיום nullים ועדיין ייחודיות למי שיש ערך
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
        sparse: true // 🆕 אותו עיקרון כמו email
    },
});
const userModel = mongoose_1.default.model("Users", userSchema);
exports.default = userModel;
