"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const lichess_controller_1 = __importDefault(require("../controllers/lichess_controller"));
const router = express_1.default.Router();
router.get("/login", lichess_controller_1.default.loginWithLichess);
router.get("/callback", lichess_controller_1.default.lichessCallback);
exports.default = router;
