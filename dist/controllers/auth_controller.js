"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const user_model_1 = __importDefault(require("../models/user_model"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const google_auth_library_1 = require("google-auth-library");
const parseDuration = (duration) => {
    const units = {
        's': 1,
        'm': 60,
        'h': 3600,
        'd': 86400
    };
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
        throw new Error('Invalid duration format');
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    return value * units[unit];
};
const register = async (req, res) => {
    try {
        const password = req.body.password;
        const hashedPassword = await bcrypt_1.default.hash(password, 10);
        const user = await user_model_1.default.create({
            email: req.body.email,
            password: hashedPassword
        });
        res.status(200).send(user);
    }
    catch (err) {
        res.status(400).send("wrong email or password");
    }
};
const generateTokens = (user) => {
    const secret = process.env.TOKEN_SECRET;
    const accessExp = process.env.TOKEN_EXPIRE ?? '3d';
    const refreshExp = process.env.REFRESH_TOKEN_EXPIRE ?? '7d';
    if (!secret) {
        return null;
    }
    const random = Math.random().toString();
    const payload = {
        _id: user._id,
        random
    };
    // Convert string duration to seconds
    const accessTokenOptions = {
        expiresIn: parseDuration(accessExp)
    };
    const refreshTokenOptions = {
        expiresIn: parseDuration(refreshExp)
    };
    const accessToken = jsonwebtoken_1.default.sign(payload, secret, accessTokenOptions);
    const refreshToken = jsonwebtoken_1.default.sign(payload, secret, refreshTokenOptions);
    if (!user.refreshToken) {
        user.refreshToken = [];
    }
    user.refreshToken.push(refreshToken);
    return {
        accessToken,
        refreshToken
    };
};
const login = async (req, res) => {
    try {
        // Verify user & password
        const user = await user_model_1.default.findOne({ email: req.body.email });
        if (!user) {
            res.status(400).send("wrong email or password");
            return;
        }
        const password = req.body.password;
        if (!password) {
            res.status(400).send("Password is required");
            return;
        }
        const valid = user.password && await bcrypt_1.default.compare(password, user.password);
        if (!valid) {
            res.status(400).send("wrong email or password");
            return;
        }
        // Generate tokens
        const tokens = generateTokens(user);
        if (!tokens) {
            res.status(400).send("Access Denied");
            return;
        }
        await user.save();
        res.status(200).send({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            _id: user._id
        });
    }
    catch (err) {
        res.status(400).send("wrong email or password");
    }
};
const verifyAccessToken = (refreshToken) => {
    return new Promise((resolve, reject) => {
        if (!refreshToken) {
            reject("Access Denied");
            return;
        }
        if (!process.env.TOKEN_SECRET) {
            reject("Server Error");
            return;
        }
        jsonwebtoken_1.default.verify(refreshToken, process.env.TOKEN_SECRET, async (err, payload) => {
            if (err) {
                reject("Access Denied");
                return;
            }
            const userId = payload._id;
            try {
                const user = await user_model_1.default.findById(userId);
                if (!user) {
                    reject("Access Denied");
                    return;
                }
                if (!user.refreshToken || !user.refreshToken.includes(refreshToken)) {
                    user.refreshToken = [];
                    await user.save();
                    reject("Access Denied");
                    return;
                }
                user.refreshToken = user.refreshToken.filter((token) => token !== refreshToken);
                resolve(user);
            }
            catch (err) {
                reject("Access Denied");
                return;
            }
        });
    });
};
const logout = async (req, res) => {
    try {
        const user = await verifyAccessToken(req.body.refreshToken);
        await user.save();
        res.status(200).send("Logged out");
    }
    catch (err) {
        res.status(400).send("Access Denied");
        return;
    }
};
const refresh = async (req, res) => {
    try {
        const user = await verifyAccessToken(req.body.refreshToken);
        // Generate new tokens
        const tokens = generateTokens(user);
        await user.save();
        if (!tokens) {
            res.status(400).send("Access Denied");
            return;
        }
        // Send response
        res.status(200).send({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        });
    }
    catch (err) {
        res.status(400).send("Access Denied");
        return;
    }
};
const authMiddleware = (req, res, next) => {
    const authorization = req.headers.authorization;
    const token = authorization && authorization.split(" ")[1];
    if (!token) {
        res.status(401).send("Access Denied");
        return;
    }
    const secret = process.env.TOKEN_SECRET;
    if (!secret) {
        res.status(500).send("Server Error");
        return;
    }
    jsonwebtoken_1.default.verify(token, secret, (err, payload) => {
        if (err) {
            res.status(401).send("Access Denied");
            return;
        }
        const userId = payload._id;
        req.params.userId = userId;
        next();
    });
};
exports.authMiddleware = authMiddleware;
const client = new google_auth_library_1.OAuth2Client();
const googleSignin = async (req, res) => {
    try {
        const ticket = await client.verifyIdToken({
            idToken: req.body.credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload?.email;
        if (email != null) {
            let user = await user_model_1.default.findOne({ email: email });
            if (user == null) {
                user = await user_model_1.default.create({
                    name: payload?.name,
                    email: email,
                    password: "",
                    imgUrl: payload?.picture,
                });
            }
            const token = await generateTokens(user);
            res.status(200).send({
                email: user.email,
                _id: user._id,
                ...token,
            });
        }
    }
    catch (err) {
        if (err instanceof Error) {
            res.status(400).send(err.message);
        }
        else {
            res.status(400).send("An unknown error occurred");
        }
    }
};
exports.default = {
    register,
    login,
    logout,
    refresh,
    googleSignin,
};
