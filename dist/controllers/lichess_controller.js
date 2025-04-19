"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const user_model_1 = __importDefault(require("../models/user_model"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const LICHESS_AUTHORIZE_URL = "https://lichess.org/oauth";
const LICHESS_TOKEN_URL = "https://lichess.org/api/token";
const LICHESS_ACCOUNT_URL = "https://lichess.org/api/account";
const clientId = process.env.LICHESS_CLIENT_ID;
const redirectUri = process.env.LICHESS_REDIRECT_URI;
const tokenSecret = process.env.TOKEN_SECRET;
const tokenExpire = process.env.TOKEN_EXPIRE ?? "3d";
// פונקציה לפירוק משך זמן כמו "3d" לשניות
const parseDuration = (duration) => {
    const units = {
        s: 1,
        m: 60,
        h: 3600,
        d: 86400,
    };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match)
        throw new Error("Invalid duration format");
    return parseInt(match[1]) * units[match[2]];
};
// פונקציות PKCE
function generateCodeVerifier() {
    return crypto_1.default.randomBytes(32).toString("base64url");
}
function generateCodeChallenge(verifier) {
    return crypto_1.default.createHash("sha256").update(verifier).digest("base64url");
}
// יצירת URL להפניית המשתמש להתחברות דרך Lichess
const loginWithLichess = (req, res) => {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    req.session.codeVerifier = codeVerifier;
    const authUrl = `${LICHESS_AUTHORIZE_URL}?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=preference:read&code_challenge=${codeChallenge}&code_challenge_method=S256`;
    res.redirect(authUrl);
};
// callback מה-lichess
const lichessCallback = async (req, res) => {
    const code = req.query.code;
    const codeVerifier = req.session.codeVerifier;
    if (!codeVerifier) {
        res.status(400).json({ error: "Missing code_verifier from session" });
        return;
    }
    try {
        const tokenRes = await axios_1.default.post(LICHESS_TOKEN_URL, new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            code_verifier: codeVerifier,
        }), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        const accessToken = tokenRes.data.access_token;
        const userInfoRes = await axios_1.default.get(LICHESS_ACCOUNT_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const lichessUser = userInfoRes.data;
        const lichessId = lichessUser.id;
        let user = await user_model_1.default.findOne({ lichessId });
        if (!user) {
            user = await user_model_1.default.create({ lichessId });
        }
        const token = jsonwebtoken_1.default.sign({ _id: user._id }, tokenSecret, {
            expiresIn: parseDuration(tokenExpire),
        });
        res.redirect(`http://localhost:5173/login?token=${token}&userId=${user._id}&lichessId=${user.lichessId}`);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Lichess login failed" });
    }
};
exports.default = {
    loginWithLichess,
    lichessCallback,
};
